// @vitest-environment node
import 'fake-indexeddb/auto'
import type { ProductFormValues } from '@/features/products/schema'
import { OfflineDb, type NewOutboxEntry, type OutboxEntry } from './db'
import { SyncEngine, type ExecResult } from './engine'

let dbCounter = 0
let online = true
let clock = 1_000_000
let executed: OutboxEntry[] = []
let behaviour: (e: OutboxEntry) => Promise<ExecResult>
let discarded: OutboxEntry[] = []

const done = async (): Promise<ExecResult> => ({ kind: 'done' })

function make() {
  const db = new OfflineDb(`test-${++dbCounter}`)
  const engine = new SyncEngine({
    db,
    execute: async (e) => {
      executed.push(e)
      return behaviour(e)
    },
    isOnline: () => online,
    afterDiscard: async (e) => {
      discarded.push(e)
    },
    now: () => clock,
    random: () => 1,
  })
  return { db, engine }
}

const movement = (id: string, productId = 'p1'): NewOutboxEntry => ({
  id,
  kind: 'stock_movement',
  inventoryId: 'inv',
  userId: 'u',
  productId,
  payload: { type: 'in', amount: 1, reference: null, note: null, localDelta: 1, productName: 'Widget' },
})

const values = { name: 'N' } as ProductFormValues
const save = (id: string, baseVersion: number | null, productId = 'p1'): NewOutboxEntry => ({
  id,
  kind: 'product_save',
  inventoryId: 'inv',
  userId: 'u',
  productId,
  payload: { mode: 'update', values, baseVersion, productName: 'Widget' },
})

beforeEach(() => {
  online = true
  clock = 1_000_000
  executed = []
  discarded = []
  behaviour = done
})

