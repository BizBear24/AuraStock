import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

type Handler = () => void
interface FakeChannel {
  name: string
  watches: { table: string; filter: string; handler: Handler }[]
  statusCallback?: (status: string) => void
  on: (type: string, opts: { table: string; filter: string }, handler: Handler) => FakeChannel
  subscribe: (cb: (status: string) => void) => FakeChannel
}

const channels: FakeChannel[] = []
const removeChannel = vi.fn()
const pullInventory = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      const ch: FakeChannel = {
        name,
        watches: [],
        on(_type, opts, handler) {
          ch.watches.push({ table: opts.table, filter: opts.filter, handler })
          return ch
        },
        subscribe(cb) {
          ch.statusCallback = cb
          return ch
        },
      }
      channels.push(ch)
      return ch
    },
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}))
vi.mock('@/features/products/remote', () => ({}))
vi.mock('@/offline/local', () => ({ bestEffort: (p: Promise<unknown>) => void p, pullInventory: (...a: unknown[]) => pullInventory(...a) }))

const { createInvalidator, keysForTable, useRealtime } = await import('./useRealtime')

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  channels.length = 0
  removeChannel.mockClear()
  pullInventory.mockClear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('keysForTable', () => {
  it('maps tables to the screens that show them', () => {
    expect(keysForTable('stock_movements')).toContain('movements')
    expect(keysForTable('organization_members')).toContain('members')
    expect(keysForTable('invitations')).toContain('my-invitations')
    expect(keysForTable('unknown')).toEqual([])
  })
})

describe('createInvalidator', () => {
  it('batches a burst of events into one invalidation', () => {
    const invalidateQueries = vi.fn()
    const inv = createInvalidator({ invalidateQueries } as never, 500)
    inv.push('products')
    inv.push('products')
    inv.push('notifications')
    expect(invalidateQueries).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)
    const { predicate } = invalidateQueries.mock.calls[0]![0] as { predicate: (q: { queryKey: unknown[] }) => boolean }
    expect(predicate({ queryKey: ['products', 'x'] })).toBe(true)
    expect(predicate({ queryKey: ['summary'] })).toBe(true)
    expect(predicate({ queryKey: ['profile'] })).toBe(false)
  })

  it('can be cancelled', () => {
    const invalidateQueries = vi.fn()
    const inv = createInvalidator({ invalidateQueries } as never, 500)
    inv.push('products')
    inv.cancel()
    vi.advanceTimersByTime(1000)
    expect(invalidateQueries).not.toHaveBeenCalled()
  })
})

describe('useRealtime', () => {
  it('subscribes to the organization and inventory, reports status, and refreshes on changes', () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result, unmount } = renderHook(() => useRealtime('org-1', 'inv-1'), { wrapper: wrapperFor(client) })

    expect(channels).toHaveLength(1)
    const ch = channels[0]!
    expect(ch.watches.map((w) => `${w.table}:${w.filter}`).sort()).toEqual(
      [
        'inventories:organization_id=eq.org-1',
        'invitations:organization_id=eq.org-1',
        'notifications:organization_id=eq.org-1',
        'organization_members:organization_id=eq.org-1',
        'products:inventory_id=eq.inv-1',
        'stock_movements:inventory_id=eq.inv-1',
        'transfers:organization_id=eq.org-1',
      ].sort(),
    )
    expect(result.current).toBe('connecting')
    act(() => ch.statusCallback?.('SUBSCRIBED'))
    expect(result.current).toBe('live')

    ch.watches.find((w) => w.table === 'stock_movements')!.handler()
    ch.watches.find((w) => w.table === 'stock_movements')!.handler()
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(invalidate).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(pullInventory).toHaveBeenCalledTimes(1)
    expect(pullInventory.mock.calls[0]![0]).toBe('inv-1')

    act(() => ch.statusCallback?.('CHANNEL_ERROR'))
    expect(result.current).toBe('offline')

    unmount()
    expect(removeChannel).toHaveBeenCalledWith(ch)
  })

  it('does nothing without an organization and skips inventory tables without an inventory', () => {
    const client = new QueryClient()
    renderHook(() => useRealtime(undefined, undefined), { wrapper: wrapperFor(client) })
    expect(channels).toHaveLength(0)
    renderHook(() => useRealtime('org-1', undefined), { wrapper: wrapperFor(client) })
    expect(channels[0]!.watches.some((w) => w.table === 'products')).toBe(false)
  })
})
