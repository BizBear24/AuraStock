-- Phase 6a: low-stock / out-of-stock / expiry alerts stored as notifications.
--
-- Alerts fire on state TRANSITIONS (tracked per product in product_alert_state), so a product that stays
-- low does not generate a notification every run, and one that recovers and drops again alerts again.
-- Stock changes and edits are evaluated immediately by trigger; time-based expiry is evaluated by the
-- scheduled generate_alerts() job (pg_cron where available).
--
-- The expiry warning window is 30 days and must match DEFAULT_EXPIRY_WINDOW_DAYS in src/domain/product-status.ts.

create type public.alert_kind as enum ('low_stock', 'out_of_stock', 'expiring', 'expired');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  inventory_id uuid not null references public.inventories (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  kind public.alert_kind not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index notifications_org_idx on public.notifications (organization_id, created_at desc);
create index notifications_inventory_idx on public.notifications (inventory_id, created_at desc);

-- Read state is per user, because notifications belong to the whole organization.
create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- Internal bookkeeping: the states we last evaluated. Not exposed to clients.
create table public.product_alert_state (
  product_id uuid primary key references public.products (id) on delete cascade,
  stock_state text not null,
  expiry_state text not null default 'none',
  updated_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.product_alert_state enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (public.is_org_member(organization_id));
create policy notification_reads_select on public.notification_reads for select to authenticated
  using (user_id = auth.uid());
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.notifications n where n.id = notification_id and public.is_org_member(n.organization_id))
  );

revoke insert, update, delete on public.notifications from anon, authenticated;
revoke all on public.product_alert_state from anon, authenticated;

-- --------------------------------------------------------------- evaluation
create or replace function public.evaluate_product_alerts(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.products%rowtype;
  org uuid;
  inv_name text;
  st public.product_alert_state%rowtype;
  cur_expiry text;
  unit_text text;
begin
  select * into p from public.products where id = p_product;
  if not found or p.archived_at is not null then
    return;
  end if;
  select i.organization_id, i.name into org, inv_name from public.inventories i where i.id = p.inventory_id;

  cur_expiry := case
    when p.expires_on is null then 'none'
    when p.expires_on < current_date then 'expired'
    when p.expires_on <= current_date + 30 then 'expiring'
    else 'ok'
  end;
  unit_text := trim_scale(p.quantity)::text || ' ' || p.unit;

  select * into st from public.product_alert_state where product_id = p.id for update;
  if not found then
    -- First sighting: record the stock state silently (a brand-new product at zero is not an alert).
    insert into public.product_alert_state (product_id, stock_state, expiry_state)
    values (p.id, p.stock_state, 'none') returning * into st;
  end if;

  if p.stock_state <> st.stock_state and p.stock_state = 'out' then
    insert into public.notifications (organization_id, inventory_id, product_id, kind, title, body)
    values (org, p.inventory_id, p.id, 'out_of_stock', 'Out of stock: ' || p.name,
            p.name || ' is out of stock in ' || inv_name || '.');
  elsif p.stock_state <> st.stock_state and p.stock_state = 'low' then
    insert into public.notifications (organization_id, inventory_id, product_id, kind, title, body)
    values (org, p.inventory_id, p.id, 'low_stock', 'Low stock: ' || p.name,
            p.name || ' is down to ' || unit_text || ' in ' || inv_name || ' (minimum ' || trim_scale(p.min_stock)::text || ').');
  end if;

  if cur_expiry <> st.expiry_state and cur_expiry = 'expired' then
    insert into public.notifications (organization_id, inventory_id, product_id, kind, title, body)
    values (org, p.inventory_id, p.id, 'expired', 'Expired: ' || p.name,
            p.name || ' expired on ' || p.expires_on::text || ' (' || inv_name || ').');
  elsif cur_expiry <> st.expiry_state and cur_expiry = 'expiring' then
    insert into public.notifications (organization_id, inventory_id, product_id, kind, title, body)
    values (org, p.inventory_id, p.id, 'expiring', 'Expiring soon: ' || p.name,
            p.name || ' expires on ' || p.expires_on::text || ' (' || inv_name || ').');
  end if;

  update public.product_alert_state
    set stock_state = p.stock_state, expiry_state = cur_expiry, updated_at = now()
    where product_id = p.id;
end $$;

create or replace function public.products_alerts_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_product_alerts(new.id);
  return null;
end $$;

create trigger products_alerts_insert after insert on public.products
  for each row execute function public.products_alerts_trigger();
create trigger products_alerts_update after update of quantity, min_stock, expires_on, archived_at on public.products
  for each row execute function public.products_alerts_trigger();

-- Existing products: remember their current stock state so enabling alerts does not announce everything.
insert into public.product_alert_state (product_id, stock_state)
select id, stock_state from public.products where archived_at is null
on conflict do nothing;

-- Time-based part: products drift into "expiring"/"expired" without any edit, so re-check them on a schedule.
create or replace function public.generate_alerts() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select id from public.products where archived_at is null and expires_on is not null loop
    perform public.evaluate_product_alerts(r.id);
  end loop;
end $$;
revoke all on function public.generate_alerts() from public, anon, authenticated;
revoke all on function public.evaluate_product_alerts(uuid) from public, anon, authenticated;

-- Schedule hourly where pg_cron is available (Supabase: enable the extension first). Elsewhere, call
-- select public.generate_alerts(); from any scheduler. See DEVELOPMENT.md.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('aurastock-alerts', '15 * * * *', 'select public.generate_alerts()');
  end if;
exception when others then
  raise notice 'pg_cron could not be configured automatically: %', sqlerrm;
end $$;

-- ------------------------------------------------------------ read helpers
create or replace function public.unread_notification_count(p_org uuid) returns bigint
language sql stable as $$
  select count(*) from public.notifications n
  where n.organization_id = p_org
    and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())
$$;

-- Mark specific notifications (or all, when p_ids is null) of an organization as read for the caller.
create or replace function public.mark_notifications_read(p_org uuid, p_ids uuid[] default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.notifications n
  where n.organization_id = p_org and (p_ids is null or n.id = any (p_ids))
  on conflict do nothing;
end $$;
revoke all on function public.mark_notifications_read(uuid, uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid, uuid[]) to authenticated;

-- Paged listing with a per-user read flag. SECURITY INVOKER: RLS limits rows to the caller's organizations.
create or replace function public.list_notifications(
  p_org uuid,
  p_inventory uuid default null,
  p_unread_only boolean default false,
  p_limit int default 25,
  p_offset int default 0
) returns table (
  id uuid, inventory_id uuid, product_id uuid, kind public.alert_kind,
  title text, body text, created_at timestamptz, is_read boolean, total_count bigint
)
language sql stable as $$
  with scoped as (
    select n.*, exists (
      select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid()
    ) as is_read
    from public.notifications n
    where n.organization_id = p_org
      and (p_inventory is null or n.inventory_id = p_inventory)
  ), filtered as (
    select * from scoped where not p_unread_only or not is_read
  )
  select f.id, f.inventory_id, f.product_id, f.kind, f.title, f.body, f.created_at, f.is_read,
         (select count(*) from filtered) as total_count
  from filtered f
  order by f.created_at desc, f.id
  limit greatest(p_limit, 1) offset greatest(p_offset, 0)
$$;
