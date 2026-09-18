import type {
  InfraEnvironmentSpec,
  InfraExecutionContext,
  InfraS3PersistenceTarget,
  InfraWorkloadSpec,
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
    dev.value.flatMap(({ persistence }) =>
      Object.values(persistence ?? {}).map(({ retention }) => retention),
    ),
  ).toEqual(['delete-on-destroy', 'delete-on-destroy']);
  expect(
    prod.value.flatMap(({ persistence }) =>
      Object.values(persistence ?? {}).map(({ retention }) => retention),
    ),
  ).toEqual(['retain', 'retain']);
  expect(prod.value.find(({ id }) => id === 'supabase-db')?.persistence).toEqual({
    data: {
      id: 'data',
      mountPath: '/var/lib/postgresql/data',
      sizeGiB: 20,
      retention: 'retain',
    },
    config: {
      id: 'config',
      mountPath: '/etc/postgresql-custom',
      sizeGiB: 1,
      seed: 'image',
      retention: 'retain',
    },
  });
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
  const database = requireWorkload(result.value, 'supabase-db');
  expect(database.command).toBeUndefined();
  expect(database.args).toEqual([
    'postgres',
    '-c',
    'config_file=/etc/postgresql/postgresql.conf',
    '-c',
    'log_min_messages=fatal',
  ]);
  expect(result.value.some(({ id }) => id === 'supabase-db-data-restore')).toBe(false);
  expect(
    Object.hasOwn(
      requireWorkload(result.value, 'supabase-gateway').dependsOn ?? {},
      'supabase-db-data-restore',
    ),
  ).toBe(false);
});

it('projects Supabase-safe backup plus post-migration atomic data recovery', async () => {
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

  assertBackupProjection(requireWorkload(result.value, 'supabase-db-backup'));
  assertRestoreProjection(requireWorkload(result.value, 'supabase-db'));
  assertDataRestoreProjection(requireWorkload(result.value, 'supabase-db-data-restore'));
  expect(
    Object.hasOwn(
      requireWorkload(result.value, 'supabase-gateway').dependsOn ?? {},
      'supabase-db-data-restore',
    ),
  ).toBe(true);
  expect(JSON.stringify(result.value)).not.toContain('s3-access-secret');
});

it('waits for Storage migrations before data recovery when Supabase owns object storage', async () => {
  const result = await createInfraAdapter().desiredWorkloadsAsync(
    createContext('prod', {
      database: {
        provider: 'supabase',
        tier: 'prod',
        backup: { mode: 'scheduled', target: backupTarget },
      },
      objectStorage: { provider: 'supabase', buckets: { media: true }, backend: storageTarget },
    }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(requireWorkload(result.value, 'supabase-db-data-restore').dependsOn).toEqual([
    'supabase-auth',
    'supabase-storage',
  ]);
});

it('uses the pinned Storage S3 environment contract and removes file persistence', async () => {
  const result = await createInfraAdapter().desiredWorkloadsAsync(
    createContext('prod', {
      objectStorage: { provider: 'supabase', buckets: { media: true }, backend: storageTarget },
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

function assertBackupProjection(backup: InfraWorkloadSpec): void {
  const backupScript = backup.args?.join('\n') ?? '';
  expect(backup.dependsOn).toEqual({ 'supabase-db-data-restore': true });
  expect(backup.environment?.BACKUP_INTERVAL_SECONDS).toEqual({ kind: 'literal', value: '43200' });
  expect(backup.environment?.PGUSER).toEqual({ kind: 'literal', value: 'postgres' });
  expect(backup.environment?.AWS_ACCESS_KEY_ID).toEqual({
    kind: 'credential',
    reference: s3Credentials,
    key: 'accessKeyId',
  });
  expect(backupScript).toContain('pg_dumpall --roles-only');
  expect(backupScript).toContain('s/^GRANT "(anon|authenticated|authenticator');
  expect(backupScript).toContain('TO "(anon|authenticated|authenticator');
  expect(backupScript).toContain('GRANTED BY "(anon|authenticated|authenticator');
  expect(backupScript).toContain(
    'GRANT (SET|ALTER SYSTEM) ON PARAMETER .* TO "(anon|authenticated|authenticator',
  );
  expect(backupScript).toContain('_ankhorage');
  expect(backupScript).toContain('pg_dump --schema-only');
  expect(backupScript).toContain("--exclude-table 'auth.schema_migrations'");
  expect(backupScript).toContain("--exclude-table 'storage.buckets_vectors'");
  expect(backupScript).toContain("--exclude-table 'storage.vector_indexes'");
  expect(backupScript).not.toContain("--exclude-schema 'storage'");
  expect(backupScript).toContain('SET session_replication_role = replica;');
  expect(backupScript).toContain('roles.sql');
  expect(backupScript).toContain('schema.sql');
  expect(backupScript).toContain('data.sql');
  expect(backupScript).not.toContain('pg_dump --format=custom');
}

function assertRestoreProjection(database: InfraWorkloadSpec): void {
  const restoreScript = requireLiteralFileContent(database, 'zzzz-ankhorage-restore.sh');
  expect(database.command).toEqual(['/bin/sh', '-c']);
  expect(database.args?.at(-5)).toBe('postgres');
  expect(database.health?.failureThreshold).toBe(60);
  expect(restoreScript).toContain('.ankhorage-restore-pending');
  expect(restoreScript).toContain('roles.sql');
  expect(restoreScript).toContain('schema.sql');
  expect(restoreScript).toContain('database_restore');
  expect(restoreScript).toContain('data restore is deferred');
  expect(restoreScript).not.toContain('download_file "$prefix/data.sql"');
}

function assertDataRestoreProjection(dataRestore: InfraWorkloadSpec): void {
  const restoreScript = dataRestore.args?.join('\n') ?? '';
  expect(dataRestore.dependsOn).toEqual({ 'supabase-auth': true });
  expect(dataRestore.health).toEqual({
    kind: 'command',
    command: ['test', '-f', '/tmp/ankhorage-data-restore-ready'],
    intervalSeconds: 10,
    timeoutSeconds: 5,
    failureThreshold: 120,
  });
  expect(restoreScript).toContain('download_file "$prefix/data.sql"');
  expect(restoreScript).toContain('psql --single-transaction');
  expect(restoreScript).toContain('SET data_restored = TRUE');
  expect(restoreScript).toContain("WHERE id = 'latest';");
}

function requireWorkload(workloads: readonly InfraWorkloadSpec[], id: string): InfraWorkloadSpec {
  const workload = workloads.find((candidate) => candidate.id === id);
  if (workload === undefined) throw new Error(`Expected workload ${id}.`);
  return workload;
}

function requireLiteralFileContent(workload: InfraWorkloadSpec, suffix: string): string {
  const entry = Object.entries(workload.files ?? {}).find(([filePath]) =>
    filePath.endsWith(suffix),
  );
  if (entry === undefined) throw new Error(`Expected workload file ending with ${suffix}.`);
  const [, file] = entry;
  if (file.kind !== 'literal') throw new Error(`Expected ${suffix} to contain a literal.`);
  return file.value;
}

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
      findAsync: () => Promise.reject(new Error('Persistence projection needs no credentials.')),
      resolveAsync: () => Promise.reject(new Error('Persistence projection needs no credentials.')),
      persistAsync: () => Promise.reject(new Error('Persistence projection needs no credentials.')),
    },
    secrets: {
      resolveAsync: () => Promise.reject(new Error('Persistence projection needs no secrets.')),
    },
  };
}
