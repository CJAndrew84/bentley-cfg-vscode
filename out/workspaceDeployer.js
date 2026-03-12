"use strict";
/**
 * Workspace Deployer — push a local CFG workspace to ProjectWise
 *
 * What "deploying a workspace" means in Bentley / DMWF terms
 * ──────────────────────────────────────────────────────────
 * A Bentley Digital Managed Workspace Framework (DMWF) deployment has two
 * independent parts:
 *
 *   1. Repository files  — the actual .cfg, .ucf, .pcf, seed, cell, dgnlib
 *      and other standards files stored as ordinary PW documents inside a
 *      folder hierarchy.  These are what MicroStation reads via
 *      _USTN_CONFIGURATION / _USTN_WORKSPACEROOT etc.
 *
 *   2. Configuration Settings Blocks (CSBs) — database-level objects inside
 *      the PW datasource that inject variables before MicroStation even opens
 *      a file.  CSBs cannot be created or modified through the WSG REST API;
 *      they require either the ProjectWise Admin client or the PWPS_DAB
 *      PowerShell module.
 *
 * This module handles part 1 (file upload via WSG) and generates a ready-to-
 * run PowerShell script (part 2) that a ProjectWise administrator can execute
 * to complete the CSB setup.
 *
 * Typical workflow
 * ────────────────
 *   1. User authors / edits workspace CFG files locally
 *   2. Runs "Bentley CFG: Deploy Workspace to ProjectWise"
 *   3. Extension uploads all CFG (and optionally all standards) files to the
 *      chosen PW folder tree, creating sub-folders as needed
 *   4. Extension generates a deploy-csb.ps1 script the admin can run once to
 *      wire up the Managed Workspace Profile and CSBs
 *   5. From that point on, any update is a re-deploy (files are updated
 *      in-place; CSBs normally only need to be created once)
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
exports.buildDeploymentPlan = buildDeploymentPlan;
exports.executeDeployment = executeDeployment;
exports.generateDeploymentPackage = generateDeploymentPackage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const DEPLOY_EXTENSIONS = new Set(['.cfg', '.ucf', '.pcf']);
const STANDARDS_EXTENSIONS = new Set(['.dgnlib', '.cel', '.dgn', '.rsc', '.pltcfg', '.pset', '.xml', '.tbl']);
/** Recursively collect files under root that match the allowed extensions */
function scanFolder(root, includeStandards) {
    const results = [];
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (!DEPLOY_EXTENSIONS.has(ext) && !(includeStandards && STANDARDS_EXTENSIONS.has(ext))) {
                    continue;
                }
                const rel = path.relative(root, full).replace(/\\/g, '/');
                const pwFolder = path.dirname(rel).replace(/\\/g, '/');
                results.push({
                    localPath: full,
                    relativePath: rel,
                    fileName: entry.name,
                    pwFolderPath: pwFolder === '.' ? '' : pwFolder,
                });
            }
        }
    }
    walk(root);
    return results;
}
/** Collect the unique PW sub-folder paths that need to exist */
function foldersToEnsure(files) {
    const seen = new Set();
    for (const f of files) {
        if (!f.pwFolderPath)
            continue;
        // Add each segment up to the full path so parents are created first
        const parts = f.pwFolderPath.split('/');
        for (let i = 1; i <= parts.length; i++) {
            seen.add(parts.slice(0, i).join('/'));
        }
    }
    return [...seen].sort(); // sort = parent folders appear before children
}
// ─────────────────────────────────────────────────────────────────────────────
// Main entry points
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build a deployment plan (no network calls yet — safe for preview).
 */
function buildDeploymentPlan(localRoot, targetFolderGuid, targetFolderLabel, includeStandards) {
    const files = scanFolder(localRoot, includeStandards);
    return {
        localRoot,
        targetFolderGuid,
        targetFolderLabel,
        files,
        foldersToEnsure: foldersToEnsure(files),
    };
}
/**
 * Execute the deployment plan — create folders and upload files.
 *
 * Progress is reported via the optional `onProgress` callback which receives
 * a human-readable status line and a 0–1 fraction.
 */
