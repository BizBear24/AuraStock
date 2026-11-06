import { backoffMs, classifyError, MAX_ATTEMPTS } from '@/domain/sync'
import type { NewOutboxEntry, OfflineDb, OutboxEntry } from './db'

export type ExecResult =
  | { kind: 'done'; /** New details_version after a product save, used to rebase later queued edits. */ detailsVersion?: number }
  | { kind: 'conflict'; message: string; serverVersion: number | null }

export type SyncPhase = 'offline' | 'syncing' | 'auth-required' | 'failed' | 'pending' | 'synced'

export interface SyncSnapshot {
  phase: SyncPhase
  online: boolean
  /** Queued or in flight: not yet confirmed by the server. */
  pending: number
  failed: number
  conflicts: number
  lastSyncedAt: number | null
  lastError: string | null
  /** Earliest time a backed-off operation may be retried, or null. */
  nextAttemptAt: number | null
}

export interface EngineDeps {
  db: OfflineDb
  /** Perform one operation against the server. Throw to signal failure. */
  execute: (entry: OutboxEntry) => Promise<ExecResult>
  isOnline: () => boolean
  /** Called after an entry is removed without being applied (discard), to undo local overlays. */
  afterDiscard?: (entry: OutboxEntry) => Promise<void>
  /** Called after an entry has been confirmed by the server. */
  afterDone?: (entry: OutboxEntry, result: ExecResult) => Promise<void>
  now?: () => number
  random?: () => number
}

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

/**
 * Durable operation queue + sequential replayer.
 *
 *  - Every operation has a unique id (its idempotency key) and is stored in IndexedDB before anything else.
 *  - Operations are applied strictly in queue order, except that a product whose earlier operation is
 *    failed, in conflict or backing off holds back its own later operations (others continue).
 *  - Network loss keeps the operation queued; expired auth pauses everything; server rejections
 *    ("Insufficient stock", permissions...) park the operation as failed for a person to resolve.
 *  - After a crash or reload, operations left "syncing" are returned to "pending". Replay is safe
 *    because the server treats each operation id as idempotent.
 */
export class SyncEngine {
  private readonly deps: EngineDeps
  private readonly listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private authBlocked = false
  private lastSyncedAt: number | null = null
  private lastError: string | null = null
  private snapshot: SyncSnapshot

