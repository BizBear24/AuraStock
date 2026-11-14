-- Transfers between inventories ("locations") of one organization, with an in-transit state.
--
--   1. DISPATCH  scan items out of the source inventory. Stock leaves the source immediately (a normal
--                'out' movement) and the transfer is IN TRANSIT: the units are not in either inventory.
--   2. RECEIVE   scan items in at the destination. Each scan adds stock there (a normal 'in' movement)
--                and counts against what was sent. Partial and repeated receiving is supported.
--   3. CLOSE     when everything has arrived the transfer completes by itself. If fewer units arrive than
--                were sent, closing the transfer records the shortage (a discrepancy alert is raised).
--   Cancel       before anything has been received, a transfer can be cancelled: the units go back to the
--                source inventory.
--
-- Every stock change is a regular ledger movement (reference = TR-nnnnn, linked by transfer_id), created
-- through record_stock_movement(), so locking, negative-stock protection, idempotency and alerts all apply.
-- All functions are all-or-nothing.

create type public.transfer_status as enum ('in_transit', 'completed', 'cancelled');
alter type public.alert_kind add value if not exists 'transfer_incoming';
alter type public.alert_kind add value if not exists 'transfer_discrepancy';

create sequence public.transfer_ref_seq;

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_inventory_id uuid not null references public.inventories (id) on delete cascade,
  destination_inventory_id uuid not null references public.inventories (id) on delete cascade,
  reference text not null unique,
  status public.transfer_status not null default 'in_transit',
  note text check (note is null or char_length(note) <= 500),
  -- Client idempotency key: repeating the same dispatch returns the original transfer.
  operation_id uuid not null,
  dispatched_by uuid not null references public.profiles (id),
  dispatched_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  closed_note text check (closed_note is null or char_length(closed_note) <= 500),
  check (source_inventory_id <> destination_inventory_id),
  unique (organization_id, operation_id)
);
create index transfers_destination_idx on public.transfers (destination_inventory_id, status, dispatched_at desc);
create index transfers_source_idx on public.transfers (source_inventory_id, status, dispatched_at desc);

create table public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id) on delete cascade,
  source_product_id uuid not null references public.products (id),
  destination_product_id uuid references public.products (id),
  -- Snapshot used to recognise the product at the destination (by barcode, QR value or SKU) and to create
  -- it there when it is new. An existing destination product keeps its own expiration date.
  product_name text not null,
  sku text,
  barcode text,
  qr_code text,
  unit text not null,
  category_name text,
  min_stock numeric(14, 3) not null default 0,
  expires_on date,
  quantity_sent numeric(14, 3) not null check (quantity_sent > 0),
  quantity_received numeric(14, 3) not null default 0 check (quantity_received >= 0),
  check (quantity_received <= quantity_sent),
  unique (transfer_id, source_product_id)
);
create index transfer_lines_transfer_idx on public.transfer_lines (transfer_id);

-- Ledger rows reference their transfer. Deliberately not a foreign key: the ledger is immutable and must
-- never be blocked or altered by deleting a transfer.
alter table public.stock_movements add column transfer_id uuid;
create index stock_movements_transfer_idx on public.stock_movements (transfer_id) where transfer_id is not null;

alter table public.transfers enable row level security;
alter table public.transfer_lines enable row level security;
create policy transfers_select on public.transfers for select to authenticated
  using (public.is_org_member(organization_id));
create policy transfer_lines_select on public.transfer_lines for select to authenticated
  using (exists (select 1 from public.transfers t where t.id = transfer_id and public.is_org_member(t.organization_id)));
revoke insert, update, delete, truncate on public.transfers from anon, authenticated;
revoke insert, update, delete, truncate on public.transfer_lines from anon, authenticated;

-- --------------------------------------------- record_stock_movement + transfer link
-- Same behaviour as before with one extra optional argument. The old signature is dropped first so calls
-- stay unambiguous.
drop function public.record_stock_movement(uuid, public.movement_type, numeric, uuid, text, text, uuid);

