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
    let workDir = ctx.workDir ?? '';
    let wsDir = '';
    const messages = [];
    const dmsPathMap = {};
    const pwFolderMetaByPath = new Map();
    let pwWorkingDir;
    let selectedFolderLocalDir;
    const logTrackedVariable = (stage, blocks) => {
        const tracked = blocks
            .flatMap(csb => csb.variables.map(v => ({ csb, v })))
            .find(({ v }) => v.name === '_DYNAMIC_DATASOURCE_BENTLEYROOT');
        if (!tracked) {
            messages.push({
                level: 'info',
                text: `${stage}: _DYNAMIC_DATASOURCE_BENTLEYROOT not present`,
            });
            return;
        }
        messages.push({
            level: 'info',
            text: `${stage}: _DYNAMIC_DATASOURCE_BENTLEYROOT ` +
                `value="${tracked.v.value}" type=${tracked.v.valueType} operator=${tracked.v.operator} ` +
                `csb=${tracked.csb.id}:${tracked.csb.name}`,
        });
    };
    // ── Step 1: Fetch CSBs ────────────────────────────────────────────────────
    let csbs = null;
    let backend = 'manual';
    if (isPowerShellPwModuleAvailable()) {
        messages.push({ level: 'info', text: 'Backend A: ProjectWise PowerShell module (pwps_dab)' });
        try {
            const result = await readCsbsViaPwModule(conn, ctx);
            csbs = result.csbs;
            logTrackedVariable('After PW module parse', csbs);
            for (const line of result.debug ?? []) {
                messages.push({ level: 'info', text: `PW module debug: ${line}` });
            }
            if (result.pwWorkingDir) {
                pwWorkingDir = result.pwWorkingDir;
                messages.push({ level: 'info', text: `PW working directory: ${pwWorkingDir}` });
            }
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
    logTrackedVariable('After CSB ordering', orderedCsbs);
    if (backend === 'powershell-pwmodule') {
        // Collect all PW folder paths that need Get-PWFolders -FolderPath resolution:
        // - PWFolder-typed variables (explicit PW folder references)
        // - Literal-typed variables whose value starts with @: (same semantics,
        //   different value type — both need Code + ProjectGUID from PW)
        const pwFolderPaths = orderedCsbs
            .flatMap(csb => csb.variables)
            .filter(v => (v.valueType === 'PWFolder' || (v.valueType === 'Literal' && isAtPath(v.value))) && !!v.value)
            .map(v => v.value);
        const resolvedMeta = await resolvePwFolderMetadataViaPwModule(conn, pwFolderPaths);
        for (const [k, meta] of resolvedMeta)
            pwFolderMetaByPath.set(k, meta);
        for (const csb of orderedCsbs) {
            for (const v of csb.variables) {
                const isPwFolderVar = v.valueType === 'PWFolder';
                const isLiteralAtPath = v.valueType === 'Literal' && isAtPath(v.value);
                if ((!isPwFolderVar && !isLiteralAtPath) || !v.value)
                    continue;
                const meta = pwFolderMetaByPath.get(normalisePwLogicalPathKey(v.value));
                messages.push({
                    level: 'info',
                    text: `PWFolder metadata: path="${v.value}" code="${meta?.code ?? ''}" projectId="${meta?.projectId ?? ''}" lookup="${meta?.lookupUsed ?? ''}"`,
                });
                if (meta?.code)
                    v.folderCode = meta.code;
                if (meta?.projectId)
                    v.folderProjectId = meta.projectId;
            }
        }
    }
    if (!workDir) {
        workDir = pwWorkingDir ?? path.join(os.tmpdir(), `pw-managed-ws-${Date.now()}`);
    }
    wsDir = path.join(workDir, 'workspace');
    fs.mkdirSync(wsDir, { recursive: true });
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
        await downloadPwFolderToDms(client, conn, pwFolderMetaByPath, configRoot, workDir, dmsPathMap, messages);
    }
    // Second pass: any other PWFolder type variables not yet downloaded
    await downloadAdditionalPwFolders(client, conn, pwFolderMetaByPath, orderedCsbs, workDir, dmsPathMap, messages);
    // Third pass: scan Literal CSB values and downloaded CFG files for @: paths.
    // This resolves recursive include chains — e.g. a downloaded WorkSpace.cfg that
    // %includes @:\Configuration\Organization\*.cfg triggers a further download of
    // the Organization folder. Continues until no new @: paths are found (up to 10 passes).
    await resolveAtPathsRecursively(client, conn, pwFolderMetaByPath, orderedCsbs, workDir, dmsPathMap, messages);
    if (ctx.folderGuid) {
        const selectedFolderMeta = await resolvePwFolderByGuidViaPwModule(conn, ctx.folderGuid);
        const selectedCode = selectedFolderMeta?.code?.trim();
        const selectedProjectId = selectedFolderMeta?.projectId;
        if (selectedCode && /^dms\d+$/i.test(selectedCode)) {
            selectedFolderLocalDir = path.join(workDir, selectedCode.toLowerCase());
        }
        else if (typeof selectedProjectId === 'number' && Number.isFinite(selectedProjectId) && selectedProjectId > 0) {
            selectedFolderLocalDir = path.join(workDir, `dms${selectedProjectId}`);
        }
    }
    // ── Step 5: Write {CsbID}.cfg files ───────────────────────────────────────
    for (const csb of orderedCsbs) {
        const tracked = csb.variables.find(v => v.name === '_DYNAMIC_DATASOURCE_BENTLEYROOT');
        if (tracked) {
            const resolvedTracked = resolveValueType(tracked, workDir, dmsPathMap);
            messages.push({
                level: 'info',
                text: `Before cfg write: _DYNAMIC_DATASOURCE_BENTLEYROOT ` +
                    `value="${tracked.value}" type=${tracked.valueType} resolved="${resolvedTracked ?? ''}" ` +
                    `csb=${csb.id}:${csb.name}`,
            });
        }
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
    const masterContent = buildMasterTmp(orderedCsbs, wsDir, workDir, ctx, dmsPathMap, workspaceName, worksetName, pwWorkingDir, selectedFolderLocalDir);
    fs.writeFileSync(masterTmpPath, masterContent, 'utf8');
    messages.push({ level: 'info', text: `Master config: ${path.basename(masterTmpPath)}` });
    return {
        masterTmpPath, workDir, csbs: orderedCsbs, dmsPathMap,
        workspaceName, worksetName, messages, backend, pwWorkingDir, selectedFolderLocalDir,
    };
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
// Backend A: PowerShell ProjectWise Module (pwps_dab)
//
// pwps_dab is the authoritative PowerShell module for ProjectWise automation.
// CSB data is NOT accessible via the WSG REST API — it lives in the PW database
// and is only reachable via the native PowerShell module or dmscli.dll (Backend B).
//
// Cmdlet name discovery strategy:
//   pwps_dab uses naming conventions like Get-PW<Entity>. For CSBs specifically,
//   the module exposes functions for both Managed Workspace Profiles and the CSBs
//   assigned to them. We probe for the cmdlets at runtime so the script works
//   across different installed versions of pwps_dab.
//
//   See https://powerwisescripting.blog/ for the latest cmdlet documentation.
// ─────────────────────────────────────────────────────────────────────────────
function detectPowerShellPwModule() {
    if (process.platform !== 'win32')
        return null;
    try {
        const result = (0, child_process_1.spawnSync)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            // Prefer PWPS_DAB (64-bit, actively maintained) over the legacy ProjectWise module
            '$m = Get-Module -ListAvailable -Name PWPS_DAB,ProjectWise | Select-Object -First 1 -ExpandProperty Name; if ($m) { $m }',
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
function getPwServerHostname(conn) {
    const rawHost = (() => {
        try {
            return new URL(conn.wsgUrl).hostname;
        }
        catch {
            return conn.wsgUrl;
        }
    })();
    return rawHost.replace(/-ws(?=\.|$)/i, '');
}
function normalisePwLogicalPathKey(p) {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase();
}
async function resolvePwFolderMetadataForPathViaPwModule(conn, pwPath) {
    const moduleName = detectPowerShellPwModule();
    if (!moduleName || !pwPath.trim())
        return undefined;
    const script = `
param($ServerPart, $DatasourceName, $PwPath)
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

try {
  Import-Module "${moduleName}" -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null | Out-Null
} catch {
  throw "Failed to import module '${moduleName}': \$(\$_.Exception.Message)"
}

$datasourceQualified = "$($ServerPart):$($DatasourceName)"
$attempts = @($datasourceQualified)
if ($DatasourceName -and $DatasourceName -notmatch ':') { $attempts += $DatasourceName }

$loggedIn = \$false
$lastError = ''

foreach ($attempt in ($attempts | Select-Object -Unique)) {
  try {
    New-PWLogin -BentleyIMS -DatasourceName $attempt -NonAdminLogin -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null | Out-Null
  } catch {
    $lastError = \$_.Exception.Message
    continue
  }

  $currentDs = \$null
  try {
    $currentDs = Get-PWCurrentDatasource -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null
  } catch {
    $lastError = "Get-PWCurrentDatasource failed: \$(\$_.Exception.Message)"
    continue
  }

  if ($currentDs) {
    $loggedIn = \$true
    break
  }
}

if (-not $loggedIn) {
  throw "Could not establish ProjectWise session for folder metadata resolution. Last error: \$lastError"
}

$base = ([string]$PwPath) -replace '/', '\\\\'
$candidates = [System.Collections.Generic.List[string]]::new()
foreach ($candidate in @(
  $base,
  ($base.TrimEnd('\\\\') + '\\\\'),
  ('\\\\' + $base.TrimStart('\\\\')),
  ('\\\\' + $base.Trim('\\\\') + '\\\\')
)) {
  if (-not [string]::IsNullOrWhiteSpace($candidate) -and -not ($candidates -contains $candidate)) {
    [void]$candidates.Add($candidate)
  }
}

$folder = \$null
$lookupUsed = ''
$attempts = \$candidates.Count

foreach ($lookup in $candidates) {
  try {
    $folder = Get-PWFolders -FolderPath $lookup -JustOne -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null
    if ($folder) {
      $lookupUsed = [string]$lookup
      break
    }
  } catch {
    \$lastError = \$_.Exception.Message
  }
}

if (-not $folder) {
  throw "Get-PWFolders failed after \$attempts attempts for path '\$PwPath'. LastError: \$lastError"
}

$projectId = 0
[void][int]::TryParse([string]$folder.ProjectID, [ref]$projectId)
@{
  Path = [string]$PwPath
  Code = [string]\$folder.Code
  ProjectID = $projectId
  ProjectGUID = [string](\$folder.ProjectGUIDString ?? \$folder.ProjectGUID)
  LookupUsed = $lookupUsed
} | ConvertTo-Json -Depth 6
`;
    const tempScript = path.join(os.tmpdir(), `pw-folder-meta-${Date.now()}.ps1`);
    try {
        fs.writeFileSync(tempScript, script, 'utf8');
        const result = (0, child_process_1.spawnSync)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', tempScript,
            '-ServerPart', getPwServerHostname(conn),
            '-DatasourceName', conn.datasource,
            '-PwPath', pwPath,
        ], { timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
        const stdout = result.stdout?.toString() ?? '';
        const stderr = result.stderr?.toString() ?? '';
        if (!stdout.trim()) {
            // If no stdout, the script failed. Log stderr if available.
            return undefined;
        }
        const item = JSON.parse(extractJsonPayload(stdout));
        return {
            path: String(item.Path ?? pwPath),
            code: String(item.Code ?? '').trim() || undefined,
            projectId: Number.isFinite(Number(item.ProjectID)) ? Number(item.ProjectID) : undefined,
            projectGuid: String(item.ProjectGUID ?? '').trim() || undefined,
            lookupUsed: String(item.LookupUsed ?? '').trim() || undefined,
        };
    }
    catch {
        return undefined;
    }
    finally {
        try {
            fs.unlinkSync(tempScript);
        }
        catch { }
    }
}
async function resolvePwFolderMetadataViaPwModule(conn, paths) {
    const outMap = new Map();
    const uniquePaths = [...new Set(paths.map(p => p.trim()).filter(Boolean))];
    for (const pwPath of uniquePaths) {
        const meta = await resolvePwFolderMetadataForPathViaPwModule(conn, pwPath);
        if (meta) {
            outMap.set(normalisePwLogicalPathKey(meta.path), meta);
        }
    }
    return outMap;
}
async function resolvePwFolderByGuidViaPwModule(conn, folderGuid) {
    if (!folderGuid)
        return undefined;
    const moduleName = detectPowerShellPwModule();
    if (!moduleName)
        return undefined;
    const script = `
param($ServerPart, $DatasourceName, $FolderGuid)
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

try {
  Import-Module "${moduleName}" -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null | Out-Null
} catch {
  throw "Failed to import module '${moduleName}': \$(\$_.Exception.Message)"
}

$datasourceQualified = "$($ServerPart):$($DatasourceName)"
$attempts = @($datasourceQualified)
if ($DatasourceName -and $DatasourceName -notmatch ':') { $attempts += $DatasourceName }

$loggedIn = \$false
$lastError = ''

foreach ($attempt in ($attempts | Select-Object -Unique)) {
  try {
    New-PWLogin -BentleyIMS -DatasourceName $attempt -NonAdminLogin -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null | Out-Null
  } catch {
    $lastError = \$_.Exception.Message
    continue
  }

  $currentDs = \$null
  try {
    $currentDs = Get-PWCurrentDatasource -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null
  } catch {
    $lastError = "Get-PWCurrentDatasource failed: \$(\$_.Exception.Message)"
    continue
  }

  if ($currentDs) {
    $loggedIn = \$true
    break
  }
}

if (-not $loggedIn) {
  throw "Could not establish ProjectWise session for folder GUID resolution. Last error: \$lastError"
}

try {
  $folder = Get-PWFoldersByGUIDs -FolderGUIDs $FolderGuid -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null
} catch {
  throw "Get-PWFoldersByGUIDs failed for GUID '\$FolderGuid': \$(\$_.Exception.Message)"
}

if (-not $folder) {
  throw "Get-PWFoldersByGUIDs returned no folder for GUID '\$FolderGuid'"
}

$projectId = 0
[void][int]::TryParse([string]$folder.ProjectID, [ref]$projectId)
@{
  Path = [string]\$folder.FullPath
  Code = [string]\$folder.Code
  ProjectID = $projectId
  ProjectGUID = [string](\$folder.ProjectGUIDString ?? \$folder.ProjectGUID)
} | ConvertTo-Json -Depth 6
`;
    const tempScript = path.join(os.tmpdir(), `pw-folder-guid-${Date.now()}.ps1`);
    try {
        fs.writeFileSync(tempScript, script, 'utf8');
        const result = (0, child_process_1.spawnSync)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', tempScript,
            '-ServerPart', getPwServerHostname(conn),
            '-DatasourceName', conn.datasource,
            '-FolderGuid', folderGuid,
        ], { timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
        const stdout = result.stdout?.toString() ?? '';
        const stderr = result.stderr?.toString() ?? '';
        if (!stdout.trim()) {
            return undefined;
        }
        const item = JSON.parse(extractJsonPayload(stdout));
        return {
            path: String(item.Path ?? ''),
            code: String(item.Code ?? '').trim() || undefined,
            projectId: Number.isFinite(Number(item.ProjectID)) ? Number(item.ProjectID) : undefined,
            projectGuid: String(item.ProjectGUID ?? '').trim() || undefined,
        };
    }
    catch {
        return undefined;
    }
    finally {
        try {
            fs.unlinkSync(tempScript);
        }
        catch { }
    }
}
async function readCsbsViaPwModule(conn, ctx) {
    const moduleName = detectPowerShellPwModule();
    if (!moduleName) {
        throw new Error('Neither PWPS_DAB nor ProjectWise PowerShell module is available.');
    }
    if (!ctx.folderGuid) {
        throw new Error('PW module backend now requires a folder GUID (ctx.folderGuid).');
    }
    const script = `
param($ServerPart, $DatasourceName, $FolderGuid)
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

Import-Module "${moduleName}" -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null | Out-Null

$datasourceQualified = "$($ServerPart):$($DatasourceName)"

$loginDebug = [System.Collections.Generic.List[string]]::new()
$loginAttempts = [System.Collections.Generic.List[string]]::new()
$loginAttempts.Add($datasourceQualified)
if ($DatasourceName -and $DatasourceName -notmatch ':') {
  $loginAttempts.Add($DatasourceName)
}

$effectiveDatasourceName = $DatasourceName
$loggedIn = $false

foreach ($attempt in ($loginAttempts | Select-Object -Unique)) {
  try {
    New-PWLogin -BentleyIMS -DatasourceName $attempt -NonAdminLogin -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null | Out-Null
  } catch {
    $loginDebug.Add("LoginError[$attempt]: " + $_.Exception.Message)
    continue
  }

  $currentDs = $null
  try {
    $currentDs = Get-PWCurrentDatasource -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null
  } catch {
    $currentDs = $null
  }

  if ($currentDs) {
    $loggedIn = $true
    if ($currentDs.Name) {
      $effectiveDatasourceName = [string]$currentDs.Name
    }
    $loginDebug.Add("LoginOK[$attempt]")
    break
  }

  $loginDebug.Add("LoginNoSession[$attempt]")
}

if (-not $loggedIn) {
  throw ("New-PWLogin did not establish a ProjectWise session. Attempts: " + ($loginDebug -join ' | '))
}

$folder = Get-PWFoldersByGUIDs -FolderGUIDs $FolderGuid -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null
if (-not $folder) {
  throw "Could not resolve FolderGuid '$FolderGuid' via Get-PWFoldersByGUIDs"
}

$workspaces = @(Get-PWManagedWorkspaces -IncludeInherited -InputFolders $folder -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null)
$variables  = @(Get-PWManagedWorkspaceVariables -InputWorkspaces $workspaces -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null)

$pwWorkingDir = ''
$currentUserCmdlet = @('Get-PWCurrentUser') |
  Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
  Select-Object -First 1

$userWorkingDirCmdlet = @('Get-PWUserWorkingDirectory') |
  Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
  Select-Object -First 1

if ($currentUserCmdlet -and $userWorkingDirCmdlet) {
  try {
    $currentUser = & $currentUserCmdlet -ErrorAction Stop
    $userWorkDir = & $userWorkingDirCmdlet -InputUser $currentUser -ErrorAction Stop
    if ($userWorkDir -is [string]) {
      $pwWorkingDir = $userWorkDir
    } else {
      if ($null -ne $userWorkDir.WorkingDirectory -and [string]$userWorkDir.WorkingDirectory -ne '') {
        $pwWorkingDir = [string]$userWorkDir.WorkingDirectory
      } elseif ($null -ne $userWorkDir.Path -and [string]$userWorkDir.Path -ne '') {
        $pwWorkingDir = [string]$userWorkDir.Path
      } elseif ($null -ne $userWorkDir.DirectoryName -and [string]$userWorkDir.DirectoryName -ne '') {
        $pwWorkingDir = [string]$userWorkDir.DirectoryName
      } elseif ($null -ne $userWorkDir.FullName -and [string]$userWorkDir.FullName -ne '') {
        $pwWorkingDir = [string]$userWorkDir.FullName
      } else {
        $pwWorkingDir = [string]$userWorkDir
      }
    }
  } catch { $pwWorkingDir = '' }
}

if (-not $pwWorkingDir) {
  $localApp = [Environment]::GetFolderPath('LocalApplicationData')
  $pwWorkingDir = Join-Path $localApp "Bentley\ProjectWise\$effectiveDatasourceName\working"
}

function Resolve-LevelName {
  param($raw)
  if ($null -eq $raw) { return 'Global' }
  $text = [string]$raw
  if ([string]::IsNullOrWhiteSpace($text)) { return 'Global' }
  switch -Regex ($text.ToLowerInvariant()) {
    'predefined' { return 'Predefined' }
    'global' { return 'Global' }
    'application' { return 'Application' }
    'customer' { return 'Customer' }
    'site|organization' { return 'Site' }
    'workspace' { return 'WorkSpace' }
    'workset|project' { return 'WorkSet' }
    'discipline' { return 'Discipline' }
    'role' { return 'Role' }
    'user' { return 'User' }
    default {
      $n = 0
      if ([int]::TryParse($text, [ref]$n)) {
        switch ($n) {
          0 { return 'Predefined' }
          1 { return 'Global' }
          2 { return 'Application' }
          3 { return 'Customer' }
          4 { return 'Site' }
          5 { return 'WorkSpace' }
          6 { return 'WorkSet' }
          7 { return 'Discipline' }
          8 { return 'Role' }
          9 { return 'User' }
          default { return 'Global' }
        }
      }
      return 'Global'
    }
  }
}

function Get-FirstValue {
  param($obj, [string[]]$names)
  foreach ($n in $names) {
    $val = $obj.$n
    if ($null -eq $val) { continue }
    if ($val -is [string]) {
      if ($val -ne '') { return $val }
      continue
    }
    if ($val -is [System.Collections.IEnumerable] -and -not ($val -is [string])) {
      if (@($val).Count -gt 0) { return $val }
      continue
    }
    return $val
  }
  return $null
}

function Parse-OpType {
  param([string]$raw)
  $s = [string]$raw
  if ($null -eq $raw) { $s = '' }
  $s = $s.ToLowerInvariant()
  switch ($s) {
    'assignment' { return '=' }
    'append'     { return '>' }
    'prepend'    { return '<' }
    'directive'  { return ':' }
    default      { return '=' }
  }
}

function Parse-ValueType {
  param([string]$raw)
  $s = [string]$raw
  if ($null -eq $raw) { $s = '' }
  $s = $s.ToLowerInvariant()
  switch ($s) {
    'string'        { return 'Literal' }
    'literal'       { return 'Literal' }
    'project'       { return 'PWFolder' }
    'folder'        { return 'PWFolder' }
    'pwfolder'      { return 'PWFolder' }
    'dms_project'   { return 'dms_project' }
    'lastdirpiece'  { return 'LastDirPiece' }
    default         { return 'Literal' }
  }
}

function Extract-ValueFromValuesText {
  param([string]$text)
  if ([string]::IsNullOrWhiteSpace($text)) { return '' }

  $t = [string]$text
  # Remove control characters (0x00-0x1F and 0x7F) using explicit replacement
  for ($i = 0; $i -le 31; $i++) { $t = $t -replace [char]$i, ' ' }
  $t = $t -replace [char]127, ' '
  $t = ($t -replace '\s+', ' ').Trim()
  if ([string]::IsNullOrWhiteSpace($t)) { return '' }

  # Prefer explicit "Value: ..." when present
  $m = [regex]::Match($t, '(?i)\bValue\s*:\s*(.+)$')
  if ($m.Success) {
    return ([string]$m.Groups[1].Value).Trim()
  }

  # Otherwise parse everything after "Value Type:" and drop only the type token.
  $m = [regex]::Match($t, '(?i)Value\s*Type\s*:\s*')
  if (-not $m.Success) { return '' }
  $tail = $t.Substring($m.Index + $m.Length).Trim()
  if ([string]::IsNullOrWhiteSpace($tail)) { return '' }

  $typeToken = [regex]::Match($tail, '^[^\s]+')
  if ($typeToken.Success) {
    $tail = $tail.Substring($typeToken.Length).Trim()
  }
  return $tail
}

function Parse-ValuesPayload {
  # $valuesStr pre-extracted in the main loop using Get-FirstValue/Out-String (confirmed working there).
  param($v, [string]$valuesStr)
  $vn = (($valuesStr -replace '[\r\n]+', ' ') -replace '\s+', ' ').Trim()
  $vn = [regex]::Replace($vn, "\x1B\[[0-9;?]*[ -/]*[@-~]", '')
  # Remove control characters (0-31 and 127) using explicit character-by-character replacement
  # (PowerShell .NET regex character classes do not support hex escape syntax)
  for ($i = 0; $i -le 31; $i++) { $vn = $vn -replace [char]$i, ' ' }
  $vn = $vn -replace [char]127, ' '
  $vn = ($vn -replace '\s+', ' ').Trim()

  # Direct property shortcuts (populated by some PW module versions)
  $op = '';   try { $op   = [string]$v.Operator  } catch {}
  $type = ''; try { $type = [string]$v.ValueType  } catch {}
  $val = '';  try { $val  = [string]$v.Value       } catch {}
  # Remove control characters from direct Value field as well
  for ($i = 0; $i -le 31; $i++) { $val = $val -replace [char]$i, ' ' }
  $val = $val -replace [char]127, ' '
  $val = $val.Trim()

  # Parse Op Type from Values string
  if (-not $op -and $vn -match '(?i)Op\s*Type\s*:\s*([^\s]+)') {
    $op = (($matches[1] -replace '[^A-Za-z_]', '')).Trim()
  }

  # Parse Value Type from Values string
  if (-not $type -and $vn -match '(?i)Value\s*Type\s*:\s*([^\s]+)') {
    $type = (($matches[1] -replace '[^A-Za-z_]', '')).Trim()
  }

  # Parse value from Values string
  if ([string]::IsNullOrWhiteSpace([string]$val)) {
    # "Value:  <payload>" form (note double/single space after colon)
    if ($vn -match '(?i)\bValue\s*:\s*(.+)$') { $val = $matches[1].Trim() }
    # "Value Type: <type> <payload>" form (no "Value:" label; value follows type directly)
    elseif ($vn -match '(?i)Value\s*Type\s*:\s*[^\s]+\s+(.+)$') { $val = $matches[1].Trim() }
  }

  # Deterministic fallback: split after "Value Type:" and drop only the first token (the type),
  # preserving the full payload even when separators/tokens contain odd bytes.
  if ([string]::IsNullOrWhiteSpace([string]$val) -and $vn -match '(?i)Value\s*Type\s*:') {
    $afterType = [regex]::Replace($vn, '(?i)^.*?Value\s*Type\s*:\s*', '')
    if ($afterType) {
      $parts = $afterType -split '\s+', 2
      if ($parts.Count -ge 2) {
        $val = [string]$parts[1]
      }
    }
  }

  # Extra safety for pwps_dab payload style:
  #   One value Op Type: ASSIGNMENT Value Type: Project _Global Data/Bentley 2024
  if ([string]::IsNullOrWhiteSpace([string]$val) -and $vn -match '(?i)Value\s*Type\s*:\s*Project\s+(.+)$') {
    $val = [string]$matches[1]
  }

  # Marker-index fallback (more robust than regex groups when tokenization contains odd bytes)
  if ([string]::IsNullOrWhiteSpace([string]$val) -and $type -match '(?i)^project$') {
    $m = [regex]::Match($vn, '(?i)Value\s*Type\s*:\s*Project')
    if ($m.Success) {
      $tail = $vn.Substring($m.Index + $m.Length).Trim()
      if ($tail) { $val = $tail }
    }
  }
  if ([string]::IsNullOrWhiteSpace([string]$val) -and $type -match '(?i)^string$') {
    $m = [regex]::Match($vn, '(?i)Value\s*Type\s*:\s*String')
    if ($m.Success) {
      $tail = $vn.Substring($m.Index + $m.Length).Trim()
      if ($tail) { $val = $tail }
    }
  }

  # Final fallback: robust extraction from Values text regardless of token corruption
  if ([string]::IsNullOrWhiteSpace([string]$val)) {
    $val = Extract-ValueFromValuesText $vn
  }

  # Type keyword fallback
  if (-not $type) {
    if ($vn -match '(?i)project') { $type = 'project' }
    elseif ($vn -match '(?i)string') { $type = 'string' }
  }

  $locked = $false
  try {
    $lockedRaw = $v.Locked
    if ($null -ne $lockedRaw) {
      if ($lockedRaw -is [int]) { $locked = ([int]$lockedRaw -ne 0) }
      else { $locked = [bool]$lockedRaw }
    }
  } catch { $locked = $false }

  return @{
    Operator  = Parse-OpType $op
    ValueType = Parse-ValueType $type
    Value     = $val.Trim()
    Locked    = $locked
    _Vn       = $vn
    _Vx       = (Extract-ValueFromValuesText $vn)
  }
}

$result = [System.Collections.Generic.List[object]]::new()
$blocks = @{}
$autoId = 1

foreach ($v in $variables) {
  $name = [string](Get-FirstValue $v @('Name','VariableName'))
  if (-not $name) { continue }

  if ($name -match '^(?i)_DYNAMIC_DATASOURCE_BENTLEYROOT$') {
    $rawType = [string](Get-FirstValue $v @('ValueType','VariableValueType'))
    $rawValue = [string](Get-FirstValue $v @('Value','VariableValue'))
    $rawValuesField = ''
    try {
      $rawValuesField = ((Get-FirstValue $v @('Values','ValueSummary') | Out-String).Trim())
    } catch {
      $rawValuesField = ''
    }
    $loginDebug.Add("TrackedRaw[$name]: Type='$rawType' Value='$rawValue' Values='$rawValuesField'")
  }

  $cbIdRaw = Get-FirstValue $v @('ConfigurationBlockID','ConfigurationBlockId','ConfigBlockId','CSBId')
  $cbId = 0
  if ($null -ne $cbIdRaw) {
    [void][int]::TryParse([string]$cbIdRaw, [ref]$cbId)
  }
  if ($cbId -le 0) {
    $cbId = $autoId
    $autoId++
  }

  $cbName = [string](Get-FirstValue $v @('ConfigurationBlockName','ConfigBlockName','ManagedWorkspaceName','WorkspaceName'))
  if (-not $cbName) { $cbName = "CSB-$cbId" }
  $cbDesc = [string](Get-FirstValue $v @('ConfigurationBlockDescription','Description'))
  $cbLevel = Resolve-LevelName (Get-FirstValue $v @('ConfigurationBlockLevel','ConfigBlockLevel','Level','ManagedWorkspaceLevel','WorkspaceLevel'))

  $key = "$cbId"
  if (-not $blocks.ContainsKey($key)) {
    $blocks[$key] = [PSCustomObject]@{
      Id = $cbId
      Name = $cbName
      Description = $cbDesc
      Level = $cbLevel
      Variables = [System.Collections.Generic.List[object]]::new()
    }
  }

  $valuesStr = ''
  try { $valuesStr = (Get-FirstValue $v @('Values','ValueSummary') | Out-String).Trim() } catch {}
  $parsed = Parse-ValuesPayload $v $valuesStr
  $folderCode = ''
  if ($parsed.ValueType -eq 'PWFolder' -and -not [string]::IsNullOrWhiteSpace([string]$parsed.Value)) {
    try {
      $folderPath = ([string]$parsed.Value).Trim() -replace '/', '\\'
      if ($folderPath -notmatch '\\$') { $folderPath += '\\' }
      $folderObj = Get-PWFolders -FolderPath $folderPath -JustOne -ErrorAction Stop -WarningAction SilentlyContinue 3>$null 4>$null 5>$null 6>$null
      if ($folderObj -and $folderObj.Code) {
        $folderCode = [string]$folderObj.Code
      }
    } catch {
      $folderCode = ''
    }
  }
  if ($name -match '^(?i)_DYNAMIC_DATASOURCE_BENTLEYROOT$') {
    $loginDebug.Add("TrackedParsed[$name]: Type='$($parsed.ValueType)' Value='$($parsed.Value)' Op='$($parsed.Operator)' Code='$folderCode' Vn='$($parsed._Vn)' Vx='$($parsed._Vx)'")
  }
  $operator = $parsed.Operator
  if ($name -match '^(?i)include$' -and $operator -eq '=') {
    $operator = ':'
  }
  $blocks[$key].Variables.Add(@{
    Name      = $name
    Operator  = $operator
    Value     = $parsed.Value
    ValueType = $parsed.ValueType
    FolderCode = $folderCode
    ValuesRaw = $valuesStr
    Locked    = $parsed.Locked
  })
}

foreach ($key in $blocks.Keys | Sort-Object {[int]$_}) {
  $b = $blocks[$key]
  $result.Add(@{
    Id          = $b.Id
    Name        = $b.Name
    Description = $b.Description
    Level       = $b.Level
    Variables   = @($b.Variables)
    LinkedIds   = @()
  })
}

if ($result.Count -eq 0 -and $workspaces.Count -gt 0) {
  foreach ($ws in $workspaces) {
    $wsIdRaw = Get-FirstValue $ws @('Id','ManagedWorkspaceId','WorkspaceId','ConfigBlockId','CSBId')
    $wsId = 0
    if ($null -ne $wsIdRaw) { [void][int]::TryParse([string]$wsIdRaw, [ref]$wsId) }
    if ($wsId -le 0) { $wsId = $autoId; $autoId++ }
    $wsName = [string](Get-FirstValue $ws @('Name','ManagedWorkspaceName','WorkspaceName','DisplayName'))
    if (-not $wsName) { $wsName = "ManagedWorkspace-$wsId" }
    $wsDesc = [string](Get-FirstValue $ws @('Description','ManagedWorkspaceDescription'))
    $wsLevel = Resolve-LevelName (Get-FirstValue $ws @('Level','ManagedWorkspaceLevel','WorkspaceLevel','Type','Scope'))
    $result.Add(@{
      Id          = $wsId
      Name        = $wsName
      Description = $wsDesc
      Level       = $wsLevel
      Variables   = @()
      LinkedIds   = @()
    })
  }
}

@{
  WorkingDir = $pwWorkingDir
  Csbs       = @($result)
  Debug      = @(
    "Module=${moduleName}",
    "ServerPart=$ServerPart",
    "DatasourceName=$DatasourceName",
    "DatasourceQualified=$datasourceQualified",
    "Login=$($loginDebug -join ' | ')",
    "FolderGuid=$FolderGuid",
    "Workspaces=$($workspaces.Count)",
    "Variables=$($variables.Count)",
    "Csbs=$($result.Count)",
    "WorkspaceNames=$((@($workspaces | Select-Object -ExpandProperty Name) -join '; '))",
    "CsbNames=$((@($result | ForEach-Object { $_.Name }) -join '; '))"
  )
} | ConvertTo-Json -Depth 10
`;
    const tempScript = path.join(os.tmpdir(), `pw-csb-mod-${Date.now()}.ps1`);
    fs.writeFileSync(tempScript, script, 'utf8');
    let out = '';
    let err = '';
    let status = null;
    try {
        const serverHostname = (() => {
            const rawHost = (() => {
                try {
                    return new URL(conn.wsgUrl).hostname;
                }
                catch {
                    return conn.wsgUrl;
                }
            })();
            // ProjectWise login expects server part without the WSG host suffix "-ws"
            // e.g. sncl-uk-pw-ws.bentley.com -> sncl-uk-pw.bentley.com
            return rawHost.replace(/-ws(?=\.|$)/i, '');
        })();
        const result = (0, child_process_1.spawnSync)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', tempScript,
            '-ServerPart', serverHostname,
            '-DatasourceName', conn.datasource,
            '-FolderGuid', ctx.folderGuid,
        ], { timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
        status = result.status;
        out = result.stdout?.toString() ?? '';
        err = result.stderr?.toString() ?? '';
        if (result.error) {
            throw new Error(`PowerShell process error: ${result.error.message}`);
        }
        if (result.signal) {
            throw new Error(`PowerShell process terminated by signal: ${result.signal}`);
        }
        if (status !== 0 && !err.trim() && !out.trim()) {
            throw new Error(`PowerShell module script exited with code ${status} and produced no output.`);
        }
        if (err.trim()) {
            // stderr carries diagnostic messages written by the script (not fatal errors)
            // Surface them to the caller via a thrown error only if stdout is also empty.
            if (!out.trim()) {
                throw new Error(`PowerShell module error:\n${err}`);
            }
        }
        if (!out.trim()) {
            throw new Error(err || 'No output from PowerShell module script');
        }
        return parsePowerShellCsbJson(out);
    }
    catch (e) {
        let debugScriptPath = '';
        let debugStdoutPath = '';
        let debugStderrPath = '';
        try {
            const debugDir = path.join(os.tmpdir(), 'bentley-cfg-debug');
            fs.mkdirSync(debugDir, { recursive: true });
            const stamp = Date.now();
            debugScriptPath = path.join(debugDir, `pw-csb-mod-${stamp}.ps1`);
            debugStdoutPath = path.join(debugDir, `pw-csb-mod-${stamp}.stdout.log`);
            debugStderrPath = path.join(debugDir, `pw-csb-mod-${stamp}.stderr.log`);
            fs.copyFileSync(tempScript, debugScriptPath);
            fs.writeFileSync(debugStdoutPath, out, 'utf8');
            fs.writeFileSync(debugStderrPath, err, 'utf8');
        }
        catch {
            // ignore debug persistence failures; preserve original error
        }
        const base = e instanceof Error ? e.message : String(e);
        const meta = [
            status !== null ? `PowerShell exit code: ${status}` : '',
            debugScriptPath ? `Debug script: ${debugScriptPath}` : '',
            debugStdoutPath ? `Debug stdout: ${debugStdoutPath}` : '',
            debugStderrPath ? `Debug stderr: ${debugStderrPath}` : '',
        ].filter(Boolean).join('\n');
        throw new Error(meta ? `${base}\n${meta}` : base);
    }
    finally {
        try {
            fs.unlinkSync(tempScript);
        }
        catch { /* ignore */ }
    }
}
/** Thin wrapper that discards the working-dir half — used by backends that don't return it. */
function parsePowerShellCsbJsonCsbsOnly(json) {
    return parsePowerShellCsbJson(json).csbs;
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
        return parsePowerShellCsbJsonCsbsOnly(out);
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
#
# Entry points:
#   Application → aaApi_SelectManagedWorkspacesByApplication → CSBs
#   Folder/Doc  → aaApi_SelectProjectByGuid → numeric ID
#               → aaApi_SelectManagedWorkspacesByProject → CSBs
#   Document    → aaApi_GetDocumentNumericProperty(PROP_PROJECTID) → numeric project ID
#               → aaApi_SelectManagedWorkspacesByProject → CSBs

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class DmsCli {
  // ── Session ──────────────────────────────────────────────────────────────
  [DllImport(@"${dllPath}")]
  public static extern bool aaApi_Login(string datasource, string user, string password, string server);
  [DllImport(@"${dllPath}")]
  public static extern bool aaApi_Logout();

  // ── Project (folder) lookup — GUID → numeric ID ──────────────────────────
  // aaApi_SelectProjectByGuid selects a single project row by its GUID.
  // Property IDs for project buffer: 1=NumericId, 2=ParentId, 3=Name
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectProjectByGuid(string guid);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetProjectNumericProperty(IntPtr hBuf, int propId, int row);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_GetProjectStringProperty(IntPtr hBuf, int propId, int row);

  // ── Document lookup — GUID → numeric project ID ──────────────────────────
  // aaApi_SelectDocumentByGuid selects a document row by its GUID.
  // Property IDs for document buffer: 1=DocId, 2=ProjectId (numeric), ...
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectDocumentByGuid(string guid);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetDocumentNumericProperty(IntPtr hBuf, int propId, int row);

  // ── Managed Workspace Profile selection ──────────────────────────────────
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectManagedWorkspacesByApplication(int applicationId);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectManagedWorkspacesByProject(int projectId);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetManagedWorkspaceNumericProperty(IntPtr hBuf, int propId, int row);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_GetManagedWorkspaceStringProperty(IntPtr hBuf, int propId, int row);

  // ── Configuration Settings Block (CSB) selection ─────────────────────────
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectConfigurationBlocksByWorkspace(int workspaceProfileId);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetConfigBlockNumericProperty(IntPtr hBuf, int propId, int row);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_GetConfigBlockStringProperty(IntPtr hBuf, int propId, int row);

  // ── CSB variable selection ────────────────────────────────────────────────
  // Variables are the name=value assignments within a CSB.
  // The %lock directive is represented by the Locked property (propId 4).
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_SelectConfigBlockVariables(int configBlockId);
  [DllImport(@"${dllPath}")]
  public static extern int aaApi_GetConfigBlockVarNumericProperty(IntPtr hBuf, int propId, int row);
  [DllImport(@"${dllPath}")]
  public static extern IntPtr aaApi_GetConfigBlockVarStringProperty(IntPtr hBuf, int propId, int row);

  // ── Buffer utilities ──────────────────────────────────────────────────────
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

# ── Property ID constants (from dmscli.h / ProjectWise SDK) ──────────────────
# CSB block properties
$CFGBLK_PROP_ID          = 1
$CFGBLK_PROP_NAME        = 3
$CFGBLK_PROP_DESCRIPTION = 4
# Level integer encoding: 0=Predefined 1=Global 2=Application 3=Customer 4=Site
#                         5=WorkSpace  6=WorkSet 7=Discipline  8=Role     9=User
$CFGBLK_PROP_LEVEL       = 5

# CSB variable properties
$CFGVAR_PROP_NAME        = 1
$CFGVAR_PROP_VALUE       = 2
$CFGVAR_PROP_OPERATOR    = 3   # 0==  1=>  2=<  3=:
$CFGVAR_PROP_LOCKED      = 4   # 0=not locked  1=locked (%lock directive)
$CFGVAR_PROP_VALUETYPE   = 5   # 0=Literal  1=PWFolder  2=dms_project  3=LastDirPiece

# Managed Workspace Profile property
$MWSP_PROP_ID            = 1

# Project (folder) property
$PROJ_PROP_ID            = 1   # numeric project ID

# Document property
$DOC_PROP_PROJECTID      = 2   # numeric ID of the parent project/folder

$levelNames = @('Predefined','Global','Application','Customer','Site','WorkSpace','WorkSet','Discipline','Role','User')
$opNames    = @('=','>','<',':')
$vtNames    = @('Literal','PWFolder','dms_project','LastDirPiece')

# ── Helper: read all CSBs for a given Managed Workspace Profile ID ────────────
function Get-CsbsForProfileId([int]$profileId) {
  $csbBuf = [DmsCli]::aaApi_SelectConfigurationBlocksByWorkspace($profileId)
  $count  = if ($csbBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($csbBuf) } else { 0 }
  $items  = [System.Collections.Generic.List[object]]::new()
  for ($ci = 0; $ci -lt $count; $ci++) {
    $csbId    = [DmsCli]::aaApi_GetConfigBlockNumericProperty($csbBuf, $CFGBLK_PROP_ID, $ci)
    $csbName  = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockStringProperty($csbBuf, $CFGBLK_PROP_NAME, $ci))
    $csbDesc  = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockStringProperty($csbBuf, $CFGBLK_PROP_DESCRIPTION, $ci))
    $levelIdx = [DmsCli]::aaApi_GetConfigBlockNumericProperty($csbBuf, $CFGBLK_PROP_LEVEL, $ci)
    $levelStr = if ($levelIdx -ge 0 -and $levelIdx -lt $levelNames.Count) { $levelNames[$levelIdx] } else { 'Global' }

    $varBuf   = [DmsCli]::aaApi_SelectConfigBlockVariables($csbId)
    $varCount = if ($varBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($varBuf) } else { 0 }
    $vars = [System.Collections.Generic.List[object]]::new()
    for ($vi = 0; $vi -lt $varCount; $vi++) {
      $vName  = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockVarStringProperty($varBuf, $CFGVAR_PROP_NAME, $vi))
      $vVal   = [DmsCli]::GetStr([DmsCli]::aaApi_GetConfigBlockVarStringProperty($varBuf, $CFGVAR_PROP_VALUE, $vi))
      $opIdx  = [DmsCli]::aaApi_GetConfigBlockVarNumericProperty($varBuf, $CFGVAR_PROP_OPERATOR, $vi)
      $locked = [DmsCli]::aaApi_GetConfigBlockVarNumericProperty($varBuf, $CFGVAR_PROP_LOCKED, $vi) -ne 0
      $vtIdx  = [DmsCli]::aaApi_GetConfigBlockVarNumericProperty($varBuf, $CFGVAR_PROP_VALUETYPE, $vi)
      $opStr  = if ($opIdx -ge 0 -and $opIdx -lt $opNames.Count) { $opNames[$opIdx] } else { '=' }
      $vtStr  = if ($vtIdx -ge 0 -and $vtIdx -lt $vtNames.Count) { $vtNames[$vtIdx] } else { 'Literal' }
      $vars.Add(@{ Name=$vName; Operator=$opStr; Value=$vVal; ValueType=$vtStr; Locked=$locked })
    }
    if ($varBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($varBuf) | Out-Null }
    $items.Add(@{ Id=$csbId; Name=$csbName; Description=$csbDesc; Level=$levelStr; Variables=$vars.ToArray(); LinkedIds=@() })
  }
  if ($csbBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($csbBuf) | Out-Null }
  return ,$items.ToArray()
}

# ── Helper: resolve a GUID to a numeric project ID via aaApi_SelectProjectByGuid
function Get-ProjectNumericId([string]$guid) {
  $buf = [DmsCli]::aaApi_SelectProjectByGuid($guid)
  if ($buf -eq [IntPtr]::Zero) { return -1 }
  $id = [DmsCli]::aaApi_GetProjectNumericProperty($buf, $PROJ_PROP_ID, 0)
  [DmsCli]::aaApi_FreeBuffer($buf) | Out-Null
  return $id
}

# ── Helper: resolve a document GUID to a numeric project ID ──────────────────
function Get-ProjectIdFromDocument([string]$docGuid) {
  $buf = [DmsCli]::aaApi_SelectDocumentByGuid($docGuid)
  if ($buf -eq [IntPtr]::Zero) { return -1 }
  $projId = [DmsCli]::aaApi_GetDocumentNumericProperty($buf, $DOC_PROP_PROJECTID, 0)
  [DmsCli]::aaApi_FreeBuffer($buf) | Out-Null
  return $projId
}

$result = [System.Collections.Generic.List[object]]::new()
$seenIds = [System.Collections.Generic.HashSet[int]]::new()

try {
  $ok = [DmsCli]::aaApi_Login("${conn.datasource}", "${conn.username}", "${conn.credential}", "${serverHost}")
  if (-not $ok) { throw "Login failed for datasource ${conn.datasource}" }

  # ── Application-level CSBs (Predefined → WorkSpace) ──────────────────────
  # The Managed Workspace Profile is assigned to the Application. This gives us
  # all global/predefined/workspace-level CSBs.
${ctx.applicationInstanceId ? `
  $appId = [int]"${ctx.applicationInstanceId}"
  $wsBuf = [DmsCli]::aaApi_SelectManagedWorkspacesByApplication($appId)
  $wsCount = if ($wsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($wsBuf) } else { 0 }
  for ($wi = 0; $wi -lt $wsCount; $wi++) {
    $profileId = [DmsCli]::aaApi_GetManagedWorkspaceNumericProperty($wsBuf, $MWSP_PROP_ID, $wi)
    foreach ($csb in (Get-CsbsForProfileId $profileId)) {
      if ($seenIds.Add($csb.Id)) { $result.Add($csb) }
    }
  }
  if ($wsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($wsBuf) | Out-Null }
` : `  # applicationInstanceId not provided — skipping Application-level CSBs`}

  # ── Document-derived folder CSBs ──────────────────────────────────────────
  # If a document GUID was provided (user selected a document in the extension),
  # resolve it to its parent folder's numeric project ID, then fetch WorkSet CSBs.
${ctx.documentGuid ? `
  $docProjId = Get-ProjectIdFromDocument "${ctx.documentGuid}"
  if ($docProjId -gt 0) {
    $docWsBuf = [DmsCli]::aaApi_SelectManagedWorkspacesByProject($docProjId)
    $docWsCount = if ($docWsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($docWsBuf) } else { 0 }
    for ($wi = 0; $wi -lt $docWsCount; $wi++) {
      $profileId = [DmsCli]::aaApi_GetManagedWorkspaceNumericProperty($docWsBuf, $MWSP_PROP_ID, $wi)
      foreach ($csb in (Get-CsbsForProfileId $profileId)) {
        if ($seenIds.Add($csb.Id)) { $result.Add($csb) }
      }
    }
    if ($docWsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($docWsBuf) | Out-Null }
  }
` : `  # documentGuid not provided — skipping document-derived folder CSBs`}

  # ── Folder-assigned CSBs (WorkSet / Discipline level) ────────────────────
  # CSBs can be assigned directly to a PW Work Area (folder) in PW Administrator.
  # aaApi_SelectManagedWorkspacesByProject requires a numeric project ID.
  # We resolve the GUID via aaApi_SelectProjectByGuid (added in PW SDK).
${ctx.folderGuid ? `
  $numericProjId = Get-ProjectNumericId "${ctx.folderGuid}"
  if ($numericProjId -gt 0) {
    $projWsBuf = [DmsCli]::aaApi_SelectManagedWorkspacesByProject($numericProjId)
    $projWsCount = if ($projWsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_GetBufferItemCount($projWsBuf) } else { 0 }
    for ($wi = 0; $wi -lt $projWsCount; $wi++) {
      $profileId = [DmsCli]::aaApi_GetManagedWorkspaceNumericProperty($projWsBuf, $MWSP_PROP_ID, $wi)
      foreach ($csb in (Get-CsbsForProfileId $profileId)) {
        if ($seenIds.Add($csb.Id)) { $result.Add($csb) }
      }
    }
    if ($projWsBuf -ne [IntPtr]::Zero) { [DmsCli]::aaApi_FreeBuffer($projWsBuf) | Out-Null }
  } else {
    [Console]::Error.WriteLine("Could not resolve folderGuid '${ctx.folderGuid}' to a numeric project ID via aaApi_SelectProjectByGuid")
  }
` : `  # folderGuid not provided — skipping folder-assigned CSBs`}

} finally {
  [DmsCli]::aaApi_Logout() | Out-Null
}

# Wrap in array explicitly — ConvertTo-Json unwraps single-element collections otherwise
@($result) | ConvertTo-Json -Depth 10
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
async function downloadPwFolderToDms(client, conn, pwFolderMetaByPath, pwLogicalPath, workDir, dmsPathMap, messages, cfgNameLike, knownFolder) {
    try {
        const matchedFolder = (() => {
            if (knownFolder)
                return Promise.resolve(knownFolder);
            return (async () => {
                const projects = await client.listProjects();
                return findFolderByPath(client, pwLogicalPath, projects);
            })();
        })();
        let folder = await matchedFolder;
        if (!folder) {
            messages.push({
                level: 'warning',
                text: `Could not locate PW folder "${pwLogicalPath}" in repository.`,
            });
            return null;
        }
        const cachedMeta = pwFolderMetaByPath.get(normalisePwLogicalPathKey(pwLogicalPath));
        if (cachedMeta) {
            folder = {
                ...folder,
                code: folder.code || cachedMeta.code,
                projectId: folder.projectId || cachedMeta.projectId,
            };
        }
        if ((!folder.code || !folder.projectId) && folder.instanceId) {
            const refreshed = await client.getProjectByGuid(folder.instanceId);
            if (refreshed) {
                folder = { ...folder, ...refreshed };
            }
        }
        if (!folder.code && !folder.projectId) {
            const resolvedMeta = (await resolvePwFolderMetadataViaPwModule(conn, [pwLogicalPath])).get(normalisePwLogicalPathKey(pwLogicalPath));
            if (resolvedMeta) {
                pwFolderMetaByPath.set(normalisePwLogicalPathKey(pwLogicalPath), resolvedMeta);
                messages.push({
                    level: 'info',
                    text: `PWFolder on-demand metadata: path="${pwLogicalPath}" code="${resolvedMeta.code ?? ''}" projectId="${resolvedMeta.projectId ?? ''}" lookup="${resolvedMeta.lookupUsed ?? ''}"`,
                });
                folder = {
                    ...folder,
                    code: folder.code || resolvedMeta.code,
                    projectId: folder.projectId || resolvedMeta.projectId,
                };
            }
        }
        const existing = dmsPathMap[folder.instanceId];
        if (existing) {
            return existing.dmsDir;
        }
        const folderCode = (folder.code ?? '').trim();
        const folderProjectId = folder.projectId;
        const preferredDmsDirName = /^dms\d+$/i.test(folderCode)
            ? folderCode.toLowerCase()
            : (typeof folderProjectId === 'number' && Number.isFinite(folderProjectId) && folderProjectId > 0
                ? `dms${folderProjectId}`
                : '');
        // Fallback if Code isn't available (or doesn't match dms#### pattern)
        const dmsIndex = Object.keys(dmsPathMap).length;
        let dmsDirName = preferredDmsDirName || `dms${String(dmsIndex).padStart(5, '0')}`;
        // Avoid collisions with an existing different PW folder mapping
        const collides = Object.values(dmsPathMap).some(entry => path.basename(entry.dmsDir).toLowerCase() === dmsDirName.toLowerCase() &&
            entry.pwLogicalPath.toLowerCase() !== pwLogicalPath.toLowerCase());
        if (collides) {
            dmsDirName = `dms${String(dmsIndex).padStart(5, '0')}`;
        }
        const dmsDir = path.join(workDir, dmsDirName);
        fs.mkdirSync(dmsDir, { recursive: true });
        dmsPathMap[folder.instanceId] = {
            dmsDir,
            pwLogicalPath,
            folderName: folder.name,
        };
        let cfgFiles = [];
        if (cfgNameLike) {
            try {
                cfgFiles = await client.fetchCfgFilesByNameLike(folder.instanceId, cfgNameLike);
                messages.push({
                    level: 'info',
                    text: `WSG filtered fetch Project/${folder.instanceId}/Document (like '${cfgNameLike}') returned ${cfgFiles.length} file(s).`,
                });
            }
            catch {
                cfgFiles = [];
            }
        }
        if (cfgFiles.length === 0) {
            const docs = await client.listDocuments(folder.instanceId);
            for (const doc of docs.filter(d => /\.(cfg|ucf|pcf)$/i.test(d.fileName))) {
                try {
                    const content = await client.downloadDocumentContent(doc.instanceId);
                    cfgFiles.push({ pwPath: `/${doc.fileName}`, content });
                }
                catch {
                    // skip undownloadable file
                }
            }
        }
        for (const { pwPath, content } of cfgFiles) {
            const localPath = path.join(dmsDir, path.basename(pwPath));
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
async function downloadAdditionalPwFolders(client, conn, pwFolderMetaByPath, csbs, workDir, dmsPathMap, messages) {
    const seenPaths = new Set(Object.values(dmsPathMap).map(e => normalisePwPathForLookup(e.pwLogicalPath)));
    for (const csb of csbs) {
        for (const v of csb.variables) {
            if (v.valueType === 'PWFolder' && v.value) {
                const normalised = normalisePwPathForLookup(v.value);
                if (!seenPaths.has(normalised)) {
                    seenPaths.add(normalised);
                    await downloadPwFolderToDms(client, conn, pwFolderMetaByPath, v.value, workDir, dmsPathMap, messages);
                }
            }
        }
    }
}
/**
 * Navigate the PW folder tree to find the folder at a logical path.
 *
 * Handles PW logical path formats:
 *  • @:\Configuration\WorkSpaces\     — @: is the datasource root marker
 *  • \MyDatasource\Configuration\     — leading datasource name as first segment
 *  • Configuration\WorkSpaces\        — relative path from repository root
 *  • /Configuration/WorkSpaces/       — forward-slash variant
 *
 * The @: prefix is stripped before descent; the remaining path is matched
 * segment-by-segment from the repository root folder list.
 */
async function findFolderByPath(client, logicalPath, rootFolders) {
    // Strip the @: datasource-root prefix (PW logical path root marker)
    const stripped = logicalPath.replace(/^@:[/\\]*/i, '').replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
    const segments = stripped.split(/[/\\]/).filter(Boolean);
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
/**
 * After the initial PW folder downloads, scan all downloaded CFG/UCF/PCF files
 * for %include directives that reference PW paths (starting with @:\ or @:/).
 * Download any such folders that haven't been downloaded yet.
 *
 * This resolves the recursive include chain:
 *   CSB → sets _USTN_CONFIGURATION = @:\Configuration\
 *       → downloaded to dms00000/
 *       → dms00000/WorkSpaces/MyWorkspace.cfg has:
 *           %include @:\Configuration\Organization\*.cfg
 *       → @:\Configuration\Organization\ is downloaded as dms00001/
 *       → and so on until no new @: paths are found
 *
 * Also scans Literal-type CSB variable values for @: paths that should be
 * downloaded (e.g. literal _USTN_CONFIGURATION assignments using @: syntax).
 */
async function resolveAtPathsRecursively(client, conn, pwFolderMetaByPath, csbs, workDir, dmsPathMap, messages) {
    const seenPwFolders = new Set(Object.values(dmsPathMap).map(e => normaliseAtPath(e.pwLogicalPath)));
    const variableContext = buildIncludeVariableContext(csbs);
    const pending = [];
    const enqueue = (pwFolderPath, cfgNameLike) => {
        const key = normaliseAtPath(pwFolderPath);
        if (!seenPwFolders.has(key)) {
            seenPwFolders.add(key);
            pending.push({ pwFolderPath, cfgNameLike });
        }
    };
    // Seed queue from CSB PWFolder variables and include directives.
    for (const csb of csbs) {
        for (const v of csb.variables) {
            if (v.valueType === 'PWFolder' && v.value) {
                enqueue(v.value);
            }
            if (/^include$/i.test(v.name) && v.value) {
                const expanded = expandIncludeExpression(v.value, variableContext);
                const target = includeToPwFolderTarget(expanded);
                if (target)
                    enqueue(target.folderPath, target.cfgNameLike);
            }
            if (isAtPath(v.value)) {
                enqueue(v.value);
            }
        }
    }
    // BFS: download queued PW folders and recursively scan all local cfg/ucf/pcf
    // for further %include directives.
    let batch = [...pending];
    let pass = 0;
    while (batch.length > 0 && pass < 20) {
        pass++;
        const nextBatch = [];
        for (const item of batch) {
            const dmsDir = await downloadPwFolderToDms(client, conn, pwFolderMetaByPath, item.pwFolderPath, workDir, dmsPathMap, messages, item.cfgNameLike);
            if (!dmsDir)
                continue;
            for (const file of walkLocalDir(workDir)) {
                if (!/\.(cfg|ucf|pcf)$/i.test(file))
                    continue;
                try {
                    const content = fs.readFileSync(file, 'utf8');
                    for (const includeExpr of extractIncludeExpressions(content)) {
                        const expanded = expandIncludeExpression(includeExpr, variableContext);
                        const target = includeToPwFolderTarget(expanded);
                        if (!target)
                            continue;
                        const key = normaliseAtPath(target.folderPath);
                        if (!seenPwFolders.has(key)) {
                            seenPwFolders.add(key);
                            nextBatch.push({ pwFolderPath: target.folderPath, cfgNameLike: target.cfgNameLike });
                        }
                    }
                }
                catch {
                    // ignore unreadable file and continue recursion
                }
            }
        }
        batch = nextBatch;
    }
    if (pass >= 20) {
        messages.push({ level: 'warning', text: 'Stopped %include recursion after 20 passes (possible cycle).' });
    }
}
/** Returns true if a value string is a PW logical path using the @: root prefix. */
function isAtPath(value) {
    return /^@:[/\\]/i.test(value);
}
/** Normalises a PW logical path for deduplication (lowercase, forward slashes, no trailing slash). */
function normaliseAtPath(p) {
    return p.replace(/^@:[/\\]*/i, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
/**
 * Scan CFG file content for %include lines that reference @: paths.
 * Returns all unique @: folder paths found.
 */
function extractIncludeExpressions(content) {
    const expressions = [];
    for (const line of content.split(/\r?\n/)) {
        const stripped = line.replace(/#.*$/, '').trim();
        const m = stripped.match(/^%include\s+(.*?)(?:\s+level\s+\w+)?\s*$/i);
        if (m) {
            const expr = m[1].trim();
            if (expr)
                expressions.push(expr);
        }
    }
    return [...new Set(expressions)];
}
function buildIncludeVariableContext(csbs) {
    const context = new Map();
    for (const csb of csbs) {
        for (const v of csb.variables) {
            if (!v.name)
                continue;
            let value = v.value ?? '';
            if (v.valueType === 'PWFolder' && value && !/[\\/]$/.test(value)) {
                value = `${value}/`;
            }
            const existing = context.get(v.name);
            if (v.operator === '=')
                context.set(v.name, value);
            else if (v.operator === ':') {
                if (!existing)
                    context.set(v.name, value);
            }
            else if (v.operator === '>') {
                context.set(v.name, existing ? `${existing};${value}` : value);
            }
            else if (v.operator === '<') {
                context.set(v.name, existing ? `${value};${existing}` : value);
            }
        }
    }
    return context;
}
function expandIncludeExpression(expr, context) {
    let out = expr;
    let iterations = 0;
    while (iterations < 10) {
        const next = out
            .replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (m, n) => context.get(n) ?? m)
            .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => context.get(n) ?? m);
        if (next === out)
            break;
        out = next;
        iterations++;
    }
    return out;
}
function includeToPwFolderTarget(includePath) {
    if (!includePath)
        return null;
    let candidate = includePath.trim().replace(/^['"]|['"]$/g, '');
    if (!candidate || /\$\(|\$\{/.test(candidate))
        return null;
    const normal = candidate.replace(/\\/g, '/');
    const isWindowsAbs = /^[A-Za-z]:\//.test(normal);
    const isUnixAbs = normal.startsWith('/');
    const isRelativeLocal = normal.startsWith('./') || normal.startsWith('../');
    if (isWindowsAbs || isUnixAbs || isRelativeLocal)
        return null;
    // Treat as PW logical include path.
    // If include targets a specific cfg/wildcard, keep that name pattern for WSG filtering.
    let cfgNameLike;
    const lastSegMatch = candidate.match(/[^/\\]+$/);
    const lastSeg = lastSegMatch?.[0] ?? '';
    if (lastSeg && (/[*?]/.test(lastSeg) || /\.(cfg|ucf|pcf)$/i.test(lastSeg))) {
        cfgNameLike = lastSeg.replace(/\?/g, '_').replace(/\*/g, '%');
    }
    // Reduce to folder path.
    let folder = candidate;
    if (/[*?]/.test(folder) || /\.(cfg|ucf|pcf)$/i.test(folder)) {
        folder = folder.replace(/[/\\][^/\\]*$/, '');
    }
    folder = folder.replace(/[/\\]+$/, '');
    if (!folder)
        return null;
    return { folderPath: folder, cfgNameLike };
}
/** Recursively list all files under a directory. */
function walkLocalDir(dir) {
    const results = [];
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory())
                results.push(...walkLocalDir(full));
            else
                results.push(full);
        }
    }
    catch { /* ignore unreadable dirs */ }
    return results;
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
        if (v.operator === ':') {
            lines.push(`%${v.name} ${resolved}`);
        }
        else {
            lines.push(`${v.name} ${v.operator} ${resolved}`);
        }
        if (v.locked)
            lines.push(`%lock ${v.name}`);
    }
    lines.push('');
    return lines.join('\n');
}
/**
 * Normalise a PW logical path for use as a lookup key.
 *
 * The same folder can appear in CSBs with several different path formats:
 *   @:\Configuration\WorkSpaces\   (PW @: root prefix, backslashes)
 *   \Configuration\WorkSpaces\     (backslash-rooted, no @:)
 *   @:/Configuration/WorkSpaces/   (forward-slash variant)
 *   Configuration/WorkSpaces       (relative, no leading separator)
 *
 * This function reduces all variants to a canonical lower-case
 * forward-slash form without leading/trailing separators so that
 * dmsPathMap lookups succeed regardless of which format was used
 * when the folder was originally downloaded.
 */
function normalisePwPathForLookup(p) {
    return p
        .replace(/^@:[/\\]*/i, '') // strip @: datasource-root prefix
        .replace(/\\/g, '/') // backslash → forward slash
        .replace(/^\/+/, '') // strip leading slashes
        .replace(/\/+$/, '') // strip trailing slashes
        .toLowerCase();
}
/**
 * Resolve a CSB variable value based on its ValueType.
 */
function resolveValueType(v, workDir, dmsPathMap) {
    const fwdWorkDir = workDir.replace(/\\/g, '/');
    switch (v.valueType) {
        case 'Literal': {
            // If the literal value is a PW logical path (@:\...) it should resolve
            // to the same local dmsNNNNN/ directory as a PWFolder-typed variable
            // would.  The folder will have been downloaded during
            // resolveAtPathsRecursively() and recorded in dmsPathMap.
            if (isAtPath(v.value)) {
                const normVal = normalisePwPathForLookup(v.value);
                const entry = Object.values(dmsPathMap).find(e => normalisePwPathForLookup(e.pwLogicalPath) === normVal);
                if (entry) {
                    return entry.dmsDir.replace(/\\/g, '/') + '/';
                }
                // Folder not yet in dmsPathMap (e.g. download failed).
                // Fall back to folderCode / folderProjectId if they were populated.
                const code = (v.folderCode ?? '').trim().toLowerCase();
                if (/^dms\d+$/i.test(code)) {
                    return `${fwdWorkDir}/${code}/`;
                }
                const projectId = v.folderProjectId;
                if (typeof projectId === 'number' && Number.isFinite(projectId) && projectId > 0) {
                    return `${fwdWorkDir}/dms${projectId}/`;
                }
            }
            return v.value;
        }
        case 'PWFolder': {
            // Look up in dmsPathMap by pwLogicalPath, normalising both sides so that
            // @:\Config\, \Config\, @:/Config/, /Config/ all resolve to the same entry.
            const normVal = normalisePwPathForLookup(v.value);
            const entry = Object.values(dmsPathMap).find(e => normalisePwPathForLookup(e.pwLogicalPath) === normVal);
            if (entry) {
                return entry.dmsDir.replace(/\\/g, '/') + '/';
            }
            const code = (v.folderCode ?? '').trim().toLowerCase();
            if (/^dms\d+$/i.test(code)) {
                return `${fwdWorkDir}/${code}/`;
            }
            const projectId = v.folderProjectId;
            if (typeof projectId === 'number' && Number.isFinite(projectId) && projectId > 0) {
                return `${fwdWorkDir}/dms${projectId}/`;
            }
            // Not yet downloaded — emit an approximate path with a placeholder dms dir.
            // The cfg parser will flag the unresolved path.
            const folderName = v.value.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'unknown';
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
function buildMasterTmp(orderedCsbs, wsDir, workDir, ctx, dmsPathMap, workspaceName, worksetName, pwWorkingDir, selectedFolderLocalDir) {
    // Use the real PW working directory if available (from pwps_dab datasource info).
    // This is the local folder where ProjectWise copies out checked-out files, and is
    // what PWE seeds as PW_WORKDIR. Fall back to the temp work directory otherwise.
    const effectiveWorkDir = pwWorkingDir ?? workDir;
    const fwdWorkDir = effectiveWorkDir.replace(/\\/g, '/');
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
    if (selectedFolderLocalDir) {
        lines.push(`# ── Selected document folder ───────────────────────────────────────`);
        lines.push(`_DGNDIR : ${selectedFolderLocalDir.replace(/\\/g, '/')}/`);
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
/**
 * Parse the JSON produced by the Backend A and B PowerShell scripts.
 *
 * Handles two output formats:
 *  - Legacy array:  [ { Id, Name, Level, Variables, ... }, ... ]
 *  - Wrapper object: { WorkingDir: "...", Csbs: [ ... ] }
 *
 * The wrapper format is produced by the updated Backend A script so that the
 * PW working directory (used for PW_WORKDIR seeding) can be passed back
 * alongside the CSBs without a second round-trip.
 */
function parsePowerShellCsbJson(json) {
    const clean = extractJsonPayload(json);
    const raw = JSON.parse(clean);
    // Detect wrapper object format
    let csbArray;
    let pwWorkingDir = '';
    let debug;
    if (Array.isArray(raw)) {
        csbArray = raw;
    }
    else if (raw && typeof raw === 'object' && (raw.Csbs ?? raw.csbs)) {
        csbArray = raw.Csbs ?? raw.csbs ?? [];
        pwWorkingDir = String(raw.WorkingDir ?? raw.workingDir ?? '');
        debug = Array.isArray(raw.Debug ?? raw.debug)
            ? (raw.Debug ?? raw.debug).map((v) => String(v))
            : undefined;
    }
    else {
        // Single CSB object
        csbArray = [raw];
    }
    const csbs = csbArray.map((item) => ({
        id: Number(item.Id ?? item.id ?? 0),
        name: String(item.Name ?? item.name ?? ''),
        description: String(item.Description ?? item.description ?? ''),
        level: normaliseCsbLevel(String(item.Level ?? item.level ?? 'Global')),
        variables: (item.Variables ?? item.variables ?? []).map((v) => parsePowerShellVariable(v)),
        linkedCsbIds: Array.isArray(item.LinkedIds) ? item.LinkedIds.map(Number) : [],
    }));
    return { csbs, pwWorkingDir, debug };
}
function extractJsonPayload(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return trimmed;
    const firstObject = trimmed.indexOf('{');
    const lastObject = trimmed.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
        return trimmed.slice(firstObject, lastObject + 1);
    }
    const firstArray = trimmed.indexOf('[');
    const lastArray = trimmed.lastIndexOf(']');
    if (firstArray >= 0 && lastArray > firstArray) {
        return trimmed.slice(firstArray, lastArray + 1);
    }
    return trimmed;
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
    const normalised = op.trim().toLowerCase();
    if (normalised === 'assignment')
        return '=';
    if (normalised === 'append')
        return '>';
    if (normalised === 'prepend')
        return '<';
    if (normalised === 'directive')
        return ':';
    return ['=', '>', '<', ':'].includes(op)
        ? op
        : '=';
}
function normaliseCsbValueType(vt) {
    const map = {
        string: 'Literal',
        literal: 'Literal',
        project: 'PWFolder',
        folder: 'PWFolder',
        pwfolder: 'PWFolder',
        dms_project: 'dms_project',
        lastdirpiece: 'LastDirPiece',
    };
    return map[vt.toLowerCase()] ?? 'Literal';
}
function parsePowerShellVariable(v) {
    const valuesText = String(firstDefined(v, ['ValuesRaw', 'valuesRaw', 'Values', 'values', 'ValueSummary', 'valueSummary']) ?? '').trim();
    let rawOperator = firstDefined(v, ['Operator', 'operator', 'AssignmentOperator', 'assignmentOperator']);
    if ((rawOperator === undefined || rawOperator === null || rawOperator === '') && valuesText) {
        const m = valuesText.match(/Op\s*Type\s*:\s*([A-Za-z_]+)/i);
        if (m)
            rawOperator = m[1];
    }
    let rawValueType = firstDefined(v, ['ValueType', 'valueType', 'VariableValueType', 'variableValueType']);
    if ((rawValueType === undefined || rawValueType === null || rawValueType === '') && valuesText) {
        const m = valuesText.match(/Value\s*Type\s*:\s*([A-Za-z_]+)/i);
        if (m)
            rawValueType = m[1];
    }
    let rawValue = firstDefined(v, ['Value', 'value', 'VariableValue', 'variableValue']);
    if ((rawValue === undefined || rawValue === null || rawValue === '') && valuesText) {
        rawValue = extractValueFromPwValuesText(valuesText) || rawValue;
    }
    const rawValueTypeText = String(rawValueType ?? '').toLowerCase();
    if ((rawValueTypeText === 'project' || rawValueTypeText === 'pwfolder' || rawValueTypeText === 'folder') && valuesText) {
        const forced = extractValueFromPwValuesText(valuesText);
        if (forced)
            rawValue = forced;
    }
    return {
        name: String(v.Name ?? v.name ?? ''),
        operator: normaliseOperator(String(rawOperator ?? '=')),
        value: String(rawValue ?? '').trim(),
        folderCode: String(firstDefined(v, ['FolderCode', 'folderCode']) ?? '').trim() || undefined,
        valueType: normaliseCsbValueType(String(rawValueType ?? 'Literal')),
        locked: Boolean(v.Locked ?? v.locked ?? false),
    };
}
function extractValueFromPwValuesText(valuesText) {
    const text = String(valuesText ?? '')
        .replace(/[\x00-\x1F\x7F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text)
        return '';
    const explicit = text.match(/\bValue\s*:\s*(.+)$/i);
    if (explicit?.[1])
        return explicit[1].trim();
    const marker = /Value\s*Type\s*:\s*/i.exec(text);
    if (!marker)
        return '';
    const tail = text.slice(marker.index + marker[0].length).trim();
    if (!tail)
        return '';
    const payload = tail.replace(/^\S+\s*/, '').trim();
    return payload;
}
function firstDefined(obj, names) {
    for (const name of names) {
        if (obj?.[name] !== undefined && obj?.[name] !== null)
            return obj[name];
    }
    return undefined;
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