import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CloudUpload, Download, FileUp, ShieldAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { backupFileName, validateBackup, type BackupDocument, type InventorySummary } from '@/domain/backup'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { downloadBlob } from '@/features/data/files'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { useOffline } from '@/offline/OfflineProvider'
import { createBackup, deleteBackup, getSchedule, listBackups, setSchedule, supabaseTarget, verifyBackup, type BackupRecord, type BackupTarget } from './api'
import { RestorePanel } from './RestorePanel'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export interface BackupsPageProps {
  /** Resolves where a record's file lives; null when that store is not available right now (e.g. Drive not connected). */
  targetFor?: (record: BackupRecord) => BackupTarget | null
  /** Extra panels (the Google Drive integration plugs in here). */
  children?: ReactNode
}

export function BackupsPage({ targetFor = (r) => (r.destination === 'supabase' ? supabaseTarget : null), children }: BackupsPageProps) {
  const { organization, role } = useWorkspace()
  const { snapshot } = useOffline()
  const queryClient = useQueryClient()
  const orgId = organization.organizationId
  const allowed = can(role, 'org.manage')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [deleting, setDeleting] = useState<BackupRecord | null>(null)
  const [restoring, setRestoring] = useState<{ document: BackupDocument; inventories: InventorySummary[] } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const backups = useQuery({ queryKey: ['backups', orgId], queryFn: () => listBackups(orgId), enabled: allowed })
  const schedule = useQuery({ queryKey: ['backups', orgId, 'schedule'], queryFn: () => getSchedule(orgId), enabled: allowed })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['backups', orgId] })

  const create = useMutation({
    mutationFn: () =>
      createBackup({ organizationId: orgId, kind: 'manual', target: supabaseTarget, fileName: (id) => backupFileName(organization.organizationName, new Date(), id) }),
    onSuccess: async (r) => {
      setNotice(
        r.verified
          ? { tone: 'ok', text: `Backup created and verified: ${r.counts.products} products, ${r.counts.movements} movements, ${formatSize(r.size)}.` }
          : { tone: 'error', text: `Backup stored but verification failed: ${r.verifyError}` },
      )
      await refresh()
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  })

  const verify = useMutation({
    mutationFn: async (record: BackupRecord) => {
      const target = targetFor(record)
      if (!target) throw new Error('Connect Google Drive to check this backup.')
      return verifyBackup(record, target)
    },
    onSuccess: async (err) => {
      setNotice(err ? { tone: 'error', text: `Verification failed: ${err}` } : { tone: 'ok', text: 'Backup verified: checksum and contents are intact.' })
      await refresh()
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  })

  const fetchText = async (record: BackupRecord) => {
    const target = targetFor(record)
    if (!target) throw new Error('Connect Google Drive to open this backup.')
    return target.get(record)
  }

  const download = useMutation({
    mutationFn: async (record: BackupRecord) => {
      const text = await fetchText(record)
      downloadBlob(new Blob([text], { type: 'application/json' }), backupFileName(organization.organizationName, new Date(record.created_at), record.id))
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  })

  const openRestore = (text: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setFileError('The file is not valid JSON.')
      return
    }
    const check = validateBackup(parsed)
    if (!check.ok) {
      setFileError(check.errors.join(' '))
      return
    }
    setFileError(null)
    setRestoring({ document: check.document, inventories: check.inventories })
  }

  const restoreFromRecord = useMutation({
    mutationFn: fetchText,
    onSuccess: openRestore,
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  })

  const remove = useMutation({
    mutationFn: (record: BackupRecord) => deleteBackup(record, targetFor(record)),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
    },
  })

  const changeSchedule = useMutation({
    mutationFn: (days: number | null) => setSchedule(orgId, days),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups', orgId, 'schedule'] }),
  })

  if (!allowed) {
    return (
      <>
        <PageHeader title="Backups" />
        <EmptyState title="Admins and owners only" description="Backups contain the whole organization, so only admins and owners can create and restore them." />
      </>
    )
  }

  const offline = !snapshot.online
  const lastAuto = backups.data?.find((b) => b.kind === 'automatic')

  return (
    <>
      <PageHeader
        title="Backups"
        description={`${organization.organizationName} · verified copies of all inventories, products and stock history`}
        actions={
          <Button variant="primary" loading={create.isPending} disabled={offline} onClick={() => create.mutate()}>
            <CloudUpload className="h-4 w-4" aria-hidden /> Back up now
          </Button>
        }
      />
      {offline && <p role="alert" className="mb-3 text-sm text-warn">You are offline. Backups need a connection.</p>}
      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-md border px-3 py-2 text-sm ${notice.tone === 'error' ? 'border-crit text-crit' : 'border-ok text-ok'}`}>
          {notice.text}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Panel className="overflow-hidden">
          <h2 className="border-b border-line px-4 py-2 font-semibold">Backup history</h2>
          {backups.isPending && <LoadingState />}
          {backups.isError && <ErrorState message={errorMessage(backups.error)} onRetry={() => void backups.refetch()} />}
          {backups.data && backups.data.length === 0 && (
            <div className="p-4">
              <EmptyState title="No backups yet" description="Create one now, or turn on daily or weekly backups." />
            </div>
          )}
          <ul className="divide-y divide-line">
            {backups.data?.map((b) => {
              const available = targetFor(b) !== null
              return (
                <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="num">{new Date(b.created_at).toLocaleString()}</span>
                      <StatusBadge status="neutral">{b.kind === 'automatic' ? 'Scheduled' : 'Manual'}</StatusBadge>
                      <StatusBadge status="info">{b.destination === 'supabase' ? 'AuraStock cloud' : 'Google Drive'}</StatusBadge>
                      {b.verified_at ? (
                        <StatusBadge status="ok">Verified</StatusBadge>
                      ) : b.verify_error ? (
                        <StatusBadge status="crit">Check failed</StatusBadge>
                      ) : (
                        <StatusBadge status="warn">Not verified</StatusBadge>
                      )}
                    </p>
                    <p className="num text-xs text-fg-2">
                      {formatSize(b.size_bytes)} · {b.counts.inventories ?? '?'} inventories · {b.counts.products ?? '?'} products · {b.counts.movements ?? '?'} movements
                    </p>
                    {b.verify_error && <p className="mt-1 text-xs text-crit">{b.verify_error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" disabled={!available || offline} loading={verify.isPending && verify.variables?.id === b.id} onClick={() => verify.mutate(b)}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden /> Verify
                    </Button>
                    <Button size="sm" disabled={!available || offline} loading={download.isPending && download.variables?.id === b.id} onClick={() => download.mutate(b)}>
                      <Download className="h-4 w-4" aria-hidden /> Download
                    </Button>
                    <Button size="sm" disabled={!available || offline} loading={restoreFromRecord.isPending && restoreFromRecord.variables?.id === b.id} onClick={() => restoreFromRecord.mutate(b)}>
                      Restore…
                    </Button>
                    <Button size="sm" variant="ghost" disabled={offline} onClick={() => setDeleting(b)}>
                      Delete
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <h2 className="mb-1 font-semibold">Schedule</h2>
            <p className="mb-3 text-sm text-fg-2">
              Scheduled backups are taken by the app of any admin or owner who has AuraStock open when one is due. The newest 14 scheduled backups are kept.
            </p>
            <select
              aria-label="Backup schedule"
              className="h-9 w-full rounded-md border border-line bg-bg-2 px-2 text-sm"
              value={schedule.data == null ? 'off' : String(schedule.data)}
              disabled={schedule.isPending || changeSchedule.isPending || offline}
              onChange={(e) => changeSchedule.mutate(e.target.value === 'off' ? null : Number(e.target.value))}
            >
              <option value="off">Off</option>
              <option value="1">Daily</option>
              <option value="7">Weekly</option>
            </select>
            {changeSchedule.isError && <p role="alert" className="mt-2 text-sm text-crit">{errorMessage(changeSchedule.error)}</p>}
            <p className="mt-2 text-xs text-fg-2">Last scheduled backup: {lastAuto ? new Date(lastAuto.created_at).toLocaleString() : 'none yet'}</p>
          </Panel>

          <Panel className="p-4">
            <h2 className="mb-1 font-semibold">Restore from a file</h2>
            <p className="mb-3 text-sm text-fg-2">Choose a downloaded AuraStock backup (.json). It is checked before anything is restored.</p>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-bg-2 px-4 text-sm font-medium hover:bg-surface">
              <FileUp className="h-4 w-4" aria-hidden /> Choose backup file
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  if (file.size > 50 * 1024 * 1024) {
                    setFileError('The file is larger than 50 MB.')
                    return
                  }
                  void file.text().then(openRestore)
                }}
              />
            </label>
            {fileError && (
              <p role="alert" className="mt-2 flex gap-1.5 text-sm text-crit">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {fileError}
              </p>
            )}
          </Panel>

          {children}
        </div>
      </div>

      <Dialog open={restoring !== null} onOpenChange={(o) => !o && setRestoring(null)} title="Restore backup">
        {restoring && <RestorePanel document={restoring.document} inventories={restoring.inventories} onClose={() => setRestoring(null)} />}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this backup?"
        description={
          deleting && targetFor(deleting) === null
            ? 'The record will be removed. The file itself stays in Google Drive because Drive is not connected right now.'
            : 'The backup file will be permanently deleted. Your live data is not affected.'
        }
        confirmLabel="Delete backup"
        destructive
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  )
}
