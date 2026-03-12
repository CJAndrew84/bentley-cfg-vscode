"use strict";
/**
 * Bentley CFG Parser & Variable Resolver
 *
 * Implements a faithful simulation of MicroStation's configuration processing:
 * - Layered level processing (System→Application→Organization→WorkSpace→WorkSet→Role→User)
 * - All assignment operators (=, >, <, :)
 * - All preprocessor directives (%if, %ifdef,%iffeature, %ifndef, %else, %elseif, %endif,
 *   %include, %lock, %undef, %define, %level)
 * - exists() and defined() functions
 * - Deferred $(VAR) and immediate ${VAR} expansion
 * - Circular reference detection
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
exports.LEVEL_NAMES = void 0;
exports.parseWorkspace = parseWorkspace;
exports.compareWorkspaces = compareWorkspaces;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
exports.LEVEL_NAMES = {
    0: "System",
    1: "Application",
    2: "Organization",
    3: "WorkSpace",
    4: "WorkSet",
    5: "Role",
    6: "User",
};
const MAX_INCLUDE_DEPTH = 32;
// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parse a workspace starting from a root config directory or a specific file.
 * @param rootPath  A directory (scans for ConfigurationSetup.cfg / msconfig-like entry) OR a single .cfg file
 * @param envVars   Optional environment variables to seed (e.g., USERNAME, COMPUTERNAME)
 */
