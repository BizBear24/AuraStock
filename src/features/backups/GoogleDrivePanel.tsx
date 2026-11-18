import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Panel } from '@/components/ui/panel'
import { backupFileName } from '@/domain/backup'
import { errorMessage } from '@/lib/supabase'
import { downloadBlob } from '@/features/data/files'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { DriveClient, type DriveFile } from '@/integrations/google/drive'
import { googleClientId, isGoogleConfigured, requestAccessToken, revokeAccessToken } from '@/integrations/google/gis'
import { googleToken, useGoogleToken } from '@/integrations/google/tokenStore'
import { createBackup } from './api'
import type { BackupsPageApi } from './BackupsPage'
import { driveTarget, getDriveConnection, removeDriveConnection, saveDriveConnection } from './drive'

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Google Drive for backups. Access is granted in Google's own window with the narrow "drive.file" permission
 * (AuraStock can only see files it created). The access token stays in this tab's memory for about an hour.
 */
export function GoogleDrivePanel({ page, folderId, online }: { page: BackupsPageApi; folderId: string | null; online: boolean }) {
  const { organization } = useWorkspace()
  const queryClient = useQueryClient()
  const orgId = organization.organizationId
  const token = useGoogleToken()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const connection = useQuery({ queryKey: ['drive-connection', orgId], queryFn: () => getDriveConnection(orgId), enabled: isGoogleConfigured })
  const files = useQuery({
    queryKey: ['drive-files', orgId, token?.token, folderId],
    queryFn: () => new DriveClient(token!.token).listFolder(folderId!),
    enabled: Boolean(token && folderId),
  })

  const signIn = useMutation({
    mutationFn: async (prompt: '' | 'consent') => {
      const t = await requestAccessToken(googleClientId!, prompt)
      const client = new DriveClient(t.token)
      const email = await client.accountEmail()
      const folder = await client.ensureFolder()
      googleToken.set(t, email)
      const existing = connection.data
      if (!existing || existing.account_email !== email || existing.folder_id !== folder) await saveDriveConnection(orgId, email, folder)
      return email
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['drive-connection', orgId] })
      await queryClient.invalidateQueries({ queryKey: ['drive-folder'] })
    },
  })

  const backup = useMutation({
    mutationFn: () =>
      createBackup({
        organizationId: orgId,
        kind: 'manual',
        target: driveTarget(new DriveClient(token!.token), folderId!),
        fileName: (id) => backupFileName(organization.organizationName, new Date(), id),
      }),
    onSuccess: async (r) => {
      page.notify(r.verified ? 'ok' : 'error', r.verified ? 'Backup saved to Google Drive and verified.' : `Backup saved to Google Drive but verification failed: ${r.verifyError}`)
      await Promise.all([page.refresh(), files.refetch()])
    },
    onError: (e) => page.notify('error', errorMessage(e)),
  })

  const open = useMutation({
    mutationFn: (file: DriveFile) => new DriveClient(token!.token).downloadText(file.id),
    onSuccess: (text) => page.openRestore(text),
    onError: (e) => page.notify('error', errorMessage(e)),
  })
  const save = useMutation({
    mutationFn: async (file: DriveFile) => downloadBlob(new Blob([await new DriveClient(token!.token).downloadText(file.id)], { type: 'application/json' }), file.name),
    onError: (e) => page.notify('error', errorMessage(e)),
  })

  const disconnect = useMutation({
    mutationFn: async () => {
      if (token) await revokeAccessToken(token.token)
      googleToken.clear()
      await removeDriveConnection(orgId)
    },
    onSuccess: async () => {
      setConfirmDisconnect(false)
      await queryClient.invalidateQueries({ queryKey: ['drive-connection', orgId] })
    },
  })

  if (!isGoogleConfigured) {
    return (
      <Panel className="p-4">
        <h2 className="mb-1 font-semibold">Google Drive</h2>
        <p className="text-sm text-fg-2">
          Google Drive is not set up for this AuraStock installation. Whoever deploys the app needs to create a Google OAuth client and set <code>VITE_GOOGLE_CLIENT_ID</code> (see DEVELOPMENT.md). Your backups in AuraStock cloud storage work without it.
        </p>
      </Panel>
    )
  }

  const connected = connection.data
  const accountDiffers = Boolean(token && connected?.account_email && token.email !== connected.account_email)

  return (
    <Panel className="p-4">
      <h2 className="mb-1 font-semibold">Google Drive</h2>
      {!connected && !token && (
        <>
          <p className="mb-3 text-sm text-fg-2">
            Keep extra copies of your backups in your own Google Drive. Google asks for permission in its own window. AuraStock can only see the files it creates there, and your Google password is never shared with AuraStock.
          </p>
          <Button variant="primary" loading={signIn.isPending} disabled={!online} onClick={() => signIn.mutate('consent')}>
            Connect Google Drive
          </Button>
        </>
      )}
      {connected && !token && (
        <>
          <p className="mb-3 text-sm text-fg-2">
            Connected{connected.account_email ? <> to <b className="text-fg">{connected.account_email}</b></> : ''}. Sign in to Google on this device to use it. Access lasts about an hour at a time.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={signIn.isPending} disabled={!online} onClick={() => signIn.mutate('')}>
              Sign in to Google Drive
            </Button>
            <Button variant="ghost" disabled={!online} onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          </div>
        </>
      )}
      {token && (
        <>
          <p className="mb-3 text-sm text-fg-2">
            Signed in as <b className="text-fg">{token.email ?? 'your Google account'}</b>. Files go to the “AuraStock Backups” folder.
          </p>
          {accountDiffers && <p className="mb-3 text-sm text-warn">The organization was connected with {connected?.account_email}. Backups from this device go to {token.email}'s Drive.</p>}
          <div className="mb-3 flex flex-wrap gap-2">
            <Button variant="primary" loading={backup.isPending} disabled={!online || !folderId} onClick={() => backup.mutate()}>
              Back up to Google Drive
            </Button>
            <Button variant="ghost" disabled={!online} onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          </div>
          <h3 className="mb-1 text-sm font-medium">Backups in Google Drive</h3>
          {files.isPending && <p className="text-sm text-fg-2">Loading…</p>}
          {files.isError && <p role="alert" className="text-sm text-crit">{errorMessage(files.error)}</p>}
          {files.data && files.data.length === 0 && <p className="text-sm text-fg-2">No backups in Drive yet.</p>}
          <ul className="divide-y divide-line">
            {files.data?.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{f.name}</span>
                  <span className="num text-xs text-fg-2">
                    {f.createdTime ? new Date(f.createdTime).toLocaleString() : ''} · {formatSize(f.size)}
                  </span>
                </span>
                <span className="flex gap-1.5">
                  <Button size="sm" aria-label={`Download ${f.name}`} loading={save.isPending && save.variables?.id === f.id} onClick={() => save.mutate(f)}>
                    <Download className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button size="sm" loading={open.isPending && open.variables?.id === f.id} onClick={() => open.mutate(f)}>
                    Restore…
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(signIn.isError || disconnect.isError) && (
        <p role="alert" className="mt-2 text-sm text-crit">
          {errorMessage(signIn.error ?? disconnect.error)}
        </p>
      )}
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Drive?"
        description="AuraStock's access to your Drive is revoked on this device and the connection is removed for the organization. Files already in Google Drive stay there."
        confirmLabel="Disconnect"
        loading={disconnect.isPending}
        error={disconnect.isError ? errorMessage(disconnect.error) : null}
        onConfirm={() => disconnect.mutate()}
      />
    </Panel>
  )
}
