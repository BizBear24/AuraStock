import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Inventory } from './api'

const seedDemoData = vi.fn()
const removeDemoData = vi.fn()
const setInventoryId = vi.fn()
const purgeInventoryCache = vi.fn()

let workspace: { role: string; inventories: Inventory[] }
let online = true

vi.mock('./api', () => ({ seedDemoData: (...a: unknown[]) => seedDemoData(...a), removeDemoData: (...a: unknown[]) => removeDemoData(...a) }))
vi.mock('@/offline/local', () => ({ purgeInventoryCache: (...a: unknown[]) => purgeInventoryCache(...a) }))
vi.mock('@/offline/OfflineProvider', () => ({ useOffline: () => ({ snapshot: { online } }) }))
vi.mock('./WorkspaceProvider', () => ({
  useWorkspace: () => ({
    organization: { organizationId: 'org-1', organizationName: 'Acme', role: workspace.role },
    role: workspace.role,
    inventories: workspace.inventories,
    inventory: workspace.inventories[0] ?? null,
    setInventoryId,
  }),
}))

const { DemoDataPanel } = await import('./DemoDataPanel')

const inv = (over: Partial<Inventory> = {}): Inventory => ({
  id: 'inv-1',
  organization_id: 'org-1',
  name: 'Main',
  description: null,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  is_demo: false,
  ...over,
})

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DemoDataPanel />
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  online = true
  workspace = { role: 'owner', inventories: [inv()] }
})

describe('DemoDataPanel', () => {
  it('loads demo data when switched on and selects the new inventory', async () => {
    seedDemoData.mockResolvedValue('demo-1')
    const user = userEvent.setup()
    show()
    const toggle = screen.getByRole('switch', { name: 'Demo data' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    await waitFor(() => expect(setInventoryId).toHaveBeenCalledWith('demo-1'))
    expect(seedDemoData).toHaveBeenCalledWith('org-1')
  })

  it('asks for confirmation before removing, then removes and clears the on-device copy', async () => {
    removeDemoData.mockResolvedValue(1)
    purgeInventoryCache.mockResolvedValue(undefined)
    workspace = { role: 'admin', inventories: [inv(), inv({ id: 'demo-1', name: 'Demo Store (sample data)', is_demo: true })] }
    const user = userEvent.setup()
    show()
    const toggle = screen.getByRole('switch', { name: 'Demo data' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    expect(removeDemoData).not.toHaveBeenCalled()
    expect(screen.getByText(/Your real inventories are not affected/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove demo data' }))
    await waitFor(() => expect(removeDemoData).toHaveBeenCalledWith('org-1'))
    expect(purgeInventoryCache).toHaveBeenCalledWith('demo-1')
  })

  it('shows server errors', async () => {
    seedDemoData.mockRejectedValue({ message: 'Only admins and owners can load demo data' })
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('switch', { name: 'Demo data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only admins and owners can load demo data')
  })

  it('is disabled for members who cannot manage inventories and while offline', () => {
    workspace = { role: 'editor', inventories: [inv()] }
    const { unmount } = show()
    expect(screen.getByRole('switch', { name: 'Demo data' })).toBeDisabled()
    expect(screen.getByText(/Only admins and owners can change demo data/)).toBeInTheDocument()
    unmount()

    workspace = { role: 'owner', inventories: [inv()] }
    online = false
    show()
    expect(screen.getByRole('switch', { name: 'Demo data' })).toBeDisabled()
    expect(screen.getByText(/needs a connection/)).toBeInTheDocument()
  })
})
