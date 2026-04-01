# Architecture: Bentley Workspace Configuration (CFG) VS Code Extension

This document describes the internal architecture of the **Bentley Workspace Configuration (CFG)** VS Code extension — how it is structured, how it reads workspace configuration files, and how it integrates with ProjectWise via the PWPS_DAB PowerShell module and the WSG REST API.

---

## Table of Contents

1. [Overview](#overview)
2. [Repository Layout](#repository-layout)
3. [Extension Activation and Lifecycle](#extension-activation-and-lifecycle)
4. [Language Support Layer](#language-support-layer)
5. [CFG File Parsing Pipeline](#cfg-file-parsing-pipeline)
6. [Workspace Loading](#workspace-loading)
   - [Local Workspace](#local-workspace)
   - [ProjectWise Managed Workspace](#projectwise-managed-workspace)
7. [ProjectWise Integration](#projectwise-integration)
   - [WSG REST API Client (pwClient.ts)](#wsg-rest-api-client-pwclientts)
   - [CSB Extractor (csbExtractor.ts)](#csb-extractor-csbextractorts)
   - [PWPS_DAB and dmscli Backends](#pwps_dab-and-dmscli-backends)
8. [Authentication and Credential Storage](#authentication-and-credential-storage)
9. [Workspace Deployment (workspaceDeployer.ts)](#workspace-deployment-workspacedeployerts)
10. [Workspace Explorer UI (workspaceExplorer.ts)](#workspace-explorer-ui-workspaceexplorerets)
11. [Key Data Structures](#key-data-structures)
12. [Commands Reference](#commands-reference)
13. [Configuration Settings](#configuration-settings)
14. [Build and Packaging](#build-and-packaging)

---

## Overview

The extension provides full authoring, validation, and deployment tooling for Bentley MicroStation and OpenRoads Designer workspace configuration files (`.cfg`, `.ucf`, `.pcf`). Its two major functional areas are:

1. **Language intelligence** — syntax highlighting, IntelliSense, live diagnostics, hover documentation, and code snippets for CFG files authored in VS Code.
2. **Workspace tooling** — loading and parsing workspace configurations (both local and ProjectWise Managed Workspaces), comparing configurations, and deploying workspaces back to ProjectWise.

The extension is written entirely in TypeScript and targets VS Code 1.75.0 or later. It has no runtime npm dependencies; all Node.js built-in modules (`fs`, `path`, `https`, `http`, `os`, `child_process`) are used directly.

---

## Repository Layout

```
bentley-cfg-vscode/
├── src/                          # TypeScript source files
│   ├── extension.ts              # Activation, command registration, IntelliSense providers
│   ├── cfgParser.ts              # CFG syntax parser and variable resolver
│   ├── csbExtractor.ts           # ProjectWise CSB extraction logic
│   ├── pwClient.ts               # ProjectWise WSG REST API client
│   ├── workspaceExplorer.ts      # WebView panel for displaying parsed results
│   └── workspaceDeployer.ts      # Workspace deployment to ProjectWise
├── syntaxes/
│   └── bentley-cfg.tmLanguage.json   # TextMate grammar (syntax highlighting)
├── snippets/
│   ├── bentley-cfg.json          # 73 code snippets
│   └── snippets.md               # Snippet reference documentation
├── language-configuration.json   # Bracket matching, auto-indent rules
├── package.json                  # Extension manifest and contribution points
├── tsconfig.json                 # TypeScript compiler configuration
├── README.md                     # End-user documentation
├── HOWTO.md                      # Step-by-step usage guide
└── out/                          # Compiled JavaScript output (not committed)
```

---

## Extension Activation and Lifecycle

**Activation trigger:** The extension activates when VS Code opens any file whose language identifier is `bentley-cfg`. This identifier is automatically assigned to files with the extensions `.cfg`, `.ucf`, or `.pcf`.

**Activation sequence (extension.ts `activate` function):**

```
1. Register language providers
   ├── CompletionItemProvider  — variables, directives, level names
   ├── HoverProvider           — inline documentation for 210 known variables
   └── DiagnosticsProvider     — validates on open / change / save

2. Register all 13 commands (see Commands Reference)

3. Show one-time DMWF version notification
   └── Compares the stored version against the currently supported DMWF version;
       the target version is updated in extension.ts when new DMWF releases are
       adopted
```

The extension uses a single shared `WorkspaceExplorer` WebView panel that is created lazily on first use and reused for all subsequent commands. Extension state (loaded parse results, active ProjectWise connection) is held in memory within the `activate` closure for the lifetime of the VS Code session.

---

## Language Support Layer

All language intelligence is registered in `extension.ts` and driven by a built-in knowledge base of 210 documented CFG variables.

### Variable Knowledge Base

Variables are stored as a typed array (`CFG_VARIABLES`) of `CfgVariable` objects:

```typescript
interface CfgVariable {
  name: string;          // e.g. "_USTN_WORKSPACEROOT"
  documentation: string; // shown in hover and completion details
  category: 'ustn' | 'ms' | 'civil' | 'user';
  valueHint?: string;    // shown as detail in completion list
  example?: string;      // shown in hover documentation
}
```

Categories correspond to Bentley variable naming conventions:
- **`ustn`** — `_USTN_*` system variables (WorkSpace, WorkSet, configuration paths)
- **`ms`** — `MS_*` MicroStation product variables (search paths, seeds, plotting)
- **`civil`** — `CIVIL_*` / `APP_*` OpenRoads Designer variables
- **`user`** — custom / project-specific variables

### Syntax Highlighting

The TextMate grammar (`syntaxes/bentley-cfg.tmLanguage.json`) highlights:
- Preprocessor directives: `%include`, `%if`, `%ifdef`, `%ifndef`, `%else`, `%elseif`, `%endif`, `%lock`, `%undef`, `%define`, `%level`
- Assignment operators: `=`, `>`, `<`, `:`
- Variable references: `$(VAR)` and `${VAR}`
- Known variable names
- Comments (`#` and `/* */`)
- String literals and path values

### Diagnostics

The diagnostics provider runs on every file open, change, and save. It reports:
- Unclosed `%if` / `%ifdef` / `%ifndef` blocks
- Orphaned `%else` / `%endif` without a matching opener
- References to known-obsolete variables
- Paths that resolve to non-existent directories (warning severity)

---

## CFG File Parsing Pipeline

**Source:** `cfgParser.ts`

The parser faithfully simulates how MicroStation itself processes CFG files, including the full `%level` hierarchy, all preprocessor directives, and both deferred and immediate variable expansion.

### Processing Levels

MicroStation defines seven named processing levels:

| Level | Name         | Typical source files                           |
|-------|--------------|------------------------------------------------|
| 0     | System       | `msconfig.cfg`, predefined and global CSBs     |
| 1     | Application  | Application-specific CFG + Application CSBs    |
| 2     | Organization | `Organization.cfg`, Customer/Site CSBs         |
| 3     | WorkSpace    | `WorkSpace.cfg`, WorkSpace CSBs                |
| 4     | WorkSet      | `WorkSet.cfg`, Discipline CSBs                 |
| 5     | Role         | Role CFG file, Role CSBs                       |
| 6     | User         | User CFG file, User CSBs                       |

A `%level N` directive in a CFG file switches the active level for all subsequent assignments. Higher-level assignments can only override lower-level values when the variable has not been locked with `%lock`.

### Multi-Pass Resolution

```
Pass 1 — File traversal
  ├── Read entry-point file (ConfigurationSetup.cfg, WorkSpaceSetup.cfg,
  │   or first .cfg found in folder)
  ├── Follow every %include directive recursively (max depth: 32)
  └── Record each assignment with its source file, line number, and level

Pass 2 — Conditional processing
  ├── Evaluate %if / %ifdef / %ifndef / %else / %elseif / %endif blocks
  ├── Supports exists() and defined() built-in functions
  └── Boolean expression evaluation (&&, ||, !, ==, !=)

Pass 3 — Level enforcement
  └── Apply level-based override rules (lower level cannot override higher)

Pass 4 — Variable expansion
  ├── Deferred $(VAR) — expanded at read time by MicroStation
  ├── Immediate ${VAR} — expanded when the assignment is processed
  ├── Maximum 20 expansion iterations per variable
  └── Circular reference detection (warns on mutually dependent variables)

Pass 5 — Validation
  ├── Check resolved directory paths exist on disk
  └── Report orphaned overrides and unused includes
```

### Key Parser Types

```typescript
// The result of parsing a workspace
export interface ParseResult {
  variables: Map<string, ConfigEntry>;
  macros: Set<string>;
  errors: ParseError[];
  resolutionIssues: ResolutionIssue[];
  filesProcessed: string[];
  includeTree: IncludeNode;
}

// Tree node representing one included file and its children
export interface IncludeNode {
  file: string;
  level: ConfigLevel;
  children: IncludeNode[];
  lineCount: number;
  variablesDefined: string[];
}

// A single configuration variable assignment
export interface ConfigEntry {
  name: string;
  value: string;              // raw (unexpanded) value
  resolvedValue: string | null;
  level: ConfigLevel;         // 0–6
  locked: boolean;
  sourceFile: string;
  sourceLine: number;
  overrideHistory: Array<{
    value: string;
    sourceFile: string;
    sourceLine: number;
    level: ConfigLevel;
  }>;
}
```

---

## Workspace Loading

### Local Workspace

**Command:** `bentley-cfg.loadLocalWorkspace`

1. VS Code folder-picker dialog opens.
2. Extension searches the folder for an entry-point file in this order:
   - `ConfigurationSetup.cfg`
   - `WorkSpaceSetup.cfg`
   - First `.cfg` file found in the root
3. The CFG parser is invoked with that entry-point file.
4. Results are displayed in the Workspace Explorer WebView panel.

**Command:** `bentley-cfg.loadCurrentFile`

Resolves the `.cfg` file currently open in the editor as a standalone entry point, useful for quickly inspecting a single file's variable output.

### ProjectWise Managed Workspace

**Command:** `bentley-cfg.loadProjectWiseWorkspace`

The full ProjectWise flow is orchestrated by `csbExtractor.ts` and mirrors what ProjectWise Explorer (PWE) does when it opens a DGN file inside a Managed Workspace:

```
1. User selects (or types) a PW Application name via QuickPick
2. CSBs are fetched via the best available backend (A → B → C, see below)
3. PW folder references within CSBs are downloaded to a temp directory
4. Temp directory structure mirrors PWE:
     /tmp/pw-managed-ws-{timestamp}/
       workspace/              ← _USTN_CONFIGURATION content
       dms00000/               ← first PWFolder variable
       dms00001/               ← second PWFolder variable
       ...
5. Each CSB is written as {CsbID}.cfg in the temp directory
6. A master .tmp file is generated with %include directives in processing order
7. The master .tmp is passed to the CFG parser
8. Results are displayed in the Workspace Explorer WebView panel
```

The recursive download also follows `@:\` path references found inside downloaded CFG files (up to 10 breadth-first passes), so all linked configuration content is resolved locally before parsing begins.

---

## ProjectWise Integration

### WSG REST API Client (`pwClient.ts`)

The `ProjectWiseClient` class wraps all HTTP communication with the ProjectWise Web Services Gateway (WSG) REST API.

**Base URL format:**

```
https://<server>/ws/v2.8/Repositories/Bentley.PW--<server>~3A<datasource>/PW_WSG/
```

The datasource name is URL-encoded: `~3A` represents the colon (`:`) separating hostname from datasource name, matching PWE's own URL construction. The API version segment (`v2.8`) reflects the WSG schema version currently targeted; on-premises deployments may expose a different version and the URL should be adjusted accordingly via the stored connection's `wsgUrl`.

**Key API operations:**

| Method | WSG endpoint | Purpose |
|--------|-------------|---------|
| `listProjects` | `Project?$select=*` | List all top-level folders |
| `getProjectByPath` | `Project?$filter=...` | Resolve a folder by logical path |
| `listDocuments` | `Document?$filter=ParentGuid+eq+'...'` | List documents in a folder |
| `downloadDocument` | `Document('...')/FileContents` | Download a document's file content |
| `createFolder` | `POST Project` | Create a new folder |
| `createOrUpdateDocument` | `POST/PUT Document` | Upload or update a document |

All responses are JSON. File content downloads use a separate binary stream request.

**HTTP transport:**

The client uses Node.js built-in `https` / `http` modules directly (no third-party HTTP library). This avoids any npm runtime dependency and keeps the packaged extension small. For connections with `ignoreSsl: true`, an `https.Agent` with `rejectUnauthorized: false` is used — intended for on-premises installations with self-signed certificates.

### CSB Extractor (`csbExtractor.ts`)

Configuration Settings Blocks (CSBs) are not exposed directly by the WSG PW_WSG schema. The extractor tries three backends in preference order:

#### Backend A — PWPS_DAB PowerShell Module

```powershell
Import-Module PWPS_DAB
Open-PWSession -DatasourceUrl $url -UserName $user -Password $pass
Get-PWManagedWorkspaceCSBs -ApplicationName $appName
```

`PWPS_DAB` (ProjectWise PowerShell Data Access Bridge) is a Bentley-supplied PowerShell module available on PowerShell Gallery (`Install-Module -Name PWPS_DAB`). It provides direct access to the PW database and can enumerate CSBs, their variable assignments, and linked CSB relationships.

The PowerShell script is built dynamically as a here-string and executed via `child_process.spawnSync('powershell.exe', ['-Command', script])`. The script outputs JSON to stdout, which the extension parses back into `CsbBlock[]`.

This backend is only available on Windows machines with ProjectWise Explorer installed.

#### Backend B — dmscli.dll P/Invoke

```powershell
$dmscli = [System.Reflection.Assembly]::LoadFile("C:\...\dmscli.dll")
# P/Invoke calls to aaApi_SelectManagedWorkspace*
# and aaApi_SelectConfigurationBlock*
```

If PWPS_DAB is not available, the extractor falls back to calling the ProjectWise native DLL (`dmscli.dll`) directly via .NET P/Invoke inside a PowerShell script. The relevant native API functions are:

- `aaApi_SelectManagedWorkspaceByName` — locate a Managed Workspace profile
- `aaApi_SelectConfigurationBlock` — enumerate CSBs within a profile
- `aaApi_GetConfigurationBlockVariable` — retrieve variable entries from a CSB

This backend is also Windows-only and requires ProjectWise Explorer.

#### Backend C — WSG Document Search

When neither PowerShell backend is available (non-Windows or no PW client), the extractor falls back to searching for CSB documents stored in the ProjectWise vault using the WSG REST API:

1. Scan the `_USTN_CONFIGURATION` folder hierarchy for `.cfg` files with CSB naming conventions.
2. Infer CSB levels from their folder path (e.g., `WorkSpace/` → level 3, `WorkSet/` → level 4).
3. Download each file and parse it as a plain CFG file.

This backend works on any platform with WSG access but only covers CSBs that have been exported as documents into the vault.

### CSB Processing Order

The extension processes CSBs in exactly the order MicroStation/PWE uses, matching the Bentley documentation:

```
%level 0  Predefined CSBs
%level 0  System CFG files
%level 0  Global CSBs
%level 1  Application CFG + Application CSBs
%level 2  Organization CFG + Customer CSBs + Site/Organization CSBs
%level 3  WorkSpace CSBs (before WorkSpace CFG files)
%level 3  WorkSpace CFG files
%level 4  WorkSet/Project CSBs (before WorkSet CFG files)
%level 4  WorkSet CFG files
%level 4  Discipline CSBs
%level 5  Role CSBs + Role CFG file
%level 6  User CSBs
```

### CSB Variable Value Types

CSB variables carry a `valueType` that controls how their value is interpreted:

| Value Type     | Description |
|----------------|-------------|
| `Literal`      | Plain string; used as-is |
| `PWFolder`     | PW logical folder path; translated to a local `dms<N>/` directory |
| `dms_project`  | Resolves to the working-copy directory for the current document |
| `LastDirPiece` | Extracts the last path segment (workspace or workset name) |

`PWFolder` variables trigger a recursive folder download from ProjectWise and are mapped to sequentially numbered local directories (`dms00000`, `dms00001`, …) that mirror the structure PWE creates in `%LOCALAPPDATA%\Bentley\...\dms\`.

---

## Authentication and Credential Storage

The extension supports two authentication modes for ProjectWise connections:

| Mode     | Header sent                               | Use case |
|----------|-------------------------------------------|----------|
| `basic`  | `Authorization: Basic <Base64(user:pass)>`| On-premises PW with Windows/LDAP accounts |
| `bearer` | `Authorization: Bearer <token>`           | Bentley IMS (cloud) or federated identity |

**Storage:** Connections are managed via two VS Code APIs:

- **`vscode.ExtensionContext.globalState`** — stores non-sensitive connection metadata: URL, datasource, username, auth type, SSL flag. This persists across VS Code sessions.
- **`vscode.ExtensionContext.secrets`** (SecretStorage) — stores passwords and bearer tokens. SecretStorage is backed by the OS credential manager (Windows Credential Manager, macOS Keychain, Linux libsecret) and is never written to disk in plaintext.

Credentials are never written to workspace settings and are not included in any exported deployment package.

---

## Workspace Deployment (`workspaceDeployer.ts`)

**Command:** `bentley-cfg.deployWorkspaceToPw`

The deployment workflow uploads a local workspace folder structure to a ProjectWise vault and generates a PowerShell script for creating the corresponding CSBs.

**4-step wizard:**

```
Step 1 — Select Connection
  └── Choose from stored ProjectWise connections

Step 2 — Select Local Folder
  └── Folder picker for the workspace root to deploy

Step 3 — Select Target PW Folder
  └── Browse PW folder tree (fetched via WSG) to choose destination

Step 4 — File Selection
  └── Checkbox list of files to include (pre-selected: .cfg, .ucf, .pcf)
```

**Upload process:**

1. For each selected file, mirror the local folder structure in PW (create folders as needed via `POST Project`).
2. Check whether each file already exists in the target PW folder.
3. Use `POST Document` to create new documents or `PUT Document` to update existing ones.
4. Record per-file outcome (created / updated / skipped / error) in `deploy-report.txt`.

**Generated artefacts (written to the local workspace root):**

| File | Contents |
|------|----------|
| `deploy-csb.ps1` | PWPS_DAB PowerShell script that creates/updates CSBs for each uploaded CFG file |
| `deploy-report.txt` | Per-file upload outcome log |

**Command:** `bentley-cfg.exportDeploymentPackage`

Generates the `deploy-csb.ps1` script locally (without connecting to or uploading to ProjectWise), ready to hand off to a ProjectWise administrator along with the workspace folder.

---

## Workspace Explorer UI (`workspaceExplorer.ts`)

The Workspace Explorer is a VS Code WebView panel (`vscode.WebviewPanel`) that displays parsed workspace results. It is created lazily on first use and kept alive as a retained panel.

**Message protocol:** The extension and the WebView communicate via `postMessage` / `onDidReceiveMessage`:

| Direction | Message type | Payload |
|-----------|-------------|---------|
| Extension → WebView | `update` | Serialised `ParseResult` |
| Extension → WebView | `compare` | Two serialised `ParseResult` objects |
| WebView → Extension | `exportReport` | — (triggers HTML report save dialog) |
| WebView → Extension | `openFile` | `{ path: string }` |

**Display modes:**

- **Single workspace** — table of all resolved variables with source file, line, level badge, and override history accordion.
- **Comparison** — side-by-side diff showing added, removed, and changed variables between two loaded workspaces, with a colour-coded legend.

**Report export:** The WebView can serialize the comparison or single-workspace view to a self-contained HTML file via the `exportReport` message, which triggers a VS Code save dialog.

---

## Key Data Structures

```typescript
// ── cfgParser.ts ──────────────────────────────────────────────────────────────

export type ConfigLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ConfigEntry {
  name: string;
  value: string;              // raw unexpanded value
  resolvedValue: string | null;
  level: ConfigLevel;
  locked: boolean;
  sourceFile: string;
  sourceLine: number;
  overrideHistory: Array<{
    value: string;
    sourceFile: string;
    sourceLine: number;
    level: ConfigLevel;
  }>;
}

export interface ParseResult {
  variables: Map<string, ConfigEntry>;
  macros: Set<string>;
  errors: ParseError[];
  resolutionIssues: ResolutionIssue[];
  filesProcessed: string[];
  includeTree: IncludeNode;
}

// ── pwClient.ts ───────────────────────────────────────────────────────────────

export interface PwConnection {
  wsgUrl: string;       // e.g. "https://pw-server.company.com/ws"
  datasource: string;   // e.g. "pwdb"
  username: string;
  credential: string;   // password or bearer token (stored in SecretStorage)
  authType: 'basic' | 'bearer';
  ignoreSsl?: boolean;
}

export interface PwDocument {
  instanceId: string;
  name: string;
  fileName: string;
  description: string;
  updateTime: string;
  fileSize: number;
  parentGuid: string;
  path: string;         // logical PW path
}

export interface PwFolder {
  instanceId: string;
  name: string;
  description: string;
  code?: string;
  projectId?: number;
  fullPath?: string;
  parentGuid: string;
  isRichProject?: boolean;
  children?: PwFolder[];
  documents?: PwDocument[];
}

// ── csbExtractor.ts ───────────────────────────────────────────────────────────

export type CsbLevel =
  | 'Predefined' | 'Global' | 'Application'
  | 'Customer' | 'Site' | 'WorkSpace'
  | 'WorkSet' | 'Discipline' | 'Role' | 'User';

export interface CsbVariable {
  name: string;
  operator: '=' | '>' | '<' | ':';
  value: string;
  valueType: 'Literal' | 'PWFolder' | 'dms_project' | 'LastDirPiece' | 'Unknown';
  folderCode?: string;
  folderProjectId?: number;
  locked: boolean;
}

export interface CsbBlock {
  id: number;                // PW database ID → used as filename: {id}.cfg
  name: string;
  description: string;
  level: CsbLevel;
  variables: CsbVariable[];
  linkedCsbIds: number[];    // IDs of CSBs processed immediately after this one
}
```

---

## Commands Reference

All commands are prefixed `bentley-cfg.` and accessible from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

| Command ID | Title | Notes |
|------------|-------|-------|
| `validateFile` | Validate Current File | Available when a `.cfg`/`.ucf`/`.pcf` file is open |
| `insertVariable` | Insert Variable Reference | Opens variable quick-pick |
| `loadLocalWorkspace` | Load Local Workspace | Opens folder picker |
| `loadCurrentFile` | Resolve Current File | Resolves the active editor file |
| `loadProjectWiseWorkspace` | Load ProjectWise Managed Workspace | Requires a saved PW connection |
| `managePwConnections` | Manage ProjectWise Connections | View and delete saved connections |
| `compareWorkspaces` | Compare Loaded Workspaces | Requires two workspaces to be loaded |
| `compareFolders` | Compare Two Workspace Folders | Opens two folder pickers |
| `importCsbManual` | Import CSB Content Manually | Paste CSB variable content (VAR = value lines) for offline use |
| `viewMasterTmp` | View Generated Master Config | Opens the `.tmp` file after a PW load |
| `deployWorkspaceToPw` | Deploy Workspace to ProjectWise | 4-step deployment wizard |
| `exportDeploymentPackage` | Export Deployment Package | Generates deploy-csb.ps1 without a live PW connection |
| `checkDmwfVersion` | Check for DMWF Updates | Opens DMWF download page |

Context-menu entries (right-click in editor) are registered for `validateFile` and `loadCurrentFile` when a CFG file is active. The `loadCurrentFile` command also appears as an icon button in the editor title bar.

---

## Configuration Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `bentley-cfg.dmwfDownloadUrl` | `string` | Bentley Communities PW blog URL | URL opened by the "Check for DMWF Updates" command. Override with a direct download URL once your Bentley account locates the latest DMWF package. |

---

## Build and Packaging

The extension uses the standard VS Code extension toolchain:

```bash
# Install dev dependencies
npm install

# Compile TypeScript → out/
npm run compile

# Watch mode (recompile on save)
npm run watch

# Package as .vsix (requires @vscode/vsce)
npm run package
```

**TypeScript configuration** (`tsconfig.json`):
- Target: `ES2020`
- Module: `commonjs`
- Strict mode enabled
- Output to `out/`

**Packaged artefact:** `bentley-cfg-1.0.0.vsix`  
Install with: `code --install-extension bentley-cfg-1.0.0.vsix`

Files excluded from the package are listed in `.vscodeignore` (source files, node_modules, tsconfig, etc.). Only the compiled `out/`, `syntaxes/`, `snippets/`, `language-configuration.json`, `package.json`, `icon.png`, `README.md`, and `LICENSE.md` are bundled.
