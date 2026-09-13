import type {
  InfraExecutionContext,
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
    'supabase-storage',
    'supabase-gateway',
  ]);
  expect(workloads.value.map(({ artifact }) => artifact.image)).toEqual([
    'supabase/postgres:17.6.1.136',
    'supabase/gotrue:v2.196.0',
    'postgrest/postgrest:v14.17',
    'supabase/realtime:v2.134.10',
    'supabase/storage-api:v1.74.0',
    'envoyproxy/envoy:v1.39.1',
  ]);
  const serialized = JSON.stringify(workloads.value);
  expect(serialized).toContain('https://supabase.example.test/auth/v1');
  expect(serialized).not.toContain('postgres-password');
  expect(serialized).not.toContain('service-role-key');
  expect(serialized).not.toContain('kubernetes');
  expect(serialized).not.toContain('docker-compose');
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

  const result = await adapter.reconcileAsync(context, []);
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
    value: 'https://supabase.example.test',
    environmentVariable: 'EXPO_PUBLIC_SUPABASE_URL',
  });
  const serialized = JSON.stringify(result);
  expect(serialized).toContain('anon-client-key');
  expect(serialized).not.toContain('service-role-key');
  expect(serialized).not.toContain('postgres-password');
  expect(serialized).not.toContain('jwt-secret');
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
  readonly created: string[] = [];
  readonly deleted: string[] = [];
  readonly buckets: Set<string>;

  constructor(buckets: readonly string[] = []) {
    this.buckets = new Set(buckets);
  }

  healthAsync(): Promise<InfraResult<null>> {
    return success(null);
  }

  listBucketsAsync(): Promise<InfraResult<readonly string[]>> {
    return success([...this.buckets].sort());
  }

  createBucketAsync(request: SupabaseControlPlaneRequest & { readonly bucket: string }) {
    this.created.push(request.bucket);
    this.buckets.add(request.bucket);
    return success(null);
  }

  deleteBucketAsync(request: SupabaseControlPlaneRequest & { readonly bucket: string }) {
    this.deleted.push(request.bucket);
    this.buckets.delete(request.bucket);
    return success(null);
  }
}

function createContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: { provider: 'supabase', tier: 'dev' },
      auth: { provider: 'supabase' },
      objectStorage: { provider: 'supabase', buckets: ['documents', 'avatars', 'avatars'] },
      networking: { publicBaseUrl: 'https://supabase.example.test' },
    },
    credentials: { resolveAsync: () => successCredentials() },
    secrets: { resolveAsync: () => success('') },
  };
}

async function createOwnedContext(
  adapter: ReturnType<typeof createInfraAdapter>,
): Promise<InfraExecutionContext> {
  const context = createContext();
  const reconciled = await adapter.reconcileAsync(context, []);
  if (!reconciled.ok) throw new Error('Expected Supabase reconciliation to succeed.');
  return {
    ...context,
    previous: {
      schemaVersion: 1,
      projectId: context.projectId,
      environment: context.environment,
      targets: [],
      resources: reconciled.value.resources,
      outputs: reconciled.value.outputs,
      artifacts: [],
    },
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
  });
}

function success<T>(value: T): Promise<InfraResult<T>> {
  return Promise.resolve({ ok: true, value, diagnostics: [] });
}
