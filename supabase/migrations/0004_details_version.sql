-- Phase 5: optimistic-concurrency token for product details.
--
-- `details_version` increases whenever any descriptive field changes, but NOT when only the quantity
-- changes (stock movements). Offline product edits carry the version they were based on, so editing a
-- product never conflicts merely because someone received stock in the meantime.

alter table public.products add column details_version integer not null default 1;

create or replace function public.products_bump_version() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'quantity' - 'updated_at' - 'stock_state' - 'details_version')
     is distinct from
     (to_jsonb(old) - 'quantity' - 'updated_at' - 'stock_state' - 'details_version') then
    new.details_version := old.details_version + 1;
  end if;
  return new;
end $$;

create trigger products_bump_version_trg before update on public.products
  for each row execute function public.products_bump_version();
