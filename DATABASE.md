# Database

Schema lives in `supabase/migrations`. Every change is a new migration; never edit production by hand.

See migration `0001_foundation.sql` for the Phase 1 tables (profiles, organizations, organization_members, inventories) and helper functions. Later phases add products, categories, tags, custom fields, stock_movements, notifications, integrations, backups, sync records and audit logs.

## Roles

`owner` > `admin` > `editor` > `viewer`. Hierarchy is encoded in `org_role_rank()`.
