"use strict";
/**
 * CSB Extractor for ProjectWise Managed Workspaces
 *
 * Replicates what ProjectWise Explorer (PWE) does when opening a DGN file
 * in a Managed Workspace. The entry point mirrors how PWE actually works:
 *
 *   PWE flow
 *   ────────
 *   1. User opens a document → PWE determines the PW Application assigned
 *      to that document's folder (via aaApi_GetDocumentApplication / WSG
 *      Application-Document relationship)
 *   2. PWE looks up the Managed Workspace Profile assigned to that Application
 *   3. PWE collects all CSBs for that profile, ordered by level:
 *        Predefined → Global → Application → Customer → Site →
 *        WorkSpace → WorkSet/Project → Discipline → Role → User
 *   4. For each CSB, PWE writes a numbered {CsbID}.cfg file into the
 *      local working directory (e.g. %LOCALAPPDATA%\Bentley\MicroStation\...\dms\)
 *   5. PWE builds a master .tmp file that %includes each {CsbID}.cfg and
 *      seeds PW_WORKDIR, PW_DATASOURCE, PW_MANAGEDWORKSPACE
 *   6. PWE passes -wc <masterTmpPath> on the MicroStation command line
 *   7. MicroStation processes the .tmp, which triggers loading of workspace
 *      .cfg files referenced by _USTN_CONFIGURATION etc.
 *
 *   Extension entry point
 *   ─────────────────────
 *   A) User picks a PW Application (or document/folder) via QuickPick
 *   B) CSBs are fetched via one of three backends (PowerShell PW module,
 *      dmscli P/Invoke, or WSG document search)
 *   C) The same file structure PWE builds is materialised locally, then
 *      the master .tmp is passed to the cfg parser for variable resolution
 *
 * CSBs are NOT exposed directly via the WSG REST API (PW_WSG schema).
 * We access them via one of three backends, in preference order:
 *
 *   A) PowerShell + ProjectWise PowerShell Module (Get-PWConfigurationBlock,
 *      Get-PWManagedWorkspaceCSBs) — available on machines with PW client
 *   B) The native dmscli.dll via a small PowerShell helper script that
 *      calls aaApi_SelectManagedWorkspace* / aaApi_SelectConfigurationBlock*
 *   C) Direct WSG document download (when CSBs are stored as PW documents)
 *
 * CSB processing order (from Bentley documentation):
 * ────────────────────────────────────────────────────
 * %level 0  Predefined CSBs      (before System CFG files)
 * %level 0  System CFG files
 * %level 0  Global CSBs          (after System CFG files)
 * %level 1  Application CFG + Application CSBs
 * %level 2  Organization CFG + Customer CSBs + Site/Organization CSBs
 * %level 3  WorkSpace CSBs       (before WorkSpace CFG files)
 * %level 3  WorkSpace CFG files
 * %level 4  WorkSet/Project CSBs (before WorkSet CFG files)
 * %level 4  WorkSet CFG files
 * %level 4  Discipline CSBs
 * %level 5  Role CSBs + Role CFG file
 * %level 6  User CSBs
 *
 * CSB variable value types (PW-specific):
 * ────────────────────────────────────────
 *  Literal      — plain string, used as-is
 *  PWFolder     — PW logical folder path; maps to local dms<N>/ directory
 *  dms_project  — resolves to the working-copy folder for the current document
 *  LastDirPiece — last segment of a PW folder path (workspace/workset name)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSB_PROCESSING_ORDER = exports.CSB_LEVEL_MAP = void 0;
exports.extractManagedWorkspace = extractManagedWorkspace;
exports.listPwApplications = listPwApplications;
exports.getApplicationForFolder = getApplicationForFolder;
exports.csbToCfgContent = csbToCfgContent;
exports.buildMasterTmp = buildMasterTmp;
exports.parseManualCsbInput = parseManualCsbInput;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
/** Maps CSB level name to MicroStation %level number */
exports.CSB_LEVEL_MAP = {
    Predefined: 0,
    Global: 0,
    Application: 1,
    Customer: 2,
    Site: 2,
    WorkSpace: 3,
    WorkSet: 4,
    Discipline: 4,
    Role: 5,
    User: 6,
};
/** Processing order PWE uses when assembling the master .tmp */
exports.CSB_PROCESSING_ORDER = [
    'Predefined', 'Global', 'Application',
    'Customer', 'Site',
    'WorkSpace', 'WorkSet', 'Discipline',
    'Role', 'User',
];
// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Extract and materialise a Managed Workspace for the given PW context.
 *
 * Sequence (mirrors PWE):
 *  1. Fetch CSBs for the Application and/or folder via best available backend
 *  2. Sort CSBs into Bentley-defined processing order
 *  3. Download PW folders referenced by _USTN_CONFIGURATION (and other
 *     PWFolder values) into numbered dms subdirectories
 *  4. Write {CsbID}.cfg files with resolved local paths
 *  5. Write master .tmp with %includes and PW variable seeds
 *
 * The caller passes masterTmpPath to the cfg parser, which resolves the full
 * variable tree exactly as MicroStation would.
 */
