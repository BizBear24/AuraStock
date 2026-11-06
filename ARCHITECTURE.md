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

## Scanning (Phase 4)

- `src/domain/scan.ts`: pure logic (normalisation, repeat suppression, HID burst detection, camera error classification).
- `src/features/scan`: `CameraScanner` (mounted = camera on, unmounted = device released), `useHidScanner` (global key listener; form fields are ignored unless marked `data-scan-input`), `ScanPage` (workflows).
- Lookup priority is barcode, then QR value, then SKU, within the active inventory (`findProductByCode`).
- Camera access requires HTTPS (or localhost) and user permission; otherwise the page offers manual entry and USB scanners.

## Offline and synchronization (Phase 5)

### Layout (`src/offline`)

| File | Role |
| --- | --- |
| `db.ts` | Dexie schema, one database per signed-in user (`aurastock-<userId>`): `outbox`, `products`, `categories`, `tags`, `meta` |
| `engine.ts` | `SyncEngine`: durable queue, sequential replay, retry, status snapshot. No UI or Supabase imports |
| `executors.ts` | Sends one queued operation to the server (the only bridge between the engine and Supabase) |
| `client.ts` | `OfflineClient`: online-first writes that fall back to the queue |
| `local.ts` | Cache writes, cache-backed queries, pending overlay, pull |
| `resilient.ts` | `readThrough`: server first, cache when unreachable |
| `OfflineProvider.tsx`, `SyncStatus.tsx`, `SyncPage.tsx` | React wiring and UI |

### Read path
Server when reachable (results refresh the cache), cache when offline or the request fails for connectivity reasons. Genuine errors (permissions, bad input) are never masked by the cache. The active inventory is pulled in the background (incremental by `updated_at`, full refresh at least daily to drop deleted rows).

### Write path
1. Online: call the server directly so the user gets the real answer at once (for example "Insufficient stock").
2. Offline, or the connection drops mid-request: store the operation in IndexedDB with the **same operation id** and replay later. The UI then says "Saved on this device only", never "saved".

### Conflict and consistency strategy

| Data | Policy |
| --- | --- |
| Stock movements | Append-only; each has a unique operation id; the server applies it at most once (`record_stock_movement` is idempotent) and re-validates against the authoritative quantity under a row lock. |
| Stock quantity | Never last-write-wins. The device shows *server-confirmed quantity + queued movement deltas* as an estimate. The server recomputes from the ledger on each movement; a movement that no longer fits (for example someone else removed the stock first) is **rejected** and parked on the Sync page for a person to retry or discard. After sync the cache is refreshed from the server. |
| Product details (name, SKU, description...) | Version-aware: each edit carries the `details_version` it was based on. If the server moved on, the edit becomes a **conflict**: the user keeps their version (re-applied on top of the server's) or takes the server's. If the server row already equals the queued values (a replayed, already-applied save) it is treated as done. Stock-only changes do not bump `details_version`, so receiving stock never conflicts with an edit. Later queued edits of a product are rebased after an earlier edit lands. |
| Product creation | Client-generated UUID; a duplicate insert of the same id is treated as success, so replays are safe. |
| Permissions | Always checked by the database at replay time (RLS / function checks). A change queued while permitted but sent after demotion is rejected and shown as rejected. |

### Engine behaviour
- Operations run in queue order. A product with an earlier failed/conflicting/backing-off operation holds back only its own later operations.
- Error classes (`src/domain/sync.ts`): network (keep, back off, stop), auth (pause; nothing is lost), transient (back off, up to 8 attempts), permanent (park as rejected).
- Restart: operations left "sending" return to "pending"; replay is safe because of idempotency.
- Sign out with unsynced changes asks for confirmation; the queue stays on the device, scoped to that user.
- The status wording is covered by tests so queued work is never labelled as synchronized.
