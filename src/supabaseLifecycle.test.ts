import type {
  InfraExecutionContext,
  InfraOutput,
  InfraResourceIdentity,
  InfraResult,
} from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import type { SupabaseControlPlane, SupabaseControlPlaneRequest } from './index';
import { createInfraAdapter } from './index';

it('contributes one deterministic current runtime-neutral Supabase workload graph', async () => {
  const adapter = createInfraAdapter({ controlPlane: new FakeSupabaseControlPlane() });
  const workloads = await adapter.desiredWorkloadsAsync(createContext());

  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;
  expect(workloads.value.map(({ id }) => id)).toEqual([
    'supabase-db',
    'supabase-auth',
    'supabase-rest',
    'supabase-realtime',
    'supabase-imgproxy',
    'supabase-storage',
    'supabase-meta',
    'supabase-studio',
    'supabase-gateway',
  ]);
  expect(workloads.value.map(({ artifact }) => artifact.image)).toEqual([
    'supabase/postgres:17.6.1.136',
    'supabase/gotrue:v2.196.0',
    'postgrest/postgrest:v14.17',
    'supabase/realtime:v2.134.10',
    'darthsim/imgproxy:v3.31.4',
    'supabase/storage-api:v1.74.0',
    'supabase/postgres-meta:v0.99.0',
    'supabase/studio:2026.09.07-sha-7996410',
    'envoyproxy/envoy:v1.39.1',
  ]);
  const database = workloads.value.find(({ id }) => id === 'supabase-db');
  expect(database?.command).toBeUndefined();
  expect(database?.args).toEqual([
    'postgres',
    '-c',
    'config_file=/etc/postgresql/postgresql.conf',
    '-c',
    'log_min_messages=fatal',
  ]);
  expect(database?.environment?.POSTGRES_USER).toBeUndefined();
  expect(workloads.value.find(({ id }) => id === 'supabase-gateway')?.ports).toEqual([
    { name: 'http', port: 8000, publishedPort: 54_321 },
  ]);
});

it('defines readiness, bootstrap and dependency boundaries without leaking secrets', async () => {
  const adapter = createInfraAdapter({ controlPlane: new FakeSupabaseControlPlane() });
  const workloads = await adapter.desiredWorkloadsAsync(createContext());

  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;
  expect(workloads.value.every(({ health }) => health !== undefined)).toBe(true);
  expect(workloads.value.find(({ id }) => id === 'supabase-storage')?.dependsOn).toContain(
    'supabase-imgproxy',
  );
  expect(workloads.value.find(({ id }) => id === 'supabase-studio')?.dependsOn).toEqual([
    'supabase-db',
    'supabase-meta',
  ]);
  const databaseFiles = workloads.value.find(({ id }) => id === 'supabase-db')?.files ?? [];
  expect(databaseFiles.map(({ path }) => path)).toEqual([
    '/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql',
    '/docker-entrypoint-initdb.d/init-scripts/99-roles.sql',
    '/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql',
    '/docker-entrypoint-initdb.d/migrations/99-realtime.sql',
  ]);
  expect(JSON.stringify(databaseFiles[0])).toContain('CREATE USER supabase_functions_admin');
  const serialized = JSON.stringify(workloads.value);
  expect(serialized).toContain('http://127.0.0.1:54321/auth/v1');
  expect(serialized).not.toContain('postgres-password');
  expect(serialized).not.toContain('service-role-key');
  expect(serialized).not.toContain('kubernetes');
  expect(serialized).not.toContain('docker-compose');
});

it('omits Supabase Storage when another provider owns object storage', async () => {
  const controlPlane = new FakeSupabaseControlPlane();
  const adapter = createInfraAdapter({ controlPlane });
  const context = createContext('dev', 'r2');
  const workloads = await adapter.desiredWorkloadsAsync(context);

  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;
  expect(workloads.value.map(({ id }) => id)).toEqual([
    'supabase-db',
    'supabase-auth',
    'supabase-rest',
    'supabase-realtime',
    'supabase-meta',
    'supabase-studio',
    'supabase-gateway',
  ]);
  expect(workloads.value.find(({ id }) => id === 'supabase-gateway')?.dependsOn).toEqual([
    'supabase-auth',
    'supabase-rest',
    'supabase-realtime',
  ]);
  const serializedWorkloads = JSON.stringify(workloads.value);
  expect(serializedWorkloads).not.toContain('supabase-storage');
  expect(serializedWorkloads).not.toContain('supabase-imgproxy');
  expect(serializedWorkloads).not.toContain('/storage/v1/');
  expect(serializedWorkloads).not.toContain('cluster: storage');

  const reconciled = await adapter.reconcileAsync(context, [createRuntimeEndpoint()]);
  expect(reconciled.ok).toBe(true);
  if (!reconciled.ok) return;
  expect(reconciled.value.resources.map(({ identity }) => identity.resourceId)).toEqual(['platform']);
  expect(controlPlane.created).toEqual([]);
});

