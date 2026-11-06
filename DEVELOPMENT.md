# Development

## Setup

1. `npm install`
2. Create a Supabase project, copy URL + anon key into `.env` (see `.env.example`).
3. Apply migrations: `supabase db push` (Supabase CLI) or run files in `supabase/migrations` in order in the SQL editor.

## Workflow

Typecheck, lint and test before every commit: `npm run typecheck && npm run lint && npm test`.

## Feature checklist

- [x] Phase 0 – Repository audit
- [ ] Phase 1 – Foundation (design system, auth, organizations, migrations, RLS, navigation)
- [ ] Phase 2 – Core inventory (products, categories, tags, search, dashboard)
- [ ] Phase 3 – Stock operations (transactional movements)
- [ ] Phase 4 – Scanning
- [ ] Phase 5 – Offline engine
- [ ] Phase 6 – Alerts, import/export, reports
- [ ] Phase 7 – Team collaboration
- [ ] Phase 8 – Backups, Google Drive, NFC
- [ ] Phase 9 – PWA and polish
