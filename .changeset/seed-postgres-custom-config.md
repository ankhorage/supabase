---
"@ankhorage/supabase": patch
---

Seed the retained Postgres custom configuration volume from the Supabase image on first creation so Kubernetes preserves image-provided configuration and the generated pgsodium root key.
