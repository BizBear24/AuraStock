// @vitest-environment node
/**
 * Runs the real migrations in an in-process PostgreSQL (PGlite) with a minimal Supabase stub
 * (auth schema, auth.uid(), anon/authenticated roles) and exercises RLS and stock rules.
 * Limitation: PGlite is single-connection, so true parallel transactions are not exercised here;
 * see DATABASE.md for the lock-based concurrency argument and the manual two-session check.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const C = '00000000-0000-0000-0000-00000000000c'

let db: PGlite
let orgA: string
let invA: string
let product: string

const op = () => crypto.randomUUID()

async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await expect(p).rejects.toThrow(pattern)
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } })
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema extensions;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `)
  const dir = join(process.cwd(), 'supabase', 'migrations')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'))
  }
  for (const [id, email] of [[A, 'a@x.test'], [B, 'b@x.test'], [C, 'c@x.test']] as const) {
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, '{}'])
  }
  orgA = await as(A, async () => (await db.query<{ id: string }>("select public.create_organization('Org A') as id")).rows[0]!.id)
  await as(B, () => db.query("select public.create_organization('Org B')"))
  invA = await as(A, async () =>
    (await db.query<{ id: string }>("insert into public.inventories (organization_id, name, created_by) values ($1, 'Main', $2) returning id", [orgA, A])).rows[0]!.id,
  )
  product = await as(A, async () =>
    (await db.query<{ id: string }>(
      "insert into public.products (inventory_id, name, sku, barcode, created_by) values ($1, 'Widget', 'W-1', '123', $2) returning id",
      [invA, A],
    )).rows[0]!.id,
  )
})

afterAll(async () => {
  await db.close()
})

const qty = async () => Number((await db.query<{ quantity: string }>('select quantity from public.products where id = $1', [product])).rows[0]!.quantity)
const record = (uid: string, type: string, amount: number, extra: { op?: string; note?: string } = {}) =>
  as(uid, () => db.query('select * from public.record_stock_movement($1, $2, $3, $4, null, $5)', [product, type, amount, extra.op ?? op(), extra.note ?? null]))

describe('tenant isolation (RLS)', () => {
  it('hides another organization entirely', async () => {
    await as(B, async () => {
      expect((await db.query('select 1 from public.organizations where id = $1', [orgA])).rows).toHaveLength(0)
      expect((await db.query('select 1 from public.inventories')).rows).toHaveLength(0)
      expect((await db.query('select 1 from public.products')).rows).toHaveLength(0)
      expect((await db.query('select 1 from public.stock_movements')).rows).toHaveLength(0)
    })
  })

  it('stops a non-member writing into another organization', async () => {
    await as(B, async () => {
      await rejects(db.query("insert into public.products (inventory_id, name, created_by) values ($1, 'X', $2)", [invA, B]), /row-level security/)
      await rejects(db.query("insert into public.inventories (organization_id, name, created_by) values ($1, 'Evil', $2)", [orgA, B]), /row-level security/)
    })
  })

  it('does not let users create organizations or memberships directly', async () => {
    await as(C, async () => {
      await rejects(db.query("insert into public.organizations (name, created_by) values ('Mine', $1)", [C]), /row-level security/)
      await rejects(db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [orgA, C]), /row-level security/)
    })
  })
})

describe('product rules', () => {
  it('enforces unique SKU and barcode within an inventory', async () => {
    await as(A, async () => {
      await rejects(db.query("insert into public.products (inventory_id, name, sku, created_by) values ($1, 'Dup', 'w-1', $2)", [invA, A]), /products_sku_uq/)
      await rejects(db.query("insert into public.products (inventory_id, name, barcode, created_by) values ($1, 'Dup', '123', $2)", [invA, A]), /products_barcode_uq/)
    })
  })

  it('bumps details_version for descriptive edits but not for stock changes', async () => {
    const version = async () => Number((await db.query<{ v: number }>('select details_version as v from public.products where id = $1', [product])).rows[0]!.v)
    const v0 = await version()
    await as(A, () => db.query("update public.products set description = 'changed' where id = $1", [product]))
    expect(await version()).toBe(v0 + 1)
    await record(A, 'in', 1)
    expect(await version()).toBe(v0 + 1)
    await as(A, () => db.query("update public.products set description = 'changed' where id = $1", [product]))
    expect(await version()).toBe(v0 + 1)
    await record(A, 'out', 1)
  })

  it('starts at zero and blocks direct quantity edits', async () => {
    await as(A, async () => {
      await rejects(db.query("insert into public.products (inventory_id, name, quantity, created_by) values ($1, 'P', 5, $2)", [invA, A]), /start at zero/)
      await rejects(db.query('update public.products set quantity = 99 where id = $1', [product]), /only change through a stock movement/)
    })
    expect(await qty()).toBe(0)
  })
})

describe('stock movements', () => {
  it('applies in/out, rejects overdraw, and keeps stock consistent', async () => {
    await record(A, 'in', 8)
    expect(await qty()).toBe(8)
    await record(A, 'out', 5)
    expect(await qty()).toBe(3)
    await rejects(record(A, 'out', 5), /Insufficient stock: 3 available, 5 requested/)
    expect(await qty()).toBe(3)
  })

  it('is idempotent for a repeated operation id', async () => {
    const id = op()
    await record(A, 'in', 2, { op: id })
    const before = await qty()
    await record(A, 'in', 2, { op: id })
    expect(await qty()).toBe(before)
    const n = (await db.query('select count(*)::int as n from public.stock_movements where operation_id = $1', [id])).rows[0] as { n: number }
    expect(n.n).toBe(1)
  })

  it('computes adjustments from the counted quantity and requires notes', async () => {
    await rejects(record(A, 'adjustment', 1), /note is required/)
    const current = await qty()
    await record(A, 'adjustment', current + 4, { note: 'stocktake' })
    expect(await qty()).toBe(current + 4)
    await rejects(record(A, 'adjustment', current + 4, { note: 'same' }), /No change/)
    await rejects(record(A, 'correction', -9999, { note: 'oops' }), /Insufficient stock/)
  })

  it('keeps the ledger consistent with the quantity', async () => {
    const sum = (await db.query<{ s: string }>('select sum(delta) as s from public.stock_movements where product_id = $1', [product])).rows[0]!.s
    expect(Number(sum)).toBe(await qty())
  })

  it('denies non-members and read-only members', async () => {
    await rejects(record(B, 'in', 1), /not found or you do not have permission/)
    await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'viewer')", [orgA, C])
    await rejects(record(C, 'in', 1), /do not have permission/)
    await as(C, async () => {
      expect((await db.query('select 1 from public.stock_movements')).rows.length).toBeGreaterThan(0)
    })
  })

  it('is append-only and cannot be written directly', async () => {
    await rejects(db.query("update public.stock_movements set note = 'x'"), /immutable/)
    await rejects(db.query('delete from public.stock_movements'), /immutable/)
    await as(A, async () => {
      await rejects(db.query('delete from public.stock_movements'), /permission denied/)
      await rejects(
        db.query(
          "insert into public.stock_movements (inventory_id, product_id, movement_type, delta, quantity_before, quantity_after, operation_id, created_by) values ($1, $2, 'in', 1, 0, 1, $3, $4)",
          [invA, product, op(), A],
        ),
        /permission denied/,
      )
    })
  })

  it('writes an audit entry visible only to admins', async () => {
    expect(Number((await db.query<{ n: string }>('select count(*) as n from public.audit_logs')).rows[0]!.n)).toBeGreaterThan(0)
    await as(C, async () => {
      expect((await db.query('select 1 from public.audit_logs')).rows).toHaveLength(0)
    })
    await as(A, async () => {
      expect((await db.query('select 1 from public.audit_logs')).rows.length).toBeGreaterThan(0)
    })
  })

  it('blocks stock in for expired products and any change to archived ones', async () => {
    const expired = (await db.query<{ id: string }>(
      "insert into public.products (inventory_id, name, expires_on, created_by) values ($1, 'Milk', current_date - 1, $2) returning id",
      [invA, A],
    )).rows[0]!.id
    await rejects(as(A, () => db.query("select public.record_stock_movement($1, 'in', 1, $2)", [expired, op()])), /expired/)
    await db.query('update public.products set archived_at = now() where id = $1', [expired])
    await rejects(as(A, () => db.query("select public.record_stock_movement($1, 'in', 1, $2)", [expired, op()])), /Archived products/)
  })

  it('refuses to delete products that are unarchived or have history', async () => {
    await rejects(as(A, () => db.query('delete from public.products where id = $1', [product])), /Archive the product/)
    await db.query('update public.products set archived_at = now() where id = $1', [product])
    await rejects(as(A, () => db.query('delete from public.products where id = $1', [product])), /foreign key|violates/)
    await db.query('update public.products set archived_at = null where id = $1', [product])
  })

  it('allows deleting an inventory together with its ledger', async () => {
    const inv = (await db.query<{ id: string }>("insert into public.inventories (organization_id, name, created_by) values ($1, 'Temp', $2) returning id", [orgA, A])).rows[0]!.id
    const p = (await db.query<{ id: string }>("insert into public.products (inventory_id, name, created_by) values ($1, 'T', $2) returning id", [inv, A])).rows[0]!.id
    await as(A, () => db.query("select public.record_stock_movement($1, 'in', 3, $2)", [p, op()]))
    await as(A, () => db.query('delete from public.inventories where id = $1', [inv]))
    expect((await db.query('select 1 from public.products where id = $1', [p])).rows).toHaveLength(0)
  })
})

describe('organization safeguards', () => {
  it('keeps at least one owner', async () => {
    await rejects(db.query("delete from public.organization_members where organization_id = $1 and user_id = $2", [orgA, A]), /at least one owner/)
  })
})

describe('alerts and notifications', () => {
  let alertProduct: string
  const kinds = async () =>
    (await db.query<{ kind: string }>('select kind from public.notifications where product_id = $1 order by created_at, id', [alertProduct])).rows.map((r) => r.kind)
  const move = (type: string, amount: number) =>
    as(A, () => db.query('select public.record_stock_movement($1, $2, $3, $4)', [alertProduct, type, amount, op()]))

  beforeAll(async () => {
    alertProduct = (await db.query<{ id: string }>(
      "insert into public.products (inventory_id, name, min_stock, created_by) values ($1, 'Alert Rice', 5, $2) returning id",
      [invA, A],
    )).rows[0]!.id
  })

  it('does not alert for a brand-new product sitting at zero', async () => {
    expect(await kinds()).toEqual([])
  })

  it('alerts on low and out-of-stock transitions, once each', async () => {
    await move('in', 10)
    expect(await kinds()).toEqual([])
    await move('out', 6) // 4 <= min 5
    expect(await kinds()).toEqual(['low_stock'])
    await move('out', 1) // still low: no repeat
    expect(await kinds()).toEqual(['low_stock'])
    await move('out', 3) // 0
    expect(await kinds()).toEqual(['low_stock', 'out_of_stock'])
  })

  it('alerts again after recovering and dropping', async () => {
    await move('in', 20)
    await move('out', 18)
    expect(await kinds()).toEqual(['low_stock', 'out_of_stock', 'low_stock'])
  })

  it('writes readable messages', async () => {
    const row = (await db.query<{ title: string; body: string }>("select title, body from public.notifications where product_id = $1 and kind = 'out_of_stock'", [alertProduct])).rows[0]!
    expect(row.title).toBe('Out of stock: Alert Rice')
    expect(row.body).toContain('Main')
  })

  it('raises expiry alerts on edit and from the scheduled job', async () => {
    await db.query("update public.products set expires_on = current_date + 10 where id = $1", [alertProduct])
    expect((await kinds()).at(-1)).toBe('expiring')
    await db.query("update public.products set expires_on = current_date - 1 where id = $1", [alertProduct])
    expect((await kinds()).at(-1)).toBe('expired')
    const before = (await kinds()).length
    await db.query('select public.generate_alerts()')
    expect((await kinds()).length).toBe(before) // idempotent
    // Time passing: simulate by rewinding the remembered state, as the daily job would see a change.
    await db.query("update public.product_alert_state set expiry_state = 'ok' where product_id = $1", [alertProduct])
    await db.query('select public.generate_alerts()')
    expect((await kinds()).length).toBe(before + 1)
  })

  it('stops alerting for archived products', async () => {
    const before = (await kinds()).length
    await db.query('update public.products set archived_at = now() where id = $1', [alertProduct])
    await db.query("update public.products set expires_on = current_date + 5 where id = $1", [alertProduct])
    expect((await kinds()).length).toBe(before)
  })

  it('is private to the organization and tracks read state per user', async () => {
    await as(B, async () => {
      expect((await db.query('select 1 from public.notifications')).rows).toHaveLength(0)
      expect(Number((await db.query<{ n: string }>('select public.unread_notification_count($1) as n', [orgA])).rows[0]!.n)).toBe(0)
      await rejects(db.query('select public.mark_notifications_read($1)', [orgA]), /Not a member/)
    })
    const total = await as(A, async () => Number((await db.query<{ n: string }>('select public.unread_notification_count($1) as n', [orgA])).rows[0]!.n))
    expect(total).toBeGreaterThan(0)
    await as(A, () => db.query('select public.mark_notifications_read($1)', [orgA]))
    expect(await as(A, async () => Number((await db.query<{ n: string }>('select public.unread_notification_count($1) as n', [orgA])).rows[0]!.n))).toBe(0)
    // A viewer in the same org still sees them as unread: read state is per user.
    expect(await as(C, async () => Number((await db.query<{ n: string }>('select public.unread_notification_count($1) as n', [orgA])).rows[0]!.n))).toBe(total)
  })

  it('lists notifications with a per-user read flag, paged and filterable', async () => {
    const list = (uid: string, unread: boolean, limit = 25, offset = 0) =>
      as(uid, async () => (await db.query<{ is_read: boolean; total_count: string }>('select is_read, total_count from public.list_notifications($1, null, $2, $3, $4)', [orgA, unread, limit, offset])).rows)
    const all = await list(A, false)
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((r) => r.is_read)).toBe(true) // A read everything above
    expect(await list(A, true)).toHaveLength(0)
    const asC = await list(C, true)
    expect(asC.length).toBe(all.length)
    expect(Number(asC[0]!.total_count)).toBe(all.length)
    expect(await list(C, false, 2, 0)).toHaveLength(2)
    expect(await list(B, false)).toHaveLength(0)
  })

  it('cannot be written directly by users', async () => {
    await as(A, async () => {
      await rejects(db.query("insert into public.notifications (organization_id, inventory_id, kind, title, body) values ($1, $2, 'low_stock', 'x', 'y')", [orgA, invA]), /permission denied/)
      await rejects(db.query('select public.generate_alerts()'), /permission denied/)
    })
  })
})

describe('bulk import', () => {
  let inv: string
  const run = (uid: string, rows: unknown[], update = false, opId: string = op()) =>
    as(uid, async () => (await db.query<{ r: { created: number; updated: number; skipped: number } }>('select public.import_products($1, $2::jsonb, $3, $4) as r', [inv, JSON.stringify(rows), update, opId])).rows[0]!.r)
  const products = async () =>
    (await db.query<{ name: string; sku: string | null; quantity: string }>('select name, sku, quantity from public.products where inventory_id = $1 order by name', [inv])).rows

  beforeAll(async () => {
    inv = (await db.query<{ id: string }>("insert into public.inventories (organization_id, name, created_by) values ($1, 'ImportInv', $2) returning id", [orgA, A])).rows[0]!.id
  })

  it('creates products with categories, tags and an opening-stock ledger entry', async () => {
    const result = await run(A, [
      { name: 'Flour', sku: 'F-1', barcode: '111', category: 'Baking', tags: ['Dry', 'Bulk'], unit: 'kg', min_stock: '5', quantity: '20' },
      { name: 'Yeast', sku: 'Y-1', tags: [], quantity: '' },
    ])
    expect(result).toEqual({ created: 2, updated: 0, skipped: 0 })
    expect((await products()).map((p) => [p.name, Number(p.quantity)])).toEqual([['Flour', 20], ['Yeast', 0]])
    const ledger = (await db.query<{ movement_type: string; reference: string; delta: string }>(
      "select m.movement_type, m.reference, m.delta from public.stock_movements m join public.products p on p.id = m.product_id where p.inventory_id = $1",
      [inv],
    )).rows
    expect(ledger).toEqual([{ movement_type: 'in', reference: 'IMPORT', delta: '20.000' }])
    const tags = (await db.query<{ name: string }>('select t.name from public.tags t where t.inventory_id = $1 order by t.name', [inv])).rows.map((t) => t.name)
    expect(tags).toEqual(['Bulk', 'Dry'])
  })

  it('skips existing products by default and matches SKU case-insensitively', async () => {
    expect(await run(A, [{ name: 'Flour again', sku: 'f-1' }, { name: 'Sugar', sku: 'S-1' }])).toEqual({ created: 1, updated: 0, skipped: 1 })
    expect((await products()).map((p) => p.name)).toContain('Flour')
    expect((await products()).map((p) => p.name)).not.toContain('Flour again')
  })

  it('updates details of existing products on request without touching quantity', async () => {
    const r = await run(A, [{ name: 'Flour (organic)', sku: 'F-1', barcode: '111', category: 'Baking', tags: ['Dry'], quantity: '999' }], true)
    expect(r).toEqual({ created: 0, updated: 1, skipped: 0 })
    const flour = (await products()).find((p) => p.sku === 'F-1')!
    expect(flour.name).toBe('Flour (organic)')
    expect(Number(flour.quantity)).toBe(20)
    const tagCount = (await db.query<{ n: string }>("select count(*) as n from public.product_tags pt join public.products p on p.id = pt.product_id where p.sku = 'F-1'")).rows[0]!.n
    expect(Number(tagCount)).toBe(1)
  })

  it('is all-or-nothing and reports the failing row', async () => {
    const before = (await products()).length
    await rejects(run(A, [{ name: 'Good one', sku: 'G-1' }, { name: 'Bad date', sku: 'B-1', expires_on: 'not-a-date' }]), /Row 2:/)
    await rejects(run(A, [{ name: 'Fine', sku: 'OK-1' }, { sku: 'NO-NAME' }]), /Row 2: name is required/)
    expect((await products()).length).toBe(before)
  })

  it('treats a repeated SKU inside one file as an existing product (the preview flags it first)', async () => {
    expect(await run(A, [{ name: 'Dup A', sku: 'D-1' }, { name: 'Dup B', sku: 'D-1' }])).toEqual({ created: 1, updated: 0, skipped: 1 })
  })

  it('refuses opening stock for expired products', async () => {
    await rejects(run(A, [{ name: 'Old milk', sku: 'M-1', expires_on: '2000-01-01', quantity: '3' }]), /Row 1: .*expired/)
  })

  it('enforces permissions and size limits', async () => {
    await rejects(run(B, [{ name: 'X' }]), /do not have permission/)
    await rejects(run(C, [{ name: 'X' }]), /do not have permission/) // viewer
    await rejects(run(A, Array.from({ length: 5001 }, (_, i) => ({ name: `n${i}` }))), /at most 5000/)
  })

  it('writes an audit entry', async () => {
    const n = (await db.query<{ n: string }>("select count(*) as n from public.audit_logs where action = 'import.products' and inventory_id = $1", [inv])).rows[0]!.n
    expect(Number(n)).toBeGreaterThanOrEqual(3)
  })
})

describe('demo data', () => {
  const seed = (uid: string, org = orgA) => as(uid, async () => (await db.query<{ id: string }>('select public.seed_demo_data($1) as id', [org])).rows[0]!.id)
  let demo: string

  it('only admins and owners can load it', async () => {
    await rejects(seed(B, orgA), /Only admins and owners/)
    await rejects(seed(C, orgA), /Only admins and owners/) // viewer
  })

  it('creates a flagged inventory, and is idempotent', async () => {
    demo = await seed(A)
    expect(await seed(A)).toBe(demo)
    const inv = (await db.query<{ is_demo: boolean; name: string }>('select is_demo, name from public.inventories where id = $1', [demo])).rows[0]!
    expect(inv).toEqual({ is_demo: true, name: 'Demo Store (sample data)' })
  })

  it('fills every module with realistic data', async () => {
    const one = async (sql: string) => Number((await db.query<{ n: string }>(sql, [demo])).rows[0]!.n)
    expect(await one('select count(*) as n from public.products where inventory_id = $1')).toBeGreaterThanOrEqual(35)
    expect(await one('select count(*) as n from public.categories where inventory_id = $1')).toBe(7)
    expect(await one('select count(*) as n from public.tags where inventory_id = $1')).toBe(6)
    expect(await one('select count(*) as n from public.product_tags where inventory_id = $1')).toBeGreaterThan(20)
    expect(await one("select count(*) as n from public.products where inventory_id = $1 and archived_at is not null")).toBe(2)
    for (const state of ['ok', 'low', 'out']) {
      expect(await one(`select count(*) as n from public.products where inventory_id = $1 and archived_at is null and stock_state = '${state}'`)).toBeGreaterThan(0)
    }
    expect(await one('select count(*) as n from public.products where inventory_id = $1 and expires_on < current_date')).toBeGreaterThan(0)
    expect(await one('select count(*) as n from public.products where inventory_id = $1 and expires_on between current_date and current_date + 30')).toBeGreaterThan(0)
    expect(await one('select count(*) as n from public.stock_movements where inventory_id = $1')).toBeGreaterThan(150)
    for (const type of ['in', 'out', 'adjustment', 'correction']) {
      expect(await one(`select count(*) as n from public.stock_movements where inventory_id = $1 and movement_type = '${type}'`)).toBeGreaterThan(0)
    }
  })

  it('keeps the ledger exact: balances chain, never go negative, and match each product', async () => {
    const bad = (await db.query<{ n: string }>(
      `select count(*) as n from (
         select m.product_id, m.quantity_before,
                lag(m.quantity_after, 1, 0::numeric) over (partition by m.product_id order by m.created_at, m.id) as prev_after,
                m.quantity_after
         from public.stock_movements m where m.inventory_id = $1
       ) x where x.quantity_before <> x.prev_after or x.quantity_after < 0`,
      [demo],
    )).rows[0]!.n
    expect(Number(bad)).toBe(0)
    const mismatch = (await db.query<{ n: string }>(
      `select count(*) as n from public.products p
       where p.inventory_id = $1
         and p.quantity <> (select coalesce(sum(delta), 0) from public.stock_movements m where m.product_id = p.id)`,
      [demo],
    )).rows[0]!.n
    expect(Number(mismatch)).toBe(0)
  })

  it('uses valid EAN-13 barcodes and places events in the past', async () => {
    const codes = (await db.query<{ barcode: string }>('select barcode from public.products where inventory_id = $1', [demo])).rows.map((r) => r.barcode)
    for (const code of codes) {
      expect(code).toMatch(/^\d{13}$/)
      const sum = [...code.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
      expect((10 - (sum % 10)) % 10).toBe(Number(code[12]))
    }
    const future = (await db.query<{ n: string }>('select count(*) as n from public.stock_movements where inventory_id = $1 and created_at > now()', [demo])).rows[0]!.n
    expect(Number(future)).toBe(0)
  })

  it('produces the alerts and audit entry those states imply', async () => {
    const kinds = (await db.query<{ kind: string }>('select distinct kind from public.notifications where inventory_id = $1', [demo])).rows.map((r) => r.kind).sort()
    expect(kinds).toEqual(['expired', 'expiring', 'low_stock', 'out_of_stock'])
    const audit = (await db.query<{ details: { products: number } }>("select details from public.audit_logs where inventory_id = $1 and action = 'demo.seed'", [demo])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]!.details.products).toBeGreaterThanOrEqual(35)
  })

  it('works with the dashboard summary', async () => {
    const s = (await as(A, async () => (await db.query<{ total_products: string; low_stock: string; out_of_stock: string; expired: string }>('select * from public.inventory_summary($1)', [demo])).rows[0]!))
    expect(Number(s.total_products)).toBeGreaterThanOrEqual(35)
    expect(Number(s.low_stock)).toBeGreaterThan(0)
    expect(Number(s.out_of_stock)).toBeGreaterThan(0)
    expect(Number(s.expired)).toBeGreaterThan(0)
  })

  it('removal deletes only demo data and nothing else', async () => {
    const real = Number((await db.query<{ n: string }>('select count(*) as n from public.products where inventory_id = $1', [invA])).rows[0]!.n)
    await rejects(as(C, () => db.query('select public.remove_demo_data($1)', [orgA])), /Only admins and owners/)
    expect(await as(A, async () => Number((await db.query<{ n: number }>('select public.remove_demo_data($1) as n', [orgA])).rows[0]!.n))).toBe(1)
    for (const table of ['inventories', 'products', 'categories', 'tags', 'stock_movements', 'notifications', 'audit_logs']) {
      const col = table === 'inventories' ? 'id' : 'inventory_id'
      const left = (await db.query<{ n: string }>(`select count(*) as n from public.${table} where ${col} = $1`, [demo])).rows[0]!.n
      expect(Number(left)).toBe(0)
    }
    expect(Number((await db.query<{ n: string }>('select count(*) as n from public.products where inventory_id = $1', [invA])).rows[0]!.n)).toBe(real)
    expect(await as(A, async () => Number((await db.query<{ n: number }>('select public.remove_demo_data($1) as n', [orgA])).rows[0]!.n))).toBe(0)
  })

  it('can be loaded again after removal', async () => {
    const again = await seed(A)
    expect(again).not.toBe(demo)
    expect(Number((await db.query<{ n: string }>('select count(*) as n from public.products where inventory_id = $1', [again])).rows[0]!.n)).toBeGreaterThanOrEqual(35)
  })
})

describe('transfers between inventories', () => {
  let wh: string // source
  let shop: string // destination
  let rice: string
  let oil: string
  let t1: string

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
  const qty = async (id: string) => Number((await q<{ quantity: string }>('select quantity from public.products where id = $1', [id]))[0]!.quantity)
  const dispatch = (uid: string, lines: unknown[], opts: { src?: string; dst?: string; op?: string; note?: string | null } = {}) =>
    as(uid, async () => (await db.query<{ id: string }>('select public.dispatch_transfer($1, $2, $3::jsonb, $4, $5) as id', [opts.src ?? wh, opts.dst ?? shop, JSON.stringify(lines), opts.note ?? null, opts.op ?? op()])).rows[0]!.id)
  const receive = (uid: string, transfer: string, lines: unknown[], opId: string = op()) =>
    as(uid, async () => (await db.query<{ r: { status: string; outstanding: number } }>('select public.receive_transfer($1, $2::jsonb, $3) as r', [transfer, JSON.stringify(lines), opId])).rows[0]!.r)
  const lineFor = async (transfer: string, product: string) =>
    (await q<{ id: string; quantity_sent: string; quantity_received: string; destination_product_id: string | null }>(
      'select id, quantity_sent, quantity_received, destination_product_id from public.transfer_lines where transfer_id = $1 and source_product_id = $2',
      [transfer, product],
    ))[0]!

  beforeAll(async () => {
    wh = (await q<{ id: string }>("insert into public.inventories (organization_id, name, created_by) values ($1, 'Warehouse', $2) returning id", [orgA, A]))[0]!.id
    shop = (await q<{ id: string }>("insert into public.inventories (organization_id, name, created_by) values ($1, 'Shop', $2) returning id", [orgA, A]))[0]!.id
    rice = (await q<{ id: string }>("insert into public.products (inventory_id, name, sku, barcode, unit, created_by) values ($1, 'Rice 5kg', 'R-5', '8901234567890', 'bag', $2) returning id", [wh, A]))[0]!.id
    oil = (await q<{ id: string }>("insert into public.products (inventory_id, name, sku, unit, created_by) values ($1, 'Oil 1L', 'O-1', 'btl', $2) returning id", [wh, A]))[0]!.id
    await as(A, async () => {
      await db.query("select public.record_stock_movement($1, 'in', 20, $2)", [rice, op()])
      await db.query("select public.record_stock_movement($1, 'in', 5, $2)", [oil, op()])
    })
  })

  it('dispatch removes stock from the source and leaves the transfer in transit', async () => {
    t1 = await dispatch(A, [{ product_id: rice, quantity: 8 }, { product_id: oil, quantity: 2 }], { note: 'Weekly top-up' })
    expect(await qty(rice)).toBe(12)
    expect(await qty(oil)).toBe(3)
    const t = (await q<{ status: string; reference: string; note: string }>('select status, reference, note from public.transfers where id = $1', [t1]))[0]!
    expect(t.status).toBe('in_transit')
    expect(t.reference).toMatch(/^TR-\d{5}$/)
    const moves = await q<{ movement_type: string; reference: string; delta: string }>('select movement_type, reference, delta from public.stock_movements where transfer_id = $1 order by delta', [t1])
    expect(moves.map((m) => [m.movement_type, Number(m.delta), m.reference])).toEqual([['out', -8, t.reference], ['out', -2, t.reference]])
    const n = await q<{ kind: string }>("select kind from public.notifications where kind = 'transfer_incoming' and inventory_id = $1", [shop])
    expect(n).toHaveLength(1)
  })

  it('is idempotent for the same operation id', async () => {
    const opId = op()
    const first = await dispatch(A, [{ product_id: oil, quantity: 1 }], { op: opId })
    expect(await dispatch(A, [{ product_id: oil, quantity: 1 }], { op: opId })).toBe(first)
    expect(await qty(oil)).toBe(2) // 3 - 1, applied once
    await as(A, () => db.query('select public.cancel_transfer($1)', [first]))
    expect(await qty(oil)).toBe(3)
  })

  it('is all-or-nothing: an overdraw anywhere aborts the whole dispatch', async () => {
    const before = [await qty(rice), await qty(oil)]
    await rejects(dispatch(A, [{ product_id: rice, quantity: 1 }, { product_id: oil, quantity: 99 }]), /Oil 1L: Insufficient stock/)
    expect([await qty(rice), await qty(oil)]).toEqual(before)
    const count = (await q<{ n: string }>("select count(*) as n from public.transfers where status = 'in_transit'"))[0]!.n
    expect(Number(count)).toBe(1) // only t1
  })

  it('validates inventories, lines and roles', async () => {
    const someone = (await q<{ id: string }>('select id from public.products where inventory_id = $1 limit 1', [invA]))[0]!.id
    await rejects(dispatch(A, [{ product_id: rice, quantity: 1 }], { dst: wh }), /different destination/)
    await rejects(dispatch(A, []), /at least one item/)
    await rejects(dispatch(A, [{ product_id: rice, quantity: 0 }]), /greater than zero/)
    await rejects(dispatch(A, [{ product_id: rice, quantity: 1 }, { product_id: rice, quantity: 1 }]), /only once/)
    await rejects(dispatch(A, [{ product_id: someone, quantity: 1 }]), /not part of Warehouse/)
    await rejects(dispatch(C, [{ product_id: rice, quantity: 1 }]), /permission/) // viewer
    await rejects(dispatch(B, [{ product_id: rice, quantity: 1 }]), /Inventory not found|permission/) // other org
  })

  it('refuses transfers across organizations', async () => {
    const orgB = (await q<{ organization_id: string }>('select organization_id from public.organization_members where user_id = $1', [B]))[0]!.organization_id
    const foreign = (await q<{ id: string }>("insert into public.inventories (organization_id, name, created_by) values ($1, 'Elsewhere', $2) returning id", [orgB, B]))[0]!.id
    await rejects(dispatch(A, [{ product_id: rice, quantity: 1 }], { dst: foreign }), /same organization/)
  })

  it('partial receipt creates the product at the destination and keeps the transfer in transit', async () => {
    const line = await lineFor(t1, rice)
    const r = await receive(A, t1, [{ line_id: line.id, quantity: 3 }])
    expect(r).toEqual({ status: 'in_transit', outstanding: 7 }) // 5 rice + 2 oil remain
    const dest = (await q<{ id: string; name: string; barcode: string; quantity: string; unit: string }>('select id, name, barcode, quantity, unit from public.products where inventory_id = $1 and sku = $2', [shop, 'R-5']))[0]!
    expect(dest).toMatchObject({ name: 'Rice 5kg', barcode: '8901234567890', unit: 'bag' })
    expect(Number(dest.quantity)).toBe(3)
    expect((await lineFor(t1, rice)).destination_product_id).toBe(dest.id)
    const mv = (await q<{ movement_type: string; transfer_id: string }>('select movement_type, transfer_id from public.stock_movements where product_id = $1', [dest.id]))[0]!
    expect(mv).toMatchObject({ movement_type: 'in', transfer_id: t1 })
  })

  it('does not double count a replayed receive', async () => {
    const line = await lineFor(t1, rice)
    const opId = op()
    await receive(A, t1, [{ line_id: line.id, quantity: 1 }], opId)
    await receive(A, t1, [{ line_id: line.id, quantity: 1 }], opId)
    expect(Number((await lineFor(t1, rice)).quantity_received)).toBe(4)
  })

  it('rejects over-receipt and matches existing destination products by SKU', async () => {
    const line = await lineFor(t1, rice)
    await rejects(receive(A, t1, [{ line_id: line.id, quantity: 5 }]), /cannot receive more than was sent \(sent 8, already received 4\)/)
    await rejects(receive(B, t1, [{ line_id: line.id, quantity: 1 }]), /not found or you do not have permission/)
    const existing = (await q<{ id: string }>("insert into public.products (inventory_id, name, sku, unit, created_by) values ($1, 'Oil (shop name)', 'o-1', 'btl', $2) returning id", [shop, A]))[0]!.id
    const oilLine = await lineFor(t1, oil)
    await receive(A, t1, [{ line_id: oilLine.id, quantity: 2 }])
    expect((await lineFor(t1, oil)).destination_product_id).toBe(existing) // matched by SKU, case-insensitive
    expect(await qty(existing)).toBe(2)
  })

  it('completes automatically when everything has arrived', async () => {
    const line = await lineFor(t1, rice)
    const r = await receive(A, t1, [{ line_id: line.id, quantity: 4 }])
    expect(r).toEqual({ status: 'completed', outstanding: 0 })
    const t = (await q<{ status: string; completed_at: string }>('select status, completed_at from public.transfers where id = $1', [t1]))[0]!
    expect(t.status).toBe('completed')
    expect(t.completed_at).not.toBeNull()
    await rejects(receive(A, t1, [{ line_id: line.id, quantity: 1 }]), /already completed/)
    await rejects(as(A, () => db.query('select public.cancel_transfer($1)', [t1])), /already completed/)
  })

  it('conserves stock: sent equals received across both inventories', async () => {
    expect(await qty(rice)).toBe(12) // source
    const destRice = (await q<{ quantity: string }>("select quantity from public.products where inventory_id = $1 and sku = 'R-5'", [shop]))[0]!.quantity
    expect(Number(destRice) + (await qty(rice))).toBe(20)
    const ledger = await q<{ net: string }>('select sum(delta) as net from public.stock_movements where transfer_id = $1', [t1])
    expect(Number(ledger[0]!.net)).toBe(0) // out and in cancel
  })

  it('closing short records the shortage and raises a discrepancy alert', async () => {
    const t2 = await dispatch(A, [{ product_id: rice, quantity: 4 }])
    const line = await lineFor(t2, rice)
    await receive(A, t2, [{ line_id: line.id, quantity: 3 }])
    await rejects(as(C, () => db.query('select public.close_transfer($1)', [t2])), /permission/)
    await as(A, () => db.query("select public.close_transfer($1, 'One box damaged')", [t2]))
    const t = (await q<{ status: string; closed_note: string }>('select status, closed_note from public.transfers where id = $1', [t2]))[0]!
    expect(t).toEqual({ status: 'completed', closed_note: 'One box damaged' })
    const l = await lineFor(t2, rice)
    expect(Number(l.quantity_sent) - Number(l.quantity_received)).toBe(1)
    const alert = await q<{ body: string }>("select body from public.notifications where kind = 'transfer_discrepancy'")
    expect(alert.at(-1)!.body).toContain('1 unit(s)')
    expect(await qty(rice)).toBe(8) // 12 - 4; the missing unit is not returned automatically
  })

  it('cancelling returns everything to the source, but not after a receipt', async () => {
    const before = await qty(rice)
    const t3 = await dispatch(A, [{ product_id: rice, quantity: 2 }])
    expect(await qty(rice)).toBe(before - 2)
    await as(A, () => db.query('select public.cancel_transfer($1)', [t3]))
    expect(await qty(rice)).toBe(before)
    expect((await q<{ status: string }>('select status from public.transfers where id = $1', [t3]))[0]!.status).toBe('cancelled')

    const t4 = await dispatch(A, [{ product_id: rice, quantity: 2 }])
    await receive(A, t4, [{ line_id: (await lineFor(t4, rice)).id, quantity: 1 }])
    await rejects(as(A, () => db.query('select public.cancel_transfer($1)', [t4])), /already been received/)
  })

  it('cannot be written directly, is private to the organization, and is audited', async () => {
    await as(A, async () => {
      await rejects(db.query("update public.transfers set status = 'completed'"), /permission denied/)
      await rejects(db.query('update public.transfer_lines set quantity_received = quantity_sent'), /permission denied/)
    })
    await as(B, async () => {
      expect((await db.query('select 1 from public.transfers')).rows).toHaveLength(0)
      expect((await db.query('select 1 from public.transfer_lines')).rows).toHaveLength(0)
    })
    await as(C, async () => {
      expect((await db.query('select 1 from public.transfers')).rows.length).toBeGreaterThan(0)
    })
    const actions = (await q<{ action: string }>("select distinct action from public.audit_logs where action like 'transfer.%'")).map((r) => r.action).sort()
    expect(actions).toEqual(['transfer.cancel', 'transfer.close', 'transfer.complete', 'transfer.dispatch', 'transfer.receive'])
  })

  it('refuses to receive expired stock at the destination', async () => {
    const milk = (await q<{ id: string }>("insert into public.products (inventory_id, name, sku, unit, expires_on, created_by) values ($1, 'Old milk', 'MK-1', 'btl', current_date + 5, $2) returning id", [wh, A]))[0]!.id
    await as(A, () => db.query("select public.record_stock_movement($1, 'in', 4, $2)", [milk, op()]))
    await db.query('update public.products set expires_on = current_date - 1 where id = $1', [milk])
    const t = await dispatch(A, [{ product_id: milk, quantity: 2 }]) // expired stock may leave (disposal) ...
    const line = await lineFor(t, milk)
    await rejects(receive(A, t, [{ line_id: line.id, quantity: 2 }]), /Old milk: .*expired/)
    // The failed receive left nothing behind: no destination product, nothing counted as received.
    expect(Number((await lineFor(t, milk)).quantity_received)).toBe(0)
    expect(await q('select 1 from public.products where inventory_id = $1 and sku = $2', [shop, 'MK-1'])).toHaveLength(0)
  })

  it('carries the expiration date to a product created at the destination', async () => {
    const yogurt = (await q<{ id: string }>("insert into public.products (inventory_id, name, sku, unit, expires_on, created_by) values ($1, 'Yogurt', 'YG-1', 'tub', current_date + 9, $2) returning id", [wh, A]))[0]!.id
    await as(A, () => db.query("select public.record_stock_movement($1, 'in', 6, $2)", [yogurt, op()]))
    const t = await dispatch(A, [{ product_id: yogurt, quantity: 3 }])
    await receive(A, t, [{ line_id: (await lineFor(t, yogurt)).id, quantity: 3 }])
    const dest = (await q<{ expires_on: string }>("select to_char(expires_on, 'YYYY-MM-DD') as expires_on from public.products where inventory_id = $1 and sku = 'YG-1'", [shop]))[0]!
    const src = (await q<{ expires_on: string }>("select to_char(expires_on, 'YYYY-MM-DD') as expires_on from public.products where id = $1", [yogurt]))[0]!
    expect(dest.expires_on).toBe(src.expires_on)
  })
})
