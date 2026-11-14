-- Phase 6b: atomic bulk product import.
--
-- The client parses and validates the file and shows a preview first; this function is the commit step.
-- It runs in ONE transaction: any row that fails aborts the whole import and reports the row number,
-- so a malformed file can never leave a half-imported inventory.
--
-- Row fields: name (required), sku, barcode, qr_code, description, category, tags (array), unit,
-- min_stock, expires_on (YYYY-MM-DD), quantity.
-- Existing products are matched by barcode, QR value or SKU. They are skipped, or have their details
-- updated when p_update_existing is true. `quantity` is an OPENING balance and applies to new products
-- only: it is recorded as a normal stock-in movement (reference IMPORT) so the ledger stays complete.

create or replace function public.import_products(
  p_inventory uuid,
  p_rows jsonb,
  p_update_existing boolean default false,
  p_operation_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  org uuid;
  r record;
  v_name text;
  v_sku text;
  v_barcode text;
  v_qr text;
  v_desc text;
  v_cat text;
  v_cat_id uuid;
  v_unit text;
  v_min numeric;
  v_expires date;
  v_qty numeric;
  v_tags text[];
  v_matches uuid[];
  v_pid uuid;
  v_tag text;
  v_tag_id uuid;
  n_created int := 0;
  n_updated int := 0;
  n_skipped int := 0;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  org := public.inventory_org(p_inventory);
  if org is null or not public.has_org_role(org, 'editor') then
    raise exception 'Inventory not found or you do not have permission to import products' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'An import may contain at most 5000 rows' using errcode = '22023';
  end if;

  for r in select value, ordinality as n from jsonb_array_elements(p_rows) with ordinality loop
    begin
      v_name := nullif(btrim(r.value ->> 'name'), '');
      v_sku := nullif(btrim(r.value ->> 'sku'), '');
      v_barcode := nullif(btrim(r.value ->> 'barcode'), '');
      v_qr := nullif(btrim(r.value ->> 'qr_code'), '');
      v_desc := nullif(btrim(r.value ->> 'description'), '');
      v_cat := nullif(btrim(r.value ->> 'category'), '');
      v_unit := coalesce(nullif(btrim(r.value ->> 'unit'), ''), 'pcs');
      v_min := coalesce(nullif(r.value ->> 'min_stock', '')::numeric, 0);
      v_expires := nullif(r.value ->> 'expires_on', '')::date;
      v_qty := coalesce(nullif(r.value ->> 'quantity', '')::numeric, 0);
      select coalesce(array_agg(t), '{}') into v_tags
        from jsonb_array_elements_text(coalesce(r.value -> 'tags', '[]'::jsonb)) t
        where nullif(btrim(t), '') is not null;

      if v_name is null then
        raise exception 'name is required';
      end if;

      select array_agg(distinct id) into v_matches from public.products
        where inventory_id = p_inventory
          and ((v_barcode is not null and barcode = v_barcode)
            or (v_qr is not null and qr_code = v_qr)
            or (v_sku is not null and lower(sku) = lower(v_sku)));
      if coalesce(array_length(v_matches, 1), 0) > 1 then
        raise exception 'SKU, barcode and QR value match more than one existing product';
      end if;

      if v_matches is not null and p_update_existing is not true then
        n_skipped := n_skipped + 1;
        continue;
      end if;

      v_cat_id := null;
      if v_cat is not null then
        select id into v_cat_id from public.categories where inventory_id = p_inventory and lower(name) = lower(v_cat);
        if v_cat_id is null then
          insert into public.categories (inventory_id, name) values (p_inventory, v_cat) returning id into v_cat_id;
        end if;
      end if;

      if v_matches is not null then
        v_pid := v_matches[1];
        update public.products set
          name = v_name, sku = v_sku, barcode = v_barcode, qr_code = v_qr, description = v_desc,
          category_id = v_cat_id, unit = v_unit, min_stock = v_min, expires_on = v_expires
        where id = v_pid;
        n_updated := n_updated + 1;
      else
        insert into public.products (inventory_id, name, sku, barcode, qr_code, description, category_id, unit, min_stock, expires_on, created_by)
        values (p_inventory, v_name, v_sku, v_barcode, v_qr, v_desc, v_cat_id, v_unit, v_min, v_expires, uid)
        returning id into v_pid;
        n_created := n_created + 1;
      end if;

      -- Tags: make the product's tag set equal to the row's.
      delete from public.product_tags where product_id = v_pid
        and tag_id not in (select id from public.tags where inventory_id = p_inventory and lower(name) = any (select lower(x) from unnest(v_tags) x));
      foreach v_tag in array v_tags loop
        select id into v_tag_id from public.tags where inventory_id = p_inventory and lower(name) = lower(v_tag);
        if v_tag_id is null then
          insert into public.tags (inventory_id, name) values (p_inventory, left(v_tag, 40)) returning id into v_tag_id;
        end if;
        insert into public.product_tags (product_id, tag_id, inventory_id) values (v_pid, v_tag_id, p_inventory) on conflict do nothing;
      end loop;

      if v_matches is null and v_qty > 0 then
        perform public.record_stock_movement(
          v_pid, 'in', v_qty, md5(p_operation_id::text || ':' || r.n::text)::uuid, 'IMPORT', 'Opening stock from import'
        );
      end if;
    exception when others then
      raise exception 'Row %: %', r.n, sqlerrm using errcode = sqlstate;
    end;
  end loop;

  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, details)
  values (org, p_inventory, uid, 'import.products', 'inventory',
          jsonb_build_object('created', n_created, 'updated', n_updated, 'skipped', n_skipped));

  return jsonb_build_object('created', n_created, 'updated', n_updated, 'skipped', n_skipped);
end $$;

revoke all on function public.import_products(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_products(uuid, jsonb, boolean, uuid) to authenticated;
