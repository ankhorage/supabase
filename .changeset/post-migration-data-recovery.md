---
'@ankhorage/supabase': patch
---

Restore portable database data only after Supabase-managed Auth and Storage schema migrations complete, while keeping recovery replay-safe and blocking new backups until recovery finishes.
