import { supabase } from '@/lib/supabase'
import { DriveClient } from '@/integrations/google/drive'
import type { BackupTarget } from './api'

export interface DriveConnection {
  account_email: string | null
  folder_id: string | null
  connected_at: string
}

/** Whether (and to which Google account) the organization connected Drive. No tokens are stored. */
export async function getDriveConnection(organizationId: string): Promise<DriveConnection | null> {
  const { data, error } = await supabase
    .from('integration_connections')
    .select('account_email, folder_id, connected_at')
    .eq('organization_id', organizationId)
    .eq('provider', 'google_drive')
    .maybeSingle<DriveConnection>()
  if (error) throw error
  return data
}

export async function saveDriveConnection(organizationId: string, accountEmail: string | null, folderId: string): Promise<void> {
  const { error } = await supabase.rpc('save_integration', { p_org: organizationId, p_provider: 'google_drive', p_account: accountEmail, p_folder: folderId })
  if (error) throw error
}

export async function removeDriveConnection(organizationId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_integration', { p_org: organizationId, p_provider: 'google_drive' })
  if (error) throw error
}

/** Backups stored as JSON files in the "AuraStock Backups" folder of the signed-in Google account. */
export function driveTarget(client: DriveClient, folderId: string): BackupTarget {
  return {
    destination: 'google_drive',
    async put(organizationId, backupId, fileName, text) {
      const file = await client.uploadJson(folderId, fileName, text, { aurastockOrg: organizationId, aurastockBackup: backupId })
      return { storagePath: null, externalId: file.id }
    },
    async get(record) {
      if (!record.external_id) throw new Error('This backup is not stored in Google Drive.')
      return client.downloadText(record.external_id)
    },
    async remove(record) {
      if (record.external_id) await client.deleteFile(record.external_id)
    },
  }
}