async function extractManagedWorkspace(conn, ctx, client) {
    const workDir = ctx.workDir ?? path.join(os.tmpdir(), `pw-managed-ws-${Date.now()}`);
    const wsDir = path.join(workDir, 'workspace');
    fs.mkdirSync(wsDir, { recursive: true });
    const messages = [];
    const dmsPathMap = {};
    // ── Step 1: Fetch CSBs ────────────────────────────────────────────────────
    let csbs = null;
    let backend = 'manual';
    if (isPowerShellPwModuleAvailable()) {
        messages.push({ level: 'info', text: 'Backend A: ProjectWise PowerShell module' });
        try {
            csbs = await readCsbsViaPwModule(conn, ctx);
            backend = 'powershell-pwmodule';
            messages.push({ level: 'info', text: `Read ${csbs.length} CSBs via PW module` });
        }
        catch (e) {
            messages.push({ level: 'warning', text: `PW module failed: ${e}` });
        }
    }
    if (!csbs && isDmscliAvailable()) {
        messages.push({ level: 'info', text: 'Backend B: dmscli.dll P/Invoke' });
        try {
            csbs = await readCsbsViaDmscli(conn, ctx);
            backend = 'powershell-dmscli';
            messages.push({ level: 'info', text: `Read ${csbs.length} CSBs via dmscli` });
        }
        catch (e) {
            messages.push({ level: 'warning', text: `dmscli failed: ${e}` });
        }
    }
    if (!csbs) {
        messages.push({ level: 'info', text: 'Backend C: WSG document search' });
        try {
            csbs = await readCsbsViaWsg(client, ctx);
            backend = 'wsg-documents';
            messages.push({ level: 'info', text: `Found ${csbs.length} CSB document(s) via WSG` });
        }
        catch (e) {
            messages.push({ level: 'warning', text: `WSG search failed: ${e}` });
        }
    }
    if (!csbs || csbs.length === 0) {
        messages.push({
            level: 'error',
            text: 'Could not read CSBs automatically. Managed Workspace extraction requires one of:\n' +
                '  • ProjectWise Explorer client installed (provides dmscli.dll + PW PowerShell module)\n' +
                '  • CSBs stored as .cfg documents in the PW repository (WSG backend)\n' +
                '  • Use "Manual CSB Import" to paste CSB content directly\n' +
                'Falling back to pure CFG file download from the PW repository.',
        });
        csbs = [];
        backend = 'manual';
    }
    // ── Step 2: Sort into processing order ────────────────────────────────────
    const orderedCsbs = orderCsbs(csbs);
    // ── Step 3: Derive workspace / workset names ──────────────────────────────
    // These must be known before writing the master .tmp so the cfg parser
    // can resolve _USTN_WORKSPACENAME / _USTN_WORKSETNAME.
    const workspaceName = ctx.workspaceName ?? extractLastDirPiece(orderedCsbs, '_USTN_WORKSPACENAME');
    const worksetName = ctx.worksetName ?? extractLastDirPiece(orderedCsbs, '_USTN_WORKSETNAME');
    if (workspaceName)
        messages.push({ level: 'info', text: `WorkspaceName: ${workspaceName}` });
    if (worksetName)
        messages.push({ level: 'info', text: `WorksetName: ${worksetName}` });
    // ── Step 4: Download PW folders into dms directories ─────────────────────
    // First pass: _USTN_CONFIGURATION (primary configuration folder)
    const configRoot = extractConfigurationVariable(orderedCsbs);
    if (configRoot) {
        messages.push({ level: 'info', text: `_USTN_CONFIGURATION: ${configRoot}` });
        await downloadPwFolderToDms(client, configRoot, workDir, dmsPathMap, messages);
    }
    // Second pass: any other PWFolder type variables not yet downloaded
    await downloadAdditionalPwFolders(client, orderedCsbs, workDir, dmsPathMap, messages);
    // ── Step 5: Write {CsbID}.cfg files ───────────────────────────────────────
    for (const csb of orderedCsbs) {
        const cfgContent = csbToCfgContent(csb, workDir, dmsPathMap);
        const cfgPath = path.join(wsDir, `${csb.id}.cfg`);
        fs.writeFileSync(cfgPath, cfgContent, 'utf8');
        messages.push({
            level: 'info',
            text: `Wrote [${csb.level}] ${csb.name} (${csb.id}) → ${path.basename(cfgPath)}`,
        });
    }
    // ── Step 6: Write master .tmp ─────────────────────────────────────────────
    const masterTmpPath = path.join(wsDir, `${ctx.datasource}.tmp`);
    const masterContent = buildMasterTmp(orderedCsbs, wsDir, workDir, ctx, dmsPathMap, workspaceName, worksetName);
    fs.writeFileSync(masterTmpPath, masterContent, 'utf8');
    messages.push({ level: 'info', text: `Master config: ${path.basename(masterTmpPath)}` });
    return { masterTmpPath, workDir, csbs: orderedCsbs, dmsPathMap, workspaceName, worksetName, messages, backend };
}
// ─────────────────────────────────────────────────────────────────────────────
// PW Application listing (for the extension QuickPick)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * List all PW Applications in the datasource via WSG.
 *
 * The Application is the primary entity CSBs are assigned to. The user
 * should pick this (not a folder) when loading a Managed Workspace — this
 * mirrors the PWE flow where the document's Application drives everything.
 *
 * WSG endpoint: GET /PW_WSG/Application?$select=*
 */
