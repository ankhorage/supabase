# Public API

## createFetchSupabaseControlPlane

Kind: `function`
Module: `src/features/platform-infrastructure/adapters/outbound/createFetchSupabaseControlPlane.ts`
Source: `src/features/platform-infrastructure/adapters/outbound/createFetchSupabaseControlPlane.ts:12:1`

Create a sanitized HTTP adapter for self-hosted Supabase health and bucket lifecycle.

### Signatures

- `(options?: FetchSupabaseControlPlaneOptions) => SupabaseControlPlane`
  - options: `FetchSupabaseControlPlaneOptions` (optional)
  - returns: `SupabaseControlPlane`

## createInfraAdapter

Kind: `function`
Module: `src/features/platform-infrastructure/composition/createInfraAdapter.ts`
Source: `src/features/platform-infrastructure/composition/createInfraAdapter.ts:22:1`

Create the canonical runtime-neutral Supabase platform adapter.

The provider contributes portable workloads and reconciles Supabase-owned API resources after
the selected runtime is ready. Resolved bootstrap secrets never cross the execution boundary.

### Signatures

- `(options?: SupabaseAdapterOptions) => InfraServiceAdapter`
  - options: `SupabaseAdapterOptions` (optional)
  - returns: `InfraServiceAdapter`

## infraAdapterDescriptor

Kind: `value`
Module: `src/constants/infra.ts`
Source: `src/constants/infra.ts:5:14`

## SupabaseAdapterOptions

Kind: `type`
Module: `src/types/supabase.ts`
Source: `src/types/supabase.ts:20:1`

### Members

| Name         | Kind     | Type                                | Required | Description |
| ------------ | -------- | ----------------------------------- | -------- | ----------- |
| controlPlane | property | `SupabaseControlPlane \| undefined` | no       |             |

## SupabaseControlPlane

Kind: `type`
Module: `src/types/supabase.ts`
Source: `src/types/supabase.ts:9:1`

### Members

| Name              | Kind   | Type                                                                                                  | Required | Description |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------- | -------- | ----------- |
| createBucketAsync | method | `(request: SupabaseControlPlaneRequest & { readonly bucket: string; }) => Promise<InfraResult<null>>` | yes      |             |
| deleteBucketAsync | method | `(request: SupabaseControlPlaneRequest & { readonly bucket: string; }) => Promise<InfraResult<null>>` | yes      |             |
| healthAsync       | method | `(request: SupabaseControlPlaneRequest) => Promise<InfraResult<null>>`                                | yes      |             |
| listBucketsAsync  | method | `(request: SupabaseControlPlaneRequest) => Promise<InfraResult<readonly string[]>>`                   | yes      |             |

## SupabaseControlPlaneRequest

Kind: `type`
Module: `src/types/supabase.ts`
Source: `src/types/supabase.ts:3:1`

### Members

| Name           | Kind     | Type                       | Required | Description |
| -------------- | -------- | -------------------------- | -------- | ----------- |
| baseUrl        | property | `string`                   | yes      |             |
| serviceRoleKey | property | `string`                   | yes      |             |
| signal         | property | `AbortSignal \| undefined` | no       |             |
