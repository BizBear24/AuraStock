import { BACKUP_VERSION, countBackup, sha256Hex, utf8Size, validateBackup, type BackupCounts, type BackupDocument } from '@/domain/backup'
import { supabase } from '@/lib/supabase'

export const BUCKET = 'backups'

export interface BackupRecord {
  id: string
  organization_id: string
  kind: 'manual' | 'automatic'
  destination: 'supabase' | 'google_drive'
  storage_path: string | null
  external_id: string | null
  size_bytes: number
  sha256: string
  format_version: number
  counts: Partial<BackupCounts>
  created_at: string
  verified_at: string | null
  verify_error: string | null
}

export async function listBackups(organizationId: string): Promise<BackupRecord[]> {
  const { data, error } = await supabase
    .from('backup_records')
    .select('id, organization_id, kind, destination, storage_path, external_id, size_bytes, sha256, format_version, counts, created_at, verified_at, verify_error')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .returns<BackupRecord[]>()
  if (error) throw error
  return data
}

export async function getSchedule(organizationId: string): Promise<number | null> {
  const { data, error } = await supabase.from('organizations').select('backup_interval_days').eq('id', organizationId).single<{ backup_interval_days: number | null }>()
  if (error) throw error
  return data.backup_interval_days
}

export async function setSchedule(organizationId: string, days: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_backup_schedule', { p_org: organizationId, p_days: days })
  if (error) throw error
}

export async function claimAutoBackup(organizationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_auto_backup', { p_org: organizationId })
  if (error) throw error
  return Boolean(data)
}

export interface RestoreResult {
  inventories: { old_id: string; new_id: string; name: string }[]
  products: number
  movements: number
}

export async function restoreBackup(organizationId: string, document: BackupDocument, inventoryIds: string[] | null): Promise<RestoreResult> {
  const { data, error } = await supabase.rpc('restore_backup', { p_org: organizationId, p_backup: document, p_inventory_ids: inventoryIds })
  if (error) throw error
  return data as RestoreResult
}

// ------------------------------------------------------------------ service

/** Where a backup file lives. Supabase Storage is built in; Google Drive is provided by the Drive integration. */
export interface BackupTarget {
  destination: 'supabase' | 'google_drive'
  /** Stores the file and returns its location (storage path or Drive file id). */
  put: (organizationId: string, backupId: string, fileName: string, text: string) => Promise<{ storagePath: string | null; externalId: string | null }>
  /** Reads the stored file back. */
  get: (record: Pick<BackupRecord, 'storage_path' | 'external_id'>) => Promise<string>
  remove: (record: Pick<BackupRecord, 'storage_path' | 'external_id'>) => Promise<void>
}

export const supabaseTarget: BackupTarget = {
  destination: 'supabase',
  async put(organizationId, backupId, _fileName, text) {
    const path = `${organizationId}/${backupId}.json`
    const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([text], { type: 'application/json' }), { contentType: 'application/json', upsert: false })
    if (error) throw error
    return { storagePath: path, externalId: null }
  },
  async get(record) {
    if (!record.storage_path) throw new Error('This backup is not stored in AuraStock cloud storage.')
    const { data, error } = await supabase.storage.from(BUCKET).download(record.storage_path)
    if (error) throw error
    return data.text()
  },
  async remove(record) {
    if (!record.storage_path) return
    const { error } = await supabase.storage.from(BUCKET).remove([record.storage_path])
    if (error) throw error
  },
}

export interface BackupDeps {
  exportDocument: (organizationId: string) => Promise<BackupDocument>
  register: (input: {
    organizationId: string
    id: string
    kind: 'manual' | 'automatic'
    destination: 'supabase' | 'google_drive'
    storagePath: string | null
    externalId: string | null
    size: number
    sha256: string
    counts: BackupCounts
  }) => Promise<void>
  markVerified: (backupId: string, ok: boolean, error: string | null) => Promise<void>
  newId: () => string
}

export const defaultDeps: BackupDeps = {
  async exportDocument(organizationId) {
    const { data, error } = await supabase.rpc('export_org_backup', { p_org: organizationId })
    if (error) throw error
    return data as BackupDocument
  },
  async register(i) {
    const { error } = await supabase.rpc('register_backup', {
      p_org: i.organizationId,
      p_id: i.id,
      p_kind: i.kind,
      p_destination: i.destination,
      p_storage_path: i.storagePath,
      p_external_id: i.externalId,
      p_size: i.size,
      p_sha256: i.sha256,
      p_format_version: BACKUP_VERSION,
      p_counts: i.counts,
    })
    if (error) throw error
  },
  async markVerified(backupId, ok, error) {
    const { error: e } = await supabase.rpc('mark_backup_verified', { p_backup: backupId, p_ok: ok, p_error: error })
    if (e) throw e
  },
  newId: () => crypto.randomUUID(),
}

export interface CreatedBackup {
  id: string
  verified: boolean
  verifyError: string | null
  counts: BackupCounts
  size: number
}

/** Check a stored backup by reading it back: same checksum as recorded, and a consistent document. */
export async function checkStoredBackup(text: string, expectedSha: string): Promise<string | null> {
  const actual = await sha256Hex(text)
  if (actual !== expectedSha) return 'The stored file does not match its checksum.'
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'The stored file is not valid JSON.'
  }
  const check = validateBackup(parsed)
  return check.ok ? null : `The stored backup is inconsistent: ${check.errors[0]}`
}

/**
 * Create a backup end to end: export, store the exact bytes, record size and checksum, then read the file
 * back and verify it. The result says whether verification succeeded; a backup is only "verified" after that.
 */
export async function createBackup(
  input: { organizationId: string; fileName: (id: string) => string; kind: 'manual' | 'automatic'; target: BackupTarget },
  deps: BackupDeps = defaultDeps,
): Promise<CreatedBackup> {
  const document = await deps.exportDocument(input.organizationId)
  const text = JSON.stringify(document)
  const sha = await sha256Hex(text)
  const size = utf8Size(text)
  const counts = countBackup(document)
  const id = deps.newId()

  const location = await input.target.put(input.organizationId, id, input.fileName(id), text)
  await deps.register({ organizationId: input.organizationId, id, kind: input.kind, destination: input.target.destination, storagePath: location.storagePath, externalId: location.externalId, size, sha256: sha, counts })

  let verifyError: string | null
  try {
    verifyError = await checkStoredBackup(await input.target.get({ storage_path: location.storagePath, external_id: location.externalId }), sha)
  } catch (e) {
    verifyError = `The stored file could not be read back: ${e instanceof Error ? e.message : String(e)}`
  }
  await deps.markVerified(id, verifyError === null, verifyError)
  return { id, verified: verifyError === null, verifyError, counts, size }
}

/** Re-check an existing backup and record the result. */
export async function verifyBackup(record: BackupRecord, target: BackupTarget, deps: Pick<BackupDeps, 'markVerified'> = defaultDeps): Promise<string | null> {
  let error: string | null
  try {
    error = await checkStoredBackup(await target.get(record), record.sha256)
  } catch (e) {
    error = `The stored file could not be read: ${e instanceof Error ? e.message : String(e)}`
  }
  await deps.markVerified(record.id, error === null, error)
  return error
}

export async function deleteBackup(record: BackupRecord, target: BackupTarget | null): Promise<void> {
  if (target) await target.remove(record)
  const { error } = await supabase.rpc('delete_backup_record', { p_backup: record.id })
  if (error) throw error
}
