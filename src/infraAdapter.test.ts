import { INFRA_ADAPTER_CATALOG, isInfraAdapterDescriptor } from '@ankhorage/contracts/infra';
import { describe, expect, it } from 'bun:test';

import { createInfraAdapter, infraAdapterDescriptor } from './index';

describe('Supabase platform adapter', () => {
  it('exports the exact Contracts catalog descriptor', () => {
    expect(infraAdapterDescriptor).toEqual(INFRA_ADAPTER_CATALOG.supabase);
    expect(isInfraAdapterDescriptor(infraAdapterDescriptor)).toBe(true);
  });

  it('rejects descriptor identity drift', () => {
    expect(
      isInfraAdapterDescriptor({
        ...infraAdapterDescriptor,
        package: '@ankhorage/not-supabase',
      }),
    ).toBe(false);
  });

  it('exposes the canonical implementation entrypoint', () => {
    expect(createInfraAdapter().descriptor).toBe(infraAdapterDescriptor);
  });
});
