import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrgRole } from '@/domain/permissions'
import type { Invitation, Member, MyInvitation } from './api'

const api = {
  listMembers: vi.fn(),
  listInvitations: vi.fn(),
  inviteMember: vi.fn(),
  revokeInvitation: vi.fn(),
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
  leaveOrganization: vi.fn(),
  listMyInvitations: vi.fn(),
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
}

let myRole: OrgRole = 'owner'
let online = true

vi.mock('./api', () => ({
  listMembers: (...a: unknown[]) => api.listMembers(...a),
  listInvitations: (...a: unknown[]) => api.listInvitations(...a),
  inviteMember: (...a: unknown[]) => api.inviteMember(...a),
  revokeInvitation: (...a: unknown[]) => api.revokeInvitation(...a),
  setMemberRole: (...a: unknown[]) => api.setMemberRole(...a),
  removeMember: (...a: unknown[]) => api.removeMember(...a),
  leaveOrganization: (...a: unknown[]) => api.leaveOrganization(...a),
  listMyInvitations: (...a: unknown[]) => api.listMyInvitations(...a),
  acceptInvitation: (...a: unknown[]) => api.acceptInvitation(...a),
  declineInvitation: (...a: unknown[]) => api.declineInvitation(...a),
}))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('@/offline/OfflineProvider', () => ({ useOffline: () => ({ snapshot: { online } }) }))
vi.mock('@/features/organizations/WorkspaceProvider', () => ({
  useWorkspace: () => ({ organization: { organizationId: 'org', organizationName: 'Acme', role: myRole }, role: myRole }),
}))

const { TeamPage } = await import('./TeamPage')
const { InvitationsList } = await import('./InvitationsList')

const member = (user_id: string, role: OrgRole, name: string): Member => ({
  user_id,
  role,
  created_at: '2026-01-01T00:00:00Z',
  profile: { email: `${name.toLowerCase()}@x.test`, full_name: name },
})

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const showTeam = () =>
  render(
    <QueryClientProvider client={client()}>
      <TeamPage />
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  myRole = 'owner'
  online = true
  api.listMembers.mockResolvedValue([member('me', 'owner', 'Me'), member('u2', 'admin', 'Dana'), member('u3', 'editor', 'Eli'), member('u4', 'viewer', 'Val')])
  api.listInvitations.mockResolvedValue([] as Invitation[])
  api.listMyInvitations.mockResolvedValue([] as MyInvitation[])
})

describe('TeamPage as owner', () => {
  it('lists members and lets the owner change any role, with a clear confirmation of removal', async () => {
    api.setMemberRole.mockResolvedValue(undefined)
    api.removeMember.mockResolvedValue(undefined)
    const user = userEvent.setup()
    showTeam()
    expect(await screen.findByText('Dana')).toBeInTheDocument()
    expect(screen.getByText('(you)')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Role of eli@x.test'), 'admin')
    await waitFor(() => expect(api.setMemberRole).toHaveBeenCalledWith('org', 'u3', 'admin'))

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[2]!) // Val
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/val@x.test will lose access to Acme immediately/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove member' }))
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith('org', 'u4'))
  })

  it('stops the only owner from leaving or demoting themselves', async () => {
    showTeam()
    await screen.findByText('Dana')
    expect(screen.getByRole('button', { name: 'Leave organization' })).toBeDisabled()
    expect(screen.getByText(/only owner/)).toBeInTheDocument()
    expect(screen.getByLabelText('Role of me@x.test')).toBeDisabled()
  })

  it('invites by email with a chosen role and explains how the invitee joins', async () => {
    api.inviteMember.mockResolvedValue('inv-1')
    const user = userEvent.setup()
    showTeam()
    await screen.findByText('Dana')
    await user.type(screen.getByLabelText('Email'), 'new@x.test')
    await user.selectOptions(screen.getByLabelText('Role'), 'admin') // owners may invite admins
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(api.inviteMember).toHaveBeenCalledWith('org', 'new@x.test', 'admin'))
    expect(await screen.findByText(/Invitation saved for/)).toHaveTextContent('new@x.test')
  })

  it('validates the email and shows server errors', async () => {
    api.inviteMember.mockRejectedValue({ message: 'That person is already a member' })
    const user = userEvent.setup()
    showTeam()
    await screen.findByText('Dana')
    await user.type(screen.getByLabelText('Email'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(api.inviteMember).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'dana@x.test')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('That person is already a member')).toBeInTheDocument()
  })

  it('shows pending invitations and revokes them', async () => {
    api.listInvitations.mockResolvedValue([{ id: 'i1', email: 'later@x.test', role: 'editor', status: 'pending', created_at: '2026-11-01T00:00:00Z', expires_at: '2026-11-15T00:00:00Z' }])
    api.revokeInvitation.mockResolvedValue(undefined)
    const user = userEvent.setup()
    showTeam()
    expect(await screen.findByText('later@x.test')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(api.revokeInvitation).toHaveBeenCalledWith('i1'))
  })

  it('shows the permission matrix', async () => {
    showTeam()
    await screen.findByText('Dana')
    const row = screen.getByText('Delete the organization and manage admins and owners').closest('tr')!
    expect(within(row).getAllByLabelText('Allowed')).toHaveLength(1)
    expect(within(row).getAllByLabelText('Not allowed')).toHaveLength(3)
  })
})

