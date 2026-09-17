import type { InfraExecutionContext, InfraS3PersistenceTarget } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

const backupTarget = {
  endpoint: 'https://storage.example.test',
  region: 'eu-central-1',
  bucket: 'database-backups',
  credentials: { source: 'control-plane', name: 'S3_PERSISTENCE' },
  forcePathStyle: true,
} as const satisfies InfraS3PersistenceTarget;

it('filters reserved ALTER ROLE config after re-enabling portable allowlisted config', async () => {
  const result = await createInfraAdapter().desiredWorkloadsAsync(createContext());
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const backup = result.value.find(({ id }) => id === 'supabase-db-backup');
  if (backup === undefined) throw new Error('Expected Supabase database backup workload.');
  const script = backup.args?.join('\n') ?? '';
  const allowlistedConfig = script.indexOf(
    's/^-- (.* SET "(pgaudit.*|pgrst.*|session_replication_role',
  );
  const reservedAlter = script.indexOf('s/^ALTER ROLE "(anon|authenticated|authenticator');

  expect(allowlistedConfig).toBeGreaterThan(-1);
  expect(reservedAlter).toBeGreaterThan(allowlistedConfig);
  expect(script).toContain('statement_timeout|track_io_timing');
  expect(script).toContain('service_role|supabase_.*|pgsodium_keyholder');
});

/*** Create production backup intent without resolving execution-only credentials. */
function createContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'production',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: {
        provider: 'supabase',
        tier: 'prod',
        backup: { mode: 'scheduled', target: backupTarget },
      },
      networking: { publicBaseUrl: 'https://api.example.test' },
    },
    credentials: {
      findAsync: () => Promise.reject(new Error('Projection must not find credentials.')),
      resolveAsync: () => Promise.reject(new Error('Projection must not resolve credentials.')),
      persistAsync: () => Promise.reject(new Error('Projection must not persist credentials.')),
    },
    secrets: {
      resolveAsync: () => Promise.reject(new Error('Projection must not resolve secrets.')),
    },
  };
}
