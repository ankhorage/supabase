import type {
  InfraEnvironmentSpec,
  InfraExecutionContext,
  InfraS3PersistenceTarget,
} from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

const s3Credentials = { source: 'control-plane', name: 'S3_PERSISTENCE' } as const;
const backupTarget = {
  endpoint: 'https://storage.example.test',
  region: 'eu-central-1',
  bucket: 'database-backups',
  credentials: s3Credentials,
  forcePathStyle: true,
} as const satisfies InfraS3PersistenceTarget;
const storageTarget = {
  ...backupTarget,
  bucket: 'storage-objects',
} as const satisfies InfraS3PersistenceTarget;

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

it('uses the Auth namespace contract without a connection-string search path', async () => {
  const result = await createInfraAdapter().desiredWorkloadsAsync(createContext('dev'));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const auth = result.value.find(({ id }) => id === 'supabase-auth');
  expect(auth?.environment?.DB_NAMESPACE).toEqual({ kind: 'literal', value: 'auth' });
  expect(JSON.stringify(auth?.environment?.GOTRUE_DB_DATABASE_URL)).not.toContain('search_path');
});

it('keeps the normal database entrypoint when backup recovery is disabled', async () => {
  const result = await createInfraAdapter().desiredWorkloadsAsync(createContext('prod'));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const database = result.value.find(({ id }) => id === 'supabase-db');
  expect(database?.command).toBeUndefined();
  expect(database?.args).toEqual([
    'postgres',
    '-c',
    'config_file=/etc/postgresql/postgresql.conf',
    '-c',
    'log_min_messages=fatal',
  ]);
});

it('projects Supabase-safe scheduled backups plus resumable first-boot restore', async () => {
  const result = await createInfraAdapter().desiredWorkloadsAsync(
    createContext('prod', {
      database: {
        provider: 'supabase',
        tier: 'prod',
        backup: { mode: 'scheduled', target: backupTarget, intervalHours: 12 },
      },
    }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const backup = result.value.find(({ id }) => id === 'supabase-db-backup');
  const database = result.value.find(({ id }) => id === 'supabase-db');
  const backupScript = backup?.args?.join('\n') ?? '';
  const restoreFile = database?.files?.find(({ path }) => path.endsWith('zzzz-ankhorage-restore.sh'));
  const restoreScript = restoreFile?.content.kind === 'literal' ? restoreFile.content.value : undefined;

  expect(backup?.dependsOn).toEqual(['supabase-db']);
  expect(backup?.environment?.BACKUP_INTERVAL_SECONDS).toEqual({ kind: 'literal', value: '43200' });
  expect(backup?.environment?.PGUSER).toEqual({ kind: 'literal', value: 'postgres' });
  expect(backup?.environment?.AWS_ACCESS_KEY_ID).toEqual({
    kind: 'credential',
    reference: s3Credentials,
    key: 'accessKeyId',
  });
  expect(backupScript).toContain('pg_dumpall --roles-only');
  expect(backupScript).toContain('pg_dump --schema-only');
  expect(backupScript).toContain("--exclude-table 'auth.schema_migrations'");
  expect(backupScript).toContain('SET session_replication_role = replica;');
  expect(backupScript).toContain('roles.sql');
  expect(backupScript).toContain('schema.sql');
  expect(backupScript).toContain('data.sql');
  expect(backupScript).not.toContain('pg_dump --format=custom');
  expect(database?.command).toEqual(['/bin/sh', '-c']);
  expect(database?.args?.at(-5)).toBe('postgres');
  expect(database?.health?.failureThreshold).toBe(60);
  expect(restoreScript).toContain('.ankhorage-restore-pending');
  expect(restoreScript).toContain('roles.sql');
  expect(restoreScript).toContain('schema.sql');
  expect(restoreScript).toContain('data.sql');
  expect(restoreScript).toContain('psql --set ON_ERROR_STOP=1');
  expect(JSON.stringify(result.value)).not.toContain('s3-access-secret');
});

it('uses the pinned Storage S3 environment contract and removes file persistence', async () => {
  const result = await createInfraAdapter().desiredWorkloadsAsync(
    createContext('prod', {
      objectStorage: { provider: 'supabase', buckets: ['media'], backend: storageTarget },
    }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const storage = result.value.find(({ id }) => id === 'supabase-storage');
  expect(storage?.persistence).toBeUndefined();
  expect(storage?.environment?.STORAGE_BACKEND).toEqual({ kind: 'literal', value: 's3' });
  expect(storage?.environment?.STORAGE_S3_BUCKET).toEqual({
    kind: 'literal',
    value: 'storage-objects',
  });
  expect(storage?.environment?.STORAGE_S3_FORCE_PATH_STYLE).toEqual({
    kind: 'literal',
    value: 'true',
  });
  expect(storage?.environment?.AWS_SECRET_ACCESS_KEY).toEqual({
    kind: 'credential',
    reference: s3Credentials,
    key: 'secretAccessKey',
  });
});

function createContext(
  tier: 'dev' | 'prod',
  overrides: Partial<InfraEnvironmentSpec> = {},
): InfraExecutionContext {
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
      ...overrides,
    },
    credentials: {
      resolveAsync: () => Promise.reject(new Error('Persistence projection needs no credentials.')),
    },
    secrets: {
      resolveAsync: () => Promise.reject(new Error('Persistence projection needs no secrets.')),
    },
  };
}
