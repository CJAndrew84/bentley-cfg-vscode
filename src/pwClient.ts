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

import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PwConnection {
  /** e.g. https://pw-server.company.com/ws */
  wsgUrl: string;
  /** Datasource name, e.g. "pwdb" */
  datasource: string;
  /** WSG username */
  username: string;
  /** WSG password or BentleyIMS token */
  credential: string;
  /** 'basic' | 'bearer' */
  authType: 'basic' | 'bearer';
  /** Ignore SSL errors (self-signed certs common on-prem) */
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
  path: string; // logical PW path
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

// ─────────────────────────────────────────────────────────────────────────────
// WSG Client
// ─────────────────────────────────────────────────────────────────────────────

export class ProjectWiseClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private ignoreSsl: boolean;

  constructor(conn: PwConnection) {
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
    } else {
      this.headers['Authorization'] = `Bearer ${conn.credential}`;
    }
  }

  /** List top-level Projects (folders) */
  async listProjects(): Promise<PwFolder[]> {
    const data = await this.get('/Project');
    return (data.instances ?? []).map(mapProject);
  }

  /** List only Rich Projects (server-side filter when supported) */
  async listRichProjects(): Promise<PwFolder[]> {
    try {
      const data = await this.get('/Project', `$filter=isRichProject+eq+'TRUE'`);
      return (data.instances ?? []).map(mapProject);
    } catch {
      const all = await this.listProjects();
      return all.filter(p => p.isRichProject);
    }
  }

  /** List sub-folders under a project GUID */
  async listSubFolders(projectGuid: string): Promise<PwFolder[]> {
    const data = await this.get(
      `/Project!poly?$filter=ProjectParent-forward-Project.$id+eq+'${projectGuid}'`
    );
    return (data.instances ?? []).map(mapProject);
  }

  /** List documents in a folder */
  async listDocuments(projectGuid: string): Promise<PwDocument[]> {
    const data = await this.get(`/Project/${projectGuid}/Document`);
    return (data.instances ?? []).map(mapDocument);
  }

  /** Get one project/folder by GUID with full metadata when available. */
  async getProjectByGuid(projectGuid: string): Promise<PwFolder | null> {
    try {
      const data = await this.get(`/Project/${projectGuid}`);
      const inst = data?.instance ?? data;
      if (!inst) return null;
      return mapProject(inst);
    } catch {
      return null;
    }
  }

  /**
   * List documents in a folder with a Name/FileName LIKE filter.
   * Pattern accepts either WSG '%' wildcards or shell '*' wildcards.
   */
  async listDocumentsByNameLike(projectGuid: string, pattern: string): Promise<PwDocument[]> {
    const like = normaliseLikePattern(pattern);
    const fileNameFilter = `$filter=FileName+like+'${escapeFilterLiteral(like)}'`;
    try {
      const data = await this.get(`/Project/${projectGuid}/Document`, fileNameFilter);
      const docs = (data.instances ?? []).map(mapDocument);
      if (docs.length > 0) return docs;
    } catch {
      // fall through to Name fallback
    }

    const nameFilter = `$filter=Name+like+'${escapeFilterLiteral(like)}'`;
    const data = await this.get(`/Project/${projectGuid}/Document`, nameFilter);
    return (data.instances ?? []).map(mapDocument);
  }

  /** Download matching cfg/ucf/pcf docs by Name/FileName LIKE filter from one folder. */
  async fetchCfgFilesByNameLike(projectGuid: string, pattern: string): Promise<Array<{ pwPath: string; content: string }>> {
    const docs = await this.listDocumentsByNameLike(projectGuid, pattern);
    const cfgDocs = docs.filter(d => isCfgFile(d.fileName));
    const results: Array<{ pwPath: string; content: string }> = [];

    for (const doc of cfgDocs) {
      try {
        const content = await this.downloadDocumentContent(doc.instanceId);
        results.push({ pwPath: `/${doc.fileName}`, content });
      } catch {
        // skip undownloadable files
      }
    }
    return results;
  }

  /** Download a document's file content as a string */
  async downloadDocumentContent(docInstanceId: string): Promise<string> {
    const url = `${this.baseUrl}/Document/${docInstanceId}/$file`;
    return this.getRaw(url);
  }

  /** Recursively fetch all .cfg files under a folder path */
  async fetchAllCfgFiles(rootFolderGuid: string): Promise<Array<{ pwPath: string; content: string }>> {
    const results: Array<{ pwPath: string; content: string }> = [];
    await this.walkFolder(rootFolderGuid, '/', results);
    return results;
  }

  private async walkFolder(
    folderGuid: string,
    currentPath: string,
    results: Array<{ pwPath: string; content: string }>
  ): Promise<void> {
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
      } catch {
        // skip undownloadable files
      }
    }

    // Recurse
    for (const folder of subFolders) {
      await this.walkFolder(folder.instanceId, `${currentPath}${folder.name}/`, results);
    }
  }

  private async get(endpoint: string, extraQuery?: string): Promise<any> {
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
  async createFolder(parentGuid: string, name: string, description: string = ''): Promise<PwFolder> {
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
  async findOrCreateFolder(parentGuid: string, name: string): Promise<PwFolder> {
    const children = await this.listSubFolders(parentGuid);
    const existing = children.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    return this.createFolder(parentGuid, name);
  }

  /**
   * Search for a document with a matching file name inside a folder.
   * Returns undefined when not found.
   */
  async findDocumentByName(folderGuid: string, fileName: string): Promise<PwDocument | undefined> {
    const docs = await this.listDocuments(folderGuid);
    return docs.find(d => d.fileName.toLowerCase() === fileName.toLowerCase());
  }

  /**
   * Create a new document (metadata only) inside a folder.
   * Call uploadDocumentContent() afterwards to attach the file bytes.
   */
  async createDocument(folderGuid: string, fileName: string, description: string = ''): Promise<PwDocument> {
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
  async uploadDocumentContent(docInstanceId: string, content: string): Promise<void> {
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
  async upsertDocument(
    folderGuid: string,
    fileName: string,
    content: string,
  ): Promise<{ doc: PwDocument; created: boolean }> {
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

  private getRaw(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const lib = isHttps ? https : http;
      const options: https.RequestOptions = {
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
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    });
  }

  private postJson(endpoint: string, body: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${endpoint}!poly`;
      const isHttps = url.startsWith('https');
      const lib = isHttps ? https : http;
      const options: https.RequestOptions = {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        rejectUnauthorized: !this.ignoreSsl,
      };
      const req = lib.request(url, options, res => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode} POST ${endpoint}: ${text.slice(0, 300)}`));
            return;
          }
          try { resolve(JSON.parse(text)); } catch { resolve({}); }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(body);
      req.end();
    });
  }

  private putRaw(url: string, body: Buffer, contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const lib = isHttps ? https : http;
      const options: https.RequestOptions = {
        method: 'PUT',
        headers: {
          ...this.headers,
          'Content-Type': contentType,
          'Content-Length': body.length,
        },
        rejectUnauthorized: !this.ignoreSsl,
      };
      const req = lib.request(url, options, res => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
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

// ─────────────────────────────────────────────────────────────────────────────
// Managed Workspace Local Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download all CFG files from ProjectWise and write them to a temp directory
 * so the local parser can process them identically to a file system workspace.
 */
export async function downloadManagedWorkspace(
  client: ProjectWiseClient,
  rootFolderGuid: string,
  targetDir?: string
): Promise<string> {
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

function extractHostname(wsgUrl: string): string {
  try {
    return stripWsSuffix(new URL(wsgUrl).hostname);
  } catch {
    return stripWsSuffix(wsgUrl.replace(/^https?:\/\//, '').split('/')[0]);
  }
}

function stripWsSuffix(hostname: string): string {
  return hostname.replace(/-ws(?=\.|$)/i, '');
}

function isCfgFile(name: string): boolean {
  return /\.(cfg|ucf|pcf)$/i.test(name);
}

function normaliseLikePattern(pattern: string): string {
  return (pattern || '*').replace(/\*/g, '%');
}

function escapeFilterLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function mapProject(inst: any): PwFolder {
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

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (typeof value === 'number') return value !== 0;
  return false;
}

function mapDocument(inst: any): PwDocument {
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

// ─────────────────────────────────────────────────────────────────────────────
// Connection Store (saved connections in VS Code globalState)
// ─────────────────────────────────────────────────────────────────────────────

export interface SavedConnection {
  id: string;
  label: string;
  wsgUrl: string;
  datasource: string;
  username: string;
  /** Note: password stored only in VS Code SecretStorage, not here */
  authType: 'basic' | 'bearer';
  ignoreSsl: boolean;
  lastUsed?: string;
}
