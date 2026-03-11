# Bentley Workspace Configuration (CFG) — VS Code Extension

Full language support and workspace analysis tooling for Bentley MicroStation / OpenRoads Designer workspace configuration files (`.cfg`, `.ucf`, `.pcf`), including ProjectWise **Managed Workspace** support via CSB extraction.

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

### Snippets
30+ snippets including full workspace/workset/org templates. Key prefixes: `hdr`, `safeinclude`, `wildinclude`, `networkfallback`, `workspace-cfg`, `workset-cfg`, `ord-cfg`.

### Validation / Diagnostics
Live validation on open, change, and save:
- ❌ Unclosed `%if` / `%ifdef` / `%ifndef` blocks
- ❌ Orphaned `%endif`
- ⚠️ Missing trailing slash on directory variables
- ⚠️ Backslash paths (should use forward slashes)
- ℹ️ Excess whitespace before operators

---

## Workspace Explorer

### Load & Resolve a Local Workspace
**`Bentley CFG: Load Local Workspace`** — pick a folder containing your workspace CFG files. The extension:
1. Locates the entry point (`ConfigurationSetup.cfg`, `WorkSpaceSetup.cfg`, etc.)
2. Processes all `%include` chains, `%if`/`%ifdef` conditionals, and `%level` directives in the correct MicroStation order
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

## Language Syntax Reference

### Assignment Operators

| Operator | Meaning |
|----------|---------|
| `=` | Assign (overrides) |
| `>` | Append to path list |
| `<` | Prepend to path list |
| `:` | Assign only if not defined |

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

---

## Tips

- Always use **forward slashes** (`/`) in paths — never backslashes
- Directory variable values must end with a **trailing slash** (`/`)
- Use `%lock` after security settings like `MS_PROTECTION_ENCRYPT`
- Use `_USTN_DISPLAYALLCFGVARS = 1` to debug variable values in MicroStation
- Never edit `msconfig.cfg` directly — use Custom Configuration layers
- For PW Managed Workspaces: the generated `{datasource}.tmp` in the workspace subfolder is what gets passed to MicroStation as `-wc[path]`

---

## Installation

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host, or:

```bash
npx @vscode/vsce package
```

Then install the generated `.vsix` via **Extensions → Install from VSIX**.