  constructor(deps: EngineDeps) {
    this.deps = deps
    this.snapshot = {
      phase: deps.isOnline() ? 'synced' : 'offline',
      online: deps.isOnline(),
      pending: 0,
      failed: 0,
      conflicts: 0,
      lastSyncedAt: null,
      lastError: null,
      nextAttemptAt: null,
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SyncSnapshot => this.snapshot

  /** Reset interrupted operations and compute counts. Call once at startup. */
  async init(): Promise<void> {
    await this.deps.db.outbox.where('status').equals('syncing').modify({ status: 'pending' })
    await this.refresh()
  }

  async list(): Promise<OutboxEntry[]> {
    return this.deps.db.outbox.orderBy('seq').toArray()
  }

  /** Persist an operation. Returns false if the same operation id is already queued (double submit). */
  async enqueue(entry: NewOutboxEntry): Promise<boolean> {
    try {
      await this.deps.db.outbox.add({
        ...entry,
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextAttemptAt: 0,
        createdAt: this.now(),
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'ConstraintError') return false
      throw e
    }
    await this.refresh()
    return true
  }

  /** Apply queued operations now (no-op while offline or already running). */
  flush(): Promise<void> {
    if (this.running) return this.running
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<void> {
    if (!this.deps.isOnline()) {
      await this.refresh()
      return
    }
    this.authBlocked = false
    this.lastError = null
    const syncing = true
    await this.refresh(syncing)
    try {
      for (;;) {
        const entry = await this.nextRunnable()
        if (!entry) break
        const outcome = await this.process(entry)
        if (outcome === 'stop') break
        await this.refresh(syncing)
      }
    } finally {
      await this.refresh()
    }
  }

  private async nextRunnable(): Promise<OutboxEntry | undefined> {
    const now = this.now()
    const held = new Set<string>()
    for (const e of await this.list()) {
      if (e.status === 'failed' || e.status === 'conflict') {
        held.add(e.productId)
        continue
      }
      if (held.has(e.productId)) continue
      if (e.nextAttemptAt > now) {
        held.add(e.productId)
        continue
      }
      return e
    }
    return undefined
  }

  private async process(entry: OutboxEntry): Promise<'continue' | 'stop'> {
    const { outbox } = this.deps.db
    const seq = entry.seq as number
    const attempts = entry.attempts + 1
    await outbox.update(seq, { status: 'syncing', attempts })
    try {
      const result = await this.deps.execute(entry)
      if (result.kind === 'done') {
        await outbox.delete(seq)
        if (result.detailsVersion !== undefined) await this.rebase(entry.productId, result.detailsVersion)
        await this.deps.afterDone?.(entry, result)
        this.lastSyncedAt = this.now()
      } else {
        await outbox.update(seq, { status: 'conflict', lastError: result.message, serverVersion: result.serverVersion })
      }
      return 'continue'
    } catch (error) {
      const message = describe(error)
      const kind = classifyError(error)
      this.lastError = message
      if (kind === 'network') {
        await outbox.update(seq, { status: 'pending', attempts: entry.attempts, lastError: message, nextAttemptAt: this.now() + backoffMs(attempts, this.deps.random) })
        return 'stop'
      }
      if (kind === 'auth') {
        this.authBlocked = true
        await outbox.update(seq, { status: 'pending', attempts: entry.attempts, lastError: message })
        return 'stop'
      }
      if (kind === 'transient' && attempts < MAX_ATTEMPTS) {
        await outbox.update(seq, { status: 'pending', lastError: message, nextAttemptAt: this.now() + backoffMs(attempts, this.deps.random) })
        return 'continue'
      }
      await outbox.update(seq, { status: 'failed', lastError: message })
      return 'continue'
    }
  }

  /** After a product edit lands, later queued edits of the same product are based on the new version. */
  private async rebase(productId: string, detailsVersion: number): Promise<void> {
    await this.deps.db.outbox
      .where('productId')
      .equals(productId)
      .filter((e) => e.kind === 'product_save' && e.payload.mode === 'update' && e.status !== 'conflict')
      .modify((e) => {
        if (e.kind === 'product_save') e.payload.baseVersion = detailsVersion
      })
  }

  /** Make backed-off operations eligible immediately (e.g. connectivity returned), then flush. */
  async syncNow(): Promise<void> {
    await this.deps.db.outbox.where('status').equals('pending').modify({ nextAttemptAt: 0 })
    await this.flush()
  }

  /** User action: try a failed operation again. */
  async retry(id: string): Promise<void> {
    await this.deps.db.outbox.where('id').equals(id).modify({ status: 'pending', attempts: 0, lastError: null, nextAttemptAt: 0 })
    await this.refresh()
  }

  /** User action: drop an operation (and undo its local overlay). */
  async discard(id: string): Promise<void> {
    const entry = await this.deps.db.outbox.where('id').equals(id).first()
    if (!entry) return
    await this.deps.db.outbox.delete(entry.seq as number)
    await this.deps.afterDiscard?.(entry)
    await this.refresh()
  }

  /** User action on a conflict: re-apply my edit on top of the server's version, or keep the server's. */
  async resolveConflict(id: string, choice: 'mine' | 'theirs'): Promise<void> {
    if (choice === 'theirs') return this.discard(id)
    await this.deps.db.outbox
      .where('id')
      .equals(id)
      .modify((e) => {
        if (e.kind === 'product_save') e.payload.baseVersion = e.serverVersion ?? e.payload.baseVersion
        e.status = 'pending'
        e.attempts = 0
        e.lastError = null
        e.nextAttemptAt = 0
      })
    await this.refresh()
  }

  /** Earliest time something becomes retryable, so the host can schedule a wake-up. */
  async nextWakeAt(): Promise<number | null> {
    const times = (await this.list()).filter((e) => e.status === 'pending' && e.nextAttemptAt > 0).map((e) => e.nextAttemptAt)
    return times.length ? Math.min(...times) : null
  }

  /** Recompute the public snapshot. Call when connectivity changes. */
  async refresh(syncing = false): Promise<void> {
    const entries = await this.list()
    const pending = entries.filter((e) => e.status === 'pending' || e.status === 'syncing').length
    const failed = entries.filter((e) => e.status === 'failed').length
    const conflicts = entries.filter((e) => e.status === 'conflict').length
    const online = this.deps.isOnline()
    const waits = entries.filter((e) => e.status === 'pending' && e.nextAttemptAt > 0).map((e) => e.nextAttemptAt)

    let phase: SyncPhase
    if (!online) phase = 'offline'
    else if (this.authBlocked) phase = 'auth-required'
    else if (syncing) phase = 'syncing'
    else if (failed + conflicts > 0) phase = 'failed'
    else if (pending > 0) phase = 'pending'
    else phase = 'synced'

    this.snapshot = {
      phase,
      online,
      pending,
      failed,
      conflicts,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      nextAttemptAt: waits.length ? Math.min(...waits) : null,
    }
    for (const l of this.listeners) l()
  }
}
