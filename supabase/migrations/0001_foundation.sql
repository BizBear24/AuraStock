-- Phase 1 foundation: profiles, organizations, memberships, inventories, RLS.


create type public.org_role as enum ('owner', 'admin', 'editor', 'viewer');

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------- organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.inventories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text,
  archived_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index inventories_org_idx on public.inventories (organization_id);
create trigger inventories_updated before update on public.inventories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- role helpers
-- SECURITY DEFINER avoids RLS recursion when policies consult membership.
create or replace function public.org_role_rank(r public.org_role) returns int
language sql immutable as $$
  select case r when 'viewer' then 1 when 'editor' then 2 when 'admin' then 3 when 'owner' then 4 end
$$;

create or replace function public.has_org_role(org uuid, minimum public.org_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and public.org_role_rank(m.role) >= public.org_role_rank(minimum)
  )
$$;

create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_org_role(org, 'viewer')
$$;

-- Atomically create an organization and make the caller its owner.
create or replace function public.create_organization(org_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  insert into public.organizations (name, created_by) values (btrim(org_name), uid)
    returning id into new_id;
  insert into public.organization_members (organization_id, user_id, role)
    values (new_id, uid, 'owner');
  return new_id;
end $$;

-- Guard: an organization must always keep at least one owner.
create or replace function public.ensure_owner_remains() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' or new.role <> 'owner') and old.role = 'owner' then
    if not exists (
      select 1 from public.organization_members
      where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id
    ) and exists (select 1 from public.organizations where id = old.organization_id) then
      raise exception 'An organization must keep at least one owner';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger members_keep_owner before update or delete on public.organization_members
  for each row execute function public.ensure_owner_remains();

-- -------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.inventories enable row level security;

-- profiles: own row, plus people who share an organization with you.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.organization_members a
    join public.organization_members b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  )
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations: created only via create_organization(); no direct insert policy.
create policy orgs_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy orgs_update on public.organizations for update to authenticated
  using (public.has_org_role(id, 'admin')) with check (public.has_org_role(id, 'admin'));
create policy orgs_delete on public.organizations for delete to authenticated
  using (public.has_org_role(id, 'owner'));

-- members: visible to members; managed by admins (owner role changes restricted to owners).
create policy members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));
create policy members_insert on public.organization_members for insert to authenticated
  with check (
    public.has_org_role(organization_id, 'admin')
    and (role <> 'owner' or public.has_org_role(organization_id, 'owner'))
    and (role <> 'admin' or public.has_org_role(organization_id, 'owner'))
  );
create policy members_update on public.organization_members for update to authenticated
  using (public.has_org_role(organization_id, 'admin'))
  with check (
    public.has_org_role(organization_id, 'admin')
    and (role not in ('owner', 'admin') or public.has_org_role(organization_id, 'owner'))
  );
create policy members_delete on public.organization_members for delete to authenticated
  using (user_id = auth.uid() or public.has_org_role(organization_id, 'admin'));

-- inventories
create policy inventories_select on public.inventories for select to authenticated
  using (public.is_org_member(organization_id));
create policy inventories_insert on public.inventories for insert to authenticated
  with check (public.has_org_role(organization_id, 'admin') and created_by = auth.uid());
create policy inventories_update on public.inventories for update to authenticated
  using (public.has_org_role(organization_id, 'admin'))
  with check (public.has_org_role(organization_id, 'admin'));
create policy inventories_delete on public.inventories for delete to authenticated
  using (public.has_org_role(organization_id, 'owner'));

revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
