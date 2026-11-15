-- Team collaboration: invitations, member management, activity log, realtime.
--
-- Invitations need no email service and no secret links: an admin invites an EMAIL ADDRESS with a role.
-- When someone signs in with that address (Supabase verifies it) they see the invitation and can accept it.
-- A forwarded link is useless to anyone else, because acceptance requires a matching verified email.
--
-- Membership changes go through the functions below only, so the rules are enforced in the database:
--   owner  can do everything, and can promote members to owner.
--   admin  can invite and manage editors and viewers, never admins or owners, and cannot change themselves.
--   An organization always keeps at least one owner (trigger from 0001).

-- ------------------------------------------------------------- invitations
create type public.invitation_status as enum ('pending', 'accepted', 'declined', 'revoked');

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role public.org_role not null check (role <> 'owner'),
  status public.invitation_status not null default 'pending',
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  responded_at timestamptz
);
create unique index invitations_one_pending on public.invitations (organization_id, email) where status = 'pending';
create index invitations_email_idx on public.invitations (email) where status = 'pending';

alter table public.invitations enable row level security;
revoke insert, update, delete, truncate on public.invitations from anon, authenticated;

create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where id = auth.uid()
$$;
revoke all on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;

-- Admins see their organization's invitations; invitees see their own pending ones.
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_org_role(organization_id, 'admin') or email = public.my_email());

-- Members can only be changed through the functions in this file.
drop policy members_insert on public.organization_members;
drop policy members_update on public.organization_members;
drop policy members_delete on public.organization_members;
revoke insert, update, delete, truncate on public.organization_members from anon, authenticated;

-- Helper: is `p_user` currently at least `minimum` in the organization?
create or replace function public._member_has_role(p_org uuid, p_user uuid, minimum public.org_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = p_user
      and public.org_role_rank(m.role) >= public.org_role_rank(minimum)
  )
$$;
revoke all on function public._member_has_role(uuid, uuid, public.org_role) from public, anon, authenticated;

create or replace function public.invite_member(p_org uuid, p_email text, p_role public.org_role) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  inv_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'Only admins and owners can invite members' using errcode = '42501';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if p_role = 'owner' then
    raise exception 'Invite as admin, editor or viewer. Owners are promoted from existing members.' using errcode = '22023';
  end if;
  if p_role = 'admin' and not public.has_org_role(p_org, 'owner') then
    raise exception 'Only owners can invite admins' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_members m join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org and lower(p.email) = v_email
  ) then
    raise exception 'That person is already a member' using errcode = '23505';
  end if;

  insert into public.invitations (organization_id, email, role, invited_by)
  values (p_org, v_email, p_role, uid)
  on conflict (organization_id, email) where status = 'pending'
  do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now(), expires_at = now() + interval '14 days'
  returning id into inv_id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, uid, 'member.invite', 'invitation', inv_id, jsonb_build_object('email', v_email, 'role', p_role));
  return inv_id;
end $$;

