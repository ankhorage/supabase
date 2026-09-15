import type { InfraExecutionContext } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

it('keeps dev persistence destroyable while retaining production data and pgsodium config', async () => {
  const adapter = createInfraAdapter();
  const dev = await adapter.desiredWorkloadsAsync(createContext('dev'));
  const prod = await adapter.desiredWorkloadsAsync(createContext('prod'));

  expect(dev.ok).toBe(true);
  expect(prod.ok).toBe(true);
  if (!dev.ok || !prod.ok) return;
  expect(
    dev.value.flatMap(({ persistence }) => persistence?.map(({ retention }) => retention) ?? []),
  ).toEqual(['delete-on-destroy', 'delete-on-destroy', 'delete-on-destroy']);
  expect(
    prod.value.flatMap(({ persistence }) => persistence?.map(({ retention }) => retention) ?? []),
  ).toEqual(['retain', 'retain', 'retain']);
  expect(prod.value.find(({ id }) => id === 'supabase-db')?.persistence).toEqual([
    {
      id: 'data',
      mountPath: '/var/lib/postgresql/data',
      sizeGiB: 20,
      retention: 'retain',
    },
    {
      id: 'config',
      mountPath: '/etc/postgresql-custom',
      sizeGiB: 1,
      seed: 'image',
      retention: 'retain',
    },
  ]);
});

function createContext(tier: 'dev' | 'prod'): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: tier === 'prod' ? 'production' : 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: { provider: 'supabase', tier },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: {
      resolveAsync: () => Promise.reject(new Error('Persistence projection needs no credentials.')),
    },
    secrets: {
      resolveAsync: () => Promise.reject(new Error('Persistence projection needs no secrets.')),
    },
  };
}
