# Architecture

## Phase 0 audit

The repository was empty (no source, no database, no remote history). There was no existing functionality or technical debt to preserve. Notes:

- The Vite scaffolder installs TypeScript 7, which `typescript-eslint` does not yet support. TypeScript is pinned to `~6.0`.
- `@vitejs/plugin-react` must be v6+ for Vite 8.

## Layers

| Layer | Location | Rule |
| --- | --- | --- |
| UI primitives | `src/components/ui` | Presentational, no data fetching, one component API per concept |
| Layout | `src/components/layout` | App shell, sidebar, top bar, mobile bottom nav |
| Features | `src/features/<name>` | Screens + hooks + feature API for one module |
| Domain | `src/domain` | Pure TypeScript business rules (permissions, stock math). No React, no I/O. Fully unit tested |
| Data access | `src/features/*/api.ts`, `src/lib/supabase.ts` | The only code that talks to Supabase |
| Offline / sync | `src/offline` (Phase 5) | Dexie repositories + sync engine, separate from UI |

Dependencies point downward only: UI → features → domain. Domain never imports from features or UI.

## Conventions

- Strict TypeScript, `noUncheckedIndexedAccess`, no `any`, no `@ts-ignore`.
- Path alias `@/` → `src/`.
- Server state: TanStack Query. Forms: React Hook Form + Zod. Zustand only for genuinely shared client state.
- Authorisation is enforced by PostgreSQL RLS and RPC functions. Frontend role checks (`src/domain/permissions.ts`) only shape the UI.
- Quantities change only through the `record_stock_movement` database function (Phase 3), never by direct UPDATE.

## Multi-tenancy

organization → inventories → products. Users join organizations through `organization_members` with a role (`owner | admin | editor | viewer`). Every tenant table carries `organization_id` and is guarded by RLS using `is_org_member()` / `has_org_role()` helpers.
