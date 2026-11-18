import { buildMultipart, DriveClient, DriveError, driveQueryLiteral } from './drive'
import { DRIVE_SCOPE, loadGis, requestAccessToken, type GoogleOAuth2 } from './gis'
import { googleToken } from './tokenStore'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('DriveClient', () => {
  it('sends the bearer token and reads the account email', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ user: { emailAddress: 'me@gmail.com' } }))
    expect(await new DriveClient('tok', fetchImpl).accountEmail()).toBe('me@gmail.com')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('reuses the backup folder or creates it once', async () => {
    const existing = vi.fn().mockResolvedValue(json({ files: [{ id: 'folder-1' }] }))
    expect(await new DriveClient('t', existing).ensureFolder()).toBe('folder-1')
    expect(decodeURIComponent(existing.mock.calls[0]![0])).toContain("name = 'AuraStock Backups' and trashed = false")

    const fresh = vi.fn().mockResolvedValueOnce(json({ files: [] })).mockResolvedValueOnce(json({ id: 'folder-2' }))
    expect(await new DriveClient('t', fresh).ensureFolder()).toBe('folder-2')
    const [, init] = fresh.mock.calls[1]!
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'AuraStock Backups', mimeType: 'application/vnd.google-apps.folder' })
  })

  it('uploads JSON as a multipart request into the folder', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: 'file-1', name: 'b.json', size: '12', createdTime: '2026-11-18T10:00:00Z', appProperties: { aurastockBackup: 'b1' } }))
    const file = await new DriveClient('t', fetchImpl).uploadJson('folder-1', 'b.json', '{"a":1}', { aurastockBackup: 'b1' })
    expect(file).toEqual({ id: 'file-1', name: 'b.json', size: 12, createdTime: '2026-11-18T10:00:00Z', appProperties: { aurastockBackup: 'b1' } })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart/)
    const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])![1]!
    const parts = (init.body as string).split(`--${boundary}`)
    expect(JSON.parse(parts[1]!.split('\r\n\r\n')[1]!.trim())).toEqual({ name: 'b.json', parents: ['folder-1'], mimeType: 'application/json', appProperties: { aurastockBackup: 'b1' } })
    expect(parts[2]!.split('\r\n\r\n')[1]!.trim()).toBe('{"a":1}')
    expect((init.body as string).endsWith(`--${boundary}--\r\n`)).toBe(true)
  })

  it('lists, downloads and deletes files', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ files: [{ id: 'f1', name: 'x.json', size: '5', createdTime: 't' }] }))
      .mockResolvedValueOnce(new Response('{"backup":true}'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = new DriveClient('t', fetchImpl)
    expect(await client.listFolder("fold'er")).toEqual([{ id: 'f1', name: 'x.json', size: 5, createdTime: 't', appProperties: {} }])
    expect(decodeURIComponent(fetchImpl.mock.calls[0]![0])).toContain("'fold\\'er' in parents and trashed = false")
    expect(await client.downloadText('f1')).toBe('{"backup":true}')
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://www.googleapis.com/drive/v3/files/f1?alt=media')
    await client.deleteFile('f1')
    expect(fetchImpl.mock.calls[2]![1].method).toBe('DELETE')
  })

  it('turns failures into readable errors', async () => {
    const expired = new DriveClient('t', vi.fn().mockResolvedValue(json({ error: { message: 'Invalid Credentials' } }, 401)))
    await expect(expired.accountEmail()).rejects.toThrow('Your Google sign-in has expired')
    const quota = new DriveClient('t', vi.fn().mockResolvedValue(json({ error: { message: 'The user has exceeded their Drive storage quota' } }, 403)))
    await expect(quota.downloadText('x')).rejects.toMatchObject({ status: 403, message: 'Google Drive: The user has exceeded their Drive storage quota' })
    await expect(quota.downloadText('x')).rejects.toBeInstanceOf(DriveError)
  })

  it('escapes query literals and builds valid multipart bodies', () => {
    expect(driveQueryLiteral("it's")).toBe("'it\\'s'")
    expect(buildMultipart({ a: 1 }, 'x', 'B')).toBe('--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"a":1}\r\n--B\r\nContent-Type: application/json\r\n\r\nx\r\n--B--\r\n')
  })
})

describe('Google sign-in (token model)', () => {
  let lastConfig: Parameters<GoogleOAuth2['initTokenClient']>[0] | null
  let lastPrompt: string | undefined
  const fake: GoogleOAuth2 = {
    initTokenClient: (config) => {
      lastConfig = config
      return { requestAccessToken: (o) => void (lastPrompt = o?.prompt) }
    },
    hasGrantedAllScopes: (r, ...scopes) => scopes.every((s) => (r.scope ?? '').split(' ').includes(s)),
    revoke: (_t, done) => done?.(),
  }

  beforeEach(() => {
    lastConfig = null
    lastPrompt = undefined
    window.google = { accounts: { oauth2: fake } }
  })
  afterEach(() => {
    delete window.google
  })

  it('uses the already-loaded library', async () => {
    expect(await loadGis()).toBe(fake)
  })

  it('requests only the drive.file scope and returns a token that expires early', async () => {
    const pending = requestAccessToken('client-1', 'consent', () => 1_000)
    await vi.waitFor(() => expect(lastConfig).not.toBeNull())
    expect(lastConfig).toMatchObject({ client_id: 'client-1', scope: DRIVE_SCOPE })
    expect(lastPrompt).toBe('consent')
    lastConfig!.callback({ access_token: 'abc', expires_in: 3599, scope: `openid ${DRIVE_SCOPE}` })
    expect(await pending).toEqual({ token: 'abc', expiresAt: 1_000 + 3539 * 1000 })
  })

  it('fails clearly when Drive access was not granted or the popup closed', async () => {
    const denied = requestAccessToken('c')
    await vi.waitFor(() => expect(lastConfig).not.toBeNull())
    lastConfig!.callback({ access_token: 'abc', expires_in: 3600, scope: 'openid' })
    await expect(denied).rejects.toThrow('Google Drive access was not granted')

    lastConfig = null
    const closed = requestAccessToken('c')
    await vi.waitFor(() => expect(lastConfig).not.toBeNull())
    lastConfig!.error_callback!({ type: 'popup_closed' })
    await expect(closed).rejects.toThrow('The Google window was closed')
  })
})

describe('googleToken store', () => {
  it('forgets tokens once they expire', () => {
    googleToken.set({ token: 't', expiresAt: 5_000 }, 'me@gmail.com')
    expect(googleToken.get(4_000)?.email).toBe('me@gmail.com')
    expect(googleToken.get(5_000)).toBeNull()
    googleToken.clear()
  })
})