async function executeDeployment(client, plan, onProgress) {
    const report = (msg, frac) => {
        onProgress?.(msg, frac);
    };
    // ── Step 1: Ensure all required sub-folders exist ──────────────────────────
    // Map from pwFolderPath -> PW instanceId so we can look them up quickly
    const folderGuids = new Map();
    folderGuids.set('', plan.targetFolderGuid); // root
    const totalSteps = plan.foldersToEnsure.length + plan.files.length;
    let step = 0;
    for (const folderPath of plan.foldersToEnsure) {
        step++;
        report(`Ensuring folder: ${folderPath}`, step / totalSteps);
        const parts = folderPath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const folderName = parts[parts.length - 1];
        const parentGuid = folderGuids.get(parentPath) ?? plan.targetFolderGuid;
        try {
            const folder = await client.findOrCreateFolder(parentGuid, folderName);
            folderGuids.set(folderPath, folder.instanceId);
        }
        catch (err) {
            // Non-fatal: record the missing guid so file uploads to this folder will
            // fail with a clear message rather than a confusing undefined error.
            report(`Warning: could not ensure folder "${folderPath}": ${err.message}`, step / totalSteps);
        }
    }
    // ── Step 2: Upload files ───────────────────────────────────────────────────
    const fileResults = [];
    let created = 0, updated = 0, failed = 0;
    for (const file of plan.files) {
        step++;
        report(`Uploading: ${file.relativePath}`, step / totalSteps);
        const folderGuid = folderGuids.get(file.pwFolderPath);
        if (!folderGuid) {
            fileResults.push({ file, status: 'failed', error: `Parent folder not found: ${file.pwFolderPath}` });
            failed++;
            continue;
        }
        let content;
        try {
            content = fs.readFileSync(file.localPath, 'utf8');
        }
        catch (err) {
            fileResults.push({ file, status: 'failed', error: `Cannot read local file: ${err.message}` });
            failed++;
            continue;
        }
        try {
            const { created: wasCreated } = await client.upsertDocument(folderGuid, file.fileName, content);
            fileResults.push({ file, status: wasCreated ? 'created' : 'updated' });
            if (wasCreated)
                created++;
            else
                updated++;
        }
        catch (err) {
            fileResults.push({ file, status: 'failed', error: err.message });
            failed++;
        }
    }
    report('Generating PowerShell CSB setup script...', 0.95);
    // ── Step 3: Generate the PowerShell CSB script ────────────────────────────
    const psScriptPath = generatePsScript(plan);
    const reportPath = generateDeployReport(plan, fileResults, psScriptPath);
    report('Deployment complete.', 1);
    return { created, updated, failed, fileResults, psScriptPath, reportPath };
}
// ─────────────────────────────────────────────────────────────────────────────
// PowerShell CSB setup script generator
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Write a deploy-csb.ps1 script next to the local workspace root.
 *
 * The script wires up the Managed Workspace Profile and CSBs using the
 * PWPS_DAB module (the same backend the extension uses to read CSBs).
 * A ProjectWise Administrator runs this once after the initial file upload.
 *
 * Key cmdlets used:
 *   New-PWManagedWorkspaceProfile  — creates the profile that links to an Application
 *   New-PWConfigurationBlock       — creates a CSB at a given level
 *   Add-PWConfigurationBlockVariable — adds a variable (name/value/valueType) to a CSB
 *   Set-PWApplicationManagedWorkspace — assigns the profile to a PW Application
 */