function parseWorkspace(rootPath, envVars = {}, workspaceName, worksetName) {
    const state = {
        variables: new Map(),
        macros: new Set(),
        errors: [],
        resolutionIssues: [],
        filesProcessed: new Set(),
        currentLevel: 0,
        includeDepth: 0,
        envVars: new Map(Object.entries(envVars)),
    };
    // Seed well-known env vars
    const sysVars = {
        USERNAME: envVars.USERNAME || process.env.USERNAME || "User",
        COMPUTERNAME: envVars.COMPUTERNAME || process.env.COMPUTERNAME || "WORKSTATION",
        USERPROFILE: envVars.USERPROFILE || process.env.USERPROFILE || "C:/Users/User",
        APPDATA: envVars.APPDATA || process.env.APPDATA || "C:/Users/User/AppData/Roaming",
        TEMP: envVars.TEMP || process.env.TEMP || "C:/Temp",
        ...envVars,
    };
    for (const [k, v] of Object.entries(sysVars)) {
        state.envVars.set(k, v);
    }
    if (workspaceName)
        seedVar(state, "_USTN_WORKSPACENAME", workspaceName, "system", 0, 0);
    if (worksetName)
        seedVar(state, "_USTN_WORKSETNAME", worksetName, "system", 0, 0);
    const stat = fs.existsSync(rootPath) ? fs.statSync(rootPath) : null;
    let entryFile = null;
    let rootTree;
    if (stat?.isDirectory()) {
        entryFile = findEntryFile(rootPath);
        if (!entryFile) {
            // Try scanning all .cfg files in alphabetical order
            const cfgFiles = fs
                .readdirSync(rootPath)
                .filter((f) => f.toLowerCase().endsWith(".cfg"))
                .sort()
                .map((f) => path.join(rootPath, f));
            rootTree = {
                file: rootPath,
                level: 0,
                children: [],
                lineCount: 0,
                variablesDefined: [],
            };
            for (const f of cfgFiles) {
                const child = parseFile(f, state, 0);
                rootTree.children.push(child);
            }
        }
        else {
            rootTree = parseFile(entryFile, state, 0);
        }
    }
    else if (stat?.isFile()) {
        rootTree = parseFile(rootPath, state, 0);
    }
    else {
        rootTree = {
            file: rootPath,
            level: 0,
            children: [],
            lineCount: 0,
            variablesDefined: [],
        };
        state.errors.push({
            file: rootPath,
            line: 0,
            message: `Path not found: ${rootPath}`,
            severity: "error",
        });
    }
    resolveAllVariables(state);
    return {
        variables: state.variables,
        macros: state.macros,
        errors: state.errors,
        resolutionIssues: state.resolutionIssues,
        filesProcessed: Array.from(state.filesProcessed),
        includeTree: rootTree,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// File Parser
// ─────────────────────────────────────────────────────────────────────────────
function parseFile(filePath, state, level) {
    const node = {
        file: filePath,
        level,
        children: [],
        lineCount: 0,
        variablesDefined: [],
    };
    if (state.includeDepth > MAX_INCLUDE_DEPTH) {
        state.errors.push({
            file: filePath,
            line: 0,
            message: "Maximum include depth exceeded — possible circular include",
            severity: "error",
        });
        return node;
    }
    if (!fs.existsSync(filePath)) {
        state.errors.push({
            file: filePath,
            line: 0,
            message: `File not found: ${filePath}`,
            severity: "error",
        });
        return node;
    }
    if (state.filesProcessed.has(filePath)) {
        return node; // already processed
    }
    state.filesProcessed.add(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    node.lineCount = lines.length;
    state.includeDepth++;
    // Conditional stack: each entry is { active: bool, anyBranchTaken: bool, done: bool }
    const condStack = [];
    const isActive = () => condStack.every((c) => c.active);
    let i = 0;
    while (i < lines.length) {
        const rawLine = lines[i];
        // Strip inline comment for processing (but preserve for display)
        const lineNoComment = rawLine.replace(/#.*$/, "").trim();
        i++;
        if (!lineNoComment)
            continue;
        // ── Preprocessor directives ──────────────────────────────────────────────
        // %if / %ifdef / %ifndef / %iffeature
        const ifMatch = lineNoComment.match(/^%(if(?:def|ndef|feature)?)\s+(.*)/i);
        if (ifMatch) {
            const keyword = ifMatch[1].toLowerCase();
            const expr = ifMatch[2].trim();
            let result = false;
            if (keyword === "ifdef" || keyword === "iffeature") {
                result =
                    (isActive() && state.variables.has(expr)) || state.macros.has(expr);
            }
            else if (keyword === "ifndef") {
                result =
                    isActive() && !(state.variables.has(expr) || state.macros.has(expr));
            }
            else {
                result = isActive() && evaluateCondition(expr, state, filePath, i - 1);
            }
            condStack.push({ active: result, anyBranchTaken: result, done: false });
            continue;
        }
        // %elseif / %elif
        const elseifMatch = lineNoComment.match(/^%(elseif|elif)\s+(.*)/i);
        if (elseifMatch) {
            const top = condStack[condStack.length - 1];
            if (top && !top.done) {
                const expr = elseifMatch[2].trim();
                const result = !top.anyBranchTaken &&
                    evaluateCondition(expr, state, filePath, i - 1);
                top.active = result;
                if (result)
                    top.anyBranchTaken = true;
            }
            continue;
        }
        // %else
        if (/^%else\b/i.test(lineNoComment)) {
            const top = condStack[condStack.length - 1];
            if (top) {
                top.active = !top.anyBranchTaken;
                if (top.active)
                    top.anyBranchTaken = true;
            }
            continue;
        }
        // %endif
        if (/^%endif\b/i.test(lineNoComment)) {
            condStack.pop();
            continue;
        }
        // Skip inactive blocks
        if (!isActive())
            continue;
        // %level
        const levelMatch = lineNoComment.match(/^%level\s+(\w+)/i);
        if (levelMatch) {
            const l = parseLevelSpec(levelMatch[1]);
            if (l !== null)
                state.currentLevel = l;
            continue;
        }
        // %lock
        const lockMatch = lineNoComment.match(/^%lock\s+([A-Za-z_]\w*)/i);
        if (lockMatch) {
            const existing = state.variables.get(lockMatch[1]);
            if (existing)
                existing.locked = true;
            continue;
        }
        // %undef / %undefine
        const undefMatch = lineNoComment.match(/^%u(?:ndef|ndefine)\s+([A-Za-z_]\w*)/i);
        if (undefMatch) {
            state.variables.delete(undefMatch[1]);
            continue;
        }
        // %define
        const defineMatch = lineNoComment.match(/^%define\s+([A-Za-z_]\w*)/i);
        if (defineMatch) {
            state.macros.add(defineMatch[1]);
            continue;
        }
        // %include
        const includeMatch = lineNoComment.match(/^%include\s+(.*?)(?:\s+level\s+(\w+))?\s*$/i);
        if (includeMatch) {
            let includePath = includeMatch[1].trim();
            const levelSpec = includeMatch[2]
                ? parseLevelSpec(includeMatch[2])
                : null;
            const savedLevel = state.currentLevel;
            if (levelSpec !== null)
                state.currentLevel = levelSpec;
            // Expand variables in the path
            includePath = expandVariables(includePath, state, filePath, i - 1);
            includePath = normalizePath(includePath);
            // Wildcard support
            const includeDir = path.dirname(includePath);
            const includePattern = path.basename(includePath);
            const files = resolveWildcard(includeDir, includePattern, filePath);
            for (const f of files) {
                const child = parseFile(f, state, state.currentLevel);
                node.children.push(child);
            }
            if (levelSpec !== null)
                state.currentLevel = savedLevel;
            continue;
        }
        // %error / %warning
        const errorMatch = lineNoComment.match(/^%(error|warning)\s+(.*)/i);
        if (errorMatch) {
            state.errors.push({
                file: filePath,
                line: i - 1,
                message: expandVariables(errorMatch[2], state, filePath, i - 1),
                severity: errorMatch[1].toLowerCase() === "error" ? "error" : "warning",
            });
            continue;
        }
        // ── Variable assignment ───────────────────────────────────────────────────
        const assignMatch = lineNoComment.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*([=><:])\s*(.*)/);
        if (assignMatch) {
            const varName = assignMatch[1];
            const operator = assignMatch[2];
            const rawValue = assignMatch[3].trim();
            // Expand immediate ${} references at definition time; leave $() for later
            const value = expandImmediate(rawValue, state, filePath, i - 1);
            const existing = state.variables.get(varName);
            if (existing?.locked) {
                // Silently ignore — variable is locked
                continue;
            }
            const entry = existing ?? {
                name: varName,
                value: "",
                resolvedValue: null,
                level: state.currentLevel,
                locked: false,
                sourceFile: filePath,
                sourceLine: i - 1,
                overrideHistory: [],
            };
            if (existing) {
                // Record the override
                existing.overrideHistory.push({
                    value: existing.value,
                    sourceFile: existing.sourceFile,
                    sourceLine: existing.sourceLine,
                    level: existing.level,
                });
            }
            switch (operator) {
                case "=":
                    entry.value = value;
                    entry.level = state.currentLevel;
                    entry.sourceFile = filePath;
                    entry.sourceLine = i - 1;
                    break;
                case ">": // append (path append with semicolon)
                    entry.value = entry.value ? `${entry.value};${value}` : value;
                    break;
                case "<": // prepend
                    entry.value = entry.value ? `${value};${entry.value}` : value;
                    break;
                case ":": // assign only if not defined
                    if (!existing) {
                        entry.value = value;
                        entry.level = state.currentLevel;
                        entry.sourceFile = filePath;
                        entry.sourceLine = i - 1;
                    }
                    break;
            }
            if (!existing)
                state.variables.set(varName, entry);
            node.variablesDefined.push(varName);
            continue;
        }
    }
    // Check for unclosed conditionals
    if (condStack.length > 0) {
        state.errors.push({
            file: filePath,
            line: lines.length,
            message: `${condStack.length} unclosed %if/%ifdef/%ifndef block(s) at end of file`,
            severity: "error",
        });
    }
    state.includeDepth--;
    return node;
}
// ─────────────────────────────────────────────────────────────────────────────
// Variable Resolution
// ─────────────────────────────────────────────────────────────────────────────
function resolveAllVariables(state) {
    for (const [name, entry] of state.variables) {
        try {
            entry.resolvedValue = resolveValue(entry.value, state, new Set([name]), entry.sourceFile, entry.sourceLine);
        }
        catch (e) {
            entry.resolvedValue = null;
            state.resolutionIssues.push({
                variable: name,
                value: entry.value,
                issue: e instanceof Error ? e.message : String(e),
                severity: "error",
                sourceFile: entry.sourceFile,
                sourceLine: entry.sourceLine,
            });
        }
        // Post-resolution checks
        if (entry.resolvedValue) {
            validateResolvedValue(name, entry, state);
        }
    }
}
function resolveValue(value, state, resolving, file, line) {
    // Handle semicolon-separated path lists
    if (value.includes(";")) {
        return value
            .split(";")
            .map((v) => resolveValue(v.trim(), state, resolving, file, line))
            .join(";");
    }
    // Replace $(VAR) references iteratively
    let result = value;
    let iterations = 0;
    while (result.includes("$(") && iterations < 20) {
        result = result.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (match, varName) => {
            if (resolving.has(varName)) {
                throw new Error(`Circular reference detected: ${varName} → ${Array.from(resolving).join(" → ")}`);
            }
            const ref = state.variables.get(varName);
            if (ref) {
                const childResolving = new Set([...resolving, varName]);
                return resolveValue(ref.value, state, childResolving, file, line);
            }
            const envVal = state.envVars.get(varName);
            if (envVal !== undefined)
                return envVal;
            return match; // leave unresolved
        });
        iterations++;
    }
    // Normalize path separators
    return result.replace(/\\/g, "/");
}
function expandVariables(value, state, file, line) {
    // Expand both $(VAR) and ${VAR} for use in directives/paths
    return value
        .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
        const v = state.variables.get(name);
        if (v)
            return expandVariables(v.value, state, file, line);
        const ev = state.envVars.get(name);
        if (ev !== undefined)
            return ev;
        return match;
    })
        .replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (match, name) => {
        const v = state.variables.get(name);
        if (v)
            return expandVariables(v.value, state, file, line);
        const ev = state.envVars.get(name);
        if (ev !== undefined)
            return ev;
        return match;
    });
}
function expandImmediate(value, state, file, line) {
    // Only expand ${VAR} (immediate), leave $(VAR) deferred
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
        const v = state.variables.get(name);
        if (v)
            return v.value;
        const ev = state.envVars.get(name);
        if (ev !== undefined)
            return ev;
        return match;
    });
}
// ─────────────────────────────────────────────────────────────────────────────
// Condition Evaluator
// ─────────────────────────────────────────────────────────────────────────────
function evaluateCondition(expr, state, file, line) {
    expr = expr.trim();
    // Handle && and || (simple left-to-right, no precedence)
    const andParts = expr.split("&&");
    if (andParts.length > 1) {
        return andParts.every((p) => evaluateCondition(p.trim(), state, file, line));
    }
    const orParts = expr.split("||");
    if (orParts.length > 1) {
        return orParts.some((p) => evaluateCondition(p.trim(), state, file, line));
    }
    // Handle !expr
    if (expr.startsWith("!")) {
        return !evaluateCondition(expr.slice(1).trim(), state, file, line);
    }
    // defined(VAR)
    const definedMatch = expr.match(/^defined\s*\(\s*([A-Za-z_]\w*)\s*\)$/i);
    if (definedMatch) {
        return (state.variables.has(definedMatch[1]) || state.macros.has(definedMatch[1]));
    }
    // exists(PATH)
    const existsMatch = expr.match(/^exists\s*\(([^)]+)\)$/i);
    if (existsMatch) {
        const p = normalizePath(expandVariables(existsMatch[1].trim(), state, file, line));
        // Support wildcard exists check
        if (p.includes("*")) {
            const dir = path.dirname(p);
            const pat = path.basename(p);
            return resolveWildcard(dir, pat, file).length > 0;
        }
        return fs.existsSync(p);
    }
    // Bare variable name — true if defined
    if (/^[A-Za-z_]\w*$/.test(expr)) {
        return state.variables.has(expr) || state.macros.has(expr);
    }
    return false;
}
// ─────────────────────────────────────────────────────────────────────────────
// Post-Resolution Validation
// ─────────────────────────────────────────────────────────────────────────────
const DIRECTORY_VARIABLES = new Set([
    "MS_RFDIR",
    "MS_CELLLIST",
    "MS_DGNLIB",
    "MS_PLOTFILES",
    "MS_PLTCFG",
    "MS_MDLAPPS",
    "MS_MACROS",
    "MS_PATTERN",
    "MS_GUIDATA",
    "MS_PRINT",
    "MS_PRINT_ORGANIZER",
    "MS_OUTPUT",
    "MS_BACKUP",
    "MS_MATERIAL",
    "MS_RENDERDATA",
    "_USTN_WORKSPACEROOT",
    "_USTN_WORKSPACESTANDARDS",
    "_USTN_WORKSETSROOT",
    "_USTN_WORKSETROOT",
    "_USTN_WORKSETSTANDARDS",
    "_USTN_WORKSETDATA",
    "_USTN_ORGANIZATION",
    "_USTN_CONFIGURATION",
    "_USTN_CUSTOM_CONFIGURATION",
    "_USTN_WORKSPACESROOT",
]);
const FILE_VARIABLES = new Set([
    "MS_DESIGNSEED",
    "MS_DWGSEED",
    "CIVIL_ROADWAY_TEMPLATE_LIBRARY",
    "MS_TASKNAVIGATORCFG",
    "_USTN_ROLECFG",
]);
function validateResolvedValue(name, entry, state) {
    const resolved = entry.resolvedValue;
    // Check for unresolved variable references
    const unresolvedRefs = resolved.match(/\$\([A-Za-z_]\w*\)/g);
    if (unresolvedRefs) {
        const unique = [...new Set(unresolvedRefs)];
        state.resolutionIssues.push({
            variable: name,
            value: resolved,
            issue: `Unresolved variable reference(s): ${unique.join(", ")}`,
            severity: "error",
            sourceFile: entry.sourceFile,
            sourceLine: entry.sourceLine,
        });
    }
    // Path variables: check paths exist on disk
    const paths = resolved.split(";").filter((p) => p.trim());
    for (const p of paths) {
        const cleanPath = p.trim();
        if (!cleanPath || cleanPath.includes("$("))
            continue; // still unresolved
        if (DIRECTORY_VARIABLES.has(name)) {
            if (!cleanPath.endsWith("/") && !cleanPath.endsWith("\\")) {
                state.resolutionIssues.push({
                    variable: name,
                    value: resolved,
                    issue: `Directory path should end with trailing slash: "${cleanPath}"`,
                    severity: "warning",
                    sourceFile: entry.sourceFile,
                    sourceLine: entry.sourceLine,
                });
            }
            const checkPath = cleanPath.replace(/[/\\]$/, "");
            if (checkPath && !fs.existsSync(checkPath) && !checkPath.includes("*")) {
                state.resolutionIssues.push({
                    variable: name,
                    value: resolved,
                    issue: `Directory does not exist: "${checkPath}"`,
                    severity: "warning",
                    sourceFile: entry.sourceFile,
                    sourceLine: entry.sourceLine,
                });
            }
        }
        else if (FILE_VARIABLES.has(name)) {
            if (!fs.existsSync(cleanPath) && !cleanPath.includes("*")) {
                state.resolutionIssues.push({
                    variable: name,
                    value: resolved,
                    issue: `File does not exist: "${cleanPath}"`,
                    severity: "warning",
                    sourceFile: entry.sourceFile,
                    sourceLine: entry.sourceLine,
                });
            }
        }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function seedVar(state, name, value, file, line, level) {
    state.variables.set(name, {
        name,
        value,
        resolvedValue: value,
        level,
        locked: false,
        sourceFile: file,
        sourceLine: line,
        overrideHistory: [],
    });
}
function parseLevelSpec(spec) {
    const n = parseInt(spec, 10);
    if (!isNaN(n) && n >= 0 && n <= 6)
        return n;
    const map = {
        system: 0,
        application: 1,
        organization: 2,
        workspace: 3,
        workset: 4,
        role: 5,
        user: 6,
    };
    return map[spec.toLowerCase()] ?? null;
}
function normalizePath(p) {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}
function findEntryFile(dir) {
    const candidates = [
        "ConfigurationSetup.cfg",
        "msconfig.cfg",
        "WorkSpaceSetup.cfg",
        "Standards.cfg",
    ];
    for (const c of candidates) {
        const full = path.join(dir, c);
        if (fs.existsSync(full))
            return full;
    }
    return null;
}
function resolveWildcard(dir, pattern, contextFile) {
    if (!fs.existsSync(dir))
        return [];
    try {
        const stat = fs.statSync(dir);
        if (!stat.isDirectory())
            return [];
        const regexPattern = pattern
            .replace(/\./g, "\\.")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");
        const regex = new RegExp(`^${regexPattern}$`, "i");
        return fs
            .readdirSync(dir)
            .filter((f) => regex.test(f))
            .map((f) => path.join(dir, f))
            .sort();
    }
    catch {
        return [];
    }
}
function compareWorkspaces(left, right) {
    const diffs = [];
    const allNames = new Set([
        ...left.variables.keys(),
        ...right.variables.keys(),
    ]);
    for (const name of Array.from(allNames).sort()) {
        const l = left.variables.get(name);
        const r = right.variables.get(name);
        if (!l) {
            diffs.push({
                name,
                kind: "added",
                rightValue: r.value,
                rightResolved: r.resolvedValue,
                rightFile: r.sourceFile,
                rightLine: r.sourceLine,
                rightLevel: r.level,
            });
        }
        else if (!r) {
            diffs.push({
                name,
                kind: "removed",
                leftValue: l.value,
                leftResolved: l.resolvedValue,
                leftFile: l.sourceFile,
                leftLine: l.sourceLine,
                leftLevel: l.level,
            });
        }
        else if (l.value !== r.value) {
            diffs.push({
                name,
                kind: "changed",
                leftValue: l.value,
                leftResolved: l.resolvedValue,
                leftFile: l.sourceFile,
                leftLine: l.sourceLine,
                leftLevel: l.level,
                rightValue: r.value,
                rightResolved: r.resolvedValue,
                rightFile: r.sourceFile,
                rightLine: r.sourceLine,
                rightLevel: r.level,
            });
        }
        else {
            diffs.push({
                name,
                kind: "unchanged",
                leftValue: l.value,
                leftResolved: l.resolvedValue,
                leftFile: l.sourceFile,
                rightFile: r.sourceFile,
            });
        }
    }
    return {
        diffs,
        addedCount: diffs.filter((d) => d.kind === "added").length,
        removedCount: diffs.filter((d) => d.kind === "removed").length,
        changedCount: diffs.filter((d) => d.kind === "changed").length,
        unchangedCount: diffs.filter((d) => d.kind === "unchanged").length,
        leftErrors: left.errors,
        rightErrors: right.errors,
    };
}
//# sourceMappingURL=cfgParser.js.map