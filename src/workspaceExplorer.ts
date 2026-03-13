/**
 * Workspace Explorer WebView
 * Provides the main UI panel for:
 *  - Loading local / ProjectWise workspaces
 *  - Variable resolution results (tree + flat table)
 *  - Issue diagnostics
 *  - Side-by-side workspace comparison / diff
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ParseResult, CompareResult, LEVEL_NAMES, ConfigLevel } from './cfgParser';

export class WorkspaceExplorerPanel {
  public static currentPanel: WorkspaceExplorerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _currentReportHtml: string | undefined;
  private _currentReportFileName = 'bentley-workspace-report.html';

  public static createOrShow(context: vscode.ExtensionContext): WorkspaceExplorerPanel {
    const column = vscode.ViewColumn.Beside;
    if (WorkspaceExplorerPanel.currentPanel) {
      WorkspaceExplorerPanel.currentPanel._panel.reveal(column);
      return WorkspaceExplorerPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'bentleyCfgExplorer',
      'Bentley Workspace Explorer',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    WorkspaceExplorerPanel.currentPanel = new WorkspaceExplorerPanel(panel, context);
    return WorkspaceExplorerPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, private _context: vscode.ExtensionContext) {
    this._panel = panel;
    this._panel.webview.html = this._getLoadingHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(msg => this._handleMessage(msg), null, this._disposables);
  }

  private async _handleMessage(msg: any): Promise<void> {
    switch (msg.command) {
      case 'openFile':
        if (msg.file) {
          const uri = vscode.Uri.file(msg.file);
          await vscode.window.showTextDocument(uri, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: false,
            preserveFocus: true,
            selection: msg.line !== undefined
              ? new vscode.Range(msg.line - 1, 0, msg.line - 1, 0)
              : undefined,
          });
        }
        break;
      case 'saveReport':
        if (!this._currentReportHtml) {
          vscode.window.showWarningMessage('No report is available to save yet.');
          return;
        }
        {
          const target = await vscode.window.showSaveDialog({
            saveLabel: 'Save Report',
            defaultUri: vscode.Uri.file(path.join(this._context.globalStorageUri.fsPath, this._currentReportFileName)),
            filters: { 'HTML Report': ['html'] },
          });
          if (!target) return;
          await vscode.workspace.fs.writeFile(target, Buffer.from(this._currentReportHtml, 'utf8'));
          vscode.window.showInformationMessage(`Report saved: ${target.fsPath}`);
        }
        break;
      case 'ready':
        // WebView signals it's ready
        break;
    }
  }

  public showLoading(message: string): void {
    this._currentReportHtml = undefined;
    this._currentReportFileName = 'bentley-workspace-report.html';
    this._panel.webview.html = this._getLoadingHtml(message);
  }

  public showParseResult(result: ParseResult, label: string, rootPath: string): void {
    const html = this._getResultHtml(result, label, rootPath);
    this._currentReportHtml = html;
    this._currentReportFileName = `${sanitizeFileName(label)}.report.html`;
    this._panel.webview.html = html;
    this._panel.reveal(vscode.ViewColumn.Beside);
  }

  public showCompareResult(compare: CompareResult, leftLabel: string, rightLabel: string): void {
    const html = this._getCompareHtml(compare, leftLabel, rightLabel);
    this._currentReportHtml = html;
    this._currentReportFileName = `${sanitizeFileName(`${leftLabel}-vs-${rightLabel}`)}.report.html`;
    this._panel.webview.html = html;
    this._panel.reveal(vscode.ViewColumn.Beside);
  }

  public dispose(): void {
    WorkspaceExplorerPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) d.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HTML Generators
  // ─────────────────────────────────────────────────────────────────────────

  private _getLoadingHtml(msg = 'Loading workspace...'): string {
    return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:40px;text-align:center">
      <h2 style="color:var(--vscode-foreground)">${escHtml(msg)}</h2>
      <div style="margin-top:20px;color:var(--vscode-descriptionForeground)">Please wait...</div>
    </body></html>`;
  }

  private _getResultHtml(result: ParseResult, label: string, rootPath: string): string {
    const vars = Array.from(result.variables.values()).sort((a, b) => a.name.localeCompare(b.name));
    const errors = result.errors;
    const issues = result.resolutionIssues;

    const errorCount = errors.filter(e => e.severity === 'error').length;
    const warnCount = errors.filter(e => e.severity === 'warning').length + issues.filter(i => i.severity === 'warning').length;
    const issueErrorCount = issues.filter(i => i.severity === 'error').length;

    // Group variables by category
    const ustnVars = vars.filter(v => v.name.startsWith('_USTN_'));
    const msVars = vars.filter(v => v.name.startsWith('MS_'));
    const civilVars = vars.filter(v => v.name.startsWith('CIVIL_') || v.name === 'APP_STANDARDS');
    const otherVars = vars.filter(v => !v.name.startsWith('_USTN_') && !v.name.startsWith('MS_') && !v.name.startsWith('CIVIL_') && v.name !== 'APP_STANDARDS');

    const varTable = (varList: typeof vars) => varList.map(v => {
      const resolved = v.resolvedValue ?? '(unresolved)';
      const hasIssue = issues.some(i => i.variable === v.name);
      const isLocked = v.locked;
      const rowClass = hasIssue ? 'row-issue' : '';
      const lockedBadge = isLocked ? '<span class="badge badge-lock">LOCK</span>' : '';
      const levelBadge = `<span class="badge badge-l${v.level}">${LEVEL_NAMES[v.level as ConfigLevel]}</span>`;
      const shortFile = path.basename(v.sourceFile);
      const fileLink = `<a href="#" class="open-file-link" data-open-file="${escAttr(encodeURIComponent(v.sourceFile))}" data-open-line="${v.sourceLine}" title="${escAttr(v.sourceFile)}">${escHtml(shortFile)}:${v.sourceLine}</a>`;
      const overrides = v.overrideHistory.length > 0
        ? `<div class="overrides">${v.overrideHistory.map(h =>
          `<div class="override">↩ was <code>${escHtml(truncate(h.value, 60))}</code> from ${path.basename(h.sourceFile)}:${h.sourceLine} [${LEVEL_NAMES[h.level as ConfigLevel]}]</div>`
        ).join('')}</div>` : '';
      return `<tr class="${rowClass}">
        <td class="var-name"><code>${escHtml(v.name)}</code>${lockedBadge}</td>
        <td>${levelBadge} ${fileLink}</td>
        <td class="var-value"><code title="${escAttr(v.value)}">${escHtml(truncate(v.value, 80))}</code></td>
        <td class="var-resolved ${v.resolvedValue ? '' : 'unresolved'}">
          <code title="${escAttr(resolved)}">${escHtml(truncate(resolved, 80))}</code>
          ${overrides}
        </td>
      </tr>`;
    }).join('');

    const issueRows = [...errors, ...issues.map(i => ({ ...i, file: i.sourceFile, line: i.sourceLine, message: `[${i.variable}] ${i.issue}` }))]
      .map(e => {
        const cls = e.severity === 'error' ? 'issue-error' : e.severity === 'warning' ? 'issue-warn' : 'issue-info';
        const icon = e.severity === 'error' ? '✖' : e.severity === 'warning' ? '⚠' : 'ℹ';
        const shortF = path.basename(e.file);
        const issueLine = 'line' in e ? e.line : 1;
        const fileLink = `<a href="#" class="open-file-link" data-open-file="${escAttr(encodeURIComponent(e.file))}" data-open-line="${issueLine}">${escHtml(shortF)}:${issueLine}</a>`;
        return `<tr class="${cls}"><td>${icon}</td><td>${fileLink}</td><td>${escHtml(e.message)}</td></tr>`;
      }).join('');

    const section = (title: string, count: number, varList: typeof vars) =>
      varList.length === 0 ? '' : `
        <details open>
          <summary><strong>${escHtml(title)}</strong> <span class="count">${count}</span></summary>
          <table class="var-table"><thead><tr>
            <th>Variable</th><th>Source</th><th>Raw Value</th><th>Resolved Value</th>
          </tr></thead><tbody>${varTable(varList)}</tbody></table>
        </details>`;

    const filesProcessed = result.filesProcessed.map(f =>
      `<li><a href="#" class="open-file-link" data-open-file="${escAttr(encodeURIComponent(f))}" data-open-line="1">${escHtml(f)}</a></li>`
    ).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${WEBVIEW_CSS}</style>
</head>
<body>
<div class="toolbar">
  <h1>📂 ${escHtml(label)}</h1>
  <div class="stats">
    <span class="stat stat-var">📊 ${vars.length} variables</span>
    <span class="stat stat-file">📄 ${result.filesProcessed.length} files</span>
    ${errorCount > 0 ? `<span class="stat stat-error">✖ ${errorCount} errors</span>` : ''}
    ${warnCount > 0 ? `<span class="stat stat-warn">⚠ ${warnCount} warnings</span>` : ''}
    ${issueErrorCount > 0 ? `<span class="stat stat-error">✖ ${issueErrorCount} resolution errors</span>` : ''}
  </div>
  <div class="filter-bar">
    <input id="filterInput" type="text" placeholder="Filter variables..." oninput="filterTable(this.value)">
    <label><input type="checkbox" id="showUnresolved" onchange="filterTable(document.getElementById('filterInput').value)"> Show only issues</label>
    <label><input type="checkbox" id="showChanged" onchange="filterTable(document.getElementById('filterInput').value)"> Show only overridden</label>
    <button type="button" onclick="saveReport()">💾 Save report</button>
  </div>
</div>

${issueRows ? `<details open><summary><strong>⚠ Issues</strong></summary>
  <table class="issue-table"><thead><tr><th></th><th>Location</th><th>Message</th></tr></thead>
  <tbody>${issueRows}</tbody></table></details>` : ''}

<div id="varSections">
  ${section('_USTN_ System Variables', ustnVars.length, ustnVars)}
  ${section('MS_ MicroStation Variables', msVars.length, msVars)}
  ${section('CIVIL_ / ORD Variables', civilVars.length, civilVars)}
  ${section('User / Custom Variables', otherVars.length, otherVars)}
</div>

<details>
  <summary><strong>📄 Files Processed (${result.filesProcessed.length})</strong></summary>
  <ul class="file-list">${filesProcessed}</ul>
</details>

<script>
const vscode = acquireVsCodeApi();
function openFile(file, line) {
  vscode.postMessage({ command: 'openFile', file, line });
}
function saveReport() {
  vscode.postMessage({ command: 'saveReport' });
}
function decodeFile(encoded) {
  try { return decodeURIComponent(encoded); } catch { return encoded; }
}
document.addEventListener('click', (event) => {
  const target = event.target && event.target.closest ? event.target.closest('a[data-open-file]') : null;
  if (!target) return;
  event.preventDefault();
  const file = decodeFile(target.getAttribute('data-open-file') || '');
  const line = parseInt(target.getAttribute('data-open-line') || '1', 10);
  if (!file) return;
  openFile(file, Number.isFinite(line) && line > 0 ? line : 1);
});
function filterTable(q) {
  const showUnresolved = document.getElementById('showUnresolved').checked;
  const showChanged = document.getElementById('showChanged').checked;
  q = q.toLowerCase();
  document.querySelectorAll('.var-table tbody tr').forEach(row => {
    const text = row.textContent.toLowerCase();
    const isIssue = row.classList.contains('row-issue');
    const hasOverride = row.querySelector('.overrides') !== null;
    let show = text.includes(q);
    if (showUnresolved && !isIssue) show = false;
    if (showChanged && !hasOverride) show = false;
    row.style.display = show ? '' : 'none';
  });
}
</script>
</body></html>`;
  }

  private _getCompareHtml(compare: CompareResult, leftLabel: string, rightLabel: string): string {
    const { diffs } = compare;
    const added = diffs.filter(d => d.kind === 'added');
    const removed = diffs.filter(d => d.kind === 'removed');
    const changed = diffs.filter(d => d.kind === 'changed');
    const unchanged = diffs.filter(d => d.kind === 'unchanged');

    const diffRow = (d: typeof diffs[0]) => {
      const kindLabel = { added: '+ Added', removed: '− Removed', changed: '~ Changed', unchanged: '= Same' }[d.kind];
      const kindClass = `diff-${d.kind}`;
      const leftVal = d.leftValue !== undefined ? `<code title="${escAttr(d.leftResolved ?? '')}>${escHtml(truncate(d.leftValue, 80))}</code>` : '<em>—</em>';
      const rightVal = d.rightValue !== undefined ? `<code title="${escAttr(d.rightResolved ?? '')}>${escHtml(truncate(d.rightValue, 80))}</code>` : '<em>—</em>';
      const leftSrc = d.leftFile ? `<span class="src">${path.basename(d.leftFile)}:${d.leftLine}</span>` : '';
      const rightSrc = d.rightFile ? `<span class="src">${path.basename(d.rightFile)}:${d.rightLine}</span>` : '';
      return `<tr class="${kindClass}">
        <td><span class="kind-badge">${kindLabel}</span></td>
        <td><code>${escHtml(d.name)}</code></td>
        <td>${leftVal} ${leftSrc}</td>
        <td>${rightVal} ${rightSrc}</td>
      </tr>`;
    };

    const section = (title: string, items: typeof diffs, open = true) =>
      items.length === 0 ? '' : `
        <details ${open ? 'open' : ''}>
          <summary><strong>${title}</strong> <span class="count">${items.length}</span></summary>
          <table class="diff-table"><thead><tr>
            <th>Kind</th><th>Variable</th>
            <th>${escHtml(leftLabel)}</th>
            <th>${escHtml(rightLabel)}</th>
          </tr></thead><tbody>${items.map(diffRow).join('')}</tbody></table>
        </details>`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${WEBVIEW_CSS}
.diff-added td { background: rgba(0,255,0,0.08); }
.diff-removed td { background: rgba(255,0,0,0.08); }
.diff-changed td { background: rgba(255,200,0,0.08); }
.kind-badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; }
.diff-added .kind-badge { background: #1e5c1e; color: #90ee90; }
.diff-removed .kind-badge { background: #5c1e1e; color: #ffaaaa; }
.diff-changed .kind-badge { background: #5c4a00; color: #ffd700; }
.diff-unchanged .kind-badge { background: transparent; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div class="toolbar">
  <h1>🔀 Workspace Comparison</h1>
  <div class="compare-labels">
    <span class="left-label">← ${escHtml(leftLabel)}</span>
    <span class="right-label">${escHtml(rightLabel)} →</span>
  </div>
  <div class="stats">
    <span class="stat stat-error">+ ${compare.addedCount} added</span>
    <span class="stat stat-warn">− ${compare.removedCount} removed</span>
    <span class="stat" style="color:#ffd700">~ ${compare.changedCount} changed</span>
    <span class="stat stat-var">= ${compare.unchangedCount} unchanged</span>
  </div>
  <div class="filter-bar">
    <input id="filterInput" type="text" placeholder="Filter variables..." oninput="filterTable(this.value)">
    <label><input type="checkbox" id="hideUnchanged" onchange="filterTable(document.getElementById('filterInput').value)" checked> Hide unchanged</label>
    <button type="button" onclick="saveReport()">💾 Save report</button>
  </div>
</div>

${section('➕ Added Variables', added)}
${section('➖ Removed Variables', removed)}
${section('✏️ Changed Variables', changed)}
${section('✓ Unchanged Variables', unchanged, false)}

<script>
const vscode = acquireVsCodeApi();
function openFile(file, line) { vscode.postMessage({ command: 'openFile', file, line }); }
function saveReport() { vscode.postMessage({ command: 'saveReport' }); }
function filterTable(q) {
  const hideUnchanged = document.getElementById('hideUnchanged').checked;
  q = q.toLowerCase();
  document.querySelectorAll('.diff-table tbody tr').forEach(row => {
    const text = row.textContent.toLowerCase();
    const isUnchanged = row.classList.contains('diff-unchanged');
    let show = text.includes(q);
    if (hideUnchanged && isUnchanged) show = false;
    row.style.display = show ? '' : 'none';
  });
}
// Apply initial filter
filterTable('');
</script>
</body></html>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared CSS
// ─────────────────────────────────────────────────────────────────────────────

const WEBVIEW_CSS = `
  :root { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); }
  body { margin: 0; padding: 0; background: var(--vscode-editor-background); }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; word-break: break-all; }

  .toolbar { position: sticky; top: 0; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 10px 16px; z-index: 10; }
  .toolbar h1 { margin: 0 0 6px; font-size: 16px; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .stat { padding: 2px 8px; border-radius: 4px; font-size: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .stat-error { background: #5c1e1e; color: #ffaaaa; }
  .stat-warn { background: #5c4a00; color: #ffd700; }
  .stat-file { background: #1e3a5c; color: #aad4ff; }
  .stat-var { background: #1e1e5c; color: #aaaaff; }

  .filter-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .filter-bar input[type=text] { flex: 1; max-width: 300px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 4px; }
  .filter-bar label { display: flex; align-items: center; gap: 4px; font-size: 12px; }
  .filter-bar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid transparent; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  .filter-bar button:hover { background: var(--vscode-button-hoverBackground); }

  details { margin: 0; border-bottom: 1px solid var(--vscode-panel-border); }
  details summary { padding: 8px 16px; cursor: pointer; background: var(--vscode-sideBarSectionHeader-background); user-select: none; display: flex; align-items: center; gap: 8px; }
  details summary:hover { background: var(--vscode-list-hoverBackground); }
  .count { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 10px; font-size: 11px; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 6px 8px; background: var(--vscode-editor-lineHighlightBackground); font-size: 11px; text-transform: uppercase; position: sticky; top: 0; }
  td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }

  .var-table { table-layout: fixed; }
  .var-table th:nth-child(1) { width: 28%; }
  .var-table th:nth-child(2) { width: 14%; }
  .var-table th:nth-child(3) { width: 29%; }
  .var-table th:nth-child(4) { width: 29%; }
  .var-name { font-size: 12px; }
  .var-value code, .var-resolved code { font-size: 11px; }
  .unresolved code { color: #ff8888; }

  .diff-table { table-layout: fixed; }
  .diff-table th:nth-child(1) { width: 9%; }
  .diff-table th:nth-child(2) { width: 22%; }
  .diff-table th:nth-child(3) { width: 34%; }
  .diff-table th:nth-child(4) { width: 34%; }

  .badge { display: inline-block; padding: 0 5px; border-radius: 3px; font-size: 10px; margin-left: 4px; vertical-align: middle; }
  .badge-lock { background: #5c1e1e; color: #ffaaaa; }
  .badge-l0 { background: #2a2a2a; color: #888; }
  .badge-l1 { background: #1e2a3a; color: #6af; }
  .badge-l2 { background: #1a2e1a; color: #6d6; }
  .badge-l3 { background: #2e2a00; color: #dd0; }
  .badge-l4 { background: #2e1a2e; color: #d6d; }
  .badge-l5 { background: #002e2e; color: #6dd; }
  .badge-l6 { background: #1e1e2e; color: #aaf; }

  .src { font-size: 10px; color: var(--vscode-descriptionForeground); display: block; margin-top: 2px; }
  .overrides { margin-top: 4px; font-size: 11px; }
  .override { color: var(--vscode-descriptionForeground); padding: 1px 0; }

  .issue-table td { font-size: 12px; }
  .issue-error td:first-child { color: #ff6666; }
  .issue-warn td:first-child { color: #ffd700; }
  .issue-info td:first-child { color: #6af; }
  .row-issue td { background: rgba(255,100,0,0.05); }

  .file-list { margin: 8px 16px; padding: 0; list-style: none; font-size: 12px; }
  .file-list li { padding: 2px 0; }

  .compare-labels { display: flex; gap: 20px; font-size: 12px; margin-bottom: 6px; }
  .left-label { color: #ffaaaa; }
  .right-label { color: #aaffaa; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s: string): string {
  return escHtml(s ?? '').replace(/'/g, '&#39;');
}
function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.substring(0, n) + '…' : s;
}

function sanitizeFileName(input: string): string {
  const cleaned = (input ?? 'bentley-workspace-report')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'bentley-workspace-report';
}
