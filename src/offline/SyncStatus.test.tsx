import type { SyncSnapshot } from './engine'
import { describePhase } from './SyncStatus'

const snap = (over: Partial<SyncSnapshot>): SyncSnapshot => ({
  phase: 'synced',
  online: true,
  pending: 0,
  failed: 0,
  conflicts: 0,
  lastSyncedAt: null,
  lastError: null,
  nextAttemptAt: null,
  ...over,
})

describe('describePhase', () => {
  it('never calls queued work synchronized', () => {
    const queued = describePhase(snap({ phase: 'pending', pending: 2 }))
    expect(queued.label).toBe('Waiting to sync')
    expect(queued.detail).toMatch(/not yet confirmed by the server/)
    const offline = describePhase(snap({ phase: 'offline', online: false, pending: 1 }))
    expect(offline.label).toBe('Offline')
    expect(offline.detail).toMatch(/saved on this device/)
  })

  it('only reports everything confirmed when the queue is empty and sync is complete', () => {
    expect(describePhase(snap({ phase: 'synced', lastSyncedAt: 1 })).detail).toMatch(/confirmed by the server/)
  })

  it('flags failures and expired sessions as needing attention', () => {
    expect(describePhase(snap({ phase: 'failed', failed: 1, conflicts: 1 })).detail).toBe('2 changes need attention')
    expect(describePhase(snap({ phase: 'auth-required' })).tone).toBe('crit')
  })
})
