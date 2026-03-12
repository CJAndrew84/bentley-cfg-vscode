# How-To Guide — Bentley Workspace Configuration (CFG) Extension

Step-by-step instructions for all major features of the extension.

---

## Table of Contents

1. [Install the Extension](#1-install-the-extension)
2. [Edit CFG Files — Syntax, IntelliSense & Validation](#2-edit-cfg-files--syntax-intellisense--validation)
3. [Load and Resolve a Local Workspace](#3-load-and-resolve-a-local-workspace)
4. [Load a ProjectWise Managed Workspace](#4-load-a-projectwise-managed-workspace)
5. [Import CSB Content Manually](#5-import-csb-content-manually)
6. [View the Generated Master Config](#6-view-the-generated-master-config)
7. [Compare Two Workspaces](#7-compare-two-workspaces)
8. [Manage ProjectWise Connections](#8-manage-projectwise-connections)
9. [Tips and Troubleshooting](#9-tips-and-troubleshooting)

---

## 1. Install the Extension

### From a .vsix file (recommended for most users)

1. Obtain the `bentley-cfg-x.x.x.vsix` file
2. Open VS Code
3. Open the Extensions panel: **Ctrl+Shift+X**
4. Click the `...` menu (top-right of the Extensions panel)
5. Choose **Install from VSIX...**
6. Browse to and select the `.vsix` file
7. When prompted, click **Reload Window**

The extension activates automatically whenever you open a `.cfg`, `.ucf`, or `.pcf` file.

### Verify the installation

1. Open any `.cfg` file
2. Check the bottom status bar — the language identifier should show **Bentley CFG**
3. Open the Command Palette (**Ctrl+Shift+P**) and type `Bentley CFG` — you should see all available commands listed

---

## 2. Edit CFG Files — Syntax, IntelliSense & Validation

### Syntax highlighting

Open any `.cfg`, `.ucf`, or `.pcf` file — syntax highlighting is applied automatically. If the file does not highlight correctly, check the language mode in the bottom-right corner of VS Code and change it to **Bentley CFG**.

### Code completion (IntelliSense)

| What you type | What you get |
|---------------|-------------|
| Start of a line | Known variable names with documentation |
| `$(` or `${` | Variable reference picker |
| `%` | Preprocessor directive list |
| `%level ` | Level names and numbers |

Press **Ctrl+Space** to trigger suggestions manually at any point.

### Hover documentation

Hover your cursor over any known variable name (e.g. `_USTN_WORKSPACENAME`) or directive (e.g. `%include`) to see a tooltip with:
- Description and category
- Expected value format
- Example usage

### Snippets

Type a snippet prefix and press **Tab** to expand. Useful prefixes:

| Prefix | Expands to |
|--------|-----------|
| `hdr` | File header block |
| `safeinclude` | `%include` wrapped in `%if exists(...)` guard |
| `wildinclude` | Wildcard `%include *.cfg` pattern |
| `networkfallback` | Network path with local fallback |
| `workspace-cfg` | Full WorkSpace CFG template |
| `workset-cfg` | Full WorkSet CFG template |
| `ord-cfg` | OpenRoads Designer CFG template |

### Validation diagnostics

Diagnostics appear automatically in the **Problems** panel (**Ctrl+Shift+M**) and as squiggly underlines in the editor. To re-run manually:

1. Open the Command Palette (**Ctrl+Shift+P**)
2. Run **Bentley CFG: Validate Current File**

Common diagnostics:

| Severity | Message | Fix |
|----------|---------|-----|
| ❌ Error | Unclosed `%if` block | Add matching `%endif` |
| ❌ Error | Orphaned `%endif` | Remove or add matching `%if` |
| ⚠️ Warning | Missing trailing slash on directory variable | Add `/` at end of value |
| ⚠️ Warning | Backslash in path | Replace `\` with `/` |
| ℹ️ Info | `ITEMTYPE_EXCELLOOKUP` is renamed | Use `ITEMTYPE_LOOKUP` instead |

### Insert a variable reference

1. Place your cursor where you want the reference
2. Open the Command Palette (**Ctrl+Shift+P**)
3. Run **Bentley CFG: Insert Variable Reference**
4. Type to filter, then select the variable — `$(VAR)` is inserted at the cursor

---

## 3. Load and Resolve a Local Workspace

Use this when your workspace CFG files are on your local machine or a network drive.

### Step-by-step

1. Open the Command Palette (**Ctrl+Shift+P**)
2. Run **Bentley CFG: Load Local Workspace**
3. In the folder picker, navigate to and select your workspace root folder (the folder that contains `ConfigurationSetup.cfg`, `WorkSpaceSetup.cfg`, or your top-level `.cfg` file)
4. The extension will:
   - Locate the entry-point CFG file automatically
   - Follow all `%include` directives recursively, opening referenced CFG files as needed
   - Apply `%if` / `%ifdef` conditionals and `%level` directives
   - Resolve all `$(VAR)` and `${VAR}` references, detecting any circular dependencies
   - Validate that resolved directory paths exist on disk
5. A **Workspace Explorer** panel opens showing all variables grouped by category

### Reading the Workspace Explorer

- **Category headers** group related variables (e.g. WorkSpace, WorkSet, Organization)
- Each variable shows:
  - **Name** — the variable name
  - **Raw value** — as written in the CFG file (may contain `$(...)` references)
  - **Resolved value** — with all variable references expanded
  - **Level badge** — the processing level (0–6) at which the value was set
  - **Source file** — which `.cfg` file and line number defined it
  - **Override history** — if the variable was set multiple times, prior values are shown
  - **Issues** — resolution errors or path warnings

### Resolve a single file

If you only want to resolve the currently open file (without loading the full workspace):

1. Open the `.cfg` file
2. Run **Bentley CFG: Resolve Current File** from the Command Palette, or click the `$(symbol-variable)` icon in the editor title bar

---

## 4. Load a ProjectWise Managed Workspace

Use this to inspect the effective workspace configuration for a file stored in ProjectWise, exactly as MicroStation would see it.

### Prerequisites

One of the following must be available:
- **ProjectWise Explorer client** installed on the same machine as VS Code (Windows), which enables the PowerShell module and dmscli backends
- **WSG REST API** access to your PW server (works on any platform, no local client required)

### Step 1 — Set up a connection (first time only)

1. Open the Command Palette and run **Bentley CFG: Load ProjectWise Managed Workspace**
2. When prompted, enter your connection details:

   | Field | Example | Notes |
   |-------|---------|-------|
   | WSG Base URL | `https://pw.company.com/ws` | Include `/ws` suffix |
   | Datasource name | `pwdb` | Matches your PW datasource |
   | Username | `domain\jsmith` | Or just `jsmith` |
   | Password | *(your password)* | Stored in VS Code SecretStorage — not in plain text |
   | Auth type | `Basic` | Use `Bearer` for token-based auth |
   | SSL verification | `On` | Turn off only for self-signed certificates on internal servers |

3. The connection is saved and reused for future sessions

### Step 2 — Select a workspace and workset

1. After connecting, you'll be presented with a list of available workspaces from the datasource
2. Select the workspace you want to inspect
3. Select the workset (project) within that workspace

### Step 3 — Wait for CSB extraction

The extension will:
1. Connect to ProjectWise and retrieve all Configuration Settings Blocks (CSBs) for the selected workspace/workset
2. Try extraction backends in order: PowerShell module → dmscli → WSG document search
3. Write each CSB as a numbered `.cfg` file in a local working directory
4. Download CFG files referenced by `_USTN_CONFIGURATION` from the PW repository
5. Recursively resolve any `%include @:\...` paths, downloading referenced folders (up to 10 passes)
6. Generate a master `.tmp` file with `%include` directives in the correct processing order
7. Parse the master config and resolve all variables

Progress is shown in the VS Code notification area.

### Step 4 — Review results

The Workspace Explorer panel opens with all resolved variables, identical to the local workspace view. The source shown for each variable will reference the CSB ID file (e.g. `abc123.cfg`) rather than a human-readable name.

To see the full generated master config, run **Bentley CFG: View Generated Master Config** (see [section 6](#6-view-the-generated-master-config)).

### Understanding CSB processing levels

CSBs are applied in a fixed order that mirrors what MicroStation does at startup:

```
Predefined (level 0) → Global (0) → Application (1) → Customer (2)
→ Site (2) → WorkSpace (3) → WorkSet (4) → Discipline (4) → Role (5) → User (6)
```

A variable set at a higher level overrides one set at a lower level (unless the lower-level setting uses `%lock`).

---

## 5. Import CSB Content Manually

Use this when you cannot connect to ProjectWise directly (e.g. no network access, no PW client installed) but you have access to the raw CSB variable content.

### When to use this

- You're on a machine without ProjectWise Explorer installed
- You're on Linux/macOS without WSG API access
- A colleague has exported CSB content for you

### Step-by-step

1. Obtain the CSB variable content — this is the raw text that PW writes into CFG files, typically a series of `VARNAME = value` lines
2. Open the Command Palette and run **Bentley CFG: Import CSB Content Manually**
3. Paste the CSB content into the input box when prompted
4. The extension processes it as if it were extracted directly from ProjectWise
5. The Workspace Explorer panel opens with the resolved variables

---

## 6. View the Generated Master Config

When a ProjectWise Managed Workspace is loaded, the extension generates a master `.tmp` file that lists all CSBs in processing order via `%include` directives — this is equivalent to what MicroStation receives on its `-wc` command line.

### Step-by-step

1. Load a ProjectWise Managed Workspace (see section 4)
2. Open the Command Palette and run **Bentley CFG: View Generated Master Config**
3. The `.tmp` file opens in the editor with full syntax highlighting

This is useful for:
- Verifying the exact processing order of CSBs
- Sharing the effective config with Bentley support
- Comparing against what MicroStation is actually loading

---

## 7. Compare Two Workspaces

Use workspace comparison to identify differences between environments, workspace versions, or before/after a configuration change.

### Option A — Compare two already-loaded workspaces

1. Load two workspaces (any combination of local or ProjectWise) using the load commands
2. Open the Command Palette and run **Bentley CFG: Compare Loaded Workspaces**
3. Select which loaded workspace to use as **Left** and which as **Right**
4. The comparison panel opens

### Option B — Compare two local folders directly

1. Open the Command Palette and run **Bentley CFG: Compare Two Workspace Folders**
2. Pick the **Left** folder in the folder picker
3. Pick the **Right** folder
4. The extension loads both and opens the comparison panel

### Reading the comparison panel

| Symbol | Meaning |
|--------|---------|
| ➕ | Variable exists only in the Right workspace |
| ➖ | Variable exists only in the Left workspace |
| ✏️ | Variable exists in both but has a different raw or resolved value |
| ✓ | Variable is identical in both |

- Use the **Hide Unchanged** toggle to focus on differences only
- Click any changed variable to see the full before/after values side by side

---

## 8. Manage ProjectWise Connections

Saved connections can be viewed and deleted at any time.

1. Open the Command Palette and run **Bentley CFG: Manage ProjectWise Connections**
2. A list of saved connections is shown
3. Select a connection to delete it

Credentials are stored in VS Code's SecretStorage (the system keychain) and are not written to any file on disk.

To add a new connection, simply run **Bentley CFG: Load ProjectWise Managed Workspace** — if no matching connection exists you'll be prompted to enter new details.

---

## 9. Tips and Troubleshooting

### General tips

- Always use **forward slashes** (`/`) in paths — MicroStation accepts them on Windows and they avoid escape issues
- Directory variables must end with a **trailing slash**: `_USTN_WORKSPACECFG = $(WorkSpace)cfg/`
- Use `$(VAR)` (deferred) for paths that may be redefined later in the chain; use `${VAR}` (immediate) to lock in the value at the point of definition
- Use `%lock` to prevent a variable from being overridden at a higher level: `%lock MS_PROTECTION_ENCRYPT`
- Never edit `msconfig.cfg` directly — always add a Custom Configuration layer

### Debugging variable values in MicroStation

Add this line to your user `.cfg` to make MicroStation print all active variable values at startup:

```cfg
_USTN_DISPLAYALLCFGVARS = 1
```

### The extension does not highlight my file

Check the language mode in the bottom-right corner of VS Code. Click it and select **Bentley CFG**. This can happen if the file has an unusual line ending or was opened before the extension activated.

### Commands are missing from the palette

Ensure you have a `.cfg`, `.ucf`, or `.pcf` file open in the active editor. Some commands (Validate, Resolve Current File) are only shown when a Bentley CFG file is active.

### ProjectWise connection fails

- Confirm the **WSG Base URL** ends with `/ws` and is reachable from your machine (try opening it in a browser)
- If you see SSL errors, toggle **SSL verification off** in the connection settings (for self-signed certificates)
- If Basic auth fails, ask your PW admin whether your server uses Bearer/token authentication
- Ensure your PW username includes the domain if required (`DOMAIN\username`)

### CSB extraction returns no results

The extension tries three backends automatically. If all fail:
1. Confirm ProjectWise Explorer is installed and you can log in via the PW Explorer desktop client
2. Try the manual import option (section 5) as a fallback
3. Check the VS Code **Output** panel (select **Bentley CFG** in the channel dropdown) for detailed error messages

### Local workspace loads but variables are unresolved

- Check for typos in variable names — `$(MY_VAR)` will not resolve if the variable is defined as `MY_VAR` but referenced as `$(My_Var)` (names are case-sensitive)
- Look for circular references reported in the Workspace Explorer panel — e.g. `VAR_A = $(VAR_B)` and `VAR_B = $(VAR_A)`
- Verify that `%include` paths are correct and the referenced files exist on disk

### Include depth or recursion limit reached

The extension enforces safety limits:
- `%include` chains: maximum **32 levels** deep
- Variable expansion: maximum **20 iterations** per variable
- ProjectWise `@:` path resolution: maximum **10 passes**

If your workspace legitimately requires more depth, this indicates an unusually complex include structure — consider flattening deeply nested includes.
