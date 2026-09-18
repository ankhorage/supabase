import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';
import { SUPABASE_VAULT_MIGRATION_SQL } from '@ankhorage/supabase-vault/migrations';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

it('adds the canonical Vault migration to the Supabase database bootstrap when selected', async () => {
  const adapter = createInfraAdapter();
  const workloads = await adapter.desiredWorkloadsAsync(createContext(true));
  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;

  const files = workloads.value.find(({ id }) => id === 'supabase-db')?.files ?? {};
  const migration = Object.entries(files).find(([filePath]) =>
    filePath.endsWith('/99-ankhorage-supabase-vault.sql'),
  )?.[1];

  expect(migration).toEqual({ kind: 'literal', value: SUPABASE_VAULT_MIGRATION_SQL });
});

it('does not add the Vault migration when no Supabase Vault secret store is selected', async () => {
  const adapter = createInfraAdapter();
  const workloads = await adapter.desiredWorkloadsAsync(createContext(false));
  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;

  const paths = Object.keys(workloads.value.find(({ id }) => id === 'supabase-db')?.files ?? {});
  expect(paths).not.toContain(
    '/docker-entrypoint-initdb.d/migrations/99-ankhorage-supabase-vault.sql',
  );
});

/*** Create one workload-only test context with optional canonical Vault selection. */
function createContext(vaultSelected: boolean): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: { provider: 'supabase', tier: 'dev' },
      ...(vaultSelected ? { secretStore: { provider: 'supabase-vault' } } : {}),
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: {
      findAsync: () => success(null),
      resolveAsync: () => success({}),
      persistAsync: () => success(null),
    },
    secrets: { resolveAsync: () => success('') },
  };
}

/*** Create one successful Infra result for deterministic test ports. */
function success<T>(value: T): Promise<InfraResult<T>> {
  return Promise.resolve({ ok: true, value, diagnostics: [] });
}
