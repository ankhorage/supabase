---
'@ankhorage/supabase': patch
---

Use the postgres-meta image's native Node health command so provider readiness works without assuming `wget` exists in the container.
