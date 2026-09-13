# Public API

## createInfraAdapter

Kind: `function`
Module: `src/features/platform-infrastructure/composition/createInfraAdapter.ts`
Source: `src/features/platform-infrastructure/composition/createInfraAdapter.ts:13:1`

Create the canonical Supabase platform adapter entrypoint.

The foundation exposes the released Contracts boundary and fails lifecycle calls explicitly
until the provider implementation phase supplies its external adapters.

### Signatures

- `() => InfraServiceAdapter`
  - returns: `InfraServiceAdapter`

## infraAdapterDescriptor

Kind: `value`
Module: `src/constants/infra.ts`
Source: `src/constants/infra.ts:5:14`
