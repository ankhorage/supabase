---
'@ankhorage/supabase': patch
---

Filter PostgreSQL configuration-parameter grants that target Supabase-managed reserved roles so fresh-database recovery does not reference platform roles that are absent during portable role restore.
