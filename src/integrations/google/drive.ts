/** Minimal Google Drive v3 client for backup files. Uses the drive.file scope: only files this app created. */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const BACKUP_FOLDER_NAME = 'AuraStock Backups'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export class DriveError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'DriveError'
    this.status = status
  }
}

export interface DriveFile {
  id: string
  name: string
  size: number
  createdTime: string
  appProperties: Record<string, string>
}

interface RawFile {
  id: string
  name: string
  size?: string
  createdTime?: string
  appProperties?: Record<string, string>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Escape a value for a Drive search query string literal. */
export function driveQueryLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function buildMultipart(metadata: object, content: string, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

export class DriveClient {
  private readonly token: string
  private readonly fetchImpl: FetchLike

  constructor(token: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.token = token
    this.fetchImpl = fetchImpl
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchImpl(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } })
    if (!response.ok) {
      let message = `Google Drive request failed (${response.status}).`
      try {
        const body = (await response.json()) as { error?: { message?: string } }
        if (body.error?.message) message = `Google Drive: ${body.error.message}`
      } catch {
        // keep the generic message
      }
      if (response.status === 401) message = 'Your Google sign-in has expired. Sign in to Google Drive again.'
      throw new DriveError(response.status, message)
    }
    return response
  }

  async accountEmail(): Promise<string | null> {
    const r = await this.request(`${API}/about?fields=${encodeURIComponent('user(emailAddress)')}`)
    const body = (await r.json()) as { user?: { emailAddress?: string } }
    return body.user?.emailAddress ?? null
  }

  /** The app's backup folder in this Google account, created on first use. */
  async ensureFolder(name = BACKUP_FOLDER_NAME): Promise<string> {
    const q = `mimeType = ${driveQueryLiteral(FOLDER_MIME)} and name = ${driveQueryLiteral(name)} and trashed = false`
    const r = await this.request(`${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&spaces=drive&pageSize=10`)
    const { files } = (await r.json()) as { files: { id: string }[] }
    if (files[0]) return files[0].id
    const created = await this.request(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    })
    return ((await created.json()) as { id: string }).id
  }

  async uploadJson(folderId: string, name: string, content: string, appProperties: Record<string, string> = {}): Promise<DriveFile> {
    const boundary = `aurastock-${Math.random().toString(36).slice(2)}`
    const r = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent('id,name,size,createdTime,appProperties')}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: buildMultipart({ name, parents: [folderId], mimeType: 'application/json', appProperties }, content, boundary),
    })
    return toFile((await r.json()) as RawFile)
  }

  async listFolder(folderId: string): Promise<DriveFile[]> {
    const q = `${driveQueryLiteral(folderId)} in parents and trashed = false`
    const r = await this.request(
      `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,size,createdTime,appProperties)')}&orderBy=${encodeURIComponent('createdTime desc')}&pageSize=100&spaces=drive`,
    )
    const { files } = (await r.json()) as { files: RawFile[] }
    return files.map(toFile)
  }

  async downloadText(fileId: string): Promise<string> {
    const r = await this.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)
    return r.text()
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
  }
}

function toFile(f: RawFile): DriveFile {
  return { id: f.id, name: f.name, size: Number(f.size ?? 0), createdTime: f.createdTime ?? '', appProperties: f.appProperties ?? {} }
}