async function listPwApplications(client) {
    try {
        const data = await client.get('/Application');
        return (data.instances ?? []).map((inst) => {
            const p = inst.properties ?? {};
            return {
                instanceId: inst.instanceId ?? '',
                name: p.Name ?? p.Label ?? inst.instanceId,
                description: p.Description ?? '',
                managedWorkspaceProfileId: p.ManagedWorkspaceProfileId ?? p.WorkspaceProfileId ?? undefined,
                managedWorkspaceProfileName: p.ManagedWorkspaceProfileName ?? undefined,
            };
        });
    }
    catch {
        // WSG may not expose Application list in all deployments
        return [];
    }
}
/**
 * Get the PW Application assigned to a specific folder.
 * Mirrors how PWE inherits the Application up the folder hierarchy.
 *
 * WSG endpoint: GET /PW_WSG/Project/{folderGuid}?$select=*
 */
async function getApplicationForFolder(client, folderGuid) {
    try {
        const data = await client.get(`/Project/${folderGuid}`);
        const p = (data.instances?.[0]?.properties ?? {});
        const appId = p.ApplicationId ?? p.Application ?? null;
        if (!appId)
            return null;
        const appData = await client.get(`/Application/${appId}`);
        const ap = (appData.instances?.[0]?.properties ?? {});
        return {
            instanceId: appId,
            name: ap.Name ?? ap.Label ?? appId,
            description: ap.Description ?? '',
            managedWorkspaceProfileId: ap.ManagedWorkspaceProfileId ?? undefined,
            managedWorkspaceProfileName: ap.ManagedWorkspaceProfileName ?? undefined,
        };
    }
    catch {
        return null;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Backend A: PowerShell ProjectWise Module
// ─────────────────────────────────────────────────────────────────────────────
function detectPowerShellPwModule() {
    if (process.platform !== 'win32')
        return null;
    try {
        const result = (0, child_process_1.spawnSync)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            '$m = Get-Module -ListAvailable -Name ProjectWise,PWPS_DAB | Select-Object -First 1 -ExpandProperty Name; if ($m) { $m }',
        ], { timeout: 8000 });
        const moduleName = (result.stdout?.toString() ?? '').trim();
        return moduleName || null;
    }
    catch {
        return null;
    }
}
function isPowerShellPwModuleAvailable() {
    return detectPowerShellPwModule() !== null;
}
async function readCsbsViaPwModule(conn, ctx) {
    const moduleName = detectPowerShellPwModule();
    if (!moduleName) {
        throw new Error('Neither ProjectWise nor PWPS_DAB PowerShell module is available.');
    }
    const script = `
param($Server, $Datasource, $Username, $Password, $ApplicationId, $FolderGuid)
Import-Module ${moduleName} -ErrorAction Stop
$secPass = ConvertTo-SecureString $Password -AsPlainText -Force
$creds = New-Object System.Management.Automation.PSCredential($Username, $secPass)
Open-PWDatasource -Server $Server -Datasource $Datasource -Credential $creds -ErrorAction Stop | Out-Null

$csbs = @()

# Primary: CSBs from the Managed Workspace Profile assigned to the Application
if ($ApplicationId) {
  $app = Get-PWApplication -Id $ApplicationId -ErrorAction SilentlyContinue
  if ($app) {
    $profile = Get-PWManagedWorkspaceProfile -Application $app -ErrorAction SilentlyContinue
    if ($profile) {
      $csbs += Get-PWConfigurationBlock -ManagedWorkspaceProfile $profile -AllLevels -ErrorAction SilentlyContinue
    }
  }
}

# Secondary: WorkSet/Project CSBs assigned directly to the PW folder
if ($FolderGuid) {
  $folder = Get-PWFolder -Guid $FolderGuid -ErrorAction SilentlyContinue
  if ($folder) {
    $csbs += Get-PWConfigurationBlock -Project $folder -ErrorAction SilentlyContinue
  }
}

$result = @()
foreach ($csb in ($csbs | Select-Object -Unique)) {
  $vars = @()
  foreach ($v in $csb.Variables) {
    $vars += @{
      Name      = $v.Name
      Operator  = $v.Operator
      Value     = $v.Value
      ValueType = if ($v.ValueType) { $v.ValueType.ToString() } else { 'Literal' }
      Locked    = [bool]$v.IsLocked
    }
  }
  $result += @{
    Id          = $csb.Id
    Name        = $csb.Name
    Description = $csb.Description
    Level       = $csb.Level.ToString()
    Variables   = $vars
    LinkedIds   = @($csb.LinkedCsbIds)
  }
}
$result | ConvertTo-Json -Depth 10
`;
    const tempScript = path.join(os.tmpdir(), `pw-csb-mod-${Date.now()}.ps1`);
    fs.writeFileSync(tempScript, script, 'utf8');
    try {
        const serverHostname = (() => { try {
            return new URL(conn.wsgUrl).hostname;
        }
        catch {
            return conn.wsgUrl;
        } })();
        const result = (0, child_process_1.spawnSync)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', tempScript,
            '-Server', serverHostname,
            '-Datasource', conn.datasource,
            '-Username', conn.username,
            '-Password', conn.credential,
            ...(ctx.applicationInstanceId ? ['-ApplicationId', ctx.applicationInstanceId] : []),
            ...(ctx.folderGuid ? ['-FolderGuid', ctx.folderGuid] : []),
        ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
        const out = result.stdout?.toString() ?? '';
        if (!out.trim())
            throw new Error(result.stderr?.toString() ?? 'No output from PowerShell');
        return parsePowerShellCsbJson(out);
    }
    finally {
        try {
            fs.unlinkSync(tempScript);
        }
        catch { /* ignore */ }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Backend B: dmscli.dll P/Invoke
// ─────────────────────────────────────────────────────────────────────────────
function isDmscliAvailable() {
    if (process.platform !== 'win32')
        return false;
    return getDmscliPath() !== null;
}
function getDmscliPath() {
    const candidates = [
        'C:/Program Files/Bentley/ProjectWise/bin/dmscli.dll',
        'C:/Program Files (x86)/Bentley/ProjectWise/bin/dmscli.dll',
        ...(process.env.PWDIR ? [path.join(process.env.PWDIR, 'bin/dmscli.dll')] : []),
    ];
    return candidates.find(p => fs.existsSync(p)) ?? null;
}
async function readCsbsViaDmscli(conn, ctx) {
    const dmscliPath = getDmscliPath();
    const serverHost = (() => { try {
        return new URL(conn.wsgUrl).hostname;
    }
    catch {
        return conn.wsgUrl;
    } })();
    const script = buildDmscliScript(conn, ctx, dmscliPath, serverHost);
    const tempScript = path.join(os.tmpdir(), `pw-dmscli-${Date.now()}.ps1`);
    fs.writeFileSync(tempScript, script, 'utf8');
    try {
        const result = (0, child_process_1.spawnSync)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', tempScript,
        ], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
        const out = result.stdout?.toString() ?? '';
        if (result.status !== 0 || !out.trim()) {
            throw new Error(result.stderr?.toString() || 'dmscli script produced no output');
        }
        return parsePowerShellCsbJson(out);
    }
    finally {
        try {
            fs.unlinkSync(tempScript);
        }
        catch { /* ignore */ }
    }
}
function buildDmscliScript(conn, ctx, dmscliPath, serverHost) {
    // Escape backslashes for the embedded C# string literal
    const dllPath = dmscliPath.replace(/\\/g, '\\\\');
    return `
# dmscli.dll P/Invoke — reads Managed Workspace CSBs from ProjectWise
# Correct entry point: aaApi_SelectManagedWorkspacesByApplication
# (not by project — applications are where the MW profile is assigned)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class DmsCli {
  [DllImport(@"${dllPath}")]
  public static extern bool aaApi_Login(string datasource, string user, string password, string server);
  [DllImport(@"${dllPath}")]
  public static extern bool aaApi_Logout();

  // Managed Workspace Profile selection
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectManagedWorkspacesByApplication(int applicationId);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectManagedWorkspacesByProject(int projectId);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetManagedWorkspaceNumericProperty(IntPtr hBuf, int propId, int row);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_GetManagedWorkspaceStringProperty(IntPtr hBuf, int propId, int row);

  // Configuration Settings Block (CSB) selection — by managed workspace profile ID
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectConfigurationBlocksByWorkspace(int workspaceProfileId);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetConfigBlockNumericProperty(IntPtr hBuf, int propId, int row);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_GetConfigBlockStringProperty(IntPtr hBuf, int propId, int row);

  // CSB variable selection
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectConfigBlockVariables(int configBlockId);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetConfigBlockVarNumericProperty(IntPtr hBuf, int propId, int row);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_GetConfigBlockVarStringProperty(IntPtr hBuf, int propId, int row);

  // Buffer utilities
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetBufferItemCount(IntPtr hBuf);
  [DllImport(@"${dllPath}")]
  public static extern bool aaApi_FreeBuffer(IntPtr hBuf);

  public static string GetStr(IntPtr p) {
    if (p == IntPtr.Zero) return "";
    return Marshal.PtrToStringUni(p) ?? "";
  }
}
"@ -ErrorAction Stop

# Property ID constants (from dmscli.h / ProjectWise SDK)
$CFGBLK_PROP_ID          = 1
$CFGBLK_PROP_NAME        = 3
$CFGBLK_PROP_DESCRIPTION = 4
# Level values (integer): 0=Predefined 1=Global 2=Application 3=Customer 4=Site
#                         5=WorkSpace  6=WorkSet 7=Discipline  8=Role     9=User
$CFGBLK_PROP_LEVEL       = 5
$CFGVAR_PROP_NAME        = 1
$CFGVAR_PROP_VALUE       = 2
$CFGVAR_PROP_OPERATOR    = 3   # 0== 1=> 2=< 3=:
$CFGVAR_PROP_LOCKED      = 4   # 0=false 1=true
$CFGVAR_PROP_VALUETYPE   = 5   # 0=Literal 1=PWFolder 2=dms_project 3=LastDirPiece
$MWSP_PROP_ID            = 1

$levelNames = @('Predefined','Global','Application','Customer','Site','WorkSpace','WorkSet','Discipline','Role','User')
$opNames    = @('=','>','<',':')
$vtNames    = @('Literal','PWFolder','dms_project','LastDirPiece')

function Get-CsbsForProfileId($profileId) {
  $csbBuf = [DmsCli]::aaApi_SelectConfigurationBlocksByWorkspace($profileId)
  $count  = if ($csbBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($csbBuf) } else { 0 }
  $items  = @()
  for ($ci = 0; $ci -lt $count; $ci++) {
    $csbId    = [DmsCli]::aaApi_GetConfigBlockNumericProperty($csbBuf, $CFGBLK_PROP_ID, $ci)
    $csbName  = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockStringProperty($csbBuf, $CFGBLK_PROP_NAME, $ci))
    $csbDesc  = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockStringProperty($csbBuf, $CFGBLK_PROP_DESCRIPTION, $ci))
    $levelIdx = [DmsCli]::aaApi_GetConfigBlockNumericProperty($csbBuf, $CFGBLK_PROP_LEVEL, $ci)
    $levelStr = if ($levelIdx -ge 0 -and $levelIdx -lt $levelNames.Count) { $levelNames[$levelIdx] } else { 'Global' }
    $varBuf   = [DmsCli]::aaApi_SelectConfigBlockVariables($csbId)
    $varCount = if ($varBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($varBuf) } else { 0 }
    $vars = @()
    for ($vi = 0; $vi -lt $varCount; $vi++) {
      $vName  = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockVarStringProperty($varBuf, $CFGVAR_PROP_NAME, $vi))
      $vVal   = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockVarStringProperty($varBuf, $CFGVAR_PROP_VALUE, $vi))
      $opIdx  = [DmsCli]::aaApi_GetConfigBlockVarNumericProperty($varBuf, $CFGVAR_PROP_OPERATOR, $vi)
      $locked = [DmsCli]::aaApi_GetConfigBlockVarNumericProperty($varBuf, $CFGVAR_PROP_LOCKED, $vi) -ne 0
      $vtIdx  = [DmsCli]::aaApi_GetConfigBlockVarNumericProperty($varBuf, $CFGVAR_PROP_VALUETYPE, $vi)
      $opStr  = if ($opIdx -ge 0 -and $opIdx -lt $opNames.Count) { $opNames[$opIdx] } else { '=' }
      $vtStr  = if ($vtIdx -ge 0 -and $vtIdx -lt $vtNames.Count) { $vtNames[$vtIdx] } else { 'Literal' }
      $vars += @{ Name=$vName; Operator=$opStr; Value=$vVal; ValueType=$vtStr; Locked=$locked }
    }
    if ($varBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($varBuf) | Out-Null }
    $items += @{ Id=$csbId; Name=$csbName; Description=$csbDesc; Level=$levelStr; Variables=$vars; LinkedIds=@() }
  }
  if ($csbBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($csbBuf) | Out-Null }
  return ,$items
}

$result = @()
try {
  $ok = [DmsCli]::aaApi_Login("${conn.datasource}", "${conn.username}", "${conn.credential}", "${serverHost}")
  if (-not $ok) { throw "Login failed for datasource ${conn.datasource}" }

  # ── Application-level CSBs (Predefined through WorkSpace) ────────────────
  # This is the correct starting point: the Managed Workspace Profile is
  # assigned to the Application, not to a folder.
${ctx.applicationInstanceId ? `
  $appId = [int]"${ctx.applicationInstanceId}"
  $wsBuf = [DmsCli]::aaApi_SelectManagedWorkspacesByApplication($appId)
  $wsCount = if ($wsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($wsBuf) } else { 0 }
  for ($wi = 0; $wi -lt $wsCount; $wi++) {
    $profileId = [DmsCli]::aaApi_GetManagedWorkspaceNumericProperty($wsBuf, $MWSP_PROP_ID, $wi)
    $result += Get-CsbsForProfileId $profileId
  }
  if ($wsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($wsBuf) | Out-Null }
` : `  # applicationInstanceId not provided — skipping Application-level CSBs`}

  # ── WorkSet/Discipline CSBs from the document folder (if folderGuid given) ─
  # These are CSBs directly assigned to the Project/folder in PW Administrator.
  # Typically WorkSet and Discipline level.
  #
  # Note: aaApi_SelectManagedWorkspacesByProject expects a numeric project ID,
  # not a GUID. We search all managed workspaces and filter by folder assignment.
  # In practice, if the Application CSBs above already included WorkSet-level
  # blocks this section may return duplicates — deduplication is done in JS.
${ctx.folderGuid ? `
  # TODO: resolve folderGuid to numeric ID via aaApi_SelectProject
  # For now, rely on Application-level CSBs which typically include WorkSet blocks
  # via the Managed Workspace profile configuration.
` : `  # folderGuid not provided — skipping folder-level CSBs`}

} finally {
  [DmsCli]::aaApi_Logout() | Out-Null
}

$result | ConvertTo-Json -Depth 10
`;
}
// ─────────────────────────────────────────────────────────────────────────────
// Backend C: WSG document search
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Some organisations store CSB content as .cfg documents in PW
 * (e.g. under a "Configuration/CSBs/" or "Predefined/" folder hierarchy).
 * This backend downloads those files and treats them as CSBs, inferring
 * the level from the folder structure.
 */
async function readCsbsViaWsg(client, ctx) {
    const folderGuid = ctx.folderGuid;
    if (!folderGuid)
        return [];
    const cfgFiles = await client.fetchAllCfgFiles(folderGuid);
    const csbs = [];
    let id = 1000;
    for (const { pwPath, content } of cfgFiles) {
        csbs.push({
            id: id++,
            name: path.basename(pwPath, path.extname(pwPath)),
            description: `Imported from PW: ${pwPath}`,
            level: inferCsbLevelFromPath(pwPath),
            variables: parseCfgAsCsb(content),
            linkedCsbIds: [],
        });
    }
    return csbs;
}
// ─────────────────────────────────────────────────────────────────────────────
// PW folder → dms directory download
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Download all .cfg/.ucf/.pcf files from the PW folder at pwLogicalPath
 * into a numbered dms subdirectory (dms00000, dms00001, ...), and record
 * the mapping in dmsPathMap so PWFolder type values can resolve to real paths.
 *
 * PWE uses this same naming scheme for the local working copy of each PW folder.
 */
async function downloadPwFolderToDms(client, pwLogicalPath, workDir, dmsPathMap, messages) {
    try {
        const projects = await client.listProjects();
        const matchedFolder = await findFolderByPath(client, pwLogicalPath, projects);
        if (!matchedFolder) {
            messages.push({
                level: 'warning',
                text: `Could not locate PW folder "${pwLogicalPath}" in repository.`,
            });
            return null;
        }
        // Assign a sequential dms index based on entries already in the map
        const dmsIndex = Object.keys(dmsPathMap).length;
        const dmsDirName = `dms${String(dmsIndex).padStart(5, '0')}`;
        const dmsDir = path.join(workDir, dmsDirName);
        fs.mkdirSync(dmsDir, { recursive: true });
        dmsPathMap[matchedFolder.instanceId] = {
            dmsDir,
            pwLogicalPath,
            folderName: matchedFolder.name,
        };
        const cfgFiles = await client.fetchAllCfgFiles(matchedFolder.instanceId);
        for (const { pwPath, content } of cfgFiles) {
            const relPath = pwPath.replace(/^[/\\]+/, '');
            const localPath = path.join(dmsDir, ...relPath.split(/[/\\]/));
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, content, 'utf8');
        }
        messages.push({
            level: 'info',
            text: `Downloaded ${cfgFiles.length} file(s) from "${pwLogicalPath}" → ${dmsDirName}/`,
        });
        return dmsDir;
    }
    catch (e) {
        messages.push({ level: 'warning', text: `Failed to download PW folder "${pwLogicalPath}": ${e}` });
        return null;
    }
}
/**
 * Scan all CSBs for PWFolder type variables whose target folders have not
 * yet been downloaded, and download them into additional dms directories.
 */
async function downloadAdditionalPwFolders(client, csbs, workDir, dmsPathMap, messages) {
    const seenPaths = new Set(Object.values(dmsPathMap).map(e => e.pwLogicalPath.toLowerCase()));
    for (const csb of csbs) {
        for (const v of csb.variables) {
            if (v.valueType === 'PWFolder' && v.value) {
                const normalised = v.value.toLowerCase();
                if (!seenPaths.has(normalised)) {
                    seenPaths.add(normalised);
                    await downloadPwFolderToDms(client, v.value, workDir, dmsPathMap, messages);
                }
            }
        }
    }
}
/**
 * Navigate the PW folder tree to find the folder at a logical path.
 * Handles paths like "\MyDS\Configuration\WorkSpaces\" by descending
 * segment-by-segment from the root project list.
 */
async function findFolderByPath(client, logicalPath, rootFolders) {
    const segments = logicalPath
        .replace(/^[/\\]+/, '').replace(/[/\\]+$/, '')
        .split(/[/\\]/)
        .filter(Boolean);
    if (segments.length === 0)
        return null;
    let currentLevel = rootFolders;
    let found = null;
    for (let i = 0; i < segments.length; i++) {
        found = currentLevel.find(f => f.name.toLowerCase() === segments[i].toLowerCase()) ?? null;
        if (!found)
            return null;
        if (i < segments.length - 1) {
            currentLevel = await client.listSubFolders(found.instanceId);
        }
    }
    return found;
}
// ─────────────────────────────────────────────────────────────────────────────
// CSB → CFG file serialisation
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Convert a CSB block to the text of a {CsbID}.cfg file, as PWE generates.
 *
 * Key behaviours:
 *  - %level directive emitted at the top of each file
 *  - PW_WORKDIR seeded in the first Predefined CSB
 *  - PWFolder values translated to local dms paths via dmsPathMap
 *  - dms_project resolves to PW_WORKDIR (approximate)
 *  - LastDirPiece extracts the last folder segment
 *  - %lock emitted immediately after locked variables
 *  - No %include or %if directives (not supported in CSB content)
 */
function csbToCfgContent(csb, workDir, dmsPathMap) {
    const fwdWorkDir = workDir.replace(/\\/g, '/');
    const lines = [
        `#----------------------------------------------------------------------`,
        `# CSB: ${csb.name}`,
        `# ID:  ${csb.id}`,
        `# Level: ${csb.level} (%level ${exports.CSB_LEVEL_MAP[csb.level]})`,
        `# Generated by Bentley CFG VS Code Extension`,
        `#----------------------------------------------------------------------`,
        ``,
        `%level ${exports.CSB_LEVEL_MAP[csb.level]}`,
        ``,
    ];
    // PWE injects PW_WORKDIR variables at the very start of the Predefined CSB
    if (csb.level === 'Predefined') {
        lines.push(`PW_WORKDIR                   = ${fwdWorkDir}/`);
        lines.push(`PW_WORKDIR_WORKSPACE         = ${fwdWorkDir}/workspace/`);
        lines.push(`PW_MANAGEDWORKSPACE_WORKDIR  = ${fwdWorkDir}/`);
        lines.push(``);
    }
    for (const v of csb.variables) {
        const resolved = resolveValueType(v, workDir, dmsPathMap);
        if (!v.name || resolved === null)
            continue;
        lines.push(`${v.name} ${v.operator} ${resolved}`);
        if (v.locked)
            lines.push(`%lock ${v.name}`);
    }
    lines.push('');
    return lines.join('\n');
}
/**
 * Resolve a CSB variable value based on its ValueType.
 */
