import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { OrgRole } from '@/domain/permissions'

let role: OrgRole = 'owner'
vi.mock('@/features/organizations/WorkspaceProvider', () => ({ useWorkspace: () => ({ role }) }))
// AppShell pulls in providers that these tests do not need.
vi.mock('@/offline/OfflineProvider', () => ({ useOffline: () => ({ snapshot: {} }) }))
vi.mock('@/features/realtime/useRealtime', () => ({ useRealtime: () => 'live' }))

const { Sidebar, NAV_GROUPS } = await import('./AppShell')
const { MorePage } = await import('@/features/tools/MorePage')

const at = (path: string, ui: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

beforeEach(() => {
  role = 'owner'
  localStorage.clear()
})

describe('Sidebar', () => {
  it('puts the everyday work first and keeps admin folded away', () => {
    at('/', <Sidebar isAdmin />)
    const links = screen.getAllByRole('link').map((l) => l.textContent?.trim())
    expect(links.slice(0, 5)).toEqual(['Dashboard', 'Products', 'Scan', 'Movements', 'Transfers'])
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the admin group on request and remembers it', async () => {
    const user = userEvent.setup()
    const { unmount } = at('/', <Sidebar isAdmin />)
    await user.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByRole('link', { name: 'Backups' })).toBeInTheDocument()
    unmount()
    at('/', <Sidebar isAdmin />)
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument()
  })

  it('opens the admin group when you are on one of its pages', () => {
    at('/team', <Sidebar isAdmin />)
    expect(screen.getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides admin-only pages from members who cannot use them', () => {
    at('/settings', <Sidebar isAdmin={false} />)
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Activity' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Backups' })).toBeNull()
  })

  it('lists every page exactly once', () => {
    const paths = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to))
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('MorePage', () => {
  it('orders sections like the sidebar', () => {
    at('/more', <MorePage />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Everyday', 'Tools', 'Admin'])
    expect(within(screen.getByRole('region', { name: 'Admin' })).getByRole('link', { name: /Backups/ })).toBeInTheDocument()
  })

  it('hides admin-only pages from editors and viewers', () => {
    role = 'editor'
    at('/more', <MorePage />)
    expect(screen.queryByRole('link', { name: /Backups/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Activity/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Team/ })).toBeInTheDocument()
  })
})
