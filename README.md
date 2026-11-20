# AuraStock

Offline-first inventory management for retail stores, warehouses, restaurants and small businesses.
React 19 + TypeScript + Vite and Tailwind 4 on the front end; Supabase (PostgreSQL, Auth, RLS, Realtime, Storage) on the back end. Installable as an app (PWA) and usable with no connection.

Live: https://aurastock-rosy.vercel.app

## What it does

**Everyday (the core, always one tap away)**

- **Products**: name, SKU, barcode, QR value, category, tags, unit, minimum stock, expiry; search, filters, bulk actions.
- **Scan**: camera (barcodes and QR), USB/Bluetooth scanners, manual entry, NFC tags on supported phones. Scan to find a product, record stock in or out, or create it.
- **Stock movements**: in, out, adjustment, correction. Every change is recorded permanently; stock can never go negative.
- **Transfers**: scan items out at one location, they show as in transit, scan them in at the other.
- **Dashboard**: what is low, out, expiring, and what moved, with quick actions.

**Tools**: alerts (low stock, out of stock, expiry), PDF reports, stock analysis (usage, days of cover, reorder suggestions), CSV/Excel import and export, calculator.

**Admin**: inventories and demo data, team invitations and roles, activity log, verified backups with restore and Google Drive, organization settings.

Works offline: changes are saved on the device and synced when the connection returns, with conflicts handled safely.

## Quick start

```bash
npm install
cp .env.example .env     # fill in your Supabase URL + anon key
npm run dev
```

Apply the database migrations in `supabase/migrations` (in order) to your Supabase project. See [DEVELOPMENT.md](DEVELOPMENT.md).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (no `any`, no ts-ignore) |
| `npm test` | Vitest: unit, component, accessibility and real-SQL database tests |
| `npm run test:e2e` | Playwright end-to-end tests against the production build (desktop and mobile) |
| `npm run build` | Typecheck + production build (includes the service worker) |
| `npm run icons` | Regenerate the app icons in `public/icons` |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) – layers, folder layout, offline and sync design, conventions
- [DATABASE.md](DATABASE.md) – schema, RLS, stock rules, every migration
- [DEVELOPMENT.md](DEVELOPMENT.md) – setup, Supabase, Google Drive, workflow, **feature checklist**

## Current Status of development

All ten phases (0–9) are implemented and tested. Features are only ticked in [DEVELOPMENT.md](DEVELOPMENT.md) once actually tested; items that still need your setup or real-device checks are listed there with the reason.