function resolveValueType(v, workDir, dmsPathMap) {
    const fwdWorkDir = workDir.replace(/\\/g, '/');
    switch (v.valueType) {
        case 'Literal':
            return v.value;
        case 'PWFolder': {
            // Look up in dmsPathMap by pwLogicalPath (case-insensitive)
            const entry = Object.values(dmsPathMap).find(e => e.pwLogicalPath.replace(/[/\\]+$/, '').toLowerCase() ===
                v.value.replace(/[/\\]+$/, '').toLowerCase());
            if (entry) {
                return entry.dmsDir.replace(/\\/g, '/') + '/';
            }
            // Not yet downloaded — emit an approximate path with a placeholder dms dir.
            // The cfg parser will flag the unresolved path.
            const folderName = v.value.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? 'unknown';
            return `${fwdWorkDir}/dms00000/${folderName}/`;
        }
        case 'dms_project':
            // The document's working-copy directory.
            // Approximated as PW_WORKDIR; would need the document GUID to be precise.
            return `${fwdWorkDir}/`;
        case 'LastDirPiece':
            // Extract the last segment of the PW folder path.
            // Used for _USTN_WORKSPACENAME, _USTN_WORKSETNAME etc.
            if (v.value) {
                return v.value.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? v.value;
            }
            return v.value;
        default:
            return v.value;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Master .tmp file builder
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build the master .tmp file that MicroStation receives on the -wc command line.
 * This is equivalent to the .tmp file written by PWE when launching
 * MicroStation for a Managed Workspace document.
 *
 * Structure:
 *  1. PW seed variables (PW_WORKDIR, PW_DATASOURCE)
 *  2. dmsPathMap comments (for diagnostic reference)
 *  3. _USTN_WORKSPACENAME / _USTN_WORKSETNAME seeds (: operator so they are
 *     only set if not already defined — allows CSBs to override later)
 *  4. %include for each {CsbID}.cfg in processing order
 *  5. PW_MANAGEDWORKSPACE accumulation (> appends the CSB ID)
 */
function buildMasterTmp(orderedCsbs, wsDir, workDir, ctx, dmsPathMap, workspaceName, worksetName) {
    const fwdWorkDir = workDir.replace(/\\/g, '/');
    const fwdWsDir = wsDir.replace(/\\/g, '/');
    const lines = [
        `#----------------------------------------------------------------------`,
        `# ProjectWise Managed Workspace Master Configuration`,
        `# Datasource : ${ctx.datasource}`,
        `# Application: ${ctx.applicationInstanceId ?? '(not specified)'}`,
        `# Folder     : ${ctx.folderGuid ?? '(not specified)'}`,
        `# Generated  : ${new Date().toISOString()}`,
        `#`,
        `# Equivalent to the .tmp file written by ProjectWise Explorer.`,
        `# Pass to MicroStation: ustation.exe -wc "${fwdWsDir}/${ctx.datasource}.tmp"`,
        `#----------------------------------------------------------------------`,
        ``,
        `# ── PW-injected root variables ───────────────────────────────────────`,
        `PW_WORKDIR           = ${fwdWorkDir}/`,
        `PW_WORKDIR_WORKSPACE = ${fwdWsDir}/`,
        `PW_DATASOURCE        = ${ctx.datasource}`,
        ``,
    ];
    // Document the dmsPathMap for diagnostic reference
    const dmsEntries = Object.entries(dmsPathMap);
    if (dmsEntries.length > 0) {
        lines.push(`# ── PW folder → local dms directory mapping ────────────────────────`);
        for (const [guid, entry] of dmsEntries) {
            lines.push(`# "${entry.pwLogicalPath}" (GUID: ${guid})`);
            lines.push(`#   → ${entry.dmsDir.replace(/\\/g, '/')}/`);
        }
        lines.push(``);
    }
    // Seed workspace / workset names before CSB %includes.
    // Using ':' operator so they are only set if not already defined —
    // the CSBs may override them via '=' at a higher level.
    if (workspaceName || worksetName) {
        lines.push(`# ── Workspace / WorkSet identity (from LastDirPiece) ───────────────`);
        if (workspaceName)
            lines.push(`_USTN_WORKSPACENAME : ${workspaceName}`);
        if (worksetName)
            lines.push(`_USTN_WORKSETNAME   : ${worksetName}`);
        lines.push(``);
    }
    // %include each CSB in processing order with level annotations
    lines.push(`# ── CSB includes (Bentley processing order) ─────────────────────────`);
    let lastLevel = -1;
    for (const csb of orderedCsbs) {
        const msLevel = exports.CSB_LEVEL_MAP[csb.level];
        if (msLevel !== lastLevel) {
            lines.push(`# %level ${msLevel}: ${csb.level}`);
            lastLevel = msLevel;
        }
        const cfgPath = path.join(wsDir, `${csb.id}.cfg`).replace(/\\/g, '/');
        lines.push(`%include ${cfgPath}`);
        // PW_MANAGEDWORKSPACE accumulates the database ID of every processed CSB.
        // MicroStation/ORD checks for this variable to confirm Managed Workspace mode.
        lines.push(`PW_MANAGEDWORKSPACE > ${csb.id}`);
    }
    lines.push('');
    return lines.join('\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// Manual CSB import
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parse CSB content pasted in manually by the user.
 * Accepts either a raw variable list or a .cfg-style export.
 */
function parseManualCsbInput(input, level, name, id = 9999) {
    return {
        id,
        name,
        description: 'Manually imported',
        level,
        variables: parseCfgAsCsb(input),
        linkedCsbIds: [],
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────────
function orderCsbs(csbs) {
    // Deduplicate by ID (Application and folder reads can produce duplicates)
    const seen = new Set();
    const unique = csbs.filter(c => {
        if (seen.has(c.id))
            return false;
        seen.add(c.id);
        return true;
    });
    return unique.sort((a, b) => {
        const aOrder = exports.CSB_PROCESSING_ORDER.indexOf(a.level);
        const bOrder = exports.CSB_PROCESSING_ORDER.indexOf(b.level);
        if (aOrder !== bOrder)
            return aOrder - bOrder;
        return a.id - b.id; // stable sort within same level
    });
}
// ─────────────────────────────────────────────────────────────────────────────
// Variable extraction helpers
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find the first literal value of _USTN_CONFIGURATION.
 * This is the PW logical path where the workspace .cfg files live.
 */
function extractConfigurationVariable(csbs) {
    for (const csb of csbs) {
        const v = csb.variables.find(v => v.name === '_USTN_CONFIGURATION');
        if (v?.value)
            return v.value;
    }
    return null;
}
/**
 * Find the effective value of a workspace/workset name variable.
 * Walks in reverse processing order so the highest-level assignment wins.
 *
 * For LastDirPiece type: extracts the last folder segment.
 * For Literal type: returns as-is.
 */
function extractLastDirPiece(csbs, varName) {
    for (const csb of [...csbs].reverse()) {
        const v = csb.variables.find(v => v.name === varName);
        if (!v?.value)
            continue;
        if (v.valueType === 'LastDirPiece') {
            return v.value.replace(/[/\\]+$/, '').split(/[/\\]/).pop();
        }
        return v.value;
    }
    return undefined;
}
// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────────────────────
function parsePowerShellCsbJson(json) {
    const clean = json.trim();
    const data = JSON.parse(clean.startsWith('[') ? clean : `[${clean}]`);
    return (Array.isArray(data) ? data : [data]).map((item) => ({
        id: Number(item.Id ?? item.id ?? 0),
        name: String(item.Name ?? item.name ?? ''),
        description: String(item.Description ?? item.description ?? ''),
        level: normaliseCsbLevel(String(item.Level ?? item.level ?? 'Global')),
        variables: (item.Variables ?? item.variables ?? []).map((v) => ({
            name: String(v.Name ?? v.name ?? ''),
            operator: normaliseOperator(String(v.Operator ?? v.operator ?? '=')),
            value: String(v.Value ?? v.value ?? ''),
            valueType: normaliseCsbValueType(String(v.ValueType ?? v.valueType ?? 'Literal')),
            locked: Boolean(v.Locked ?? v.locked ?? false),
        })),
        linkedCsbIds: Array.isArray(item.LinkedIds) ? item.LinkedIds.map(Number) : [],
    }));
}
/**
 * Parse a .cfg file as CSB content (no preprocessor directives).
 * Used by Backend C (WSG document search) and Manual import.
 */
function parseCfgAsCsb(content) {
    const vars = [];
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line)
            continue;
        // %lock applies to the nearest preceding variable with that name
        const lockMatch = line.match(/^%lock\s+([A-Za-z_]\w*)/i);
        if (lockMatch) {
            const last = [...vars].reverse().find(v => v.name === lockMatch[1]);
            if (last)
                last.locked = true;
            continue;
        }
        // Skip any preprocessor directives that may appear in .cfg files stored as CSBs
        if (/^%(?:include|if|ifdef|ifndef|else|elseif|endif|define|undef|level|error|warning)\b/i.test(line)) {
            continue;
        }
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*([=><:])\s*(.*)/);
        if (m) {
            vars.push({
                name: m[1],
                operator: normaliseOperator(m[2]),
                value: m[3].trim(),
                valueType: 'Literal',
                locked: false,
            });
        }
    }
    return vars;
}
function normaliseCsbLevel(level) {
    const map = {
        predefined: 'Predefined', global: 'Global', application: 'Application',
        customer: 'Customer', site: 'Site', workspace: 'WorkSpace',
        workset: 'WorkSet', project: 'WorkSet', discipline: 'Discipline',
        role: 'Role', user: 'User',
    };
    return map[level.toLowerCase()] ?? 'Global';
}
function normaliseOperator(op) {
    return ['=', '>', '<', ':'].includes(op)
        ? op
        : '=';
}
function normaliseCsbValueType(vt) {
    const map = {
        literal: 'Literal', pwfolder: 'PWFolder',
        dms_project: 'dms_project', lastdirpiece: 'LastDirPiece',
    };
    return map[vt.toLowerCase()] ?? 'Literal';
}
function inferCsbLevelFromPath(pwPath) {
    const lower = pwPath.toLowerCase();
    if (lower.includes('predefined'))
        return 'Predefined';
    if (lower.includes('global'))
        return 'Global';
    if (lower.includes('application'))
        return 'Application';
    if (lower.includes('customer'))
        return 'Customer';
    if (lower.includes('site'))
        return 'Site';
    if (lower.includes('workset') || lower.includes('project'))
        return 'WorkSet';
    if (lower.includes('workspace'))
        return 'WorkSpace';
    if (lower.includes('discipline'))
        return 'Discipline';
    if (lower.includes('role'))
        return 'Role';
    if (lower.includes('user'))
        return 'User';
    return 'Global';
}
//# sourceMappingURL=csbExtractor.js.map