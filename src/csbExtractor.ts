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

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { ProjectWiseClient, PwConnection, PwFolder } from './pwClient';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single variable entry within a CSB */
export interface CsbVariable {
  name: string;
  operator: '=' | '>' | '<' | ':';
  value: string;
  /**
   * Raw value type from PW:
   *  Literal      — use value as-is
   *  PWFolder     — value is a PW logical path; translate to local dms path
   *  dms_project  — value is the current-document working folder
   *  LastDirPiece — last folder segment of value (workspace/workset name)
   */
  valueType: 'Literal' | 'PWFolder' | 'dms_project' | 'LastDirPiece' | 'Unknown';
  locked: boolean;
}

/** One Configuration Settings Block */
export interface CsbBlock {
  id: number;           // PW database ID (used as filename: {id}.cfg)
  name: string;
  description: string;
  level: CsbLevel;
  variables: CsbVariable[];
  /** IDs of other CSBs linked from this one (processed immediately after) */
  linkedCsbIds: number[];
  /** PW folder GUID this CSB is directly assigned to (if known) */
  assignedFolderGuid?: string;
}

/** CSB processing levels — PW names mapped to MicroStation %level numbers */
export type CsbLevel =
  | 'Predefined'   // %level 0 — injected before System CFG
  | 'Global'       // %level 0 — injected after System CFG
  | 'Application'  // %level 1
  | 'Customer'     // %level 2 (Organisation)
  | 'Site'         // %level 2 (Organisation/Site)
  | 'WorkSpace'    // %level 3
  | 'WorkSet'      // %level 4 (also "Project")
  | 'Discipline'   // %level 4 sub-level
  | 'Role'         // %level 5
  | 'User';        // %level 6

/** Maps CSB level name to MicroStation %level number */
export const CSB_LEVEL_MAP: Record<CsbLevel, number> = {
  Predefined:  0,
  Global:      0,
  Application: 1,
  Customer:    2,
  Site:        2,
  WorkSpace:   3,
  WorkSet:     4,
  Discipline:  4,
  Role:        5,
  User:        6,
};

/** Processing order PWE uses when assembling the master .tmp */
export const CSB_PROCESSING_ORDER: CsbLevel[] = [
  'Predefined', 'Global', 'Application',
  'Customer', 'Site',
  'WorkSpace', 'WorkSet', 'Discipline',
  'Role', 'User',
];

// ─────────────────────────────────────────────────────────────────────────────
// PW Application
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ProjectWise Application — the entity that CSBs are primarily assigned to.
 * This is the correct starting point for resolving a Managed Workspace, not
 * the folder hierarchy.
 */