-- Pending, unexpired invitations addressed to the caller's verified email.
create or replace function public.list_my_invitations()
returns table (id uuid, organization_id uuid, organization_name text, role public.org_role, invited_by_name text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.organization_id, o.name, i.role, coalesce(p.full_name, p.email), i.created_at, i.expires_at
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending' and i.expires_at > now() and i.email = public.my_email()
  order by i.created_at desc
$$;
revoke all on function public.list_my_invitations() from public, anon;
grant execute on function public.list_my_invitations() to authenticated;

create or replace function public.accept_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.invitations%rowtype;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or inv.email <> public.my_email() then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invitation is no longer valid' using errcode = '23514';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = '23514';
  end if;
  -- The inviter must still be allowed to grant this role.
  if inv.invited_by is null or not public._member_has_role(inv.organization_id, inv.invited_by, case when inv.role = 'admin' then 'owner' else 'admin' end::public.org_role) then
    raise exception 'This invitation is no longer valid' using errcode = '23514';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (inv.organization_id, uid, inv.role)
  on conflict do nothing;
  update public.invitations set status = 'accepted', responded_at = now() where id = inv.id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (inv.organization_id, uid, 'member.accept', 'invitation', inv.id, jsonb_build_object('role', inv.role));
  return inv.organization_id;
end $$;

create or replace function public.decline_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations%rowtype;
begin
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or auth.uid() is null or inv.email <> public.my_email() then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invitation is no longer valid' using errcode = '23514';
  end if;
  update public.invitations set status = 'declined', responded_at = now() where id = inv.id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (inv.organization_id, auth.uid(), 'member.decline', 'invitation', inv.id, '{}'::jsonb);
end $$;

create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations%rowtype;
begin
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or not public.has_org_role(inv.organization_id, 'admin') then
    raise exception 'Invitation not found or you do not have permission' using errcode = '42501';
  end if;
  if inv.role = 'admin' and not public.has_org_role(inv.organization_id, 'owner') then
    raise exception 'Only owners can revoke admin invitations' using errcode = '42501';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invitation is no longer pending' using errcode = '23514';
  end if;
  update public.invitations set status = 'revoked', responded_at = now() where id = inv.id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (inv.organization_id, auth.uid(), 'invite.revoke', 'invitation', inv.id, jsonb_build_object('email', inv.email));
end $$;

-- ------------------------------------------------------------ member changes
create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role public.org_role) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  actor public.org_role;
  target public.org_role;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select role into actor from public.organization_members where organization_id = p_org and user_id = uid;
  if actor is null or public.org_role_rank(actor) < public.org_role_rank('admin') then
    raise exception 'Only admins and owners can change roles' using errcode = '42501';
  end if;
  select role into target from public.organization_members where organization_id = p_org and user_id = p_user;
  if target is null then
    raise exception 'That person is not a member of this organization' using errcode = '22023';
  end if;
  if target = p_role then
    return;
  end if;
  if actor = 'admin' then
    if p_user = uid then
      raise exception 'Admins cannot change their own role' using errcode = '42501';
    end if;
    if target in ('admin', 'owner') or p_role in ('admin', 'owner') then
      raise exception 'Admins can only manage editors and viewers' using errcode = '42501';
    end if;
  end if;

  update public.organization_members set role = p_role where organization_id = p_org and user_id = p_user;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, uid, 'member.role', 'member', p_user, jsonb_build_object('from', target, 'to', p_role));
end $$;

create or replace function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  actor public.org_role;
  target public.org_role;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select role into actor from public.organization_members where organization_id = p_org and user_id = uid;
  if actor is null or public.org_role_rank(actor) < public.org_role_rank('admin') then
    raise exception 'Only admins and owners can remove members' using errcode = '42501';
  end if;
  if p_user = uid then
    raise exception 'Use "Leave organization" to remove yourself' using errcode = '22023';
  end if;
  select role into target from public.organization_members where organization_id = p_org and user_id = p_user;
  if target is null then
    raise exception 'That person is not a member of this organization' using errcode = '22023';
  end if;
  if actor = 'admin' and target in ('admin', 'owner') then
    raise exception 'Admins can only remove editors and viewers' using errcode = '42501';
  end if;

  delete from public.organization_members where organization_id = p_org and user_id = p_user;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, uid, 'member.remove', 'member', p_user, jsonb_build_object('role', target));
end $$;

create or replace function public.leave_organization(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mine public.org_role;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select role into mine from public.organization_members where organization_id = p_org and user_id = uid;
  if mine is null then
    raise exception 'You are not a member of this organization' using errcode = '22023';
  end if;
  -- The "at least one owner" trigger rejects the delete when this is the last owner.
  delete from public.organization_members where organization_id = p_org and user_id = uid;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, uid, 'member.leave', 'member', uid, jsonb_build_object('role', mine));
end $$;

revoke all on function public.invite_member(uuid, text, public.org_role) from public, anon;
revoke all on function public.accept_invitation(uuid) from public, anon;
revoke all on function public.decline_invitation(uuid) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.org_role) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.leave_organization(uuid) from public, anon;
grant execute on function public.invite_member(uuid, text, public.org_role) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.org_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_organization(uuid) to authenticated;