create or replace function public.record_stock_movement(
  p_product_id uuid,
  p_type public.movement_type,
  p_amount numeric,
  p_operation_id uuid,
  p_reference text default null,
  p_note text default null,
  p_corrects uuid default null,
  p_transfer uuid default null
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

  select inventory_id into inv from public.products where id = p_product_id;
  if inv is not null then org := public.inventory_org(inv); end if;
  if inv is null or not public.has_org_role(org, 'editor') then
    raise exception 'Product not found or you do not have permission to change its stock' using errcode = '42501';
  end if;

  select * into prod from public.products where id = p_product_id for update;

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
    reference, note, operation_id, corrects_movement_id, transfer_id, created_by
  ) values (
    inv, prod.id, p_type, v_delta, prod.quantity, v_after,
    v_ref, v_note, p_operation_id, p_corrects, p_transfer, uid
  ) returning * into mv;

  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (
    org, inv, uid, 'stock.' || p_type::text, 'product', prod.id,
    jsonb_build_object('movement_id', mv.id, 'delta', v_delta, 'before', prod.quantity, 'after', v_after,
                       'reference', v_ref, 'product', prod.name)
  );

  return mv;
end $$;

revoke all on function public.record_stock_movement(uuid, public.movement_type, numeric, uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.record_stock_movement(uuid, public.movement_type, numeric, uuid, text, text, uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ dispatch
-- p_lines: [{"product_id": "...", "quantity": 3}, ...] (each product at most once).
create or replace function public.dispatch_transfer(
  p_source uuid,
  p_destination uuid,
  p_lines jsonb,
  p_note text default null,
  p_operation_id uuid default gen_random_uuid()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  org_s uuid := public.inventory_org(p_source);
  org_d uuid := public.inventory_org(p_destination);
  t public.transfers%rowtype;
  new_id uuid;
  ref text;
  src_name text;
  dest_name text;
  l record;
  prod public.products%rowtype;
  cat text;
  n_lines int := 0;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if org_s is null or org_d is null then
    raise exception 'Inventory not found' using errcode = '42501';
  end if;
  if org_s <> org_d then
    raise exception 'Both inventories must belong to the same organization' using errcode = '22023';
  end if;
  if not public.has_org_role(org_s, 'editor') then
    raise exception 'You do not have permission to transfer stock' using errcode = '42501';
  end if;
  if p_source = p_destination then
    raise exception 'Choose a different destination inventory' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item to transfer' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'A transfer may contain at most 200 items' using errcode = '22023';
  end if;

  select * into t from public.transfers where organization_id = org_s and operation_id = p_operation_id;
  if found then
    return t.id;
  end if;

  select name into src_name from public.inventories where id = p_source;
  select name into dest_name from public.inventories where id = p_destination;
  ref := 'TR-' || lpad(nextval('public.transfer_ref_seq')::text, 5, '0');

  insert into public.transfers (organization_id, source_inventory_id, destination_inventory_id, reference, note, operation_id, dispatched_by)
  values (org_s, p_source, p_destination, ref, nullif(btrim(coalesce(p_note, '')), ''), p_operation_id, uid)
  returning id into new_id;

  for l in
    select (e ->> 'product_id')::uuid as product_id, round((e ->> 'quantity')::numeric, 3) as qty
    from jsonb_array_elements(p_lines) e
  loop
    select * into prod from public.products where id = l.product_id and inventory_id = p_source;
    if not found then
      raise exception 'A product in the list is not part of %', src_name using errcode = '22023';
    end if;
    if l.qty is null or l.qty <= 0 then
      raise exception '%: quantity must be greater than zero', prod.name using errcode = '22023';
    end if;
    select name into cat from public.categories where id = prod.category_id;

    begin
      insert into public.transfer_lines (transfer_id, source_product_id, product_name, sku, barcode, qr_code, unit, category_name, min_stock, expires_on, quantity_sent)
      values (new_id, prod.id, prod.name, prod.sku, prod.barcode, prod.qr_code, prod.unit, cat, prod.min_stock, prod.expires_on, l.qty);
    exception when unique_violation then
      raise exception '%: each product can appear only once in a transfer', prod.name using errcode = '22023';
    end;

    begin
      perform public.record_stock_movement(
        prod.id, 'out', l.qty, md5(p_operation_id::text || ':' || prod.id::text)::uuid,
        ref, 'Transfer to ' || dest_name, null, new_id
      );
    exception when others then
      raise exception '%: %', prod.name, sqlerrm using errcode = sqlstate;
    end;
    n_lines := n_lines + 1;
  end loop;

  insert into public.notifications (organization_id, inventory_id, kind, title, body)
  values (org_s, p_destination, 'transfer_incoming', 'Incoming transfer ' || ref,
          n_lines || ' item' || case when n_lines = 1 then '' else 's' end || ' dispatched from ' || src_name || ' to ' || dest_name || '. Scan them in when they arrive.');

  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (org_s, p_source, uid, 'transfer.dispatch', 'transfer', new_id,
          jsonb_build_object('reference', ref, 'to', dest_name, 'lines', n_lines));

  return new_id;
end $$;

-- ------------------------------------------------------------------- receive
-- p_lines: [{"line_id": "...", "quantity": 2}, ...]. Quantities are ADDED to what was already received.
-- Returns {"status": "...", "outstanding": n} where outstanding is the number of units still to arrive.
create or replace function public.receive_transfer(
  p_transfer uuid,
  p_lines jsonb,
  p_operation_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.transfers%rowtype;
  src_name text;
  dest_name text;
  l record;
  tl public.transfer_lines%rowtype;
  dp uuid;
  cat_id uuid;
  op uuid;
  outstanding numeric;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into t from public.transfers where id = p_transfer for update;
  if not found or not public.has_org_role(t.organization_id, 'editor') then
    raise exception 'Transfer not found or you do not have permission to receive it' using errcode = '42501';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'Transfer % is already %', t.reference, t.status using errcode = '23514';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one item to receive' using errcode = '22023';
  end if;
  select name into src_name from public.inventories where id = t.source_inventory_id;
  select name into dest_name from public.inventories where id = t.destination_inventory_id;

  for l in
    select (e ->> 'line_id')::uuid as line_id, round((e ->> 'quantity')::numeric, 3) as qty
    from jsonb_array_elements(p_lines) e
  loop
    select * into tl from public.transfer_lines where id = l.line_id and transfer_id = t.id for update;
    if not found then
      raise exception 'An item in the list does not belong to transfer %', t.reference using errcode = '22023';
    end if;
    if l.qty is null or l.qty <= 0 then
      raise exception '%: quantity must be greater than zero', tl.product_name using errcode = '22023';
    end if;

    -- Replaying the same receive (same operation id) must not count twice.
    op := md5(p_operation_id::text || ':' || tl.id::text)::uuid;
    if exists (select 1 from public.stock_movements where inventory_id = t.destination_inventory_id and operation_id = op) then
      continue;
    end if;

    if tl.quantity_received + l.qty > tl.quantity_sent then
      raise exception '%: cannot receive more than was sent (sent %, already received %)',
        tl.product_name, trim_scale(tl.quantity_sent), trim_scale(tl.quantity_received) using errcode = '23514';
    end if;

    -- Find the product at the destination by barcode, then QR value, then SKU; create it if it is new there.
    dp := tl.destination_product_id;
    if dp is null then
      select p.id into dp from public.products p
        where p.inventory_id = t.destination_inventory_id
          and ((tl.barcode is not null and p.barcode = tl.barcode)
            or (tl.qr_code is not null and p.qr_code = tl.qr_code)
            or (tl.sku is not null and lower(p.sku) = lower(tl.sku)))
        order by case when tl.barcode is not null and p.barcode = tl.barcode then 0
                      when tl.qr_code is not null and p.qr_code = tl.qr_code then 1 else 2 end
        limit 1;
      if dp is null then
        cat_id := null;
        if tl.category_name is not null then
          select id into cat_id from public.categories where inventory_id = t.destination_inventory_id and lower(name) = lower(tl.category_name);
          if cat_id is null then
            insert into public.categories (inventory_id, name) values (t.destination_inventory_id, tl.category_name) returning id into cat_id;
          end if;
        end if;
        insert into public.products (inventory_id, name, sku, barcode, qr_code, description, category_id, unit, min_stock, expires_on, created_by)
        values (t.destination_inventory_id, tl.product_name, tl.sku, tl.barcode, tl.qr_code,
                'Created from transfer ' || t.reference, cat_id, tl.unit, tl.min_stock, tl.expires_on, uid)
        returning id into dp;
      end if;
      update public.transfer_lines set destination_product_id = dp where id = tl.id;
    end if;

    begin
      perform public.record_stock_movement(dp, 'in', l.qty, op, t.reference, 'Transfer from ' || src_name, null, t.id);
    exception when others then
      raise exception '%: %', tl.product_name, sqlerrm using errcode = sqlstate;
    end;
    update public.transfer_lines set quantity_received = quantity_received + l.qty where id = tl.id;
  end loop;

  select coalesce(sum(quantity_sent - quantity_received), 0) into outstanding from public.transfer_lines where transfer_id = t.id;
  if outstanding = 0 then
    update public.transfers set status = 'completed', completed_at = now() where id = t.id;
    insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
    values (t.organization_id, t.destination_inventory_id, uid, 'transfer.complete', 'transfer', t.id, jsonb_build_object('reference', t.reference));
  else
    insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
    values (t.organization_id, t.destination_inventory_id, uid, 'transfer.receive', 'transfer', t.id,
            jsonb_build_object('reference', t.reference, 'outstanding', outstanding));
  end if;

  return jsonb_build_object('status', case when outstanding = 0 then 'completed' else 'in_transit' end, 'outstanding', outstanding);
end $$;

-- --------------------------------------------------------------------- close
-- Finish a transfer even though some units never arrived. The shortage stays recorded on the lines
-- (quantity_sent minus quantity_received) and a discrepancy alert is raised.
create or replace function public.close_transfer(p_transfer uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.transfers%rowtype;
  missing numeric;
  src_name text;
  dest_name text;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into t from public.transfers where id = p_transfer for update;
  if not found or not public.has_org_role(t.organization_id, 'editor') then
    raise exception 'Transfer not found or you do not have permission to close it' using errcode = '42501';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'Transfer % is already %', t.reference, t.status using errcode = '23514';
  end if;
  select coalesce(sum(quantity_sent - quantity_received), 0) into missing from public.transfer_lines where transfer_id = t.id;
  select name into src_name from public.inventories where id = t.source_inventory_id;
  select name into dest_name from public.inventories where id = t.destination_inventory_id;

  update public.transfers
    set status = 'completed', completed_at = now(), closed_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = t.id;

  if missing > 0 then
    insert into public.notifications (organization_id, inventory_id, kind, title, body)
    values (t.organization_id, t.destination_inventory_id, 'transfer_discrepancy', 'Transfer ' || t.reference || ' closed short',
            trim_scale(missing)::text || ' unit(s) sent from ' || src_name || ' to ' || dest_name || ' did not arrive.');
  end if;
  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (t.organization_id, t.destination_inventory_id, uid, 'transfer.close', 'transfer', t.id,
          jsonb_build_object('reference', t.reference, 'missing', missing));
end $$;

-- -------------------------------------------------------------------- cancel
-- Only while nothing has been received yet: the dispatched units return to the source inventory.
create or replace function public.cancel_transfer(p_transfer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.transfers%rowtype;
  l record;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into t from public.transfers where id = p_transfer for update;
  if not found or not public.has_org_role(t.organization_id, 'editor') then
    raise exception 'Transfer not found or you do not have permission to cancel it' using errcode = '42501';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'Transfer % is already %', t.reference, t.status using errcode = '23514';
  end if;
  if exists (select 1 from public.transfer_lines where transfer_id = t.id and quantity_received > 0) then
    raise exception 'Some items have already been received. Close the transfer instead.' using errcode = '23514';
  end if;

  for l in select * from public.transfer_lines where transfer_id = t.id loop
    begin
      perform public.record_stock_movement(
        l.source_product_id, 'in', l.quantity_sent, md5(t.id::text || ':cancel:' || l.id::text)::uuid,
        t.reference, 'Transfer cancelled', null, t.id
      );
    exception when others then
      raise exception '%: %', l.product_name, sqlerrm using errcode = sqlstate;
    end;
  end loop;

  update public.transfers set status = 'cancelled', cancelled_at = now() where id = t.id;
  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (t.organization_id, t.source_inventory_id, uid, 'transfer.cancel', 'transfer', t.id, jsonb_build_object('reference', t.reference));
end $$;

revoke all on function public.dispatch_transfer(uuid, uuid, jsonb, text, uuid) from public, anon;
revoke all on function public.receive_transfer(uuid, jsonb, uuid) from public, anon;
revoke all on function public.close_transfer(uuid, text) from public, anon;
revoke all on function public.cancel_transfer(uuid) from public, anon;
grant execute on function public.dispatch_transfer(uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.receive_transfer(uuid, jsonb, uuid) to authenticated;
grant execute on function public.close_transfer(uuid, text) to authenticated;
grant execute on function public.cancel_transfer(uuid) to authenticated;
