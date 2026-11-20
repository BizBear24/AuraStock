import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import axe from 'axe-core'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Pages are rendered with their data layers mocked; the check is about markup, labels and roles.
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: vi.fn(), signUp: vi.fn(), requestPasswordReset: vi.fn(), updatePassword: vi.fn() }),
}))
vi.mock('@/features/organizations/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: 'owner',
    organization: { organizationId: 'org', organizationName: 'Acme', role: 'owner' },
    inventory: { id: 'inv', name: 'Main', is_demo: false },
    inventories: [{ id: 'inv', name: 'Main', is_demo: false }],
    setInventoryId: vi.fn(),
  }),
}))
vi.mock('@/offline/OfflineProvider', () => ({ useOffline: () => ({ snapshot: { online: true } }) }))
vi.mock('@/features/realtime/useRealtime', () => ({ useRealtime: () => 'live' }))

const { LoginPage, SignUpPage, ForgotPasswordPage } = await import('@/features/auth/AuthPages')
const { Sidebar } = await import('@/components/layout/AppShell')
const { MorePage } = await import('@/features/tools/MorePage')
const { CalculatorPage } = await import('@/features/tools/CalculatorPage')
const { ProductTagPanel } = await import('@/features/nfc/ProductTagPanel')
const { Field } = await import('@/components/ui/field')
const { Button } = await import('@/components/ui/button')
const { StatusBadge } = await import('@/components/ui/status-badge')
const { EmptyState, ErrorState } = await import('@/components/ui/states')

async function violations(ui: ReactNode) {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
  // Colour contrast needs real layout and is covered by src/styles/contrast.test.ts.
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
}

describe('accessibility (axe-core)', () => {
  it('really detects problems (control case)', async () => {
    const found = await violations(
      <div>
        <button type="button" />
        <input type="text" />
        <img src="x.png" />
      </div>,
    )
    expect(found.map((v) => v.split(':')[0])).toEqual(expect.arrayContaining(['button-name', 'label', 'image-alt']))
  })

  it.each([
    ['sign in', <LoginPage key="1" />],
    ['sign up', <SignUpPage key="2" />],
    ['password reset', <ForgotPasswordPage key="3" />],
    ['sidebar', <Sidebar key="4" isAdmin />],
    ['more page', <MorePage key="5" />],
    ['calculator', <CalculatorPage key="6" />],
    [
      'tags and labels',
      <ProductTagPanel
        key="7"
        product={{ id: 'p', name: 'Rice', sku: 'R-5', barcode: null, qr_code: null, unit: 'bag', nfc_uid: null } as never}
        canWrite
        online
      />,
    ],
    [
      'shared components',
      <div key="8">
        <Field label="Quantity" error="Required" />
        <Button>Save</Button>
        <Button loading>Saving</Button>
        <StatusBadge status="warn">Low stock</StatusBadge>
        <EmptyState title="Nothing yet" description="Add something." />
        <ErrorState message="It failed." onRetry={() => undefined} />
      </div>,
    ],
  ])('%s has no detectable violations', async (_name, ui) => {
    expect(await violations(ui)).toEqual([])
  })
})
