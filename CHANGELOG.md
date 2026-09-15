# @ankhorage/supabase

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
