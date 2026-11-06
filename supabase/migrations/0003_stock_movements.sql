-- Phase 3: immutable stock movements, audit log, transactional stock function.
--
-- Negative-stock policy: stock can never go below zero. A movement that would do so is rejected
-- with an "Insufficient stock" error and nothing is written.

create type public.movement_type as enum ('in', 'out', 'adjustment', 'correction');

-- ------------------------------------------------------------- audit_logs
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  inventory_id uuid references public.inventories (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------- stock_movements
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories (id) on delete cascade,
  product_id uuid not null,
  movement_type public.movement_type not null,
  delta numeric(14, 3) not null check (delta <> 0),
  quantity_before numeric(14, 3) not null check (quantity_before >= 0),
  quantity_after numeric(14, 3) not null check (quantity_after >= 0),
  reference text check (reference is null or char_length(reference) <= 64),
  note text check (note is null or char_length(note) <= 500),
  -- Client-generated idempotency key: replaying the same operation never double-applies.
  operation_id uuid not null,
  corrects_movement_id uuid references public.stock_movements (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (quantity_after = quantity_before + delta),
  check (
    (movement_type = 'in' and delta > 0)
    or (movement_type = 'out' and delta < 0)
    or movement_type in ('adjustment', 'correction')
  ),
  unique (inventory_id, operation_id),
  -- NO ACTION: a product that has history cannot be deleted directly.
  foreign key (product_id, inventory_id) references public.products (id, inventory_id)
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index stock_movements_inventory_idx on public.stock_movements (inventory_id, created_at desc);

-- Append-only: rows may never be updated; they may only disappear when their whole inventory is deleted.
create or replace function public.reject_ledger_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% rows are immutable', tg_table_name;
  end if;
  if tg_op = 'DELETE' and exists (select 1 from public.inventories where id = old.inventory_id) then
    raise exception '% rows are immutable', tg_table_name;
  end if;
  return old;
end $$;
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.reject_ledger_change();

-- audit_logs has no inventory-level cascade guarantee, so protect against UPDATE and ad-hoc DELETE.
create or replace function public.reject_audit_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_logs rows are immutable';
  end if;
  if tg_op = 'DELETE' and exists (select 1 from public.organizations where id = old.organization_id) then
    if old.inventory_id is null or exists (select 1 from public.inventories where id = old.inventory_id) then
      raise exception 'audit_logs rows are immutable';
    end if;
  end if;
  return old;
end $$;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.reject_audit_change();

alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.is_org_member(public.inventory_org(inventory_id)));
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.has_org_role(organization_id, 'admin'));

-- No INSERT/UPDATE/DELETE policies exist: rows are written only by record_stock_movement().
revoke insert, update, delete, truncate on public.stock_movements from anon, authenticated;
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;

-- Products with a ledger cannot be removed by direct delete; allow cascade when the inventory is gone.
create or replace function public.products_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 then
      raise exception 'New products start at zero stock; record a stock movement to add stock';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.inventory_id <> old.inventory_id then
      raise exception 'A product cannot be moved to another inventory';
    end if;
    if new.quantity is distinct from old.quantity
       and coalesce(current_setting('app.stock_write', true), '') <> 'on' then
      raise exception 'Quantity can only change through a stock movement';
    end if;
  elsif tg_op = 'DELETE' then
    if old.archived_at is null and exists (select 1 from public.inventories where id = old.inventory_id) then
      raise exception 'Archive the product before deleting it';
    end if;
    return old;
  end if;
  return new;
end $$;

