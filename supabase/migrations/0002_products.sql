-- Phase 2: categories, tags, products, search indexes, dashboard summaries.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.inventory_org(inv uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from public.inventories where id = inv
$$;

-- ------------------------------------------------------------- categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (id, inventory_id)
);
create unique index categories_name_uq on public.categories (inventory_id, lower(name));

-- ------------------------------------------------------------------- tags
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (id, inventory_id)
);
create unique index tags_name_uq on public.tags (inventory_id, lower(name));

-- --------------------------------------------------------------- products
create table public.products (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  sku text check (sku is null or char_length(btrim(sku)) between 1 and 80),
  barcode text check (barcode is null or char_length(btrim(barcode)) between 1 and 128),
  qr_code text check (qr_code is null or char_length(btrim(qr_code)) between 1 and 512),
  description text check (description is null or char_length(description) <= 2000),
  image_path text,
  category_id uuid,
  -- Changed only by record_stock_movement() (Phase 3); see guard trigger below.
  quantity numeric(14, 3) not null default 0 check (quantity >= 0),
  unit text not null default 'pcs' check (char_length(btrim(unit)) between 1 and 20),
  min_stock numeric(14, 3) not null default 0 check (min_stock >= 0),
  expires_on date,
  archived_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stock_state text generated always as (
    case when quantity <= 0 then 'out' when quantity <= min_stock then 'low' else 'ok' end
  ) stored,
  unique (id, inventory_id),
  foreign key (category_id, inventory_id) references public.categories (id, inventory_id)
    on delete set null (category_id)
);
create unique index products_sku_uq on public.products (inventory_id, lower(sku)) where sku is not null;
create unique index products_barcode_uq on public.products (inventory_id, barcode) where barcode is not null;
create unique index products_qr_uq on public.products (inventory_id, qr_code) where qr_code is not null;
create index products_list_idx on public.products (inventory_id, archived_at, name);
create index products_state_idx on public.products (inventory_id, stock_state) where archived_at is null;
create index products_expiry_idx on public.products (inventory_id, expires_on) where expires_on is not null and archived_at is null;
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index products_sku_trgm on public.products using gin (sku extensions.gin_trgm_ops);
create index products_barcode_trgm on public.products using gin (barcode extensions.gin_trgm_ops);

create trigger products_updated before update on public.products
  for each row execute function public.set_updated_at();

create table public.product_tags (
  product_id uuid not null,
  tag_id uuid not null,
  inventory_id uuid not null,
  primary key (product_id, tag_id),
  foreign key (product_id, inventory_id) references public.products (id, inventory_id) on delete cascade,
  foreign key (tag_id, inventory_id) references public.tags (id, inventory_id) on delete cascade
);
create index product_tags_tag_idx on public.product_tags (tag_id);

-- Invariants: stock starts at zero, quantity moves only via stock movements,
-- products cannot change inventory, and only archived products can be deleted.
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
    if old.archived_at is null then
      raise exception 'Archive the product before deleting it';
    end if;
    return old;
  end if;
  return new;
end $$;
create trigger products_guard_trg before insert or update or delete on public.products
  for each row execute function public.products_guard();

-- -------------------------------------------------------------------- RLS
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.products enable row level security;
alter table public.product_tags enable row level security;

create policy categories_select on public.categories for select to authenticated
  using (public.is_org_member(public.inventory_org(inventory_id)));
create policy categories_write on public.categories for all to authenticated
  using (public.has_org_role(public.inventory_org(inventory_id), 'editor'))
  with check (public.has_org_role(public.inventory_org(inventory_id), 'editor'));

create policy tags_select on public.tags for select to authenticated
  using (public.is_org_member(public.inventory_org(inventory_id)));
create policy tags_write on public.tags for all to authenticated
  using (public.has_org_role(public.inventory_org(inventory_id), 'editor'))
  with check (public.has_org_role(public.inventory_org(inventory_id), 'editor'));

create policy products_select on public.products for select to authenticated
  using (public.is_org_member(public.inventory_org(inventory_id)));
create policy products_insert on public.products for insert to authenticated
  with check (public.has_org_role(public.inventory_org(inventory_id), 'editor') and created_by = auth.uid());
create policy products_update on public.products for update to authenticated
  using (public.has_org_role(public.inventory_org(inventory_id), 'editor'))
  with check (public.has_org_role(public.inventory_org(inventory_id), 'editor'));
create policy products_delete on public.products for delete to authenticated
  using (public.has_org_role(public.inventory_org(inventory_id), 'admin'));

create policy product_tags_select on public.product_tags for select to authenticated
  using (public.is_org_member(public.inventory_org(inventory_id)));
create policy product_tags_write on public.product_tags for all to authenticated
  using (public.has_org_role(public.inventory_org(inventory_id), 'editor'))
  with check (public.has_org_role(public.inventory_org(inventory_id), 'editor'));

-- ------------------------------------------------------ dashboard summaries
-- SECURITY INVOKER (default): RLS limits results to inventories the caller can read.
create or replace function public.inventory_summary(inv uuid, expiry_window_days int default 30)
returns table (
  total_products bigint, total_units numeric, low_stock bigint,
  out_of_stock bigint, expiring bigint, expired bigint
)
language sql stable as $$
  select
    count(*),
    coalesce(sum(quantity), 0),
    count(*) filter (where stock_state = 'low'),
    count(*) filter (where stock_state = 'out'),
    count(*) filter (where expires_on >= current_date and expires_on <= current_date + expiry_window_days),
    count(*) filter (where expires_on < current_date)
  from public.products
  where inventory_id = inv and archived_at is null
$$;

create or replace function public.category_stock(inv uuid)
returns table (category text, units numeric, products bigint)
language sql stable as $$
  select coalesce(c.name, 'Uncategorized'), coalesce(sum(p.quantity), 0), count(*)
  from public.products p
  left join public.categories c on c.id = p.category_id
  where p.inventory_id = inv and p.archived_at is null
  group by 1
  order by 2 desc
$$;
