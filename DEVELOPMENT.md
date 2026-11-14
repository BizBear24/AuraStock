# Development

## Setup

1. `npm install`
2. Create a Supabase project, copy URL + anon key into `.env` (see `.env.example`).
3. Apply migrations: `supabase db push` (Supabase CLI) or run files in `supabase/migrations` in order in the SQL editor.

## Workflow

Typecheck, lint and test before every commit: `npm run typecheck && npm run lint && npm test`.

## Feature checklist

- [x] Phase 0 – Repository audit
- [x] Phase 1 – Foundation: design tokens, UI primitives, auth (sign up, login, logout, reset, session persistence, protected routes, profile), organization onboarding, inventory create/switch, responsive shell (sidebar + mobile bottom nav), migration 0001 with RLS
  - [ ] Still unverified: migration applied to a live Supabase project, RLS cross-org isolation tests, Playwright e2e (need a Supabase project)
  - [ ] Deferred from Phase 1: organization settings, member management (Phase 7), inventory-level memberships
- [x] Phase 2 – Core inventory: products (create, edit, archive, restore, duplicate, delete-after-archive, bulk archive/category), categories, tags, debounced search (name/SKU/barcode), filters, sorting, pagination, product detail, dashboard with real metrics and chart; migration 0002
  - [ ] Unverified against a live database: migration 0002, RLS, unique-constraint messages
  - [ ] Deferred: product images (needs Storage bucket + upload policy), custom fields, saved filters, dashboard date filters and recent activity (needs stock movements, Phase 3)
- [x] Phase 3 – Stock operations: stock in/out/adjustment/correction through `record_stock_movement()` (row lock, idempotency key, immutable ledger, audit log), movement history (global + per product), dashboard flow chart and recent activity; migration 0003
  - [x] Tested against real PostgreSQL (PGlite): RLS isolation, overdraw rejection, idempotent replay, append-only ledger, expired/archived rules (`supabase/tests/database.test.ts`)
  - [ ] Not tested: true parallel transactions (PGlite is single-connection) - run the two-session check in DATABASE.md on a real Supabase project
  - [ ] Deferred: UI to link a correction to the movement it fixes (column exists), reversal shortcut
- [x] Phase 4 – Scanning: `/scan` with camera decoding (ZXing: EAN-13/8, UPC-A/E, Code 128/39, ITF, Codabar, QR, Data Matrix), camera switching, permission/unavailable/in-use/insecure-context errors, USB/Bluetooth keyboard-wedge scanner support, manual entry, invalid and repeated scan handling, beep/vibrate feedback, scan -> open details / stock in / stock out / create product with the scanned code
  - [x] Unit tested: code normalisation, repeat suppression, HID burst detection (including through real key events), camera error classification
  - [ ] **Not tested on real hardware**: camera decoding and a physical scanner have not been run on a phone or with a USB scanner - please try on your devices and report problems
  - [ ] Deferred: torch toggle, continuous multi-scan "batch" mode, offline lookup (Phase 5)
  - NFC is not part of this phase (Phase 8); no NFC support is claimed
- [x] Phase 5 – Offline engine: per-user IndexedDB (Dexie), durable operation queue with idempotency keys, sequential sync engine (backoff, auth pause, restart recovery, duplicate prevention), cached products/categories/tags/workspace, offline reads and writes for stock movements and product create/edit, version-aware conflict handling with a resolution screen, Offline/Waiting/Syncing/Online/Sync-failed indicators and `/sync` queue page; migration 0004
  - [x] Tested with real IndexedDB semantics (fake-indexeddb) and real SQL (PGlite): engine ordering/retry/auth/restart/conflict, offline client, cache pull and local queries, details_version trigger
  - [ ] **Not yet verified in a real browser with the network switched off** - please try: open the app online once, go offline in DevTools, record stock and edit a product, reconnect and watch the Sync badge
  - [ ] Limitation: the app shell itself is not cached until Phase 9 (service worker), so a cold start with no connection will not load yet; an already-open tab keeps working
  - [ ] Online-only for now: archive/restore, delete, duplicate, bulk actions, creating inventories/organizations, movement history, CSV/Excel (Phase 6)
- [ ] Phase 6 – Alerts, import/export, reports, calculator
  - [x] 6a Alerts: stored low/out-of-stock/expiring/expired notifications, bell with unread count, Alerts page (filters, mark read), dashboard "Needs attention"; migration 0005; tested on real SQL (transitions, no duplicates, expiry job, per-user read state, isolation)
  - [ ] 6a not verified live: the hourly pg_cron schedule needs the extension enabled on your Supabase project
  - [x] 6b CSV/XLSX import and export: column mapping with auto-detection, per-row validation, in-file and existing-product duplicate detection, preview before commit, atomic import (migration 0006); CSV (UTF-8 BOM, formula-injection safe) and XLSX (frozen bold header, filter, real numbers/dates) export of products and movements. Tested: parsing, validation, CSV/XLSX round trips, import function on real SQL
  - [ ] 6b limits: files up to 5 MB / 5000 rows per import; import and movement export need a connection; product export works offline from the device copy; CSV cells starting with = + - @ are prefixed with ' on export (spreadsheet safety), so such SKUs gain a leading quote in CSV
  - [ ] 6c PDF reports and calculator
- [ ] Phase 7 – Team collaboration
- [ ] Phase 8 – Backups, Google Drive, NFC
- [ ] Phase 9 – PWA and polish
