import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { backupFileName, backupsToPrune } from '@/domain/backup'
import { can, type OrgRole } from '@/domain/permissions'
import { claimAutoBackup, createBackup, deleteBackup, listBackups, supabaseTarget } from './api'

const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * Scheduled backups. When an organization has a daily or weekly schedule, the app of any admin or owner who
 * has AuraStock open takes the backup once it is due. claim_auto_backup() in the database makes sure only one
 * tab or person does it per period. Older automatic backups beyond the newest 14 are removed afterwards.
 */
export function useAutoBackup(organizationId: string, organizationName: string, role: OrgRole, online: boolean): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!online || !can(role, 'org.manage')) return
    let cancelled = false

    const run = async () => {
      try {
        if (!(await claimAutoBackup(organizationId)) || cancelled) return
        await createBackup({
          organizationId,
          kind: 'automatic',
          target: supabaseTarget,
          fileName: (id) => backupFileName(organizationName, new Date(), id),
        })
        for (const old of backupsToPrune(await listBackups(organizationId))) {
          await deleteBackup(old, old.destination === 'supabase' ? supabaseTarget : null)
        }
        await queryClient.invalidateQueries({ queryKey: ['backups', organizationId] })
      } catch (e) {
        // A failed attempt is retried after the claim expires (15 minutes) on the next check.
        console.warn('[backups] scheduled backup failed', e)
      }
    }

    const first = setTimeout(() => void run(), 15_000) // let the app settle first
    const timer = setInterval(() => void run(), CHECK_EVERY_MS)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [organizationId, organizationName, role, online, queryClient])
}