export interface PwApplication {
  instanceId: string;
  name: string;
  description: string;
  /** Managed Workspace profile ID assigned to this application (if any) */
  managedWorkspaceProfileId?: string;
  /** Name of the Managed Workspace profile */
  managedWorkspaceProfileName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Managed Workspace Context
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagedWorkspaceContext {
  /** Datasource name (e.g. "pwdb") */
  datasource: string;

  /**
   * The PW Application instance ID (preferred starting point).
   * If provided, CSBs assigned to this Application are fetched first.
   * Maps to how PWE resolves the Managed Workspace Profile from the Application.
   */
  applicationInstanceId?: string;

  /**
   * PW folder GUID for the target document's folder.
   * Drives WorkSet-level CSBs and seeds _USTN_WORKSETNAME via LastDirPiece.
   */
  folderGuid?: string;

  /** Document GUID — used for document-level CSB assignments if present */
  documentGuid?: string;

  /**
   * Explicit workspace name override.
   * If not provided, derived from WorkSpace-level CSBs (LastDirPiece).
   */
  workspaceName?: string;

  /**
   * Explicit workset name override.
   * If not provided, derived from the PW folder name (LastDirPiece).
   */
  worksetName?: string;

  /**
   * Local working directory root.
   * Defaults to a temp directory.
   *
   * Structure written mirrors PWE:
   *   workDir/
   *     workspace/       ← {CsbID}.cfg files and master .tmp
   *     dms00000/        ← downloaded PW folder contents (Configuration etc.)
   *     dms00001/
   *     ...
   */
  workDir?: string;
}

/**
 * Maps a PW folder GUID to its local dms subdirectory.
 * Built as PW folder content is downloaded so PWFolder type variables
 * can be resolved to actual local paths in the generated .cfg files.
 */
export interface DmsPathMap {
  [folderGuid: string]: {
    dmsDir: string;        // absolute local path (e.g. /tmp/pw-ws-123/dms00000)
    pwLogicalPath: string; // PW logical path (e.g. \MyDS\Configuration\)
    folderName: string;    // last segment
  };
}

export interface CsbExtractionResult {
  /** Path to master .tmp — equivalent to the -wc argument passed to MicroStation */
  masterTmpPath: string;
  /** Working directory root */
  workDir: string;
  /** All CSBs in processing order */
  csbs: CsbBlock[];
  /** PW folder GUID → local dms directory (for resolving PWFolder values) */
  dmsPathMap: DmsPathMap;
  /**
   * Workspace and WorkSet names extracted from CSBs (LastDirPiece values).
   * Seeded into the master .tmp so the cfg parser can resolve
   * _USTN_WORKSPACENAME / _USTN_WORKSETNAME and follow workspace/workset includes.
   */
  workspaceName?: string;
  worksetName?: string;
  /** Warnings / errors from the extraction process */
  messages: Array<{ level: 'info' | 'warning' | 'error'; text: string }>;
  /** Which backend successfully read the CSBs */
  backend: 'powershell-pwmodule' | 'powershell-dmscli' | 'wsg-documents' | 'manual';
}

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
export async function extractManagedWorkspace(
  conn: PwConnection,
  ctx: ManagedWorkspaceContext,
  client: ProjectWiseClient
): Promise<CsbExtractionResult> {
  const workDir = ctx.workDir ?? path.join(os.tmpdir(), `pw-managed-ws-${Date.now()}`);
  const wsDir = path.join(workDir, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });

  const messages: CsbExtractionResult['messages'] = [];
  const dmsPathMap: DmsPathMap = {};

  // ── Step 1: Fetch CSBs ────────────────────────────────────────────────────
  let csbs: CsbBlock[] | null = null;
  let backend: CsbExtractionResult['backend'] = 'manual';

  if (isPowerShellPwModuleAvailable()) {
    messages.push({ level: 'info', text: 'Backend A: ProjectWise PowerShell module' });
    try {
      csbs = await readCsbsViaPwModule(conn, ctx);
      backend = 'powershell-pwmodule';
      messages.push({ level: 'info', text: `Read ${csbs.length} CSBs via PW module` });
    } catch (e) {
      messages.push({ level: 'warning', text: `PW module failed: ${e}` });
    }
  }

  if (!csbs && isDmscliAvailable()) {
    messages.push({ level: 'info', text: 'Backend B: dmscli.dll P/Invoke' });
    try {
      csbs = await readCsbsViaDmscli(conn, ctx);
      backend = 'powershell-dmscli';
      messages.push({ level: 'info', text: `Read ${csbs.length} CSBs via dmscli` });
    } catch (e) {
      messages.push({ level: 'warning', text: `dmscli failed: ${e}` });
    }
  }

  if (!csbs) {
    messages.push({ level: 'info', text: 'Backend C: WSG document search' });
    try {
      csbs = await readCsbsViaWsg(client, ctx);
      backend = 'wsg-documents';
      messages.push({ level: 'info', text: `Found ${csbs.length} CSB document(s) via WSG` });
    } catch (e) {
      messages.push({ level: 'warning', text: `WSG search failed: ${e}` });
    }
  }