describe('TeamPage as admin, editor and viewer', () => {
  it('admins manage only editors and viewers, and cannot invite admins', async () => {
    myRole = 'admin'
    api.listMembers.mockResolvedValue([member('me', 'admin', 'Me'), member('u1', 'owner', 'Olga'), member('u3', 'editor', 'Eli')])
    showTeam()
    await screen.findByText('Olga')
    expect(screen.queryByLabelText('Role of olga@x.test')).toBeNull() // owner: badge only
    expect(screen.queryByLabelText('Role of me@x.test')).toBeNull() // cannot change self
    expect(screen.getByLabelText('Role of eli@x.test')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    const roleSelect = screen.getByLabelText('Role')
    expect(within(roleSelect).queryByRole('option', { name: 'Admin' })).toBeNull()
    expect(within(roleSelect).getByRole('option', { name: 'Editor' })).toBeInTheDocument()
  })

  it('viewers see the team but get no management controls', async () => {
    myRole = 'viewer'
    showTeam()
    await screen.findByText('Dana')
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByText('Invite someone')).toBeNull()
    expect(screen.queryByText(/Pending invitations/)).toBeNull()
    expect(api.listInvitations).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/Role of/)).toBeNull()
  })
})

describe('InvitationsList', () => {
  const invite = (over: Partial<MyInvitation> = {}): MyInvitation => ({
    id: 'i1',
    organization_id: 'org-9',
    organization_name: 'Globex',
    role: 'editor',
    invited_by_name: 'Grace',
    created_at: '2026-11-01T00:00:00Z',
    expires_at: '2026-11-15T00:00:00Z',
    ...over,
  })
  const show = (onAccepted?: (id: string) => void) =>
    render(
      <QueryClientProvider client={client()}>
        <InvitationsList onAccepted={onAccepted} />
      </QueryClientProvider>,
    )

  it('renders nothing without invitations', async () => {
    const { container } = show()
    await waitFor(() => expect(api.listMyInvitations).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('accepts an invitation and reports the organization', async () => {
    api.listMyInvitations.mockResolvedValue([invite()])
    api.acceptInvitation.mockResolvedValue('org-9')
    const onAccepted = vi.fn()
    const user = userEvent.setup()
    show(onAccepted)
    expect(await screen.findByText(/invited you to join/)).toHaveTextContent('Grace invited you to join Globex as editor.')
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('org-9'))
    expect(api.acceptInvitation).toHaveBeenCalledWith('i1')
  })

  it('declines, and shows why an invitation cannot be accepted', async () => {
    api.listMyInvitations.mockResolvedValue([invite()])
    api.declineInvitation.mockResolvedValue(undefined)
    api.acceptInvitation.mockRejectedValue({ message: 'This invitation has expired. Ask for a new one.' })
    const user = userEvent.setup()
    show()
    await screen.findByText(/invited you to join/)
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation has expired')
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(api.declineInvitation).toHaveBeenCalledWith('i1'))
  })
})
