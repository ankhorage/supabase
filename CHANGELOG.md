# @ankhorage/supabase

## 0.5.10

### Patch Changes

- d8962cb: Restore standalone local Supabase bootstrap credential provisioning through the provider-neutral preparation contract while keeping validation read-only and non-local environments fail-closed.

## 0.5.9

### Patch Changes

- 6a11c3d: Align logical database backups with Supabase restore exclusions for service-owned Storage vector tables.

## 0.5.8

### Patch Changes

- f86e630: Restore portable database data only after Supabase-managed Auth and Storage schema migrations complete, while keeping recovery replay-safe and blocking new backups until recovery finishes.

## 0.5.7

### Patch Changes

- 292b852: Filter PostgreSQL configuration-parameter grants that target Supabase-managed reserved roles so fresh-database recovery does not reference platform roles that are absent during portable role restore.

## 0.5.6

### Patch Changes

- e382044: Keep allowlisted custom role settings portable while ensuring Supabase-managed reserved `ALTER ROLE` configuration remains filtered from fresh-database recovery backups.

## 0.5.5

### Patch Changes

- 6754aff: Respect independent object-storage provider selection so Supabase database/auth can run without contributing a second Supabase Storage stack.

## 0.5.4

### Patch Changes

- 46a9671: Filter role-membership grants whose PostgreSQL grantor is a Supabase-managed reserved role so fresh-database restores do not reference platform roles that are absent during first boot.

## 0.5.3

### Patch Changes

- f701414: Filter database-backup role memberships whenever either side is a Supabase-managed reserved role, so recovery restores only portable custom-role relationships.

## 0.5.2

### Patch Changes

- f88fd2b: Make scheduled database backups Supabase-safe and resume interrupted first-boot recovery from a fresh database directory.

## 0.5.1

### Patch Changes

- e86cb78: Align Auth with Supabase's explicit database namespace contract so persisted databases restart cleanly, and harden the database recovery path used by production backup acceptance.

## 0.5.0

### Minor Changes

- 0cc1f77: Add scheduled logical database backup and first-boot restore through S3-compatible storage, plus an
  optional S3 backend for Supabase Storage.

## 0.4.9

### Patch Changes

- b079422: Seed the retained Postgres custom configuration volume from the Supabase image on first creation so Kubernetes preserves image-provided configuration and the generated pgsodium root key.

## 0.4.8

### Patch Changes

- 56a656f: Persist the Postgres custom configuration volume so production pgsodium key material survives runtime and host recreation alongside database data.

## 0.4.7

### Patch Changes

- 64d6ecb: Align Realtime, Studio, and Envoy readiness probes with the health commands supported by their current container images while keeping credentials execution-only.

## 0.4.6

### Patch Changes

- 2f13ca5: Use the postgres-meta image's native Node health command so provider readiness works without assuming `wget` exists in the container.

## 0.4.5

### Patch Changes

- 32f9781: Make dev/default Supabase database and file-storage volumes explicitly destroyable while retaining production-tier persistence.

## 0.4.4

### Patch Changes

- bcf34be: Use the current self-hosted Supabase Studio health endpoint for runtime readiness checks.

## 0.4.3

### Patch Changes

- e07b451: Restore the self-hosted Supabase webhooks bootstrap before database role password initialization.

## 0.4.2

### Patch Changes

- 227b8b0: Preserve the Supabase Postgres image bootstrap user when projecting the database workload.

## 0.4.1

### Patch Changes

- b8c6391: Preserve the Supabase Postgres image entrypoint while passing the database server command as container arguments.

## 0.4.0

### Minor Changes

- e6ebe17: Use released runtime endpoints for local Supabase control-plane reconciliation.

## 0.3.0

### Minor Changes

- efc58a1: Complete the provider-neutral self-hosted Supabase workload graph with Imgproxy, Postgres Meta, Studio, current image pins, explicit readiness and bootstrap dependencies.

## 0.2.0

### Minor Changes

- 1522929: Implement the runtime-neutral Supabase platform workload and bucket lifecycle.

## 0.1.0

### Minor Changes

- 7bd93ec: Publish the initial provider-neutral infrastructure package foundation.

## 0.0.0

Initial unpublished package state.
