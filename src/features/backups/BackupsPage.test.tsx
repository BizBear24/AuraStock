import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrgRole } from '@/domain/permissions'
import type { BackupRecord } from './api'

const api = {
  listBackups: vi.fn(),
  getSchedule: vi.fn(),
  setSchedule: vi.fn(),
  createBackup: vi.fn(),
  verifyBackup: vi.fn(),
  deleteBackup: vi.fn(),
  restoreBackup: vi.fn(),
}
let role: OrgRole = 'owner'
const setInventoryId = vi.fn()

vi.mock('./api', () => ({
  listBackups: (...a: unknown[]) => api.listBackups(...a),
  getSchedule: (...a: unknown[]) => api.getSchedule(...a),
  setSchedule: (...a: unknown[]) => api.setSchedule(...a),
  createBackup: (...a: unknown[]) => api.createBackup(...a),
  verifyBackup: (...a: unknown[]) => api.verifyBackup(...a),
  deleteBackup: (...a: unknown[]) => api.deleteBackup(...a),
  restoreBackup: (...a: unknown[]) => api.restoreBackup(...a),
  supabaseTarget: { destination: 'supabase', get: async () => '{}', put: async () => ({}), remove: async () => undefined },
}))
vi.mock('@/features/data/files', () => ({ downloadBlob: vi.fn() }))
vi.mock('@/offline/OfflineProvider', () => ({ useOffline: () => ({ snapshot: { online: true } }) }))
vi.mock('@/features/organizations/WorkspaceProvider', () => ({
  useWorkspace: () => ({ organization: { organizationId: 'org', organizationName: 'Acme', role }, role, setInventoryId }),
}))

const { BackupsPage } = await import('./BackupsPage')

const record = (over: Partial<BackupRecord> = {}): BackupRecord => ({
  id: 'b1',
  organization_id: 'org',
  kind: 'manual',
  destination: 'supabase',
  storage_path: 'org/b1.json',
  external_id: null,
  size_bytes: 2048,
  sha256: 'a'.repeat(64),
  format_version: 1,
  counts: { inventories: 2, products: 40, movements: 300 },
  created_at: '2026-11-18T10:00:00Z',
  verified_at: '2026-11-18T10:00:05Z',
  verify_error: null,
  ...over,
})

const validDoc = {
  format: 'aurastock-backup',
  version: 1,
  created_at: '2026-11-18T10:00:00Z',
  organization: { id: 'org', name: 'Acme' },
  inventories: [
    { id: 'inv', name: 'Main', is_demo: false },
    { id: 'demo', name: 'Demo Store', is_demo: true },
  ],
  categories: [],
  tags: [],
  products: [{ id: 'p1', inventory_id: 'inv', name: 'Rice', quantity: 2 }],
  product_tags: [],
  stock_movements: [{ id: 'm1', product_id: 'p1', created_at: '2026-11-01T00:00:00Z', delta: 2, quantity_before: 0, quantity_after: 2 }],
  transfers: [],
  transfer_lines: [],
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BackupsPage />
    </QueryClientProvider>,
  )

const chooseFile = (content: string) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([content], 'backup.json', { type: 'application/json' })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  role = 'owner'
  api.listBackups.mockResolvedValue([record(), record({ id: 'b2', kind: 'automatic', verified_at: null, verify_error: 'The stored file does not match its checksum.' })])
  api.getSchedule.mockResolvedValue(7)
})

describe('BackupsPage', () => {
  it('lists backups with their verification state and the schedule', async () => {
    show()
    expect(await screen.findByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('Check failed')).toBeInTheDocument()
    expect(screen.getByText('The stored file does not match its checksum.')).toBeInTheDocument()
    expect(screen.getAllByText(/2\.0 KB · 2 inventories · 40 products · 300 movements/)).toHaveLength(2)
    await waitFor(() => expect(screen.getByLabelText('Backup schedule')).toHaveValue('7'))
  })

  it('creates a backup and reports whether it verified', async () => {
    api.createBackup.mockResolvedValue({ id: 'b3', verified: true, verifyError: null, counts: { products: 40, movements: 300 }, size: 4096 })
    const user = userEvent.setup()
    show()
    await screen.findByText('Verified')
    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Backup created and verified: 40 products, 300 movements, 4.0 KB.')
    expect(api.createBackup).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org', kind: 'manual' }))
  })

  it('says so plainly when a new backup fails verification', async () => {
    api.createBackup.mockResolvedValue({ id: 'b3', verified: false, verifyError: 'The stored file does not match its checksum.', counts: {}, size: 1 })
    const user = userEvent.setup()
    show()
    await screen.findByText('Verified')
    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Backup stored but verification failed')
  })

  it('changes the schedule', async () => {
    api.setSchedule.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show()
    await waitFor(() => expect(screen.getByLabelText('Backup schedule')).toHaveValue('7'))
    await user.selectOptions(screen.getByLabelText('Backup schedule'), '1')
    await waitFor(() => expect(api.setSchedule).toHaveBeenCalledWith('org', 1))
    await user.selectOptions(screen.getByLabelText('Backup schedule'), 'off')
    await waitFor(() => expect(api.setSchedule).toHaveBeenCalledWith('org', null))
  })

  it('refuses invalid files before anything is restored', async () => {
    show()
    await screen.findByText('Verified')
    chooseFile('not json')
    expect(await screen.findByText('The file is not valid JSON.')).toBeInTheDocument()
    chooseFile(JSON.stringify({ ...validDoc, products: [{ ...validDoc.products[0], quantity: 5 }] }))
    expect(await screen.findByText(/"Rice" has quantity 5 but its history adds up to 2/)).toBeInTheDocument()
    expect(api.restoreBackup).not.toHaveBeenCalled()
  })

  it('previews a valid file and restores the chosen inventories as new copies', async () => {
    api.restoreBackup.mockResolvedValue({ inventories: [{ old_id: 'inv', new_id: 'new-1', name: 'Main (restored 2026-11-18)' }], products: 1, movements: 1 })
    const user = userEvent.setup()
    show()
    await screen.findByText('Verified')
    chooseFile(JSON.stringify(validDoc))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Nothing you have now is changed or deleted/)).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /Main/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Demo Store/ })).not.toBeChecked() // demo data is off by default
    await user.click(within(dialog).getByRole('button', { name: 'Restore 1 inventory' }))
    await waitFor(() => expect(api.restoreBackup).toHaveBeenCalledWith('org', expect.objectContaining({ format: 'aurastock-backup' }), ['inv']))
    expect(await within(dialog).findByText('Main (restored 2026-11-18)')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(setInventoryId).toHaveBeenCalledWith('new-1')
  })

  it('confirms before deleting a backup', async () => {
    api.deleteBackup.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show()
    await screen.findByText('Verified')
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/permanently deleted\. Your live data is not affected/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete backup' }))
    await waitFor(() => expect(api.deleteBackup).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), expect.anything()))
  })

  it('is for admins and owners only', () => {
    role = 'editor'
    show()
    expect(screen.getByText('Admins and owners only')).toBeInTheDocument()
    expect(api.listBackups).not.toHaveBeenCalled()
  })
})
