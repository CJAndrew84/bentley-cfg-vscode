# Bentley Workspace Configuration (CFG) — VS Code Extension

Full language support and workspace analysis tooling for Bentley MicroStation / OpenRoads Designer workspace configuration files (`.cfg`, `.ucf`, `.pcf`), including ProjectWise **Managed Workspace** support via CSB extraction.

> **New to the extension?** See the [How-To Guide](HOWTO.md) for step-by-step instructions.

---

## Installation

Install the packaged extension directly into VS Code:

1. Download `bentley-cfg-x.x.x.vsix`
2. Open VS Code → **Extensions** (`Ctrl+Shift+X`) → `...` menu → **Install from VSIX...**
3. Select the `.vsix` file and reload when prompted

The extension activates automatically when you open any `.cfg`, `.ucf`, or `.pcf` file.

---

## Features

### Syntax Highlighting
- **Preprocessor directives** — `%include`, `%if`, `%ifdef`, `%ifndef`, `%else`, `%endif`, `%lock`, `%undef`, `%define`, `%level`, `%error`, `%warning`
- **Known variables** — `_USTN_*`, `MS_*`, `CIVIL_*` color-coded by category
- **Variable references** — `$(VAR)` (deferred) and `${VAR}` (immediate) distinctly highlighted
- **Preprocessor functions** — `exists()`, `defined()`
- **Assignment operators** — `=`, `>`, `<`, `:`

### IntelliSense / Code Completion
- Variable name completion at line start with full documentation
- Variable reference completion inside `$(...)` or `${...}`
- Directive completion after `%`
- Level name/number completion after `%level`

### Hover Documentation
Hover any known variable or directive for description, category, and example.

Includes article-backed documentation for many current OpenRoads/OpenSite workspace variables, including:
- ProjectWise VBA copy-out/search variables
- Extended `MS_DGNLIBLIST_*` variables for drawing seeds, display styles, item types, and printing
- Item Types migration notes such as `ITEMTYPE_LOOKUP` replacing `ITEMTYPE_EXCELLOOKUP`
- Civil reports, survey tolerance, print-performance, upgrade, and admin variables from Bentley's 2025 CFG tips

### Snippets
30+ snippets including full workspace/workset/org templates. Key prefixes: `hdr`, `safeinclude`, `wildinclude`, `networkfallback`, `workspace-cfg`, `workset-cfg`, `ord-cfg`.

### Validation / Diagnostics
Live validation on open, change, and save:
- ❌ Unclosed `%if` / `%ifdef` / `%ifndef` blocks
- ❌ Orphaned `%endif`
- ⚠️ Missing trailing slash on directory variables
- ⚠️ Backslash paths (should use forward slashes)
- ⚠️ `CIVIL_DEFAULT_STATION_LOCK = True` guidance (`1` recommended)
- ⚠️ Obsolete `CIVIL_SURVEY_RETAIN_SURVEY_ON_COPY`
- ℹ️ Renamed `ITEMTYPE_EXCELLOOKUP` → `ITEMTYPE_LOOKUP`
- ℹ️ Excess whitespace before operators

---

## Workspace Explorer

### Load & Resolve a Local Workspace
**`Bentley CFG: Load Local Workspace`** — pick a folder containing your workspace CFG files. The extension:
1. Locates the entry point (`ConfigurationSetup.cfg`, `WorkSpaceSetup.cfg`, etc.)
2. Processes all `%include` chains recursively, `%if`/`%ifdef` conditionals, and `%level` directives in the correct MicroStation order
3. Resolves all `$(VAR)` references, detecting circular dependencies
4. Validates resolved paths exist on disk
5. Displays all variables grouped by category with source file, level badge, override history, and resolution issues

**`Bentley CFG: Resolve Current File`** — resolves just the currently open `.cfg` file.

### ProjectWise Managed Workspace

**`Bentley CFG: Load ProjectWise Managed Workspace`** — connects to a ProjectWise datasource and replicates what ProjectWise Explorer does when opening a DGN in a Managed Workspace:

#### CSB Extraction Pipeline