  if (!csbs || csbs.length === 0) {
    messages.push({
      level: 'error',
      text:
        'Could not read CSBs automatically. Managed Workspace extraction requires one of:\n' +
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
  const worksetName   = ctx.worksetName   ?? extractLastDirPiece(orderedCsbs, '_USTN_WORKSETNAME');
  if (workspaceName) messages.push({ level: 'info', text: `WorkspaceName: ${workspaceName}` });
  if (worksetName)   messages.push({ level: 'info', text: `WorksetName: ${worksetName}` });

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
  const masterContent = buildMasterTmp(
    orderedCsbs, wsDir, workDir, ctx, dmsPathMap, workspaceName, worksetName
  );
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
export async function listPwApplications(client: ProjectWiseClient): Promise<PwApplication[]> {
  try {
    const data = await (client as any).get('/Application');
    return ((data.instances ?? []) as any[]).map((inst: any) => {
      const p = inst.properties ?? {};
      return {
        instanceId: inst.instanceId ?? '',
        name: p.Name ?? p.Label ?? inst.instanceId,
        description: p.Description ?? '',
        managedWorkspaceProfileId: p.ManagedWorkspaceProfileId ?? p.WorkspaceProfileId ?? undefined,
        managedWorkspaceProfileName: p.ManagedWorkspaceProfileName ?? undefined,
      } as PwApplication;
    });
  } catch {
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
export async function getApplicationForFolder(
  client: ProjectWiseClient,
  folderGuid: string
): Promise<PwApplication | null> {
  try {
    const data = await (client as any).get(`/Project/${folderGuid}`);
    const p = (data.instances?.[0]?.properties ?? {}) as any;
    const appId = p.ApplicationId ?? p.Application ?? null;
    if (!appId) return null;
    const appData = await (client as any).get(`/Application/${appId}`);
    const ap = (appData.instances?.[0]?.properties ?? {}) as any;
    return {
      instanceId: appId,
      name: ap.Name ?? ap.Label ?? appId,
      description: ap.Description ?? '',
      managedWorkspaceProfileId: ap.ManagedWorkspaceProfileId ?? undefined,
      managedWorkspaceProfileName: ap.ManagedWorkspaceProfileName ?? undefined,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend A: PowerShell ProjectWise Module
// ─────────────────────────────────────────────────────────────────────────────

function detectPowerShellPwModule(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '$m = Get-Module -ListAvailable -Name ProjectWise,PWPS_DAB | Select-Object -First 1 -ExpandProperty Name; if ($m) { $m }',
    ], { timeout: 8000 });
    const moduleName = (result.stdout?.toString() ?? '').trim();
    return moduleName || null;
  } catch {
    return null;
  }
}

function isPowerShellPwModuleAvailable(): boolean {
  return detectPowerShellPwModule() !== null;
}

async function readCsbsViaPwModule(conn: PwConnection, ctx: ManagedWorkspaceContext): Promise<CsbBlock[]> {
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
    const serverHostname = (() => { try { return new URL(conn.wsgUrl).hostname; } catch { return conn.wsgUrl; } })();
    const result = spawnSync('powershell.exe', [
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
    if (!out.trim()) throw new Error(result.stderr?.toString() ?? 'No output from PowerShell');
    return parsePowerShellCsbJson(out);
  } finally {
    try { fs.unlinkSync(tempScript); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend B: dmscli.dll P/Invoke
// ─────────────────────────────────────────────────────────────────────────────

function isDmscliAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  return getDmscliPath() !== null;
}

function getDmscliPath(): string | null {
  const candidates = [
    'C:/Program Files/Bentley/ProjectWise/bin/dmscli.dll',
    'C:/Program Files (x86)/Bentley/ProjectWise/bin/dmscli.dll',
    ...(process.env.PWDIR ? [path.join(process.env.PWDIR, 'bin/dmscli.dll')] : []),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

async function readCsbsViaDmscli(conn: PwConnection, ctx: ManagedWorkspaceContext): Promise<CsbBlock[]> {
  const dmscliPath = getDmscliPath()!;
  const serverHost = (() => { try { return new URL(conn.wsgUrl).hostname; } catch { return conn.wsgUrl; } })();
  const script = buildDmscliScript(conn, ctx, dmscliPath, serverHost);

  const tempScript = path.join(os.tmpdir(), `pw-dmscli-${Date.now()}.ps1`);
  fs.writeFileSync(tempScript, script, 'utf8');

  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', tempScript,
    ], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 });

    const out = result.stdout?.toString() ?? '';
    if (result.status !== 0 || !out.trim()) {
      throw new Error(result.stderr?.toString() || 'dmscli script produced no output');
    }
    return parsePowerShellCsbJson(out);
  } finally {
    try { fs.unlinkSync(tempScript); } catch { /* ignore */ }
  }
}

function buildDmscliScript(
  conn: PwConnection,
  ctx: ManagedWorkspaceContext,
  dmscliPath: string,
  serverHost: string
): string {
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
async function readCsbsViaWsg(client: ProjectWiseClient, ctx: ManagedWorkspaceContext): Promise<CsbBlock[]> {
  const folderGuid = ctx.folderGuid;
  if (!folderGuid) return [];

  const cfgFiles = await client.fetchAllCfgFiles(folderGuid);
  const csbs: CsbBlock[] = [];
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
async function downloadPwFolderToDms(
  client: ProjectWiseClient,
  pwLogicalPath: string,
  workDir: string,
  dmsPathMap: DmsPathMap,
  messages: CsbExtractionResult['messages']
): Promise<string | null> {
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
  } catch (e) {
    messages.push({ level: 'warning', text: `Failed to download PW folder "${pwLogicalPath}": ${e}` });
    return null;
  }
}

/**
 * Scan all CSBs for PWFolder type variables whose target folders have not
 * yet been downloaded, and download them into additional dms directories.
 */
async function downloadAdditionalPwFolders(
  client: ProjectWiseClient,
  csbs: CsbBlock[],
  workDir: string,
  dmsPathMap: DmsPathMap,
  messages: CsbExtractionResult['messages']
): Promise<void> {
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
async function findFolderByPath(
  client: ProjectWiseClient,
  logicalPath: string,
  rootFolders: PwFolder[]
): Promise<PwFolder | null> {
  const segments = logicalPath
    .replace(/^[/\\]+/, '').replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .filter(Boolean);

  if (segments.length === 0) return null;

  let currentLevel: PwFolder[] = rootFolders;
  let found: PwFolder | null = null;

  for (let i = 0; i < segments.length; i++) {
    found = currentLevel.find(
      f => f.name.toLowerCase() === segments[i].toLowerCase()
    ) ?? null;
    if (!found) return null;
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
export function csbToCfgContent(
  csb: CsbBlock,
  workDir: string,
  dmsPathMap: DmsPathMap
): string {
  const fwdWorkDir = workDir.replace(/\\/g, '/');
  const lines: string[] = [
    `#----------------------------------------------------------------------`,
    `# CSB: ${csb.name}`,
    `# ID:  ${csb.id}`,
    `# Level: ${csb.level} (%level ${CSB_LEVEL_MAP[csb.level]})`,
    `# Generated by Bentley CFG VS Code Extension`,
    `#----------------------------------------------------------------------`,
    ``,
    `%level ${CSB_LEVEL_MAP[csb.level]}`,
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
    if (!v.name || resolved === null) continue;
    lines.push(`${v.name} ${v.operator} ${resolved}`);
    if (v.locked) lines.push(`%lock ${v.name}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Resolve a CSB variable value based on its ValueType.
 */
function resolveValueType(
  v: CsbVariable,
  workDir: string,
  dmsPathMap: DmsPathMap
): string | null {
  const fwdWorkDir = workDir.replace(/\\/g, '/');

  switch (v.valueType) {
    case 'Literal':
      return v.value;

    case 'PWFolder': {
      // Look up in dmsPathMap by pwLogicalPath (case-insensitive)
      const entry = Object.values(dmsPathMap).find(
        e => e.pwLogicalPath.replace(/[/\\]+$/, '').toLowerCase() ===
             v.value.replace(/[/\\]+$/, '').toLowerCase()
      );
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
export function buildMasterTmp(
  orderedCsbs: CsbBlock[],
  wsDir: string,
  workDir: string,
  ctx: ManagedWorkspaceContext,
  dmsPathMap: DmsPathMap,
  workspaceName?: string,
  worksetName?: string
): string {
  const fwdWorkDir = workDir.replace(/\\/g, '/');
  const fwdWsDir   = wsDir.replace(/\\/g, '/');

  const lines: string[] = [
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
    if (workspaceName) lines.push(`_USTN_WORKSPACENAME : ${workspaceName}`);
    if (worksetName)   lines.push(`_USTN_WORKSETNAME   : ${worksetName}`);
    lines.push(``);
  }

  // %include each CSB in processing order with level annotations
  lines.push(`# ── CSB includes (Bentley processing order) ─────────────────────────`);
  let lastLevel = -1;
  for (const csb of orderedCsbs) {
    const msLevel = CSB_LEVEL_MAP[csb.level];
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
export function parseManualCsbInput(
  input: string,
  level: CsbLevel,
  name: string,
  id: number = 9999
): CsbBlock {
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

function orderCsbs(csbs: CsbBlock[]): CsbBlock[] {
  // Deduplicate by ID (Application and folder reads can produce duplicates)
  const seen = new Set<number>();
  const unique = csbs.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  return unique.sort((a, b) => {
    const aOrder = CSB_PROCESSING_ORDER.indexOf(a.level);
    const bOrder = CSB_PROCESSING_ORDER.indexOf(b.level);
    if (aOrder !== bOrder) return aOrder - bOrder;
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
function extractConfigurationVariable(csbs: CsbBlock[]): string | null {
  for (const csb of csbs) {
    const v = csb.variables.find(v => v.name === '_USTN_CONFIGURATION');
    if (v?.value) return v.value;
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
function extractLastDirPiece(csbs: CsbBlock[], varName: string): string | undefined {
  for (const csb of [...csbs].reverse()) {
    const v = csb.variables.find(v => v.name === varName);
    if (!v?.value) continue;
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

function parsePowerShellCsbJson(json: string): CsbBlock[] {
  const clean = json.trim();
  const data = JSON.parse(clean.startsWith('[') ? clean : `[${clean}]`);
  return (Array.isArray(data) ? data : [data]).map((item: any) => ({
    id: Number(item.Id ?? item.id ?? 0),
    name: String(item.Name ?? item.name ?? ''),
    description: String(item.Description ?? item.description ?? ''),
    level: normaliseCsbLevel(String(item.Level ?? item.level ?? 'Global')),
    variables: (item.Variables ?? item.variables ?? []).map((v: any) => ({
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
function parseCfgAsCsb(content: string): CsbVariable[] {
  const vars: CsbVariable[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    // %lock applies to the nearest preceding variable with that name
    const lockMatch = line.match(/^%lock\s+([A-Za-z_]\w*)/i);
    if (lockMatch) {
      const last = [...vars].reverse().find(v => v.name === lockMatch[1]);
      if (last) last.locked = true;
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

function normaliseCsbLevel(level: string): CsbLevel {
  const map: Record<string, CsbLevel> = {
    predefined: 'Predefined', global: 'Global', application: 'Application',
    customer: 'Customer', site: 'Site', workspace: 'WorkSpace',
    workset: 'WorkSet', project: 'WorkSet', discipline: 'Discipline',
    role: 'Role', user: 'User',
  };
  return map[level.toLowerCase()] ?? 'Global';
}

function normaliseOperator(op: string): CsbVariable['operator'] {
  return (['=', '>', '<', ':'] as const).includes(op as any)
    ? (op as CsbVariable['operator'])
    : '=';
}

function normaliseCsbValueType(vt: string): CsbVariable['valueType'] {
  const map: Record<string, CsbVariable['valueType']> = {
    literal: 'Literal', pwfolder: 'PWFolder',
    dms_project: 'dms_project', lastdirpiece: 'LastDirPiece',
  };
  return map[vt.toLowerCase()] ?? 'Literal';
}

function inferCsbLevelFromPath(pwPath: string): CsbLevel {
  const lower = pwPath.toLowerCase();
  if (lower.includes('predefined')) return 'Predefined';
  if (lower.includes('global')) return 'Global';
  if (lower.includes('application')) return 'Application';
  if (lower.includes('customer')) return 'Customer';
  if (lower.includes('site')) return 'Site';
  if (lower.includes('workset') || lower.includes('project')) return 'WorkSet';
  if (lower.includes('workspace')) return 'WorkSpace';
  if (lower.includes('discipline')) return 'Discipline';
  if (lower.includes('role')) return 'Role';
  if (lower.includes('user')) return 'User';
  return 'Global';
}