-- ------------------------------------------------------ record_stock_movement
-- The only way quantity changes. One transaction: lock the product row, validate, update the
-- quantity, append the movement and audit entry. Concurrent calls on a product serialise on the lock,
-- so two people removing 5 from a stock of 8 yields one success and one "Insufficient stock" error.
--
--   in          p_amount > 0, added
--   out         p_amount > 0, removed
--   adjustment  p_amount = counted quantity (>= 0); delta is computed here; note required
--   correction  p_amount = signed non-zero delta; note required
create or replace function public.record_stock_movement(
  p_product_id uuid,
  p_type public.movement_type,
  p_amount numeric,
  p_operation_id uuid,
  p_reference text default null,
  p_note text default null,
  p_corrects uuid default null
) returns public.stock_movements
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv uuid;
  org uuid;
  prod public.products%rowtype;
  mv public.stock_movements%rowtype;
  v_amount numeric;
  v_delta numeric;
  v_after numeric;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_operation_id is null then
    raise exception 'An operation id is required' using errcode = '22023';
  end if;

  -- Authorise before locking so unauthorised callers learn nothing about the product.
  select inventory_id into inv from public.products where id = p_product_id;
  if inv is not null then org := public.inventory_org(inv); end if;
  if inv is null or not public.has_org_role(org, 'editor') then
    raise exception 'Product not found or you do not have permission to change its stock' using errcode = '42501';
  end if;

  select * into prod from public.products where id = p_product_id for update;

  -- Idempotent replay.
  select * into mv from public.stock_movements where inventory_id = inv and operation_id = p_operation_id;
  if found then
    if mv.product_id <> p_product_id then
      raise exception 'Operation id was already used for another product' using errcode = '22023';
    end if;
    return mv;
  end if;

  if prod.archived_at is not null then
    raise exception 'Archived products cannot change stock. Restore the product first.' using errcode = '23514';
  end if;

  v_amount := round(p_amount, 3);
  if p_type = 'in' then
    if v_amount is null or v_amount <= 0 then raise exception 'Quantity must be greater than zero' using errcode = '22023'; end if;
    if prod.expires_on is not null and prod.expires_on < current_date then
      raise exception 'This product is expired. Update its expiration date before receiving stock.' using errcode = '23514';
    end if;
    v_delta := v_amount;
  elsif p_type = 'out' then
    if v_amount is null or v_amount <= 0 then raise exception 'Quantity must be greater than zero' using errcode = '22023'; end if;
    v_delta := -v_amount;
  elsif p_type = 'adjustment' then
    if v_amount is null or v_amount < 0 then raise exception 'Counted quantity cannot be negative' using errcode = '22023'; end if;
    if v_note is null then raise exception 'A note is required for adjustments' using errcode = '22023'; end if;
    v_delta := v_amount - prod.quantity;
  else
    if v_amount is null or v_amount = 0 then raise exception 'Correction amount cannot be zero' using errcode = '22023'; end if;
    if v_note is null then raise exception 'A note is required for corrections' using errcode = '22023'; end if;
    v_delta := v_amount;
  end if;

  if v_delta = 0 then
    raise exception 'No change: the counted quantity equals the current quantity' using errcode = '22023';
  end if;

  v_after := prod.quantity + v_delta;
  if v_after < 0 then
    raise exception 'Insufficient stock: % available, % requested', trim_scale(prod.quantity), trim_scale(abs(v_delta))
      using errcode = '23514';
  end if;

  if p_corrects is not null and not exists (
    select 1 from public.stock_movements where id = p_corrects and inventory_id = inv
  ) then
    raise exception 'The movement being corrected was not found' using errcode = '22023';
  end if;

  perform set_config('app.stock_write', 'on', true);
  update public.products set quantity = v_after where id = prod.id;
  perform set_config('app.stock_write', 'off', true);

  insert into public.stock_movements (
    inventory_id, product_id, movement_type, delta, quantity_before, quantity_after,
    reference, note, operation_id, corrects_movement_id, created_by
  ) values (
    inv, prod.id, p_type, v_delta, prod.quantity, v_after,
    v_ref, v_note, p_operation_id, p_corrects, uid
  ) returning * into mv;

  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (
    org, inv, uid, 'stock.' || p_type::text, 'product', prod.id,
    jsonb_build_object('movement_id', mv.id, 'delta', v_delta, 'before', prod.quantity, 'after', v_after,
                       'reference', v_ref, 'product', prod.name)
  );

  return mv;
end $$;

revoke all on function public.record_stock_movement(uuid, public.movement_type, numeric, uuid, text, text, uuid) from public, anon;
grant execute on function public.record_stock_movement(uuid, public.movement_type, numeric, uuid, text, text, uuid) to authenticated;

-- ------------------------------------------------------------- summaries
-- Days are UTC calendar days. SECURITY INVOKER: RLS limits rows to inventories the caller can read.
create or replace function public.movement_summary(inv uuid, days int default 14)
returns table (day date, units_in numeric, units_out numeric)
language sql stable as $$
  select d::date,
         coalesce(sum(m.delta) filter (where m.delta > 0), 0),
         coalesce(-sum(m.delta) filter (where m.delta < 0), 0)
  from generate_series((now() at time zone 'utc')::date - (days - 1), (now() at time zone 'utc')::date, interval '1 day') d
  left join public.stock_movements m
    on m.inventory_id = inv and (m.created_at at time zone 'utc')::date = d::date
  group by d
  order by d
$$;
