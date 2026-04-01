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
 * Auth: Basic (user:password) or BentleyIMS token
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
    /** Get one project/folder by GUID with full metadata when available. */
    async getProjectByGuid(projectGuid) {
        try {
            const data = await this.get(`/Project/${projectGuid}`);
            const inst = data?.instance ?? data;
            if (!inst)
                return null;
            return mapProject(inst);
        }
        catch {
            return null;
        }
    }
    /**
     * List documents in a folder with a Name/FileName LIKE filter.
     * Pattern accepts either WSG '%' wildcards or shell '*' wildcards.
     */
    async listDocumentsByNameLike(projectGuid, pattern) {
        const like = normaliseLikePattern(pattern);
        const fileNameFilter = `$filter=FileName+like+'${escapeFilterLiteral(like)}'`;
        try {
            const data = await this.get(`/Project/${projectGuid}/Document`, fileNameFilter);
            const docs = (data.instances ?? []).map(mapDocument);
            if (docs.length > 0)
                return docs;
        }
        catch {
            // fall through to Name fallback
        }
        const nameFilter = `$filter=Name+like+'${escapeFilterLiteral(like)}'`;
        const data = await this.get(`/Project/${projectGuid}/Document`, nameFilter);
        return (data.instances ?? []).map(mapDocument);
    }
    /** Download matching cfg/ucf/pcf docs by Name/FileName LIKE filter from one folder. */
    async fetchCfgFilesByNameLike(projectGuid, pattern) {
        const docs = await this.listDocumentsByNameLike(projectGuid, pattern);
        const cfgDocs = docs.filter(d => isCfgFile(d.fileName));
        const results = [];
        for (const doc of cfgDocs) {
            try {
                const content = await this.downloadDocumentContent(doc.instanceId);
                results.push({ pwPath: `/${doc.fileName}`, content });
            }
            catch {
                // skip undownloadable files
            }
        }
        return results;
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
    // ─── Write operations ───────────────────────────────────────────────────────
    /**
     * Create a sub-folder (Project) inside the given parent folder.
     * Uses POST to PW_WSG/Project with the parent GUID in the JSON body.
     */
    async createFolder(parentGuid, name, description = '') {
        const body = JSON.stringify({
            instance: {
                schemaName: 'PW_WSG',
                className: 'Project',
                properties: {
                    Name: name,
                    Description: description,
                    ParentGuid: parentGuid,
                },
            },
        });
        const data = await this.postJson('/Project', body);
        return mapProject(data.instance ?? data);
    }
    /**
     * Find an existing child folder by name, or create it if absent.
     * Returns the folder's instanceId and name.
     */
    async findOrCreateFolder(parentGuid, name) {
        const children = await this.listSubFolders(parentGuid);
        const existing = children.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (existing)
            return existing;
        return this.createFolder(parentGuid, name);
    }
    /**
     * Search for a document with a matching file name inside a folder.
     * Returns undefined when not found.
     */
    async findDocumentByName(folderGuid, fileName) {
        const docs = await this.listDocuments(folderGuid);
        return docs.find(d => d.fileName.toLowerCase() === fileName.toLowerCase());
    }
    /**
     * Create a new document (metadata only) inside a folder.
     * Call uploadDocumentContent() afterwards to attach the file bytes.
     */
    async createDocument(folderGuid, fileName, description = '') {
        const body = JSON.stringify({
            instance: {
                schemaName: 'PW_WSG',
                className: 'Document',
                properties: {
                    FileName: fileName,
                    Name: fileName,
                    Description: description,
                    ParentGuid: folderGuid,
                },
            },
        });
        const data = await this.postJson('/Document', body);
        return mapDocument(data.instance ?? data);
    }
    /**
     * PUT the raw file bytes to a document's $file endpoint.
     * Works for both initial upload and subsequent updates.
     */
    async uploadDocumentContent(docInstanceId, content) {
        const url = `${this.baseUrl}/Document/${docInstanceId}/$file`;
        await this.putRaw(url, Buffer.from(content, 'utf8'), 'application/octet-stream');
    }
    /**
     * Create-or-update a document in a folder.
     * If a document with the same file name already exists, its content is
     * replaced; otherwise a new document is created then uploaded.
     *
     * Returns the document metadata and whether it was newly created.
     */
    async upsertDocument(folderGuid, fileName, content) {
        const existing = await this.findDocumentByName(folderGuid, fileName);
        if (existing) {
            await this.uploadDocumentContent(existing.instanceId, content);
            return { doc: existing, created: false };
        }
        const doc = await this.createDocument(folderGuid, fileName);
        await this.uploadDocumentContent(doc.instanceId, content);
        return { doc, created: true };
    }
    // ─── Private helpers ─────────────────────────────────────────────────────────
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
    postJson(endpoint, body) {
        return new Promise((resolve, reject) => {
            const url = `${this.baseUrl}${endpoint}!poly`;
            const isHttps = url.startsWith('https');
            const lib = isHttps ? https : http;
            const options = {
                method: 'POST',
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
                rejectUnauthorized: !this.ignoreSsl,
            };
            const req = lib.request(url, options, res => {
                const chunks = [];
                res.on('data', (d) => chunks.push(d));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    if ((res.statusCode ?? 0) >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} POST ${endpoint}: ${text.slice(0, 300)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(text));
                    }
                    catch {
                        resolve({});
                    }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
            req.write(body);
            req.end();
        });
    }
    putRaw(url, body, contentType) {
        return new Promise((resolve, reject) => {
            const isHttps = url.startsWith('https');
            const lib = isHttps ? https : http;
            const options = {
                method: 'PUT',
                headers: {
                    ...this.headers,
                    'Content-Type': contentType,
                    'Content-Length': body.length,
                },
                rejectUnauthorized: !this.ignoreSsl,
            };
            const req = lib.request(url, options, res => {
                const chunks = [];
                res.on('data', (d) => chunks.push(d));
                res.on('end', () => {
                    if ((res.statusCode ?? 0) >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} PUT ${url}: ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`));
                        return;
                    }
                    resolve();
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(60000, () => { req.destroy(); reject(new Error('Upload timeout')); });
            req.write(body);
            req.end();
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
function normaliseLikePattern(pattern) {
    return (pattern || '*').replace(/\*/g, '%');
}
function escapeFilterLiteral(value) {
    return value.replace(/'/g, "''");
}
function mapProject(inst) {
    const p = inst.properties ?? {};
    const projectIdRaw = p.ProjectID ?? p.ProjectId ?? p.projectId ?? p.ID ?? p.Id;
    const parsedProjectId = Number.parseInt(String(projectIdRaw ?? ''), 10);
    return {
        instanceId: inst.instanceId ?? '',
        name: p.Name ?? p.Label ?? inst.instanceId,
        description: p.Description ?? '',
        code: p.Code ?? p.ProjectCode ?? p.code ?? '',
        projectId: Number.isFinite(parsedProjectId) ? parsedProjectId : undefined,
        fullPath: p.FullPath ?? p.Path ?? p.fullPath ?? '',
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