-- ------------------------------------------------------------ activity log
-- Product and inventory changes are recorded automatically so the activity feed covers everything a team
-- does, not just stock. (Stock, transfers, imports, member changes are logged by their own functions.)
create or replace function public.audit_product_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.products%rowtype;
  org uuid;
  act text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  select organization_id into org from public.inventories where id = r.inventory_id;
  if org is null then
    return null; -- the inventory itself is being deleted
  end if;
  if tg_op = 'INSERT' then act := 'product.create';
  elsif tg_op = 'DELETE' then act := 'product.delete';
  elsif old.archived_at is null and new.archived_at is not null then act := 'product.archive';
  elsif old.archived_at is not null and new.archived_at is null then act := 'product.restore';
  elsif new.details_version is distinct from old.details_version then act := 'product.update';
  else return null;
  end if;
  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (org, r.inventory_id, auth.uid(), act, 'product', r.id, jsonb_build_object('name', r.name, 'sku', r.sku));
  return null;
end $$;
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_product_change();

create or replace function public.audit_inventory_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.inventories%rowtype;
  act text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if not exists (select 1 from public.organizations where id = r.organization_id) then
    return null; -- the organization is being deleted
  end if;
  if tg_op = 'INSERT' then act := 'inventory.create';
  elsif tg_op = 'DELETE' then act := 'inventory.delete';
  elsif old.archived_at is null and new.archived_at is not null then act := 'inventory.archive';
  elsif old.archived_at is not null and new.archived_at is null then act := 'inventory.restore';
  elsif new.name is distinct from old.name or new.description is distinct from old.description then act := 'inventory.update';
  else return null;
  end if;
  insert into public.audit_logs (organization_id, inventory_id, actor_id, action, entity_type, entity_id, details)
  values (r.organization_id, case when tg_op = 'DELETE' then null else r.id end, auth.uid(), act, 'inventory', r.id,
          jsonb_build_object('name', r.name, 'demo', r.is_demo));
  return null;
end $$;
create trigger inventories_audit after insert or update or delete on public.inventories
  for each row execute function public.audit_inventory_change();

create or replace function public.audit_org_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
    values (new.id, auth.uid(), 'org.rename', 'organization', new.id, jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  return null;
end $$;
create trigger organizations_audit after update on public.organizations
  for each row execute function public.audit_org_change();

-- Paged activity feed for admins and owners (RLS on audit_logs applies). `p_category` is the action prefix
-- (stock, product, inventory, transfer, member, import, org, demo) or null for everything.
create or replace function public.list_activity(p_org uuid, p_category text default null, p_limit int default 30, p_offset int default 0)
returns table (
  id uuid, created_at timestamptz, action text, entity_type text, entity_id uuid, inventory_id uuid,
  inventory_name text, actor_id uuid, actor_name text, details jsonb, total_count bigint
)
language sql stable as $$
  with scoped as (
    select a.* from public.audit_logs a
    where a.organization_id = p_org
      and (p_category is null or a.action like p_category || '.%')
  )
  select s.id, s.created_at, s.action, s.entity_type, s.entity_id, s.inventory_id, i.name,
         s.actor_id, coalesce(p.full_name, p.email), s.details,
         (select count(*) from scoped)
  from scoped s
  left join public.inventories i on i.id = s.inventory_id
  left join public.profiles p on p.id = s.actor_id
  order by s.created_at desc, s.id
  limit greatest(p_limit, 1) offset greatest(p_offset, 0)
$$;

-- ----------------------------------------------------------------- realtime
-- Publish the tables the app subscribes to. Row-level security still decides who receives which rows.
-- (Skipped where the supabase_realtime publication does not exist.)
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['products', 'stock_movements', 'notifications', 'transfers', 'organization_members', 'invitations', 'inventories'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then
        null; -- already published
      end;
    end loop;
  end if;
exception when others then
  raise notice 'Realtime publication could not be configured automatically: %', sqlerrm;
end $$;
