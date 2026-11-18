import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let configured = true
const requestAccessToken = vi.fn()
const revokeAccessToken = vi.fn()
const conn = { get: vi.fn(), save: vi.fn(), remove: vi.fn() }
const createBackup = vi.fn()
const drive = {
  accountEmail: vi.fn(),
  ensureFolder: vi.fn(),
  listFolder: vi.fn(),
  downloadText: vi.fn(),
}

vi.mock('@/integrations/google/gis', () => ({
  get isGoogleConfigured() {
    return configured
  },
  googleClientId: 'client-123',
  requestAccessToken: (...a: unknown[]) => requestAccessToken(...a),
  revokeAccessToken: (...a: unknown[]) => revokeAccessToken(...a),
}))
vi.mock('@/integrations/google/drive', () => ({
  DriveClient: class {
    accountEmail = drive.accountEmail
    ensureFolder = drive.ensureFolder
    listFolder = drive.listFolder
    downloadText = drive.downloadText
  },
}))
vi.mock('./drive', () => ({
  getDriveConnection: (...a: unknown[]) => conn.get(...a),
  saveDriveConnection: (...a: unknown[]) => conn.save(...a),
  removeDriveConnection: (...a: unknown[]) => conn.remove(...a),
  driveTarget: () => ({ destination: 'google_drive' }),
}))
vi.mock('./api', () => ({ createBackup: (...a: unknown[]) => createBackup(...a) }))
vi.mock('@/features/data/files', () => ({ downloadBlob: vi.fn() }))
vi.mock('@/features/organizations/WorkspaceProvider', () => ({ useWorkspace: () => ({ organization: { organizationId: 'org', organizationName: 'Acme' } }) }))

const { GoogleDrivePanel } = await import('./GoogleDrivePanel')
const { googleToken } = await import('@/integrations/google/tokenStore')

const page = { openRestore: vi.fn(), notify: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }
const show = (folderId: string | null = 'folder-1') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GoogleDrivePanel page={page} folderId={folderId} online />
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  googleToken.clear()
  configured = true
  conn.get.mockResolvedValue(null)
  drive.accountEmail.mockResolvedValue('me@gmail.com')
  drive.ensureFolder.mockResolvedValue('folder-1')
  drive.listFolder.mockResolvedValue([{ id: 'f1', name: 'aurastock-acme.json', size: 2048, createdTime: '2026-11-18T10:00:00Z', appProperties: {} }])
})

describe('GoogleDrivePanel', () => {
  it('says plainly when Google Drive is not set up, with no buttons that cannot work', () => {
    configured = false
    show()
    expect(screen.getByText(/not set up for this AuraStock installation/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('connects through Google consent and records only the account and folder', async () => {
    requestAccessToken.mockResolvedValue({ token: 'tok', expiresAt: Date.now() + 3_600_000 })
    conn.save.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive' }))
    await waitFor(() => expect(conn.save).toHaveBeenCalledWith('org', 'me@gmail.com', 'folder-1'))
    expect(requestAccessToken).toHaveBeenCalledWith('client-123', 'consent')
    expect(await screen.findByText('me@gmail.com')).toBeInTheDocument()
    expect(await screen.findByText('aurastock-acme.json')).toBeInTheDocument()
  })

  it('asks an already-connected organization to sign in on this device', async () => {
    conn.get.mockResolvedValue({ account_email: 'me@gmail.com', folder_id: 'folder-1', connected_at: '2026-11-01' })
    requestAccessToken.mockResolvedValue({ token: 'tok', expiresAt: Date.now() + 3_600_000 })
    const user = userEvent.setup()
    show()
    expect(await screen.findByText(/Sign in to Google on this device/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in to Google Drive' }))
    await waitFor(() => expect(requestAccessToken).toHaveBeenCalledWith('client-123', ''))
    expect(conn.save).not.toHaveBeenCalled() // same account and folder: nothing to update
  })

  it('backs up to Drive and restores from a Drive file', async () => {
    googleToken.set({ token: 'tok', expiresAt: Date.now() + 3_600_000 }, 'me@gmail.com')
    createBackup.mockResolvedValue({ verified: true, verifyError: null })
    drive.downloadText.mockResolvedValue('{"format":"aurastock-backup"}')
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Back up to Google Drive' }))
    await waitFor(() => expect(createBackup).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org', target: { destination: 'google_drive' } })))
    await waitFor(() => expect(page.notify).toHaveBeenCalledWith('ok', 'Backup saved to Google Drive and verified.'))
    await user.click(await screen.findByRole('button', { name: 'Restore…' }))
    await waitFor(() => expect(page.openRestore).toHaveBeenCalledWith('{"format":"aurastock-backup"}'))
  })

  it('disconnects by revoking access and removing the connection, after confirmation', async () => {
    googleToken.set({ token: 'tok', expiresAt: Date.now() + 3_600_000 }, 'me@gmail.com')
    conn.get.mockResolvedValue({ account_email: 'me@gmail.com', folder_id: 'folder-1', connected_at: '2026-11-01' })
    revokeAccessToken.mockResolvedValue(undefined)
    conn.remove.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Files already in Google Drive stay there/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(conn.remove).toHaveBeenCalledWith('org'))
    expect(revokeAccessToken).toHaveBeenCalledWith('tok')
    expect(googleToken.get()).toBeNull()
  })

  it('shows Google errors', async () => {
    requestAccessToken.mockRejectedValue(new Error('The Google window was closed before access was granted.'))
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The Google window was closed')
  })
})