it('deduplicates capabilities, reconciles buckets and returns only public client outputs', async () => {
  const controlPlane = new FakeSupabaseControlPlane(['avatars']);
  const adapter = createInfraAdapter({ controlPlane });
  const context = createContext();
  const plan = await adapter.planAsync(context);
  expect(plan.ok && plan.value.map(({ operation }) => operation)).toEqual([
    'create',
    'create',
    'create',
  ]);

  const result = await adapter.reconcileAsync(context, [createRuntimeEndpoint()]);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(controlPlane.created).toEqual(['documents']);
  expect(result.value.resources.map(({ identity }) => identity.resourceId)).toEqual([
    'platform',
    'bucket/avatars',
    'bucket/documents',
  ]);
  const [platform] = result.value.resources;
  if (platform === undefined) throw new Error('Expected the owned Supabase platform.');
  expect(result.value.outputs).toContainEqual({
    owner: platform.identity,
    name: 'url',
    visibility: 'public',
    value: 'http://127.0.0.1:54321',
    environmentVariable: 'EXPO_PUBLIC_SUPABASE_URL',
  });
  const serialized = JSON.stringify(result);
  expect(serialized).toContain('anon-client-key');
  expect(serialized).not.toContain('service-role-key');
  expect(serialized).not.toContain('postgres-password');
  expect(serialized).not.toContain('jwt-secret');
  expect(new Set(controlPlane.baseUrls)).toEqual(new Set(['http://127.0.0.1:54321']));
});

it('reports live state and deletes only an explicitly confirmed persistent bucket', async () => {
  const controlPlane = new FakeSupabaseControlPlane(['avatars', 'documents']);
  const adapter = createInfraAdapter({ controlPlane });
  const context = await createOwnedContext(adapter);
  const status = await adapter.statusAsync(context);
  expect(status.ok && status.value.every(({ state }) => state === 'ready')).toBe(true);

  const retained = await adapter.destroyAsync(context, createDestroyRequest([]));
  expect(retained.ok && retained.value.resources).toHaveLength(2);
  expect(controlPlane.deleted).toEqual([]);
  const avatars = context.previous?.resources.find(
    ({ identity }) => identity.resourceId === 'bucket/avatars',
  )?.identity;
  if (avatars === undefined) throw new Error('Expected the owned avatars bucket.');
  const deleted = await adapter.destroyAsync(context, createDestroyRequest([avatars]));
  expect(deleted.ok && deleted.value.resources.map(({ identity }) => identity.resourceId)).toEqual([
    'bucket/documents',
  ]);
  expect(controlPlane.deleted).toEqual(['avatars']);
});

it('fails closed for missing origin, incomplete credentials and wrong destroy confirmation', async () => {
  const adapter = createInfraAdapter({ controlPlane: new FakeSupabaseControlPlane() });
  const context = createContext();
  const { networking: _networking, ...desiredWithoutNetworking } = context.desired;
  expect(
    (
      await adapter.validateAsync({
        ...context,
        desired: desiredWithoutNetworking,
      })
    ).ok,
  ).toBe(false);
  const missingRuntimeEndpoint = await adapter.reconcileAsync(context, []);
  expect(
    !missingRuntimeEndpoint.ok &&
      missingRuntimeEndpoint.diagnostics.some(
        ({ code }) => code === 'supabase-runtime-endpoint-missing',
      ),
  ).toBe(true);
  expect(
    (
      await adapter.validateAsync({
        ...context,
        credentials: {
          resolveAsync: () => Promise.resolve({ ok: true, value: {}, diagnostics: [] }),
        },
      })
    ).ok,
  ).toBe(false);
  const rejected = await adapter.destroyAsync(context, {
    ...createDestroyRequest([]),
    confirmation: { projectId: 'wrong', environment: 'local' },
  });
  expect(rejected.ok).toBe(false);
});