function generatePsScript(plan) {
    const workspaceName = path.basename(plan.localRoot);
    const scriptPath = path.join(plan.localRoot, 'deploy-csb.ps1');
    // Detect worksets: sub-folders that contain a WorkSet.cfg or similar
    const worksets = detectWorksets(plan.localRoot);
    const lines = [
        '#Requires -Module PWPS_DAB',
        '# ─────────────────────────────────────────────────────────────────────────',
        `# ProjectWise Managed Workspace (DMWF) CSB Setup — ${workspaceName}`,
        '# Generated by the Bentley Workspace Configuration VS Code extension.',
        '#',
        '# Prerequisites',
        '# ─────────────',
        '# • Run on a machine that has the ProjectWise PowerShell module (PWPS_DAB)',
        '#   installed (ships with PW Explorer CONNECT Edition).',
        '# • The account used must have ProjectWise Administrator rights.',
        '# • The CFG files must already be uploaded to ProjectWise (use the',
        "#   'Deploy Workspace to ProjectWise' command in VS Code first).",
        '#',
        '# Instructions',
        '# ────────────',
        '# 1. Edit the $Config section below to match your environment.',
        '# 2. Run the script from PowerShell: .\\deploy-csb.ps1',
        '# 3. To re-run safely, the script checks for existing objects and only',
        '#    creates what is missing.',
        '# ─────────────────────────────────────────────────────────────────────────',
        '',
        '#region ── Configuration — edit these values ─────────────────────────────',
        '$Config = @{',
        `    WorkspaceName        = '${workspaceName}'`,
        `    WorkspaceDescription = '${workspaceName} Managed Workspace'`,
        '',
        '    # PW datasource connection',
        "    DatasourceURL  = 'https://YOUR-PW-SERVER/ws'   # e.g. https://pw.company.com/ws",
        "    Datasource     = 'YOUR-DATASOURCE'              # e.g. pwdb",
        "    UserName       = 'administrator'",
        '    # Password will be prompted at runtime if left empty',
        "    Password       = ''",
        '',
        '    # The PW Application this workspace profile will be assigned to.',
        '    # Run: Get-PWApplication | Select Name,InstanceId  to list applications.',
        "    ApplicationName = 'YOUR-APPLICATION-NAME'",
        '',
        '    # PW logical path to the uploaded workspace root folder.',
        '    # This is the folder you chose as the deployment target in VS Code.',
        `    PwWorkspaceFolder = '\\Projects\\Configuration\\WorkSpaces\\${workspaceName}'`,
        '',
        '    # Local dms path prefix written into WorkSpace-level CSB variables.',
        "    # Leave as-is to use PW's standard working-directory macro.",
        "    PwWorkDir = '$(PW_WORKDIR)'",
        '}',
        '#endregion',
        '',
        '# ─────────────────────────────────────────────────────────────────────────',
        '',
        'function Ensure-PWSession {',
        '    param($cfg)',
        '    $pass = if ($cfg.Password) {',
        '        ConvertTo-SecureString $cfg.Password -AsPlainText -Force',
        '    } else {',
        "        Read-Host \"Password for $($cfg.UserName)@$($cfg.Datasource)\" -AsSecureString",
        '    }',
        '    $cred = New-Object System.Management.Automation.PSCredential($cfg.UserName, $pass)',
        '    Open-PWSession -DatasourceURL $cfg.DatasourceURL -Credential $cred -Datasource $cfg.Datasource',
        '}',
        '',
        'function Ensure-ManagedWorkspaceProfile {',
        '    param($name, $description)',
        '    $existing = Get-PWManagedWorkspaceProfile | Where-Object { $_.Name -eq $name }',
        '    if ($existing) {',
        "        Write-Host \"  Profile already exists: $name\" -ForegroundColor Cyan",
        '        return $existing',
        '    }',
        '    Write-Host "  Creating Managed Workspace Profile: $name"',
        '    return New-PWManagedWorkspaceProfile -Name $name -Description $description',
        '}',
        '',
        'function Ensure-CSB {',
        '    param($profileId, $level, $name, [hashtable]$variables)',
        '    $existing = Get-PWConfigurationBlock -ManagedWorkspaceProfileId $profileId |',
        '                Where-Object { $_.Name -eq $name -and $_.Level -eq $level }',
        '    if ($existing) {',
        "        Write-Host \"  CSB already exists: [$level] $name\" -ForegroundColor Cyan",
        '        return $existing',
        '    }',
        "    Write-Host \"  Creating CSB: [$level] $name\"",
        '    $csb = New-PWConfigurationBlock -ManagedWorkspaceProfileId $profileId \\',
        '               -Name $name -Level $level',
        '    foreach ($varName in $variables.Keys) {',
        '        $v = $variables[$varName]',
        '        Add-PWConfigurationBlockVariable -ConfigurationBlockId $csb.Id \\',
        '            -Name $varName -Value $v.Value -ValueType $v.ValueType \\',
        '            -Operator $v.Operator',
        '    }',
        '    return $csb',
        '}',
        '',
        '# ─────────────────────────────────────────────────────────────────────────',
        "Write-Host 'Connecting to ProjectWise...' -ForegroundColor Yellow",
        'Ensure-PWSession -cfg $Config',
        '',
        "Write-Host 'Setting up Managed Workspace Profile...' -ForegroundColor Yellow",
        '$profile = Ensure-ManagedWorkspaceProfile -name $Config.WorkspaceName \\',
        '                                           -description $Config.WorkspaceDescription',
        '',
        '# ── WorkSpace-level CSB (Level 3) ────────────────────────────────────────',
        "Write-Host 'Creating WorkSpace CSB (Level 3)...' -ForegroundColor Yellow",
        '$wsVars = @{',
        "    '_USTN_CONFIGURATION'   = @{ Value = \"$($Config.PwWorkDir)/workspace/\"; ValueType = 'PWFolder'; Operator = '=' }",
        "    '_USTN_WORKSPACEROOT'   = @{ Value = \"$($Config.PwWorkDir)/workspace/\"; ValueType = 'PWFolder'; Operator = '=' }",
        "    '_USTN_WORKSPACENAME'   = @{ Value = $Config.PwWorkspaceFolder;           ValueType = 'LastDirPiece'; Operator = '=' }",
        "    '_USTN_WORKSETSROOT'    = @{ Value = \"$($Config.PwWorkDir)/workspace/WorkSets/\"; ValueType = 'PWFolder'; Operator = '=' }",
        '}',
        "Ensure-CSB -profileId \$profile.Id -level 'WorkSpace' \\",
        "           -name \$Config.WorkspaceName -variables \$wsVars",
        '',
    ];
    // Generate one WorkSet-level CSB per detected workset
    if (worksets.length > 0) {
        lines.push('# ── WorkSet-level CSBs (Level 4) — one per project ──────────────────────');
        lines.push("Write-Host 'Creating WorkSet CSBs (Level 4)...' -ForegroundColor Yellow");
        lines.push('$worksets = @(');
        for (const ws of worksets) {
            lines.push(`    '${ws}'`);
        }
        lines.push(')');
        lines.push('foreach ($wsName in $worksets) {');
        lines.push('    $wsSetVars = @{');
        lines.push("        '_USTN_WORKSETNAME' = @{ Value = \"$($Config.PwWorkspaceFolder)/WorkSets/$wsName\"; ValueType = 'LastDirPiece'; Operator = '=' }");
        lines.push("        '_USTN_WORKSETROOT' = @{ Value = \"$($Config.PwWorkDir)/workspace/WorkSets/$wsName/\"; ValueType = 'PWFolder'; Operator = '=' }");
        lines.push('    }');
        lines.push('    Ensure-CSB -profileId $profile.Id -level \'WorkSet\' \\');
        lines.push('               -name $wsName -variables $wsSetVars');
        lines.push('}');
        lines.push('');
    }
    else {
        lines.push('# No WorkSets were detected in the local workspace folder.');
        lines.push("# Add WorkSet-level CSBs manually using Ensure-CSB with -level 'WorkSet'.");
        lines.push('');
    }
    lines.push('# ── Assign profile to Application ────────────────────────────────────────');
    lines.push("Write-Host 'Assigning profile to Application...' -ForegroundColor Yellow");
    lines.push('$app = Get-PWApplication | Where-Object { $_.Name -eq $Config.ApplicationName }');
    lines.push('if ($app) {');
    lines.push('    Set-PWApplicationManagedWorkspace -ApplicationId $app.InstanceId \\');
    lines.push('                                     -ManagedWorkspaceProfileId $profile.Id');
    lines.push("    Write-Host \"  Assigned to Application: $($Config.ApplicationName)\" -ForegroundColor Green");
    lines.push('} else {');
    lines.push("    Write-Warning \"Application '$($Config.ApplicationName)' not found. Assign the profile manually in PW Admin.\"");
    lines.push('}');
    lines.push('');
    lines.push('Close-PWSession');
    lines.push("Write-Host 'Done. Managed Workspace setup complete.' -ForegroundColor Green");
    fs.writeFileSync(scriptPath, lines.join('\n'), 'utf8');
    return scriptPath;
}
/** Detect workset names by looking for WorkSets/ sub-folders or *.cfg files named like worksets */
function detectWorksets(root) {
    const worksets = [];
    // Strategy 1: look for a WorkSets/ directory and enumerate its children
    for (const candidate of ['WorkSets', 'Worksets', 'worksets', 'Projects']) {
        const wsDir = path.join(root, candidate);
        if (fs.existsSync(wsDir)) {
            try {
                const entries = fs.readdirSync(wsDir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.isDirectory())
                        worksets.push(e.name);
                }
            }
            catch { /* ignore */ }
            if (worksets.length > 0)
                return worksets;
        }
    }
    // Strategy 2: scan for WorkSet.cfg files one level down from root
    try {
        const top = fs.readdirSync(root, { withFileTypes: true });
        for (const e of top) {
            if (!e.isDirectory())
                continue;
            const wsFile = path.join(root, e.name, 'WorkSet.cfg');
            if (fs.existsSync(wsFile))
                worksets.push(e.name);
        }
    }
    catch { /* ignore */ }
    return worksets;
}
/**
 * Generate the PowerShell CSB setup script only (no upload).
 * Used by the "Export Deployment Package" command.
 */
