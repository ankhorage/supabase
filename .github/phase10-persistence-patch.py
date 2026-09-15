from pathlib import Path

workloads = Path('src/features/platform-infrastructure/domain/createSupabaseWorkloads.ts')
source = workloads.read_text()
source = source.replace(
    '/*** Create the persistent Postgres 17 workload and first-boot configuration. */',
    '/*** Create persistent Postgres 17 data and custom configuration for safe runtime recreation. */',
    1,
)
old = """    persistence: [
      {
        id: 'data',
        mountPath: '/var/lib/postgresql/data',
        sizeGiB: prod ? 20 : 5,
        retention: prod ? 'retain' : 'delete-on-destroy',
      },
    ],"""
new = """    persistence: createDatabasePersistence(prod),"""
if source.count(old) != 1:
    raise SystemExit(f'Expected one database persistence block, found {source.count(old)}')
source = source.replace(old, new, 1)
anchor = """/*** Create the GoTrue authentication workload using the current external Auth URL shape. */
function createAuthWorkload(baseUrl: string): InfraWorkloadSpec {"""
helper = """/*** Keep Postgres data and pgsodium configuration on independently retained runtime volumes. */
function createDatabasePersistence(
  prod: boolean,
): NonNullable<InfraWorkloadSpec['persistence']> {
  return [
    {
      id: 'data',
      mountPath: '/var/lib/postgresql/data',
      sizeGiB: prod ? 20 : 5,
      retention: prod ? 'retain' : 'delete-on-destroy',
    },
    {
      id: 'config',
      mountPath: '/etc/postgresql-custom',
      sizeGiB: 1,
      retention: prod ? 'retain' : 'delete-on-destroy',
    },
  ];
}

/*** Create the GoTrue authentication workload using the current external Auth URL shape. */
function createAuthWorkload(baseUrl: string): InfraWorkloadSpec {"""
if source.count(anchor) != 1:
    raise SystemExit(f'Expected one auth workload anchor, found {source.count(anchor)}')
workloads.write_text(source.replace(anchor, helper, 1))

tests = Path('src/supabaseLifecycle.test.ts')
test_source = tests.read_text()
block = """it('makes dev persistence explicitly destroyable while retaining production data', async () => {
  const adapter = createInfraAdapter({ controlPlane: new FakeSupabaseControlPlane() });
  const dev = await adapter.desiredWorkloadsAsync(createContext('dev'));
  const prod = await adapter.desiredWorkloadsAsync(createContext('prod'));

  expect(dev.ok).toBe(true);
  expect(prod.ok).toBe(true);
  if (!dev.ok || !prod.ok) return;
  expect(
    dev.value.flatMap(({ persistence }) => persistence?.map(({ retention }) => retention) ?? []),
  ).toEqual(['delete-on-destroy', 'delete-on-destroy']);
  expect(
    prod.value.flatMap(({ persistence }) => persistence?.map(({ retention }) => retention) ?? []),
  ).toEqual(['retain', 'retain']);
});

"""
if test_source.count(block) != 1:
    raise SystemExit(f'Expected one persistence test block, found {test_source.count(block)}')
tests.write_text(test_source.replace(block, '', 1))

Path('src/supabasePersistence.test.ts').write_text("""import type { InfraExecutionContext } from '@ankhorage/contracts/infra';
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
""")
