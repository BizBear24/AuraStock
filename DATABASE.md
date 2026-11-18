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

## Phase 5 (`0004_details_version.sql`)

`products.details_version` increments when any descriptive column changes and is untouched by quantity-only changes. It is the optimistic-concurrency token for offline edits (see ARCHITECTURE.md).

## Phase 6a (`0005_alerts.sql`)

- `notifications`: stored alerts per organization/inventory/product (`low_stock`, `out_of_stock`, `expiring`, `expired`). Written only by database functions.
- `notification_reads`: per-user read receipts (read state is not shared between teammates).
- `product_alert_state`: internal record of the last evaluated stock/expiry state per product. Alerts fire only on **transitions** into low / out / expiring / expired, so a product that stays low does not alert every run, and one that recovers and drops again alerts again. A new product at zero stock is not an alert.
- Triggers on `products` evaluate immediately after inserts and after changes to quantity, minimum stock, expiration date or archive state. Archived products never alert.
- `generate_alerts()` re-checks products that have an expiration date (they drift into "expiring/expired" without any edit). The migration schedules it hourly with **pg_cron when the extension is available** (on Supabase, enable `pg_cron` first, then re-run the `cron.schedule` statement shown in the migration). Where pg_cron is not available, call `select public.generate_alerts();` from any scheduler (for example a Supabase scheduled Edge Function). The function is not callable by app users.
- Helpers: `list_notifications`, `unread_notification_count`, `mark_notifications_read`.
- The 30-day expiry window is fixed and shared with `DEFAULT_EXPIRY_WINDOW_DAYS` in `src/domain/product-status.ts`. Low-stock thresholds are configurable per product (`min_stock`).
- Alerts are not yet pushed live; the bell polls once a minute and refreshes after stock changes. Realtime push arrives with Phase 7.

## Phase 6b (`0006_import.sql`)

`import_products(inventory, rows jsonb, update_existing, operation_id)`: the commit step of a CSV/XLSX import. One transaction: any failing row aborts everything and reports `Row n: reason`. New products with an opening quantity get a normal stock-in movement (reference `IMPORT`) so the ledger stays complete; existing products matched by barcode, QR value or SKU are skipped, or have their details (never their quantity) updated. Limit 5000 rows per call. Requires editor role; writes an audit entry.

## Demo data (`0007_demo_data.sql`)

`inventories.is_demo` (at most one per organization), `seed_demo_data(org)` and `remove_demo_data(org)` (admin or owner). Removal relies on the same cascade as any inventory delete. See DEVELOPMENT.md.

## Transfers (`0008_transfers.sql`)

`transfers` and `transfer_lines` (read-only to clients), `stock_movements.transfer_id` (not a foreign key, so the immutable ledger can never be blocked or altered), `record_stock_movement` gains an optional `p_transfer` argument, and `dispatch_transfer`, `receive_transfer`, `close_transfer`, `cancel_transfer` do all the work in single transactions. New alert kinds: `transfer_incoming`, `transfer_discrepancy`. See DEVELOPMENT.md for behaviour and guarantees.

## Team collaboration (`0009_team.sql`)

- `invitations`: an invitation addresses an **email**, not a secret link. It is visible to the organization's admins and to the invitee (matched against the verified `profiles.email`). Accepting requires that match, a pending and unexpired invitation (14 days), and that the inviter still has the authority to grant the role (owners for admin invitations).
- Membership is changed **only** through `invite_member`, `accept_invitation`, `decline_invitation`, `revoke_invitation`, `set_member_role`, `remove_member` and `leave_organization`; direct writes to `organization_members` and `invitations` are revoked. Rules: owners can do anything; admins manage only editors and viewers and cannot change themselves; an organization always keeps at least one owner.
- Activity log: triggers record product create/update/archive/restore/delete, inventory changes and organization renames in `audit_logs`; stock, transfer, import and member functions record their own entries. `list_activity` serves a filterable, paged, named feed to admins and owners.
- Realtime: the migration adds `products`, `stock_movements`, `notifications`, `transfers`, `organization_members`, `invitations` and `inventories` to the `supabase_realtime` publication (skipped where it does not exist). Row-level security decides which rows a subscriber receives.

## Phase 8 (`0010_backups_integrations.sql`)

- `backup_records`: one row per stored backup (client-chosen id, destination `supabase` or `google_drive`, path or Drive file id, size, SHA-256, format version, counts, verification result). Admin read only; written by `register_backup`, `mark_backup_verified`, `delete_backup_record`.
- `export_org_backup(org)`: the organization as one JSON document (format `aurastock-backup`, version 1). `restore_backup(org, doc, inventory_ids)`: validates and restores into new inventories in one transaction, replaying each product's ledger with original timestamps (equal timestamps are ordered by their balance chain) and refusing any product whose history does not add up.
- `organizations.backup_interval_days` (null, 1, 7) with `set_backup_schedule`; `claim_auto_backup` hands out a due scheduled backup once (15-minute claim).
- Storage: private bucket `backups` (50 MB per file, JSON only) with policies restricting each `<organization id>/` folder to that organization's admins and owners.
- `integration_connections`: which Google account and folder an organization connected; no tokens or secrets. `save_integration`, `remove_integration`.
- `products.nfc_uid`: serial number of a linked NFC tag, unique per inventory; product lookup also matches it.
- `stock_analysis(inventory, days)`: per-product usage, receipts, movement count and last movement for the analysis report.