ProjectWise Managed Workspaces store configuration in **Configuration Settings Blocks (CSBs)** in the datasource — not as plain `.cfg` files. The extension extracts these and materialises them into a local working directory identical to what PWE creates at `%PW_WORKDIR%\workspace\`.

**Processing order** (matches Bentley documentation exactly):

| Level | PW Name | MS Level | Processed Before |
|-------|---------|----------|-----------------|
| Predefined | Predefined CSBs | 0 | System CFG files |
| Global | Global CSBs | 0 | After System CFG |
| Application | Application CSBs | 1 | App CFG files |
| Customer | Customer CSBs | 2 | Site CSBs |
| Site | Site/Org CSBs | 2 | WorkSpace CSBs |
| WorkSpace | WorkSpace CSBs | 3 | WorkSpace CFG files |
| WorkSet | WorkSet/Project CSBs | 4 | WorkSet CFG files |
| Discipline | Discipline CSBs | 4 | Role CSBs |
| Role | Role CSBs | 5 | Role CFG file |
| User | User CSBs | 6 | — |

Each CSB is written as a numbered `{CsbID}.cfg` file. A master `.tmp` file is generated with `%include` statements in the correct order — this is the file MicroStation receives on its `-wc` command line argument.

**CSB variable value types** are handled:
- `Literal` — used as-is
- `PWFolder` — mapped to the local working directory dms path
- `dms_project()` — resolves to the current project's working directory
- `LastDirPiece()` — extracts folder name segment (used for `_USTN_WORKSPACENAME`, `_USTN_WORKSETNAME`)

**CFG files** referenced by `_USTN_CONFIGURATION` are downloaded from the PW repository and placed in the working directory so the parser can follow `%include` chains into workspace/workset `.cfg` files.

**Recursive `%include` resolution** — when downloaded CFG files contain `%include @:\...` directives pointing to other PW folders, those folders are downloaded and scanned too (breadth-first, up to 10 passes, with deduplication to prevent loops).

#### CSB Extraction Backends

The extension tries three backends in order:

1. **PowerShell ProjectWise Module** (`Get-PWManagedWorkspaceCSBs`) — requires the PW client + PowerShell module installed on the machine running VS Code
2. **dmscli.dll P/Invoke helper** — uses `aaApi_SelectConfigurationBlocks*` native API functions via a generated PowerShell script; requires PW Explorer client installed (Windows only)
3. **WSG document search** — searches the PW repository for `.cfg` files stored as documents and infers CSB levels from folder structure; works on any platform via the WSG REST API

If no backend succeeds, use **`Bentley CFG: Import CSB Content Manually`** to paste CSB variable content directly.

#### Connection Setup
On first use you'll be prompted for:
- WSG Base URL (e.g. `https://pw-server.company.com/ws`)
- Datasource name (e.g. `pwdb`)
- Username and password (stored in VS Code SecretStorage)
- Auth type: Basic or Bearer token
- SSL verification (toggle off for self-signed on-prem certs)

Connections are saved and reused. Manage them with **`Bentley CFG: Manage ProjectWise Connections`**.

### Compare Workspaces

**`Bentley CFG: Compare Loaded Workspaces`** — diff any two previously loaded workspaces (local or PW). Shows:
- ➕ Added variables (only in right)
- ➖ Removed variables (only in left)
- ✏️ Changed variables (different raw or resolved values)
- ✓ Unchanged variables (hide with toggle)

**`Bentley CFG: Compare Two Workspace Folders`** — directly pick two local folders to compare without pre-loading.

---

## Deploying a Workspace (DMWF)

The extension can push a locally-authored workspace up to ProjectWise, enabling a full **Digital Managed Workspace Framework (DMWF)** round-trip: author locally → validate → deploy to PW.

### What "deployment" means

A Bentley DMWF deployment has two parts:

| Part | What it is | How the extension handles it |
|------|-----------|------------------------------|
| **Repository files** | `.cfg` / standards files stored as regular PW documents | Uploaded automatically via WSG REST API |
| **CSBs** (Configuration Settings Blocks) | Database-level variables injected before MicroStation opens | CSBs cannot be written via WSG. The extension generates a ready-to-run **PowerShell script** (`deploy-csb.ps1`) for the PW admin |

### Deploy Workspace to ProjectWise

**`Bentley CFG: Deploy Workspace to ProjectWise`** — four-step wizard:

1. **Connection** — pick a saved PW connection or create a new one
2. **Local folder** — choose the workspace root on your machine
3. **Target folder** — browse to the PW folder that will host the files
4. **File selection** — CFG files only, or CFG + standards (`.dgnlib`, `.cel`, seeds, etc.)

The extension then:
- Creates any missing sub-folders in PW (mirroring your local structure)
- Uploads new documents; updates existing ones in place
- Writes `deploy-csb.ps1` — a PowerShell script the PW admin runs once to create the Managed Workspace Profile and wire up the CSBs
- Writes `deploy-report.txt` — a full per-file outcome log

> **Re-deploying** is safe: files are updated in place and the CSB script checks for existing objects before creating new ones.

