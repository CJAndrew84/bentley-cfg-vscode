# Bentley CFG VS Code Extension

This repository is a VS Code extension for Bentley MicroStation and OpenRoads configuration files. Keep changes minimal, preserve existing APIs and command IDs, and prefer targeted fixes over broad refactors.

## Build And Validation

- Install dependencies with `npm install`.
- Compile with `npm run compile`.
- Use `npm run watch` for iterative TypeScript work.
- Package the extension with `npm run package`.
- There is currently no automated test suite. After code changes, always run `npm run compile` and describe any manual verification performed.

## Architecture Map

- `src/extension.ts`: extension entry point, command registration, hover/completion providers, and the large built-in CFG variable knowledge base.
- `src/cfgParser.ts`: core parser and resolver for Bentley CFG semantics, including `%if`-style directives, config levels, include processing, and deferred vs immediate variable expansion.
- `src/csbExtractor.ts`: ProjectWise Managed Workspace extraction flow and CSB backend selection.
- `src/pwClient.ts`: WSG REST client for ProjectWise folders and documents.
- `src/workspaceDeployer.ts`: uploads workspace files to ProjectWise and generates the PowerShell CSB deployment script.
- `src/workspaceExplorer.ts`: Webview UI for parsed workspaces and comparison results.

## Repo-Specific Working Rules

- Preserve Bentley CFG behavior exactly when editing parser logic. Do not simplify away level ordering, `%include` handling, `%lock`, `%undef`, or the distinction between `$(VAR)` and `${VAR}`.
- Treat ProjectWise repository files and CSBs as separate concerns. WSG handles file upload and download, but CSBs are not writable through the REST client and require the generated PowerShell workflow.
- Keep Windows and ProjectWise assumptions explicit. Some Managed Workspace functionality is intentionally Windows-only and depends on PowerShell or native PW client tooling.
- Maintain the existing documentation style in source files. Several modules use long header comments to capture Bentley and ProjectWise behavior; update those comments when behavior changes.
- Keep the hardcoded variable knowledge base in `src/extension.ts` aligned with any new validation, hover, or completion behavior you introduce.
- Follow existing TypeScript style: strict typing, descriptive interfaces, and small focused helpers over ad hoc inline objects.
- Avoid unrelated UI rewrites in `src/workspaceExplorer.ts`; its HTML, CSS, and client script are intentionally embedded in the TypeScript file.

## Practical Expectations For Changes

- For parser changes, inspect `src/cfgParser.ts` first and verify downstream effects in `src/workspaceExplorer.ts` and `src/extension.ts`.
- For ProjectWise extraction or deployment changes, review both `src/csbExtractor.ts` and `src/pwClient.ts`, and include `src/workspaceDeployer.ts` when the change affects deployment or CSB setup.
- Preserve command titles, command IDs, activation behavior, and package contribution points unless the task explicitly requires changing extension UX.
- Use forward-slash CFG paths unless the code is intentionally dealing with Windows APIs or ProjectWise logical paths.
- If you add new user-facing behavior, update `README.md` and `HOWTO.md` when the change affects commands, workflows, prerequisites, or troubleshooting.

## Manual Verification Guidance

- For general extension changes: run `npm run compile`.
- For parser or diagnostics changes: manually exercise representative `.cfg` inputs, especially nested conditionals, include chains, and variable resolution edge cases.
- For ProjectWise changes: document what was verified locally and what could not be verified without ProjectWise client tooling, datasource access, or Windows-specific dependencies.