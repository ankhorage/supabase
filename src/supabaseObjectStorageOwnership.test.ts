import type { InfraExecutionContext, InfraOutput, InfraResult } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import type { SupabaseControlPlane, SupabaseControlPlaneRequest } from './index';
import { createInfraAdapter } from './index';

it('omits Supabase Storage when another provider owns object storage', async () => {
  const controlPlane = new FakeSupabaseControlPlane();
  const adapter = createInfraAdapter({ controlPlane });
  const context = createContext();
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
  expect(reconciled.value.resources.map(({ identity }) => identity.resourceId)).toEqual([
    'platform',
  ]);
  expect(controlPlane.created).toEqual([]);
});

class FakeSupabaseControlPlane implements SupabaseControlPlane {
  readonly created: string[] = [];

  healthAsync(_request: SupabaseControlPlaneRequest): Promise<InfraResult<null>> {
    return success(null);
  }

  listBucketsAsync(
    _request: SupabaseControlPlaneRequest,
  ): Promise<InfraResult<readonly string[]>> {
    return success([]);
  }

  createBucketAsync(
    request: SupabaseControlPlaneRequest & { readonly bucket: string },
  ): Promise<InfraResult<null>> {
    this.created.push(request.bucket);
    return success(null);
  }

  deleteBucketAsync(
    _request: SupabaseControlPlaneRequest & { readonly bucket: string },
  ): Promise<InfraResult<null>> {
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
      objectStorage: { provider: 'r2', accountId: 'account-id', buckets: ['documents'] },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: { resolveAsync: () => successCredentials() },
    secrets: { resolveAsync: () => success('') },
  };
}

/*** Create the selected runtime's canonical public Supabase gateway output. */
function createRuntimeEndpoint(): InfraOutput {
  return {
    owner: {
      projectId: 'sample',
      environment: 'local',
      adapter: 'docker-compose',
      resourceId: 'service:supabase-gateway',
    },
    name: 'endpoint',
    visibility: 'public',
    value: 'http://127.0.0.1:54321',
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
