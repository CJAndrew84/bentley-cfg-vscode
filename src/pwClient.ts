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
  /** WSG password or Bearer token */
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

function mapProject(inst: any): PwFolder {
  const p = inst.properties ?? {};
  return {
    instanceId: inst.instanceId ?? '',
    name: p.Name ?? p.Label ?? inst.instanceId,
    description: p.Description ?? '',
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
