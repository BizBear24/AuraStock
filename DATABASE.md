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

## Phase 3 (`0003_stock_movements.sql`)

- `stock_movements`: append-only ledger. Each row stores the signed `delta`, `quantity_before/after`, optional reference and note, the acting user, and a client `operation_id` (unique per inventory) used as an idempotency key. Updates are rejected by trigger; direct INSERT/UPDATE/DELETE are revoked and no write policies exist.
- `audit_logs`: immutable record of actions, written by `record_stock_movement()`; readable by admins and owners.
- `record_stock_movement(product, type, amount, operation_id, reference, note, corrects)`: the only code path that changes `products.quantity`.

### Policies

- **Negative stock is never allowed.** An overdraw raises `Insufficient stock: N available, M requested` and writes nothing.
- `in` / `out`: amount > 0. `adjustment`: amount is the counted quantity, note required. `correction`: signed non-zero amount, note required.
- Stock in is refused for expired products (fix the expiration date first); archived products cannot change stock. Stock out of expired products is allowed (disposal).
- A product with history cannot be deleted; archive it instead. Deleting a whole inventory removes its ledger.

### Concurrency

The function authorises, then runs `SELECT ... FOR UPDATE` on the product row. Two concurrent removals of 5 from a stock of 8 serialise on that lock: the first commits (stock 3), the second re-reads 3 and fails. A repeated `operation_id` returns the original movement instead of applying twice.

Manual two-session check on a real database: open two SQL sessions as an editor, `begin;` in both, call `record_stock_movement(<product>, 'out', 5, gen_random_uuid())` in session 1, then in session 2 (it blocks), then `commit;` session 1 and observe session 2 fail with `Insufficient stock`.

`movement_summary` buckets days in UTC.