function generateDeploymentPackage(plan) {
    return generatePsScript(plan);
}
/** Write a human-readable deployment summary next to the workspace */
function generateDeployReport(plan, results, psScriptPath) {
    const reportPath = path.join(plan.localRoot, 'deploy-report.txt');
    const now = new Date().toISOString();
    const created = results.filter(r => r.status === 'created').length;
    const updated = results.filter(r => r.status === 'updated').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const lines = [
        `Bentley Workspace Deployment Report`,
        `Generated: ${now}`,
        ``,
        `Source:  ${plan.localRoot}`,
        `Target:  PW folder ${plan.targetFolderLabel} (${plan.targetFolderGuid})`,
        ``,
        `Summary`,
        `───────`,
        `  Created : ${created}`,
        `  Updated : ${updated}`,
        `  Failed  : ${failed}`,
        `  Total   : ${results.length}`,
        ``,
        `Next step`,
        `─────────`,
        `  Run the generated PowerShell script to complete the CSB setup:`,
        `  ${psScriptPath}`,
        ``,
        `File details`,
        `────────────`,
    ];
    for (const r of results) {
        const icon = r.status === 'created' ? '+' : r.status === 'updated' ? '~' : '!';
        const suffix = r.error ? `  ERROR: ${r.error}` : '';
        lines.push(`  [${icon}] ${r.file.relativePath}${suffix}`);
    }
    const content = lines.join('\n');
    fs.writeFileSync(reportPath, content, 'utf8');
    return reportPath;
}
//# sourceMappingURL=workspaceDeployer.js.map