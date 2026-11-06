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
