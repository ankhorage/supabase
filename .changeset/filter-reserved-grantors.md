---
'@ankhorage/supabase': patch
---

Filter role-membership grants whose PostgreSQL grantor is a Supabase-managed reserved role so fresh-database restores do not reference platform roles that are absent during first boot.
