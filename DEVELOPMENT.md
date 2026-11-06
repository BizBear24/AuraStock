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
- [ ] Phase 3 – Stock operations (transactional movements)
- [ ] Phase 4 – Scanning
- [ ] Phase 5 – Offline engine
- [ ] Phase 6 – Alerts, import/export, reports
- [ ] Phase 7 – Team collaboration
- [ ] Phase 8 – Backups, Google Drive, NFC
- [ ] Phase 9 – PWA and polish