describe('SyncEngine', () => {
  it('applies queued operations in order and empties the queue', async () => {
    const { engine } = make()
    await engine.init()
    await engine.enqueue(movement('a'))
    await engine.enqueue(movement('b', 'p2'))
    await engine.enqueue(movement('c'))
    await engine.flush()
    expect(executed.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(engine.getSnapshot()).toMatchObject({ phase: 'synced', pending: 0, failed: 0 })
    expect(engine.getSnapshot().lastSyncedAt).not.toBeNull()
  })

  it('keeps everything queued while offline and reports it', async () => {
    online = false
    const { engine } = make()
    await engine.enqueue(movement('a'))
    await engine.flush()
    expect(executed).toHaveLength(0)
    expect(engine.getSnapshot()).toMatchObject({ phase: 'offline', pending: 1 })
    online = true
    await engine.syncNow()
    expect(executed).toHaveLength(1)
    expect(engine.getSnapshot()).toMatchObject({ phase: 'synced', pending: 0 })
  })

  it('does not execute the same operation id twice', async () => {
    const { engine } = make()
    expect(await engine.enqueue(movement('dup'))).toBe(true)
    expect(await engine.enqueue(movement('dup'))).toBe(false)
    await engine.flush()
    expect(executed).toHaveLength(1)
  })

  it('stops on network failure, backs off, then succeeds when retried', async () => {
    const { engine } = make()
    await engine.enqueue(movement('a'))
    await engine.enqueue(movement('b', 'p2'))
    behaviour = async () => {
      throw new TypeError('Failed to fetch')
    }
    await engine.flush()
    expect(executed).toHaveLength(1) // stopped at first failure
    expect(engine.getSnapshot()).toMatchObject({ phase: 'pending', pending: 2 })
    expect(engine.getSnapshot().nextAttemptAt).toBeGreaterThan(clock)

    await engine.flush() // still inside the back-off window
    expect(executed).toHaveLength(1 + 1) // p2 proceeds, p1 is held back
    behaviour = done
    await engine.syncNow()
    expect(engine.getSnapshot()).toMatchObject({ phase: 'synced', pending: 0 })
  })

  it('parks permanent rejections and holds later ops for the same product only', async () => {
    const { engine } = make()
    await engine.enqueue(movement('a'))
    await engine.enqueue(movement('b'))
    await engine.enqueue(movement('c', 'p2'))
    behaviour = async (e) => {
      if (e.id === 'a') throw { message: 'Insufficient stock: 3 available, 5 requested', code: '23514' }
      return { kind: 'done' }
    }
    await engine.flush()
    expect(executed.map((e) => e.id)).toEqual(['a', 'c'])
    const list = await engine.list()
    expect(list.map((e) => [e.id, e.status])).toEqual([
      ['a', 'failed'],
      ['b', 'pending'],
    ])
    expect(list[0]?.lastError).toContain('Insufficient stock')
    expect(engine.getSnapshot()).toMatchObject({ phase: 'failed', failed: 1, pending: 1 })

    await engine.discard('a')
    expect(discarded.map((e) => e.id)).toEqual(['a'])
    await engine.flush()
    expect(executed.map((e) => e.id)).toEqual(['a', 'c', 'b'])
  })

  it('pauses on expired authentication without burning attempts', async () => {
    const { engine } = make()
    await engine.enqueue(movement('a'))
    behaviour = async () => {
      throw { message: 'JWT expired', code: 'PGRST301' }
    }
    await engine.flush()
    expect(engine.getSnapshot().phase).toBe('auth-required')
    const [entry] = await engine.list()
    expect(entry).toMatchObject({ status: 'pending', attempts: 0 })
    behaviour = done
    await engine.flush()
    expect(engine.getSnapshot().phase).toBe('synced')
  })

  it('retries transient server errors with back-off', async () => {
    const { engine } = make()
    await engine.enqueue(movement('a'))
    behaviour = async () => {
      throw { message: 'deadlock detected', code: '40P01' }
    }
    await engine.flush()
    const [entry] = await engine.list()
    expect(entry).toMatchObject({ status: 'pending', attempts: 1 })
    expect(entry?.nextAttemptAt).toBeGreaterThan(clock)
  })

  it('recovers operations interrupted by a restart', async () => {
    const { db, engine } = make()
    await engine.enqueue(movement('a'))
    await db.outbox.where('id').equals('a').modify({ status: 'syncing', attempts: 1 })
    const restarted = new SyncEngine({ db, execute: async (e) => { executed.push(e); return { kind: 'done' } }, isOnline: () => true, now: () => clock })
    await restarted.init()
    expect(restarted.getSnapshot().pending).toBe(1)
    await restarted.flush()
    expect(executed.map((e) => e.id)).toEqual(['a'])
    expect(restarted.getSnapshot().phase).toBe('synced')
  })

  it('surfaces conflicts and lets the user keep their edit on the new version', async () => {
    const { engine } = make()
    await engine.enqueue(save('s1', 3))
    behaviour = async (e) =>
      e.kind === 'product_save' && e.payload.baseVersion === 3
        ? { kind: 'conflict', message: 'Changed by someone else', serverVersion: 5 }
        : { kind: 'done', detailsVersion: 6 }
    await engine.flush()
    expect(engine.getSnapshot()).toMatchObject({ phase: 'failed', conflicts: 1 })

    await engine.resolveConflict('s1', 'mine')
    await engine.flush()
    expect(executed.map((e) => e.kind === 'product_save' && e.payload.baseVersion)).toEqual([3, 5])
    expect(engine.getSnapshot()).toMatchObject({ phase: 'synced', conflicts: 0 })
  })

  it('discards my edit when the user keeps the server version', async () => {
    const { engine } = make()
    await engine.enqueue(save('s1', 3))
    behaviour = async () => ({ kind: 'conflict', message: 'x', serverVersion: 4 })
    await engine.flush()
    await engine.resolveConflict('s1', 'theirs')
    expect(await engine.list()).toHaveLength(0)
    expect(discarded).toHaveLength(1)
  })

  it('rebases later queued edits after an earlier edit lands', async () => {
    const { engine } = make()
    await engine.enqueue(save('s1', 3))
    await engine.enqueue(save('s2', 3))
    behaviour = async (e) => ({ kind: 'done', detailsVersion: e.id === 's1' ? 4 : 5 })
    await engine.flush()
    expect(executed.map((e) => e.kind === 'product_save' && e.payload.baseVersion)).toEqual([3, 4])
  })
})
