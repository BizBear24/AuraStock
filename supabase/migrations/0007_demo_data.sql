-- Demo data: a realistic, clearly-labelled sample inventory that exercises every module, plus a clean way
-- to remove it again. Demo inventories are flagged `is_demo`; removing them deletes only those inventories
-- (and everything in them) and never touches real data.

alter table public.inventories add column is_demo boolean not null default false;
create unique index inventories_one_demo_per_org on public.inventories (organization_id) where is_demo;

-- Valid EAN-13 barcode from a 12-digit prefix (so scanners and checksum validators accept demo codes).
create or replace function public._demo_ean13(p12 text) returns text
language sql immutable as $$
  select p12 || ((10 - (sum(substr(p12, i, 1)::int * case when i % 2 = 0 then 3 else 1 end) % 10)) % 10)::text
  from generate_series(1, 12) i
$$;
revoke all on function public._demo_ean13(text) from public, anon, authenticated;

-- Creates the sample inventory and returns its id. Idempotent: returns the existing one if already loaded.
--
-- What it contains: ~38 products in 7 categories with tags, units, barcodes/QR values and minimum levels;
-- a 28-day stock ledger (opening stock, sales, restocks, cycle-count adjustments, corrections) whose
-- balances always add up; products that are healthy, low, out of stock, expiring and expired; archived
-- products; and the stored alerts and audit entry those states naturally produce.
create or replace function public.seed_demo_data(p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv uuid;
  r record;
  pid uuid;
  cat_id uuid;
  tag text;
  tag_id uuid;
  base_ts timestamptz := date_trunc('day', now());
  idx int;
  target numeric;
  s1 numeric;
  restock numeric;
  adj numeric;
  corr numeric;
  opening numeric;
  balance numeric;
  n int;
  k int;
  amt numeric;
  d int;
  seq int := 0;
  n_products int := 0;
  n_movements int := 0;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'Only admins and owners can load demo data' using errcode = '42501';
  end if;

  select id into inv from public.inventories where organization_id = p_org and is_demo;
  if found then
    return inv;
  end if;

  perform setseed(0.37); -- deterministic sample data
  perform set_config('app.stock_write', 'on', true);

  insert into public.inventories (organization_id, name, description, is_demo, created_by)
  values (p_org, 'Demo Store (sample data)', 'Sample data for exploring AuraStock. Safe to remove at any time.', true, uid)
  returning id into inv;

  insert into public.categories (inventory_id, name)
  select inv, c from unnest(array['Groceries', 'Dairy', 'Bakery', 'Beverages', 'Frozen', 'Cleaning', 'Stationery']) c;
  insert into public.tags (inventory_id, name)
  select inv, t from unnest(array['Organic', 'Bulk', 'Cold chain', 'Fragile', 'Seasonal', 'Best seller']) t;

  for r in
    select row_number() over () as n, *
    from (values
      -- name, sku, category, unit, min_stock, target_qty, expiry_offset_days, tags, archived
      ('Basmati Rice 5 kg',            'GRO-001', 'Groceries', 'bag', 10, 42,  null, array['Bulk', 'Best seller'], false),
      ('Sunflower Oil 1 L',            'GRO-002', 'Groceries', 'btl', 12, 8,   null, array['Best seller'],         false),
      ('Whole Wheat Flour 1 kg',       'GRO-003', 'Groceries', 'pkt', 15, 36,  null, array['Bulk'],                false),
      ('Cane Sugar 1 kg',              'GRO-004', 'Groceries', 'pkt', 15, 54,  null, array['Bulk'],                false),
      ('Iodized Salt 1 kg',            'GRO-005', 'Groceries', 'pkt', 10, 0,   null, array[]::text[],              false),
      ('Red Lentils 500 g',            'GRO-006', 'Groceries', 'pkt', 10, 27,  null, array['Organic'],             false),
      ('Chickpeas 500 g',              'GRO-007', 'Groceries', 'pkt', 10, 6,   null, array['Organic'],             false),
      ('Assam Tea 250 g',              'GRO-008', 'Groceries', 'box', 8,  19,  null, array['Best seller'],         false),
      ('Instant Coffee 100 g',         'GRO-009', 'Groceries', 'jar', 8,  23,  null, array[]::text[],              false),
      ('Peanut Butter 340 g',          'GRO-010', 'Groceries', 'jar', 6,  4,   null, array[]::text[],              false),
      ('Whole Milk 1 L',               'DAI-001', 'Dairy',     'btl', 20, 64,  4,    array['Cold chain', 'Best seller'], false),
      ('Greek Yogurt 500 g',           'DAI-002', 'Dairy',     'tub', 12, 31,  9,    array['Cold chain'],          false),
      ('Cheddar Cheese 200 g',         'DAI-003', 'Dairy',     'pkt', 10, 18,  21,   array['Cold chain'],          false),
      ('Salted Butter 250 g',          'DAI-004', 'Dairy',     'pkt', 10, 14,  -2,   array['Cold chain'],          false),
      ('Paneer 200 g',                 'DAI-005', 'Dairy',     'pkt', 8,  5,   6,    array['Cold chain', 'Organic'], false),
      ('Fresh Cream 250 ml',           'DAI-006', 'Dairy',     'btl', 8,  0,   2,    array['Cold chain'],          false),
      ('Sourdough Loaf',               'BAK-001', 'Bakery',    'pcs', 10, 22,  2,    array['Best seller'],         false),
      ('Butter Croissant 4-pack',      'BAK-002', 'Bakery',    'pkt', 8,  16,  1,    array['Fragile'],             false),
      ('Plain Bagels 6-pack',          'BAK-003', 'Bakery',    'pkt', 6,  9,   -1,   array[]::text[],              false),
      ('Orange Juice 1 L',             'BEV-001', 'Beverages', 'btl', 15, 48,  12,   array['Cold chain'],          false),
      ('Sparkling Water 6-pack',       'BEV-002', 'Beverages', 'pkt', 10, 33,  null, array['Bulk'],                false),
      ('Cola 330 ml (24 cans)',        'BEV-003', 'Beverages', 'box', 6,  7,   null, array['Bulk', 'Best seller'], false),
      ('Green Tea Bags (50)',          'BEV-004', 'Beverages', 'box', 8,  26,  null, array['Organic'],             false),
      ('Energy Drink 250 ml',          'BEV-005', 'Beverages', 'can', 24, 0,   null, array[]::text[],              false),
      ('Frozen Green Peas 1 kg',       'FRZ-001', 'Frozen',    'pkt', 10, 40,  120,  array['Cold chain', 'Bulk'],  false),
      ('Vanilla Ice Cream 1 L',        'FRZ-002', 'Frozen',    'tub', 8,  3,   90,   array['Cold chain', 'Seasonal'], false),
      ('Fish Fingers 500 g',           'FRZ-003', 'Frozen',    'pkt', 8,  17,  60,   array['Cold chain'],          false),
      ('Margherita Pizza 350 g',       'FRZ-004', 'Frozen',    'pcs', 8,  21,  75,   array['Cold chain'],          false),
      ('Dish Soap 500 ml',             'CLN-001', 'Cleaning',  'btl', 10, 38,  null, array[]::text[],              false),
      ('Laundry Detergent 2 L',        'CLN-002', 'Cleaning',  'btl', 8,  12,  null, array['Bulk'],                false),
      ('Paper Towels 6 rolls',         'CLN-003', 'Cleaning',  'pkt', 10, 9,   null, array[]::text[],              false),
      ('Trash Bags 30 ct',             'CLN-004', 'Cleaning',  'box', 8,  0,   null, array[]::text[],              false),
      ('Hand Sanitizer 250 ml',        'CLN-005', 'Cleaning',  'btl', 12, 29,  330,  array['Fragile'],             false),
      ('A4 Copy Paper 500 sheets',     'STA-001', 'Stationery','ream', 10, 45, null, array['Bulk'],                false),
      ('Ballpoint Pens (10)',          'STA-002', 'Stationery','box', 6,  13,  null, array[]::text[],              false),
      ('Sticky Notes 3 x 3',           'STA-003', 'Stationery','pad', 10, 2,   null, array[]::text[],              false),
      ('Discontinued Mug Set',         'STA-090', 'Stationery','set', 2,  0,   null, array['Seasonal'],            true),
      ('Seasonal Gift Hamper',         'GRO-090', 'Groceries', 'box', 2,  0,   null, array['Seasonal', 'Fragile'], true)
    ) as t(name, sku, category, unit, min_stock, target_qty, expiry_days, tags, archived)
  loop
    idx := r.n;
    target := r.target_qty;

    select id into cat_id from public.categories where inventory_id = inv and name = r.category;
    insert into public.products (inventory_id, name, sku, barcode, qr_code, description, category_id, unit, min_stock, expires_on, created_by, created_at)
    values (
      inv, r.name, r.sku, public._demo_ean13('590' || lpad(idx::text, 9, '0')),
      case when idx % 4 = 0 then 'AS-DEMO-' || r.sku end,
      'Sample ' || lower(r.category) || ' item for demonstration.',
      cat_id, r.unit, r.min_stock,
      case when r.expiry_days is null then null else current_date + r.expiry_days end,
      uid, now() - interval '29 days'
    ) returning id into pid;
    n_products := n_products + 1;

    foreach tag in array r.tags loop
      select id into tag_id from public.tags where inventory_id = inv and name = tag;
      insert into public.product_tags (product_id, tag_id, inventory_id) values (pid, tag_id, inv);
    end loop;

    -- Plan the ledger so every balance is non-negative and the last one equals the target.
    adj := case when idx % 5 = 0 and target >= 2 then 1 else 0 end;   -- cycle-count shrinkage
    corr := case when idx % 11 = 0 and target >= 2 then 2 else 0 end; -- stock found
    s1 := case when target = 0 then 8 + floor(random() * 20) else round(target * (0.4 + random() * 0.8)) + 3 end;
    restock := case when r.archived or random() < 0.25 then 0 else round(target * (0.3 + random() * 0.5)) + 2 end;
    opening := target + s1 + adj - corr;
    balance := 0;

    -- Opening stock, 28 days ago.
    seq := seq + 1;
    insert into public.stock_movements (inventory_id, product_id, movement_type, delta, quantity_before, quantity_after, reference, note, operation_id, created_by, created_at)
    values (inv, pid, 'in', opening, 0, opening, 'PO-' || (1000 + idx), 'Opening stock', gen_random_uuid(), uid,
            base_ts - interval '28 days' + interval '9 hours' + (idx % 50) * interval '1 minute');
    balance := opening;
    n_movements := n_movements + 1;

    -- Sales before the restock (days 27..16).
    n := least(5, greatest(2, ceil(s1 / 6.0)::int));
    n := least(n, s1::int);
    for k in 1..n loop
      amt := case when k < n then floor(s1 / n) else s1 - floor(s1 / n) * (n - 1) end;
      continue when amt <= 0;
      d := 27 - ((k - 1) * 11) / n;
      insert into public.stock_movements (inventory_id, product_id, movement_type, delta, quantity_before, quantity_after, reference, operation_id, created_by, created_at)
      values (inv, pid, 'out', -amt, balance, balance - amt, 'SO-' || (2000 + idx * 10 + k), gen_random_uuid(), uid,
              base_ts - make_interval(days => d) + make_interval(hours => 10 + (idx + k) % 8, mins => (idx * 7 + k * 13) % 60));
      balance := balance - amt;
      n_movements := n_movements + 1;
    end loop;

    -- Stock found during a count (correction), day 15.
    if corr > 0 then
      insert into public.stock_movements (inventory_id, product_id, movement_type, delta, quantity_before, quantity_after, note, operation_id, created_by, created_at)
      values (inv, pid, 'correction', corr, balance, balance + corr, 'Found 2 units misplaced on another shelf', gen_random_uuid(), uid,
              base_ts - interval '15 days' + interval '11 hours');
      balance := balance + corr;
      n_movements := n_movements + 1;
    end if;

    -- Restock, day 14.
    if restock > 0 then
      insert into public.stock_movements (inventory_id, product_id, movement_type, delta, quantity_before, quantity_after, reference, note, operation_id, created_by, created_at)
      values (inv, pid, 'in', restock, balance, balance + restock, 'PO-' || (1500 + idx), 'Weekly restock', gen_random_uuid(), uid,
              base_ts - interval '14 days' + interval '8 hours' + (idx % 40) * interval '1 minute');
      balance := balance + restock;
      n_movements := n_movements + 1;

      -- Sales after the restock (days 13..2) consume exactly the restock.
      n := least(4, greatest(2, ceil(restock / 6.0)::int));
      n := least(n, restock::int);
      for k in 1..n loop
        amt := case when k < n then floor(restock / n) else restock - floor(restock / n) * (n - 1) end;
        continue when amt <= 0;
        d := 13 - ((k - 1) * 11) / n;
        insert into public.stock_movements (inventory_id, product_id, movement_type, delta, quantity_before, quantity_after, reference, operation_id, created_by, created_at)
        values (inv, pid, 'out', -amt, balance, balance - amt, 'SO-' || (3000 + idx * 10 + k), gen_random_uuid(), uid,
                base_ts - make_interval(days => d) + make_interval(hours => 9 + (idx + k) % 9, mins => (idx * 11 + k * 17) % 60));
        balance := balance - amt;
        n_movements := n_movements + 1;
      end loop;
    end if;

    -- Cycle-count adjustment on the last day: shrinkage of one unit.
    if adj > 0 then
      insert into public.stock_movements (inventory_id, product_id, movement_type, delta, quantity_before, quantity_after, note, operation_id, created_by, created_at)
      values (inv, pid, 'adjustment', -adj, balance, balance - adj, 'Cycle count: 1 unit short', gen_random_uuid(), uid,
              base_ts - interval '1 day' + interval '16 hours');
      balance := balance - adj;
      n_movements := n_movements + 1;
    end if;

    if balance <> target then
      raise exception 'Demo ledger for % ended at % instead of %', r.sku, balance, target;
    end if;

    -- Two quantity updates so the alert triggers see a healthy -> low/out transition.
    update public.products set quantity = opening where id = pid;
    update public.products set quantity = target where id = pid;

    if r.archived then
      update public.products set archived_at = now() - interval '3 days' where id = pid;
    end if;
  end loop;

  perform set_config('app.stock_write', 'off', true);

  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, inv, uid, 'demo.seed', 'inventory', inv, jsonb_build_object('products', n_products, 'movements', n_movements));

  return inv;
end $$;

-- Deletes the organization's demo inventory (and its products, movements, alerts and audit entries).
-- Returns how many demo inventories were removed (0 or 1). Real inventories are never touched.
create or replace function public.remove_demo_data(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'Only admins and owners can remove demo data' using errcode = '42501';
  end if;
  delete from public.inventories where organization_id = p_org and is_demo;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.seed_demo_data(uuid) from public, anon;
revoke all on function public.remove_demo_data(uuid) from public, anon;
grant execute on function public.seed_demo_data(uuid) to authenticated;
grant execute on function public.remove_demo_data(uuid) to authenticated;
