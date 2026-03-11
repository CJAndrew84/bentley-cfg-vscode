"use strict";
/**
 * ProjectWise WSG API Client
 *
 * Fetches .cfg / .ucf / .pcf files from a ProjectWise datasource
 * using the Web Services Gateway (WSG) REST API.
 *
 * WSG URL format:
 *   https://<server>/ws/v2.8/Repositories/Bentley.PW--<server>~3A<datasource>/PW_WSG/
 *
 * Auth: Basic (user:password) or Bearer token via Bentley IMS
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
exports.ProjectWiseClient = void 0;
exports.downloadManagedWorkspace = downloadManagedWorkspace;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ─────────────────────────────────────────────────────────────────────────────
// WSG Client
// ─────────────────────────────────────────────────────────────────────────────
class ProjectWiseClient {
    constructor(conn) {
        // Build full repo URL
        // Format: https://server/ws/v2.8/Repositories/Bentley.PW--server~3Adatasource
        const serverPart = conn.wsgUrl.replace(/\/$/, '');
        const encodedDs = `${extractHostname(serverPart)}~3A${conn.datasource}`;
        this.baseUrl = `${serverPart}/v2.8/Repositories/Bentley.PW--${encodedDs}/PW_WSG`;
        this.ignoreSsl = conn.ignoreSsl ?? false;
        this.headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };
        if (conn.authType === 'basic') {
            const encoded = Buffer.from(`${conn.username}:${conn.credential}`).toString('base64');
            this.headers['Authorization'] = `Basic ${encoded}`;
        }
        else {
            this.headers['Authorization'] = `Bearer ${conn.credential}`;
        }
    }
    /** List top-level Projects (folders) */
    async listProjects() {
        const data = await this.get('/Project');
        return (data.instances ?? []).map(mapProject);
    }
    /** List only Rich Projects (server-side filter when supported) */
    async listRichProjects() {
        try {
            const data = await this.get('/Project', `$filter=isRichProject+eq+'TRUE'`);
            return (data.instances ?? []).map(mapProject);
        }
        catch {
            const all = await this.listProjects();
            return all.filter(p => p.isRichProject);
        }
    }
    /** List sub-folders under a project GUID */
    async listSubFolders(projectGuid) {
        const data = await this.get(`/Project!poly?$filter=ProjectParent-forward-Project.$id+eq+'${projectGuid}'`);
        return (data.instances ?? []).map(mapProject);
    }
    /** List documents in a folder */
    async listDocuments(projectGuid) {
        const data = await this.get(`/Project/${projectGuid}/Document`);
        return (data.instances ?? []).map(mapDocument);
    }
    /** Download a document's file content as a string */
    async downloadDocumentContent(docInstanceId) {
        const url = `${this.baseUrl}/Document/${docInstanceId}/$file`;
        return this.getRaw(url);
    }
    /** Recursively fetch all .cfg files under a folder path */
    async fetchAllCfgFiles(rootFolderGuid) {
        const results = [];
        await this.walkFolder(rootFolderGuid, '/', results);
        return results;
    }
    async walkFolder(folderGuid, currentPath, results) {
        const [subFolders, docs] = await Promise.all([
            this.listSubFolders(folderGuid),
            this.listDocuments(folderGuid),
        ]);
        // Download CFG files
        const cfgDocs = docs.filter(d => isCfgFile(d.fileName));
        for (const doc of cfgDocs) {
            try {
                const content = await this.downloadDocumentContent(doc.instanceId);
                results.push({ pwPath: `${currentPath}${doc.fileName}`, content });
            }
            catch {
                // skip undownloadable files
            }
        }
        // Recurse
        for (const folder of subFolders) {
            await this.walkFolder(folder.instanceId, `${currentPath}${folder.name}/`, results);
        }
    }
    async get(endpoint, extraQuery) {
        const hasQuery = endpoint.includes('?');
        const queryPrefix = hasQuery ? '&' : '!poly?';
        const query = `$select=*${extraQuery ? `&${extraQuery}` : ''}`;
        const url = `${this.baseUrl}${endpoint}${queryPrefix}${query}`;
        const body = await this.getRaw(url);
        return JSON.parse(body);
    }
    getRaw(url) {
        return new Promise((resolve, reject) => {
            const isHttps = url.startsWith('https');
            const lib = isHttps ? https : http;
            const options = {
                headers: this.headers,
                rejectUnauthorized: !this.ignoreSsl,
            };
            const req = lib.get(url, options, res => {
                if (res.statusCode === 401) {
                    reject(new Error(`Authentication failed (401). Check credentials.`));
                    return;
                }
                if (res.statusCode === 403) {
                    reject(new Error(`Access denied (403). Check permissions.`));
                    return;
                }
                if ((res.statusCode ?? 0) >= 400) {
                    reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                    return;
                }
                const chunks = [];
                res.on('data', (d) => chunks.push(d));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
        });
    }
}
exports.ProjectWiseClient = ProjectWiseClient;
// ─────────────────────────────────────────────────────────────────────────────
// Managed Workspace Local Cache
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Download all CFG files from ProjectWise and write them to a temp directory
 * so the local parser can process them identically to a file system workspace.
 */
async function downloadManagedWorkspace(client, rootFolderGuid, targetDir) {
    const dir = targetDir ?? path.join(os.tmpdir(), `pw-workspace-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const files = await client.fetchAllCfgFiles(rootFolderGuid);
    for (const { pwPath, content } of files) {
        const localPath = path.join(dir, ...pwPath.split('/').filter(Boolean));
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, content, 'utf8');
    }
    return dir;
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function extractHostname(wsgUrl) {
    try {
        return stripWsSuffix(new URL(wsgUrl).hostname);
    }
    catch {
        return stripWsSuffix(wsgUrl.replace(/^https?:\/\//, '').split('/')[0]);
    }
}
function stripWsSuffix(hostname) {
    return hostname.replace(/-ws(?=\.|$)/i, '');
}
function isCfgFile(name) {
    return /\.(cfg|ucf|pcf)$/i.test(name);
}
function mapProject(inst) {
    const p = inst.properties ?? {};
    return {
        instanceId: inst.instanceId ?? '',
        name: p.Name ?? p.Label ?? inst.instanceId,
        description: p.Description ?? '',
        parentGuid: p.ParentGuid ?? '',
        isRichProject: toBool(p.IsRichProject ?? p.isRichProject),
    };
}
function toBool(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string')
        return value.toLowerCase() === 'true';
    if (typeof value === 'number')
        return value !== 0;
    return false;
}
function mapDocument(inst) {
    const p = inst.properties ?? {};
    return {
        instanceId: inst.instanceId ?? '',
        name: p.Name ?? '',
        fileName: p.FileName ?? p.Name ?? '',
        description: p.Description ?? '',
        updateTime: p.UpdateTime ?? '',
        fileSize: parseInt(p.FileSize ?? '0', 10),
        parentGuid: p.ParentGuid ?? '',
        path: '',
    };
}
//# sourceMappingURL=pwClient.js.map