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

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawnSync } from "child_process";
import { ProjectWiseClient, PwConnection, PwFolder } from "./pwClient";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single variable entry within a CSB */
export interface CsbVariable {
  name: string;
  operator: "=" | ">" | "<" | ":";
  value: string;
  /**
   * Raw value type from PW:
   *  Literal      — use value as-is
   *  PWFolder     — value is a PW logical path; translate to local dms path
   *  dms_project  — value is the current-document working folder
   *  LastDirPiece — last folder segment of value (workspace/workset name)
   */
  valueType:
    | "Literal"
    | "PWFolder"
    | "dms_project"
    | "LastDirPiece"
    | "Unknown";
  locked: boolean;
}

/** One Configuration Settings Block */
export interface CsbBlock {
  id: number; // PW database ID (used as filename: {id}.cfg)
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
  | "Predefined" // %level 0 — injected before System CFG
  | "Global" // %level 0 — injected after System CFG
  | "Application" // %level 1
  | "Customer" // %level 2 (Organisation)
  | "Site" // %level 2 (Organisation/Site)
  | "WorkSpace" // %level 3
  | "WorkSet" // %level 4 (also "Project")
  | "Discipline" // %level 4 sub-level
  | "Role" // %level 5
  | "User"; // %level 6

/** Maps CSB level name to MicroStation %level number */
export const CSB_LEVEL_MAP: Record<CsbLevel, number> = {
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
export const CSB_PROCESSING_ORDER: CsbLevel[] = [
  "Predefined",
  "Global",
  "Application",
  "Customer",
  "Site",
  "WorkSpace",
  "WorkSet",
  "Discipline",
  "Role",
  "User",
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
    dmsDir: string; // absolute local path (e.g. /tmp/pw-ws-123/dms00000)
    pwLogicalPath: string; // PW logical path (e.g. \MyDS\Configuration\)
    folderName: string; // last segment
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
  messages: Array<{ level: "info" | "warning" | "error"; text: string }>;
  /** Which backend successfully read the CSBs */
  backend:
    | "powershell-pwmodule"
    | "powershell-dmscli"
    | "wsg-documents"
    | "manual";
  /**
   * The real ProjectWise working directory for the active datasource.
   * Returned by Backend A (pwps_dab) when available; used to seed PW_WORKDIR
   * with the actual local checkout path instead of a temp directory.
   *
   * Format:  C:\Users\<user>\AppData\Local\Bentley\ProjectWise\<datasource>\working
   *
   * When present this is used as PW_WORKDIR in the generated master .tmp so that
   * DMS_PROJECT() and dms_project-type variables resolve correctly against the
   * user's actual ProjectWise working copy location.
   */
  pwWorkingDir?: string;
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
  client: ProjectWiseClient,
): Promise<CsbExtractionResult> {
  const workDir =
    ctx.workDir ?? path.join(os.tmpdir(), `pw-managed-ws-${Date.now()}`);
  const wsDir = path.join(workDir, "workspace");
  fs.mkdirSync(wsDir, { recursive: true });

  const messages: CsbExtractionResult["messages"] = [];
  const dmsPathMap: DmsPathMap = {};
  let pwWorkingDir: string | undefined;

  // ── Step 1: Fetch CSBs ────────────────────────────────────────────────────
  let csbs: CsbBlock[] | null = null;
  let backend: CsbExtractionResult["backend"] = "manual";

  if (isPowerShellPwModuleAvailable()) {
    messages.push({
      level: "info",
      text: "Backend A: ProjectWise PowerShell module (pwps_dab)",
    });
    try {
      const result = await readCsbsViaPwModule(conn, ctx);
      csbs = result.csbs;
      if (result.pwWorkingDir) {
        pwWorkingDir = result.pwWorkingDir;
        messages.push({
          level: "info",
          text: `PW working directory: ${pwWorkingDir}`,
        });
      }
      backend = "powershell-pwmodule";
      messages.push({
        level: "info",
        text: `Read ${csbs.length} CSBs via PW module`,
      });
    } catch (e) {
      messages.push({ level: "warning", text: `PW module failed: ${e}` });
    }
  }

  if (!csbs && isDmscliAvailable()) {
    messages.push({ level: "info", text: "Backend B: dmscli.dll P/Invoke" });
    try {
      csbs = await readCsbsViaDmscli(conn, ctx);
      backend = "powershell-dmscli";
      messages.push({
        level: "info",
        text: `Read ${csbs.length} CSBs via dmscli`,
      });
    } catch (e) {
      messages.push({ level: "warning", text: `dmscli failed: ${e}` });
    }
  }

  if (!csbs) {
    messages.push({ level: "info", text: "Backend C: WSG document search" });
    try {
      csbs = await readCsbsViaWsg(client, ctx);
      backend = "wsg-documents";
      messages.push({
        level: "info",
        text: `Found ${csbs.length} CSB document(s) via WSG`,
      });
    } catch (e) {
      messages.push({ level: "warning", text: `WSG search failed: ${e}` });
    }
  }

  if (!csbs || csbs.length === 0) {
    messages.push({
      level: "error",
      text:
        "Could not read CSBs automatically. Managed Workspace extraction requires one of:\n" +
        "  • ProjectWise Explorer client installed (provides dmscli.dll + PW PowerShell module)\n" +
        "  • CSBs stored as .cfg documents in the PW repository (WSG backend)\n" +
        '  • Use "Manual CSB Import" to paste CSB content directly\n' +
        "Falling back to pure CFG file download from the PW repository.",
    });
    csbs = [];
    backend = "manual";
  }

  // ── Step 2: Sort into processing order ────────────────────────────────────
  const orderedCsbs = orderCsbs(csbs);

  // ── Step 3: Derive workspace / workset names ──────────────────────────────
  // These must be known before writing the master .tmp so the cfg parser
  // can resolve _USTN_WORKSPACENAME / _USTN_WORKSETNAME.
  const workspaceName =
    ctx.workspaceName ??
    extractLastDirPiece(orderedCsbs, "_USTN_WORKSPACENAME");
  const worksetName =
    ctx.worksetName ?? extractLastDirPiece(orderedCsbs, "_USTN_WORKSETNAME");
  if (workspaceName)
    messages.push({ level: "info", text: `WorkspaceName: ${workspaceName}` });
  if (worksetName)
    messages.push({ level: "info", text: `WorksetName: ${worksetName}` });

  // ── Step 4: Download PW folders into dms directories ─────────────────────
  // First pass: _USTN_CONFIGURATION (primary configuration folder)
  const configRoot = extractConfigurationVariable(orderedCsbs);
  if (configRoot) {
    messages.push({
      level: "info",
      text: `_USTN_CONFIGURATION: ${configRoot}`,
    });
    await downloadPwFolderToDms(
      client,
      configRoot,
      workDir,
      dmsPathMap,
      messages,
    );
  }

  // Second pass: any other PWFolder type variables not yet downloaded
  await downloadAdditionalPwFolders(
    client,
    orderedCsbs,
    workDir,
    dmsPathMap,
    messages,
  );

  // Third pass: scan Literal CSB values and downloaded CFG files for @: paths.
  // This resolves recursive include chains — e.g. a downloaded WorkSpace.cfg that
  // %includes @:\Configuration\Organization\*.cfg triggers a further download of
  // the Organization folder. Continues until no new @: paths are found (up to 10 passes).
  await resolveAtPathsRecursively(
    client,
    orderedCsbs,
    workDir,
    dmsPathMap,
    messages,
  );

  // ── Step 5: Write {CsbID}.cfg files ───────────────────────────────────────
  for (const csb of orderedCsbs) {
    const cfgContent = csbToCfgContent(csb, workDir, dmsPathMap);
    const cfgPath = path.join(wsDir, `${csb.id}.cfg`);
    fs.writeFileSync(cfgPath, cfgContent, "utf8");
    messages.push({
      level: "info",
      text: `Wrote [${csb.level}] ${csb.name} (${csb.id}) → ${path.basename(cfgPath)}`,
    });
  }

  // ── Step 6: Write master .tmp ─────────────────────────────────────────────
  const masterTmpPath = path.join(wsDir, `${ctx.datasource}.tmp`);
  const masterContent = buildMasterTmp(
    orderedCsbs,
    wsDir,
    workDir,
    ctx,
    dmsPathMap,
    workspaceName,
    worksetName,
    pwWorkingDir,
  );
  fs.writeFileSync(masterTmpPath, masterContent, "utf8");
  messages.push({
    level: "info",
    text: `Master config: ${path.basename(masterTmpPath)}`,
  });

  return {
    masterTmpPath,
    workDir,
    csbs: orderedCsbs,
    dmsPathMap,
    workspaceName,
    worksetName,
    messages,
    backend,
    pwWorkingDir,
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
export async function listPwApplications(
  client: ProjectWiseClient,
): Promise<PwApplication[]> {
  try {
    const data = await (client as any).get("/Application");
    return ((data.instances ?? []) as any[]).map((inst: any) => {
      const p = inst.properties ?? {};
      return {
        instanceId: inst.instanceId ?? "",
        name: p.Name ?? p.Label ?? inst.instanceId,
        description: p.Description ?? "",
        managedWorkspaceProfileId:
          p.ManagedWorkspaceProfileId ?? p.WorkspaceProfileId ?? undefined,
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
  folderGuid: string,
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
      description: ap.Description ?? "",
      managedWorkspaceProfileId: ap.ManagedWorkspaceProfileId ?? undefined,
      managedWorkspaceProfileName: ap.ManagedWorkspaceProfileName ?? undefined,
    };
  } catch {
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

function detectPowerShellPwModule(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // Prefer PWPS_DAB (64-bit, actively maintained) over the legacy ProjectWise module
        "$m = Get-Module -ListAvailable -Name PWPS_DAB,ProjectWise | Select-Object -First 1 -ExpandProperty Name; if ($m) { $m }",
      ],
      { timeout: 8000 },
    );
    const moduleName = (result.stdout?.toString() ?? "").trim();
    return moduleName || null;
  } catch {
    return null;
  }
}

function isPowerShellPwModuleAvailable(): boolean {
  return detectPowerShellPwModule() !== null;
}

async function readCsbsViaPwModule(
  conn: PwConnection,
  ctx: ManagedWorkspaceContext,
): Promise<{ csbs: CsbBlock[]; pwWorkingDir: string }> {
  const moduleName = detectPowerShellPwModule();
  if (!moduleName) {
    throw new Error(
      "Neither PWPS_DAB nor ProjectWise PowerShell module is available.",
    );
  }

  // ── pwps_dab Backend A script ─────────────────────────────────────────────
  //
  // CSB extraction via pwps_dab follows this flow:
  //
  //   1. Open-PWDatasource       — authenticate and connect
  //   2. Resolve the document's folder (if DocumentGuid supplied)
  //      Get-PWDocumentsByGuid / Get-PWDocument → document.FolderGuid
  //   3. Resolve the Application → Managed Workspace Profile
  //      Get-PWApplication (by numeric ApplicationId)
  //   4. Get all CSBs for the profile (all levels)
  //      The correct pwps_dab cmdlet for this step is documented at
  //      https://powerwisescripting.blog/ — probe dynamically since the
  //      exact cmdlet name varies across module versions.
  //   5. Get folder-assigned CSBs (WorkSet/Discipline level)
  //      Get-PWFoldersByGuids / Get-PWFolder — look up the target folder,
  //      then retrieve CSBs assigned directly to it.
  //
  // Variable properties returned by pwps_dab:
  //   .Name        — CFG variable name (e.g. "_USTN_CONFIGURATION")
  //   .Operator    — assignment operator string: "=", ">", "<", ":"
  //   .Value       — raw value as stored in PW (may be a PW folder path)
  //   .ValueType   — "Literal" | "PWFolder" | "dms_project" | "LastDirPiece"
  //   .IsLocked    — boolean; maps to %lock directive in generated .cfg
  //
  // Note: CSBs do not support preprocessor directives (%include, %if, etc.).
  // The only "directive" produced from a CSB is the %level header and %lock
  // lines, both of which are generated by csbToCfgContent() in TypeScript.

  const script = `
param($Server, $Datasource, $Username, $Password, $ApplicationId, $FolderGuid, $DocumentGuid)
Import-Module "${moduleName}" -ErrorAction Stop

# ── Authentication ─────────────────────────────────────────────────────────────
# pwps_dab supports two login patterns depending on version:
#
#   New-PWLogin (preferred, modern):
#     -ProjectWiseServer "server:datasource"
#     The server part is the PW server hostname WITHOUT the -ws suffix.
#     The datasource is the name configured in ProjectWise Administrator.
#     Combined format: "server.company.com:MyDatasource"
#
#   Open-PWDatasource (legacy):
#     -Server hostname  -Datasource name  -Credential $creds
#
# We probe for New-PWLogin first (as the blog documents it as the current API).

$loginCmdlet = @('New-PWLogin','Open-PWDatasource') |
  Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
  Select-Object -First 1

if (-not $loginCmdlet) {
  throw "No login cmdlet found in module ${moduleName}. Expected 'New-PWLogin' or 'Open-PWDatasource'."
}

if ($loginCmdlet -eq 'New-PWLogin') {
  # "server:datasource" — $Server is already the hostname without -ws suffix (stripped by TS).
  # $Datasource is the name configured in ProjectWise Administrator.
  New-PWLogin -ProjectWiseServer "$Server:$Datasource" -UserName $Username -Password $Password -ErrorAction Stop | Out-Null
} else {
  $secPass = ConvertTo-SecureString $Password -AsPlainText -Force
  $creds   = New-Object System.Management.Automation.PSCredential($Username, $secPass)
  Open-PWDatasource -Server $Server -Datasource $Datasource -Credential $creds -ErrorAction Stop | Out-Null
}

# ── Get the PW working directory for this datasource ──────────────────────────
# The working directory is the local folder where PW copies out checked-out
# files. It is needed for PW_WORKDIR seeding and for DMS_PROJECT() resolution.
# pwps_dab exposes this via the datasource info object.
$pwWorkingDir = ''
$dsCmdlet = @('Get-PWCurrentDatasource','Get-PWDatasource','Get-PWDatasourceProperties') |
  Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
  Select-Object -First 1

if ($dsCmdlet) {
  try {
    $dsInfo = & $dsCmdlet -ErrorAction SilentlyContinue
    $pwWorkingDir = [string]($dsInfo.WorkingDirectory ??
                             $dsInfo.LocalWorkingDirectory ??
                             $dsInfo.LocalWorkDir ??
                             $dsInfo.WorkDir ?? '')
  } catch { $pwWorkingDir = '' }
}

# Fall back to the standard ProjectWise working directory convention:
#   %LOCALAPPDATA%\Bentley\ProjectWise\<datasource>\working\
if (-not $pwWorkingDir) {
  $localApp = [Environment]::GetFolderPath('LocalApplicationData')
  $pwWorkingDir = Join-Path $localApp "Bentley\ProjectWise\$Datasource\working"
}

# ── Diagnostic: list available CSB-related cmdlets to stderr ─────────────────
$availableCsbCmdlets = Get-Command -Module "${moduleName}" |
  Where-Object { $_.Name -match 'CSB|ConfigBlock|ConfigurationBlock|ManagedWorkspace|WorkspaceProfile' } |
  Select-Object -ExpandProperty Name
if ($availableCsbCmdlets) {
  [Console]::Error.WriteLine("Available CSB cmdlets: " + ($availableCsbCmdlets -join ", "))
} else {
  [Console]::Error.WriteLine("No CSB-specific cmdlets found in module ${moduleName}")
}
[Console]::Error.WriteLine("Login: $loginCmdlet | WorkingDir: $pwWorkingDir")

# ── If DocumentGuid provided, resolve it to a FolderGuid ─────────────────────
# Some workflows start from a selected document rather than a folder.
# pwps_dab exposes Get-PWDocumentsByGuid (or Get-PWDocument) for this.
if ($DocumentGuid -and -not $FolderGuid) {
  $docCmdlet = @('Get-PWDocumentsByGuid','Get-PWDocument','Get-PWDocumentByGuid') |
    Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
    Select-Object -First 1
  if ($docCmdlet) {
    $doc = & $docCmdlet -Guid $DocumentGuid -ErrorAction SilentlyContinue
    if ($doc) {
      # FolderGuid is exposed as .FolderGuid, .ProjectGuid, or .ParentGuid depending on version
      $FolderGuid = $doc.FolderGuid ?? $doc.ProjectGuid ?? $doc.ParentGuid
      [Console]::Error.WriteLine("Resolved DocumentGuid to FolderGuid: $FolderGuid")
    }
  } else {
    [Console]::Error.WriteLine("No document-lookup cmdlet found; DocumentGuid resolution skipped")
  }
}

$csbs = [System.Collections.Generic.List[object]]::new()

# ── Primary: CSBs via Managed Workspace Profile assigned to the Application ──
# The Application is the correct anchor for the full CSB set (Predefined through
# WorkSpace levels). pwps_dab provides cmdlets to navigate:
#   Application → Managed Workspace Profile → CSBs
# The exact cmdlet names depend on the installed version of pwps_dab.
if ($ApplicationId) {
  # Find the Application object by its numeric ID
  $appCmdlet = @('Get-PWApplications','Get-PWApplication') |
    Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
    Select-Object -First 1
  $app = $null
  if ($appCmdlet) {
    $app = & $appCmdlet -ErrorAction SilentlyContinue |
           Where-Object { $_.Id -eq $ApplicationId -or $_.InstanceId -eq $ApplicationId } |
           Select-Object -First 1
  }

  if ($app) {
    # Navigate Application → Managed Workspace Profile → CSBs
    # Probe for the profile-retrieval cmdlet (naming varies across module versions)
    $profileCmdlet = @(
      'Get-PWManagedWorkspaceProfile',
      'Get-PWApplicationManagedWorkspaceProfile',
      'Get-PWWorkspaceProfile'
    ) | Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
        Select-Object -First 1

    $csbCmdlet = @(
      'Get-PWConfigurationBlock',
      'Get-PWCSB',
      'Get-PWConfigurationSetBehavior',
      'Get-PWWorkspaceCSB'
    ) | Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
        Select-Object -First 1

    if ($profileCmdlet -and $csbCmdlet) {
      $profile = & $profileCmdlet -Application $app -ErrorAction SilentlyContinue
      if ($profile) {
        $fetched = & $csbCmdlet -ManagedWorkspaceProfile $profile -AllLevels -ErrorAction SilentlyContinue
        if ($fetched) { $csbs.AddRange(@($fetched)) }
      }
    } elseif ($csbCmdlet) {
      # Some versions allow direct Application → CSB retrieval
      $fetched = & $csbCmdlet -Application $app -AllLevels -ErrorAction SilentlyContinue
      if ($fetched) { $csbs.AddRange(@($fetched)) }
    } else {
      [Console]::Error.WriteLine("Could not find Managed Workspace Profile or CSB retrieval cmdlet in ${moduleName}")
    }
  } else {
    [Console]::Error.WriteLine("Application ID '$ApplicationId' not found via $appCmdlet")
  }
}

# ── Secondary: folder-assigned CSBs (WorkSet / Discipline level) ──────────────
# CSBs can be assigned directly to a PW folder (Work Area) in PW Administrator.
# These are typically WorkSet and Discipline level blocks.
if ($FolderGuid) {
  # Probe for folder-lookup cmdlet (naming varies)
  $folderCmdlet = @('Get-PWFoldersByGuids','Get-PWFolderByGuid','Get-PWFolder') |
    Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
    Select-Object -First 1

  $csbCmdlet = @(
    'Get-PWConfigurationBlock',
    'Get-PWCSB',
    'Get-PWConfigurationSetBehavior',
    'Get-PWWorkspaceCSB'
  ) | Where-Object { Get-Command $_ -Module "${moduleName}" -ErrorAction SilentlyContinue } |
      Select-Object -First 1

  $folder = $null
  if ($folderCmdlet) {
    $folder = & $folderCmdlet -Guid $FolderGuid -ErrorAction SilentlyContinue
    if (-not $folder) {
      $folder = & $folderCmdlet -ErrorAction SilentlyContinue |
                Where-Object { $_.Guid -eq $FolderGuid -or $_.InstanceId -eq $FolderGuid } |
                Select-Object -First 1
    }
  }

  if ($folder -and $csbCmdlet) {
    # Try Project/Folder parameter variants used by different pwps_dab versions
    $fetched = & $csbCmdlet -Project $folder -ErrorAction SilentlyContinue
    if (-not $fetched) {
      $fetched = & $csbCmdlet -Folder $folder -ErrorAction SilentlyContinue
    }
    if (-not $fetched) {
      $fetched = & $csbCmdlet -WorkArea $folder -ErrorAction SilentlyContinue
    }
    if ($fetched) { $csbs.AddRange(@($fetched)) }
  } elseif (-not $folder) {
    [Console]::Error.WriteLine("Could not resolve FolderGuid '$FolderGuid' to a folder object")
  }
}

# ── Serialise CSBs to JSON ────────────────────────────────────────────────────
# Each CSB exposes:
#   .Id / .CsbId     — numeric database ID
#   .Name            — display name
#   .Description     — optional description
#   .Level           — CsbLevel enum or integer (0-9) or string
#   .Variables       — collection of CsbVariable objects
#
# Each Variable exposes:
#   .Name            — CFG variable name
#   .Operator        — string "=" | ">" | "<" | ":"
#   .Value           — raw value string (may be PW logical path for PWFolder type)
#   .ValueType       — enum/string: Literal | PWFolder | dms_project | LastDirPiece
#   .IsLocked / .Locked — boolean; if true, emit %lock directive after assignment
#
$levelNames = @('Predefined','Global','Application','Customer','Site','WorkSpace','WorkSet','Discipline','Role','User')

$result = [System.Collections.Generic.List[object]]::new()
$seenIds = [System.Collections.Generic.HashSet[int]]::new()

foreach ($csb in $csbs) {
  $csbId = [int]($csb.Id ?? $csb.CsbId ?? 0)
  if (-not $seenIds.Add($csbId)) { continue }  # deduplicate

  # Level: handle integer index, enum .Value, or string
  $rawLevel = $csb.Level
  $levelStr = if ($rawLevel -is [int]) {
    if ($rawLevel -ge 0 -and $rawLevel -lt $levelNames.Count) { $levelNames[$rawLevel] } else { 'Global' }
  } elseif ($rawLevel -ne $null) {
    $s = $rawLevel.ToString()
    # If the enum ToString() produces an integer string, map it
    $parsed = 0
    if ([int]::TryParse($s, [ref]$parsed)) {
      if ($parsed -ge 0 -and $parsed -lt $levelNames.Count) { $levelNames[$parsed] } else { 'Global' }
    } else { $s }
  } else { 'Global' }

  $vars = [System.Collections.Generic.List[object]]::new()
  $variableCollection = $csb.Variables ?? $csb.VariableSet ?? @()
  foreach ($v in $variableCollection) {
    $vtRaw = $v.ValueType
    $vtStr = if ($vtRaw -ne $null) { $vtRaw.ToString() } else { 'Literal' }

    # .IsLocked and .Locked are both used across pwps_dab versions
    $isLocked = [bool]($v.IsLocked ?? $v.Locked ?? $false)

    $vars.Add(@{
      Name      = [string]($v.Name ?? '')
      Operator  = [string]($v.Operator ?? '=')
      Value     = [string]($v.Value ?? '')
      ValueType = $vtStr
      Locked    = $isLocked
    })
  }

  $result.Add(@{
    Id          = $csbId
    Name        = [string]($csb.Name ?? '')
    Description = [string]($csb.Description ?? '')
    Level       = $levelStr
    Variables   = $vars.ToArray()
    LinkedIds   = @()   # CSB linking is not exposed via pwps_dab property; handled by ordering
  })
}

# Output a wrapper object so the TypeScript caller can read both the CSBs and the
# PW working directory in one JSON parse. The WorkingDir is used to seed PW_WORKDIR
# in the master .tmp, which is the actual local working directory ProjectWise uses
# for checked-out files (not a temp directory).
@{
  WorkingDir = $pwWorkingDir
  Csbs       = @($result)
} | ConvertTo-Json -Depth 10
`;

  const tempScript = path.join(os.tmpdir(), `pw-csb-mod-${Date.now()}.ps1`);
  fs.writeFileSync(tempScript, script, "utf8");

  try {
    const serverHostname = (() => {
      try {
        return new URL(conn.wsgUrl).hostname;
      } catch {
        return conn.wsgUrl;
      }
    })();
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        tempScript,
        "-Server",
        serverHostname,
        "-Datasource",
        conn.datasource,
        "-Username",
        conn.username,
        "-Password",
        conn.credential,
        ...(ctx.applicationInstanceId
          ? ["-ApplicationId", ctx.applicationInstanceId]
          : []),
        ...(ctx.folderGuid ? ["-FolderGuid", ctx.folderGuid] : []),
        ...(ctx.documentGuid ? ["-DocumentGuid", ctx.documentGuid] : []),
      ],
      { timeout: 45000, maxBuffer: 10 * 1024 * 1024 },
    );

    const out = result.stdout?.toString() ?? "";
    const err = result.stderr?.toString() ?? "";
    if (err.trim()) {
      // stderr carries diagnostic messages written by the script (not fatal errors)
      // Surface them to the caller via a thrown error only if stdout is also empty.
      if (!out.trim()) {
        throw new Error(`PowerShell module error:\n${err}`);
      }
    }
    if (!out.trim()) {
      throw new Error(err || "No output from PowerShell module script");
    }
    return parsePowerShellCsbJson(out);
  } finally {
    try {
      fs.unlinkSync(tempScript);
    } catch {
      /* ignore */
    }
  }
}

/** Thin wrapper that discards the working-dir half — used by backends that don't return it. */
function parsePowerShellCsbJsonCsbsOnly(json: string): CsbBlock[] {
  return parsePowerShellCsbJson(json).csbs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend B: dmscli.dll P/Invoke
// ─────────────────────────────────────────────────────────────────────────────

function isDmscliAvailable(): boolean {
  if (process.platform !== "win32") return false;
  return getDmscliPath() !== null;
}

function getDmscliPath(): string | null {
  const candidates = [
    "C:/Program Files/Bentley/ProjectWise/bin/dmscli.dll",
    "C:/Program Files (x86)/Bentley/ProjectWise/bin/dmscli.dll",
    ...(process.env.PWDIR
      ? [path.join(process.env.PWDIR, "bin/dmscli.dll")]
      : []),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function readCsbsViaDmscli(
  conn: PwConnection,
  ctx: ManagedWorkspaceContext,
): Promise<CsbBlock[]> {
  const dmscliPath = getDmscliPath()!;
  const serverHost = (() => {
    try {
      return new URL(conn.wsgUrl).hostname;
    } catch {
      return conn.wsgUrl;
    }
  })();
  const script = buildDmscliScript(conn, ctx, dmscliPath, serverHost);

  const tempScript = path.join(os.tmpdir(), `pw-dmscli-${Date.now()}.ps1`);
  fs.writeFileSync(tempScript, script, "utf8");

  try {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        tempScript,
      ],
      { timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
    );

    const out = result.stdout?.toString() ?? "";
    if (result.status !== 0 || !out.trim()) {
      throw new Error(
        result.stderr?.toString() || "dmscli script produced no output",
      );
    }
    return parsePowerShellCsbJsonCsbsOnly(out);
  } finally {
    try {
      fs.unlinkSync(tempScript);
    } catch {
      /* ignore */
    }
  }
}

function buildDmscliScript(
  conn: PwConnection,
  ctx: ManagedWorkspaceContext,
  dmscliPath: string,
  serverHost: string,
): string {
  // Escape backslashes for the embedded C# string literal
  const dllPath = dmscliPath.replace(/\\/g, "\\\\");

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
${
  ctx.applicationInstanceId
    ? `
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
`
    : `  # applicationInstanceId not provided — skipping Application-level CSBs`
}

  # ── Document-derived folder CSBs ──────────────────────────────────────────
  # If a document GUID was provided (user selected a document in the extension),
  # resolve it to its parent folder's numeric project ID, then fetch WorkSet CSBs.
${
  ctx.documentGuid
    ? `
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
`
    : `  # documentGuid not provided — skipping document-derived folder CSBs`
}

  # ── Folder-assigned CSBs (WorkSet / Discipline level) ────────────────────
  # CSBs can be assigned directly to a PW Work Area (folder) in PW Administrator.
  # aaApi_SelectManagedWorkspacesByProject requires a numeric project ID.
  # We resolve the GUID via aaApi_SelectProjectByGuid (added in PW SDK).
${
  ctx.folderGuid
    ? `
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
`
    : `  # folderGuid not provided — skipping folder-assigned CSBs`
}

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
async function readCsbsViaWsg(
  client: ProjectWiseClient,
  ctx: ManagedWorkspaceContext,
): Promise<CsbBlock[]> {
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
  messages: CsbExtractionResult["messages"],
): Promise<string | null> {
  try {
    const projects = await client.listProjects();
    const matchedFolder = await findFolderByPath(
      client,
      pwLogicalPath,
      projects,
    );

    if (!matchedFolder) {
      messages.push({
        level: "warning",
        text: `Could not locate PW folder "${pwLogicalPath}" in repository.`,
      });
      return null;
    }

    // Assign a sequential dms index based on entries already in the map
    const dmsIndex = Object.keys(dmsPathMap).length;
    const dmsDirName = `dms${String(dmsIndex).padStart(5, "0")}`;
    const dmsDir = path.join(workDir, dmsDirName);
    fs.mkdirSync(dmsDir, { recursive: true });

    dmsPathMap[matchedFolder.instanceId] = {
      dmsDir,
      pwLogicalPath,
      folderName: matchedFolder.name,
    };

    const cfgFiles = await client.fetchAllCfgFiles(matchedFolder.instanceId);
    for (const { pwPath, content } of cfgFiles) {
      const relPath = pwPath.replace(/^[/\\]+/, "");
      const localPath = path.join(dmsDir, ...relPath.split(/[/\\]/));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content, "utf8");
    }

    messages.push({
      level: "info",
      text: `Downloaded ${cfgFiles.length} file(s) from "${pwLogicalPath}" → ${dmsDirName}/`,
    });
    return dmsDir;
  } catch (e) {
    messages.push({
      level: "warning",
      text: `Failed to download PW folder "${pwLogicalPath}": ${e}`,
    });
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
  messages: CsbExtractionResult["messages"],
): Promise<void> {
  const seenPaths = new Set(
    Object.values(dmsPathMap).map((e) => e.pwLogicalPath.toLowerCase()),
  );

  for (const csb of csbs) {
    for (const v of csb.variables) {
      if (v.valueType === "PWFolder" && v.value) {
        const normalised = v.value.toLowerCase();
        if (!seenPaths.has(normalised)) {
          seenPaths.add(normalised);
          await downloadPwFolderToDms(
            client,
            v.value,
            workDir,
            dmsPathMap,
            messages,
          );
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
async function findFolderByPath(
  client: ProjectWiseClient,
  logicalPath: string,
  rootFolders: PwFolder[],
): Promise<PwFolder | null> {
  // Strip the @: datasource-root prefix (PW logical path root marker)
  const stripped = logicalPath
    .replace(/^@:[/\\]*/i, "")
    .replace(/^[/\\]+/, "")
    .replace(/[/\\]+$/, "");

  const segments = stripped.split(/[/\\]/).filter(Boolean);
  if (segments.length === 0) return null;

  let currentLevel: PwFolder[] = rootFolders;
  let found: PwFolder | null = null;

  for (let i = 0; i < segments.length; i++) {
    found =
      currentLevel.find(
        (f) => f.name.toLowerCase() === segments[i].toLowerCase(),
      ) ?? null;
    if (!found) return null;
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
async function resolveAtPathsRecursively(
  client: ProjectWiseClient,
  csbs: CsbBlock[],
  workDir: string,
  dmsPathMap: DmsPathMap,
  messages: CsbExtractionResult["messages"],
): Promise<void> {
  const seenPaths = new Set(
    Object.values(dmsPathMap).map((e) => normaliseAtPath(e.pwLogicalPath)),
  );

  // Collect @: paths from Literal CSB variable values
  const pending: string[] = [];
  for (const csb of csbs) {
    for (const v of csb.variables) {
      if (v.value && isAtPath(v.value)) {
        const n = normaliseAtPath(v.value);
        if (!seenPaths.has(n)) {
          seenPaths.add(n);
          pending.push(v.value);
        }
      }
    }
  }

  // BFS: download folders, scan their CFG files for further @: includes
  let batch = [...pending];
  let pass = 0;
  while (batch.length > 0 && pass < 10) {
    // safety limit
    pass++;
    const nextBatch: string[] = [];
    for (const pwPath of batch) {
      const dmsDir = await downloadPwFolderToDms(
        client,
        pwPath,
        workDir,
        dmsPathMap,
        messages,
      );
      if (!dmsDir) continue;

      // Scan all downloaded CFG files for further @: %include paths
      for (const file of walkLocalDir(dmsDir)) {
        if (!/\.(cfg|ucf|pcf)$/i.test(file)) continue;
        try {
          const content = fs.readFileSync(file, "utf8");
          for (const atPath of extractAtPathsFromCfg(content)) {
            const n = normaliseAtPath(atPath);
            if (!seenPaths.has(n)) {
              seenPaths.add(n);
              nextBatch.push(atPath);
            }
          }
        } catch {
          /* unreadable file — skip */
        }
      }
    }
    batch = nextBatch;
  }
  if (pass >= 10) {
    messages.push({
      level: "warning",
      text: "Stopped @: path resolution after 10 passes (possible cycle).",
    });
  }
}

/** Returns true if a value string is a PW logical path using the @: root prefix. */
function isAtPath(value: string): boolean {
  return /^@:[/\\]/i.test(value);
}

/** Normalises a PW logical path for deduplication (lowercase, forward slashes, no trailing slash). */
function normaliseAtPath(p: string): string {
  return p
    .replace(/^@:[/\\]*/i, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Scan CFG file content for %include lines that reference @: paths.
 * Returns all unique @: folder paths found.
 */
function extractAtPathsFromCfg(content: string): string[] {
  const paths: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const stripped = line.replace(/#.*$/, "").trim();
    // %include @:\Some\Path\ or %include @:\Some\Path\*.cfg
    const m = stripped.match(/^%include\s+(@:[/\\][^*?\s]*)/i);
    if (m) {
      // Reduce to the folder part (strip filename/wildcard at end)
      const raw = m[1];
      const folder =
        raw.includes("*") || raw.includes("?")
          ? raw.replace(/[/\\][^/\\]*$/, "") // strip last segment (filename/glob)
          : raw;
      if (folder) paths.push(folder);
    }
  }
  return [...new Set(paths)];
}

/** Recursively list all files under a directory. */
function walkLocalDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walkLocalDir(full));
      else results.push(full);
    }
  } catch {
    /* ignore unreadable dirs */
  }
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
export function csbToCfgContent(
  csb: CsbBlock,
  workDir: string,
  dmsPathMap: DmsPathMap,
): string {
  const fwdWorkDir = workDir.replace(/\\/g, "/");
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
  if (csb.level === "Predefined") {
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

  lines.push("");
  return lines.join("\n");
}

/**
 * Resolve a CSB variable value based on its ValueType.
 */
function resolveValueType(
  v: CsbVariable,
  workDir: string,
  dmsPathMap: DmsPathMap,
): string | null {
  const fwdWorkDir = workDir.replace(/\\/g, "/");

  switch (v.valueType) {
    case "Literal":
      return v.value;

    case "PWFolder": {
      // Look up in dmsPathMap by pwLogicalPath (case-insensitive)
      const entry = Object.values(dmsPathMap).find(
        (e) =>
          e.pwLogicalPath.replace(/[/\\]+$/, "").toLowerCase() ===
          v.value.replace(/[/\\]+$/, "").toLowerCase(),
      );
      if (entry) {
        return entry.dmsDir.replace(/\\/g, "/") + "/";
      }
      // Not yet downloaded — emit an approximate path with a placeholder dms dir.
      // The cfg parser will flag the unresolved path.
      const folderName =
        v.value
          .replace(/[/\\]+$/, "")
          .split(/[/\\]/)
          .pop() ?? "unknown";
      return `${fwdWorkDir}/dms00000/${folderName}/`;
    }

    case "dms_project":
      // The document's working-copy directory.
      // Approximated as PW_WORKDIR; would need the document GUID to be precise.
      return `${fwdWorkDir}/`;

    case "LastDirPiece":
      // Extract the last segment of the PW folder path.
      // Used for _USTN_WORKSPACENAME, _USTN_WORKSETNAME etc.
      if (v.value) {
        return (
          v.value
            .replace(/[/\\]+$/, "")
            .split(/[/\\]/)
            .pop() ?? v.value
        );
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
  worksetName?: string,
  pwWorkingDir?: string,
): string {
  // Use the real PW working directory if available (from pwps_dab datasource info).
  // This is the local folder where ProjectWise copies out checked-out files, and is
  // what PWE seeds as PW_WORKDIR. Fall back to the temp work directory otherwise.
  const effectiveWorkDir = pwWorkingDir ?? workDir;
  const fwdWorkDir = effectiveWorkDir.replace(/\\/g, "/");
  const fwdWsDir = wsDir.replace(/\\/g, "/");

  const lines: string[] = [
    `#----------------------------------------------------------------------`,
    `# ProjectWise Managed Workspace Master Configuration`,
    `# Datasource : ${ctx.datasource}`,
    `# Application: ${ctx.applicationInstanceId ?? "(not specified)"}`,
    `# Folder     : ${ctx.folderGuid ?? "(not specified)"}`,
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
    lines.push(
      `# ── PW folder → local dms directory mapping ────────────────────────`,
    );
    for (const [guid, entry] of dmsEntries) {
      lines.push(`# "${entry.pwLogicalPath}" (GUID: ${guid})`);
      lines.push(`#   → ${entry.dmsDir.replace(/\\/g, "/")}/`);
    }
    lines.push(``);
  }

  // Seed workspace / workset names before CSB %includes.
  // Using ':' operator so they are only set if not already defined —
  // the CSBs may override them via '=' at a higher level.
  if (workspaceName || worksetName) {
    lines.push(
      `# ── Workspace / WorkSet identity (from LastDirPiece) ───────────────`,
    );
    if (workspaceName) lines.push(`_USTN_WORKSPACENAME : ${workspaceName}`);
    if (worksetName) lines.push(`_USTN_WORKSETNAME   : ${worksetName}`);
    lines.push(``);
  }

  // %include each CSB in processing order with level annotations
  lines.push(
    `# ── CSB includes (Bentley processing order) ─────────────────────────`,
  );
  let lastLevel = -1;
  for (const csb of orderedCsbs) {
    const msLevel = CSB_LEVEL_MAP[csb.level];
    if (msLevel !== lastLevel) {
      lines.push(`# %level ${msLevel}: ${csb.level}`);
      lastLevel = msLevel;
    }
    const cfgPath = path.join(wsDir, `${csb.id}.cfg`).replace(/\\/g, "/");
    lines.push(`%include ${cfgPath}`);
    // PW_MANAGEDWORKSPACE accumulates the database ID of every processed CSB.
    // MicroStation/ORD checks for this variable to confirm Managed Workspace mode.
    lines.push(`PW_MANAGEDWORKSPACE > ${csb.id}`);
  }

  lines.push("");
  return lines.join("\n");
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
  id: number = 9999,
): CsbBlock {
  return {
    id,
    name,
    description: "Manually imported",
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
  const unique = csbs.filter((c) => {
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
    const v = csb.variables.find((v) => v.name === "_USTN_CONFIGURATION");
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
function extractLastDirPiece(
  csbs: CsbBlock[],
  varName: string,
): string | undefined {
  for (const csb of [...csbs].reverse()) {
    const v = csb.variables.find((v) => v.name === varName);
    if (!v?.value) continue;
    if (v.valueType === "LastDirPiece") {
      return v.value
        .replace(/[/\\]+$/, "")
        .split(/[/\\]/)
        .pop();
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
function parsePowerShellCsbJson(json: string): {
  csbs: CsbBlock[];
  pwWorkingDir: string;
} {
  const clean = json.trim();
  const raw = JSON.parse(clean);

  // Detect wrapper object format
  let csbArray: any[];
  let pwWorkingDir = "";

  if (Array.isArray(raw)) {
    csbArray = raw;
  } else if (raw && typeof raw === "object" && (raw.Csbs ?? raw.csbs)) {
    csbArray = raw.Csbs ?? raw.csbs ?? [];
    pwWorkingDir = String(raw.WorkingDir ?? raw.workingDir ?? "");
  } else {
    // Single CSB object
    csbArray = [raw];
  }

  const csbs = csbArray.map(
    (item: any) =>
      ({
        id: Number(item.Id ?? item.id ?? 0),
        name: String(item.Name ?? item.name ?? ""),
        description: String(item.Description ?? item.description ?? ""),
        level: normaliseCsbLevel(String(item.Level ?? item.level ?? "Global")),
        variables: (item.Variables ?? item.variables ?? []).map((v: any) => ({
          name: String(v.Name ?? v.name ?? ""),
          operator: normaliseOperator(String(v.Operator ?? v.operator ?? "=")),
          value: String(v.Value ?? v.value ?? ""),
          valueType: normaliseCsbValueType(
            String(v.ValueType ?? v.valueType ?? "Literal"),
          ),
          locked: Boolean(v.Locked ?? v.locked ?? false),
        })),
        linkedCsbIds: Array.isArray(item.LinkedIds)
          ? item.LinkedIds.map(Number)
          : [],
      }) as CsbBlock,
  );

  return { csbs, pwWorkingDir };
}

/**
 * Parse a .cfg file as CSB content (no preprocessor directives).
 * Used by Backend C (WSG document search) and Manual import.
 */
function parseCfgAsCsb(content: string): CsbVariable[] {
  const vars: CsbVariable[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    // %lock applies to the nearest preceding variable with that name
    const lockMatch = line.match(/^%lock\s+([A-Za-z_]\w*)/i);
    if (lockMatch) {
      const last = [...vars].reverse().find((v) => v.name === lockMatch[1]);
      if (last) last.locked = true;
      continue;
    }

    // Skip any preprocessor directives that may appear in .cfg files stored as CSBs
    if (
      /^%(?:include|if|ifdef|iffeature|ifndef|else|elseif|endif|define|undef|level|error|warning)\b/i.test(
        line,
      )
    ) {
      continue;
    }

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*([=><:])\s*(.*)/);
    if (m) {
      vars.push({
        name: m[1],
        operator: normaliseOperator(m[2]),
        value: m[3].trim(),
        valueType: "Literal",
        locked: false,
      });
    }
  }
  return vars;
}

function normaliseCsbLevel(level: string): CsbLevel {
  const map: Record<string, CsbLevel> = {
    predefined: "Predefined",
    global: "Global",
    application: "Application",
    customer: "Customer",
    site: "Site",
    workspace: "WorkSpace",
    workset: "WorkSet",
    project: "WorkSet",
    discipline: "Discipline",
    role: "Role",
    user: "User",
  };
  return map[level.toLowerCase()] ?? "Global";
}

function normaliseOperator(op: string): CsbVariable["operator"] {
  return (["=", ">", "<", ":"] as const).includes(op as any)
    ? (op as CsbVariable["operator"])
    : "=";
}

function normaliseCsbValueType(vt: string): CsbVariable["valueType"] {
  const map: Record<string, CsbVariable["valueType"]> = {
    literal: "Literal",
    pwfolder: "PWFolder",
    dms_project: "dms_project",
    lastdirpiece: "LastDirPiece",
  };
  return map[vt.toLowerCase()] ?? "Literal";
}

function inferCsbLevelFromPath(pwPath: string): CsbLevel {
  const lower = pwPath.toLowerCase();
  if (lower.includes("predefined")) return "Predefined";
  if (lower.includes("global")) return "Global";
  if (lower.includes("application")) return "Application";
  if (lower.includes("customer")) return "Customer";
  if (lower.includes("site")) return "Site";
  if (lower.includes("workset") || lower.includes("project")) return "WorkSet";
  if (lower.includes("workspace")) return "WorkSpace";
  if (lower.includes("discipline")) return "Discipline";
  if (lower.includes("role")) return "Role";
  if (lower.includes("user")) return "User";
  return "Global";
}
