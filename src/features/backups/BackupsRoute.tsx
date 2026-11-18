import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { DriveClient } from '@/integrations/google/drive'
import { useGoogleToken } from '@/integrations/google/tokenStore'
import { useOffline } from '@/offline/OfflineProvider'
import { supabaseTarget, type BackupRecord, type BackupTarget } from './api'
import { BackupsPage } from './BackupsPage'
import { driveTarget } from './drive'
import { GoogleDrivePanel } from './GoogleDrivePanel'

/** Backups screen with AuraStock cloud storage plus Google Drive while signed in to Google. */
export function BackupsRoute() {
  const token = useGoogleToken()
  const { snapshot } = useOffline()
  const folder = useQuery({
    queryKey: ['drive-folder', token?.token],
    queryFn: () => new DriveClient(token!.token).ensureFolder(),
    enabled: Boolean(token),
    staleTime: Infinity,
  })
  const folderId = folder.data ?? null

  const targetFor = useCallback(
    (record: BackupRecord): BackupTarget | null => {
      if (record.destination === 'supabase') return supabaseTarget
      return token && folderId ? driveTarget(new DriveClient(token.token), folderId) : null
    },
    [token, folderId],
  )

  return <BackupsPage targetFor={targetFor} extras={(page) => <GoogleDrivePanel page={page} folderId={folderId} online={snapshot.online} />} />
}
