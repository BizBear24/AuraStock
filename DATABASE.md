# Database

Schema lives in `supabase/migrations`. Every change is a new migration; never edit production by hand.

See migration `0001_foundation.sql` for the Phase 1 tables (profiles, organizations, organization_members, inventories) and helper functions. Later phases add products, categories, tags, custom fields, stock_movements, notifications, integrations, backups, sync records and audit logs.

## Roles

`owner` > `admin` > `editor` > `viewer`. Hierarchy is encoded in `org_role_rank()`.

## Phase 2 tables (`0002_products.sql`)

- `categories`, `tags`: per inventory, names unique case-insensitively.
- `products`: per inventory. SKU, barcode and QR code are unique within an inventory when set. `stock_state` is a generated column (`out` / `low` / `ok`) used for filtering. Composite foreign keys guarantee a product's category and tags belong to the same inventory.
- `product_tags`: many-to-many link.
- Search uses `pg_trgm` GIN indexes on name, SKU and barcode.

### Invariants enforced by the `products_guard` trigger

- New products start at quantity 0.
- `quantity` can change only when `app.stock_write = 'on'`, which only the Phase 3 `record_stock_movement()` function will set.
- A product cannot change inventory.
- Only archived products can be deleted (admins and owners).

### Functions

`inventory_summary(inv, expiry_window_days)` and `category_stock(inv)` run as the caller, so RLS limits results.