class FakeSupabaseControlPlane implements SupabaseControlPlane {
  readonly baseUrls: string[] = [];
  readonly created: string[] = [];
  readonly deleted: string[] = [];
  readonly buckets: Set<string>;

  constructor(buckets: readonly string[] = []) {
    this.buckets = new Set(buckets);
  }

  healthAsync(request: SupabaseControlPlaneRequest): Promise<InfraResult<null>> {
    this.baseUrls.push(request.baseUrl);
    return success(null);
  }

  listBucketsAsync(request: SupabaseControlPlaneRequest): Promise<InfraResult<readonly string[]>> {
    this.baseUrls.push(request.baseUrl);
    return success([...this.buckets].sort());
  }

  createBucketAsync(request: SupabaseControlPlaneRequest & { readonly bucket: string }) {
    this.baseUrls.push(request.baseUrl);
    this.created.push(request.bucket);
    this.buckets.add(request.bucket);
    return success(null);
  }

  deleteBucketAsync(request: SupabaseControlPlaneRequest & { readonly bucket: string }) {
    this.baseUrls.push(request.baseUrl);
    this.deleted.push(request.bucket);
    this.buckets.delete(request.bucket);
    return success(null);
  }
}

function createContext(
  tier: 'dev' | 'prod' = 'dev',
  objectStorageProvider: 'supabase' | 'r2' = 'supabase',
): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: { provider: 'supabase', tier },
      auth: { provider: 'supabase' },
      objectStorage:
        objectStorageProvider === 'supabase'
          ? { provider: 'supabase', buckets: ['documents', 'avatars', 'avatars'] }
          : { provider: 'r2', accountId: 'account-id', buckets: ['documents'] },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: { resolveAsync: () => successCredentials() },
    secrets: { resolveAsync: () => success('') },
  };
}

async function createOwnedContext(
  adapter: ReturnType<typeof createInfraAdapter>,
): Promise<InfraExecutionContext> {
  const context = createContext();
  const runtimeEndpoint = createRuntimeEndpoint();
  const reconciled = await adapter.reconcileAsync(context, [runtimeEndpoint]);
  if (!reconciled.ok) throw new Error('Expected Supabase reconciliation to succeed.');
  return {
    ...context,
    previous: {
      schemaVersion: 1,
      projectId: context.projectId,
      environment: context.environment,
      targets: [],
      resources: reconciled.value.resources,
      outputs: [runtimeEndpoint, ...reconciled.value.outputs],
      artifacts: [],
    },
  };
}

/*** Create the selected runtime's canonical public Supabase gateway output. */
function createRuntimeEndpoint(
  provider: 'docker-compose' | 'minikube' = 'docker-compose',
): InfraOutput {
  const minikube = provider === 'minikube';
  return {
    owner: {
      projectId: 'sample',
      environment: 'local',
      adapter: provider,
      resourceId: minikube ? 'endpoint:supabase-gateway' : 'service:supabase-gateway',
    },
    name: minikube ? 'localUrl' : 'endpoint',
    visibility: 'public',
    value: 'http://127.0.0.1:54321',
  };
}

function createDestroyRequest(confirmedResources: readonly InfraResourceIdentity[]) {
  return {
    projectId: 'sample',
    environment: 'local' as const,
    confirmation: { projectId: 'sample', environment: 'local' as const },
    persistence:
      confirmedResources.length === 0
        ? ({ policy: 'retain' } as const)
        : ({ policy: 'delete', confirmedResources } as const),
  };
}

function successCredentials() {
  return success({
    postgresPassword: 'postgres-password',
    jwtSecret: 'jwt-secret-that-is-at-least-thirty-two-characters',
    anonKey: 'anon-client-key',
    serviceRoleKey: 'service-role-key',
    realtimeSecretKeyBase: 'r'.repeat(64),
    realtimeDatabaseEncryptionKey: '0123456789abcdef',
    pgMetaCryptoKey: 'meta-crypto-key-that-is-at-least-32-characters',
  });
}

function success<T>(value: T): Promise<InfraResult<T>> {
  return Promise.resolve({ ok: true, value, diagnostics: [] });
}