### Export Deployment Package (offline)

**`Bentley CFG: Export Deployment Package`** — same as above but without a live PW connection. Generates `deploy-csb.ps1` locally so you can hand the whole workspace folder to a PW administrator for manual import.

### PowerShell CSB script (`deploy-csb.ps1`)

The generated script uses the **PWPS_DAB** module (ships with PW Explorer CONNECT Edition):

```powershell
# Edit the $Config section at the top, then run:
.\deploy-csb.ps1
```

It will:
1. Connect to the datasource
2. Create a **Managed Workspace Profile** for the workspace
3. Create a **WorkSpace CSB** (Level 3) setting `_USTN_CONFIGURATION`, `_USTN_WORKSPACEROOT`, etc.
4. Create one **WorkSet CSB** (Level 4) per detected workset
5. Assign the profile to the chosen PW **Application**

CSB creation is idempotent — objects that already exist are skipped.

---

## Commands

| Command | Description |
|---------|-------------|
| `Bentley CFG: Validate Current File` | Run diagnostics on the open file |
| `Bentley CFG: Insert Variable Reference` | Pick and insert a `$(VAR)` |
| `Bentley CFG: Load Local Workspace` | Load and resolve a folder of CFG files |
| `Bentley CFG: Resolve Current File` | Resolve the open CFG file |
| `Bentley CFG: Load ProjectWise Managed Workspace` | Connect to PW, extract CSBs, resolve |
| `Bentley CFG: Import CSB Content Manually` | Paste CSB content for environments without PW client tools |
| `Bentley CFG: View Generated Master Config` | Open the generated master `.tmp` file |
| `Bentley CFG: Manage ProjectWise Connections` | Delete saved PW connections |
| `Bentley CFG: Compare Loaded Workspaces` | Diff two previously loaded workspaces |
| `Bentley CFG: Compare Two Workspace Folders` | Diff two local folders directly |
| `Bentley CFG: Deploy Workspace to ProjectWise` | Upload local workspace files to PW + generate CSB script |
| `Bentley CFG: Export Deployment Package` | Generate `deploy-csb.ps1` without a live PW connection |

---

## Language Syntax Reference

### Assignment Operators

| Operator | Meaning |
|----------|---------|
| `=` | Assign (overrides any existing value) |
| `>` | Append to path list |
| `<` | Prepend to path list |
| `:` | Assign only if not already defined |

### Variable References

| Syntax | Behavior |
|--------|---------|
| `$(VAR)` | Deferred — resolved at use time |
| `${VAR}` | Immediate — resolved at definition time |

### Processing Levels

| Number | Name |
|--------|------|
| `0` | System / Predefined / Global |
| `1` | Application |
| `2` | Organization / Site / Customer |
| `3` | WorkSpace |
| `4` | WorkSet / Discipline |
| `5` | Role |
| `6` | User |

---

## File Types

| Extension | Purpose |
|-----------|---------|
| `.cfg` | Configuration file (WorkSpace, WorkSet, Organization, etc.) |
| `.ucf` | User configuration (legacy V8i) |
| `.pcf` | Project configuration (legacy V8i) |

---

## Tips

- Always use **forward slashes** (`/`) in paths — never backslashes
- Directory variable values must end with a **trailing slash** (`/`)
- Use `%lock` after security settings like `MS_PROTECTION_ENCRYPT`
- Use `_USTN_DISPLAYALLCFGVARS = 1` to debug variable values in MicroStation
- Never edit `msconfig.cfg` directly — use Custom Configuration layers
- For PW Managed Workspaces: the generated `{datasource}.tmp` in the workspace subfolder is what gets passed to MicroStation as `-wc[path]`

---

## Developer Setup

To build and run from source:

1. Clone the repository and open the folder in VS Code
2. Install dependencies:

   ```bash
   npm install
   ```

3. Compile TypeScript:

   ```bash
   npm run compile
   ```

4. Press **F5** (or **Run → Run Extension**) to launch the Extension Development Host

5. For live recompilation during development:

   ```bash
   npm run watch
   ```

   Then use **Developer: Reload Window** in the Extension Development Host to pick up changes.

6. To package a `.vsix` for distribution:

   ```bash
   npx @vscode/vsce package
   ```

### Troubleshooting the Dev Build

- If `npm run compile` fails, re-run `npm install` first
- If **F5** does not start the host, open **Run and Debug** and select **Run Extension**
- If commands are missing in the palette, confirm the active editor language is `Bentley CFG` (open a `.cfg` file)
