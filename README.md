# AuraStock

Offline-first inventory management for retail stores, warehouses, restaurants and small businesses.
React 19 + TypeScript + Vite + Tailwind 4 on the front end; Supabase (PostgreSQL, Auth, RLS, Realtime, Storage) on the back end.

## Quick start

```bash
npm install
cp .env.example .env     # fill in your Supabase URL + anon key
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (no `any`, no ts-ignore) |
| `npm test` | Vitest unit + component tests |
| `npm run build` | Typecheck + production build |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) – layers, folder layout, conventions
- [DATABASE.md](DATABASE.md) – schema, RLS, stock-movement rules
- [DEVELOPMENT.md](DEVELOPMENT.md) – setup, Supabase, workflow, **feature checklist**

## Status

See the checklist in [DEVELOPMENT.md](DEVELOPMENT.md). Features are only ticked once actually tested.
