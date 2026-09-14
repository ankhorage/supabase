import type { InfraExecutionContext, InfraOutput, InfraResult } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import type { SupabaseControlPlane, SupabaseControlPlaneRequest } from './index';
import { createInfraAdapter } from './index';

it('uses the Minikube workload endpoint for local control-plane requests', async () => {
  const controlPlane = new EndpointCapturingControlPlane();
  const adapter = createInfraAdapter({ controlPlane });
  const context = createContext('local');
  const result = await adapter.reconcileAsync(context, [createMinikubeEndpoint()]);

  expect(result.ok).toBe(true);
  expect(new Set(controlPlane.baseUrls)).toEqual(new Set(['http://127.0.0.1:54321']));
});

it('keeps the production gateway behind ingress and uses the declared public origin', async () => {
  const controlPlane = new EndpointCapturingControlPlane();
  const adapter = createInfraAdapter({ controlPlane });
  const context = createContext('production');
  const workloads = await adapter.desiredWorkloadsAsync(context);
  const result = await adapter.reconcileAsync(context, []);

  expect(workloads.ok).toBe(true);
  expect(
    workloads.ok && workloads.value.find(({ id }) => id === 'supabase-gateway')?.ports,
  ).toEqual([{ name: 'http', port: 8000 }]);
  expect(result.ok).toBe(true);
  expect(new Set(controlPlane.baseUrls)).toEqual(new Set(['https://supabase.example.test']));
});

class EndpointCapturingControlPlane implements SupabaseControlPlane {
  readonly baseUrls: string[] = [];

  healthAsync(request: SupabaseControlPlaneRequest): Promise<InfraResult<null>> {
    return this.capture(request, null);
  }

  listBucketsAsync(request: SupabaseControlPlaneRequest): Promise<InfraResult<readonly string[]>> {
    return this.capture(request, []);
  }

  createBucketAsync(
    request: SupabaseControlPlaneRequest & { readonly bucket: string },
  ): Promise<InfraResult<null>> {
    return this.capture(request, null);
  }

  deleteBucketAsync(
    request: SupabaseControlPlaneRequest & { readonly bucket: string },
  ): Promise<InfraResult<null>> {
    return this.capture(request, null);
  }

  /*** Record the selected URL and return one successful control-plane result. */
  private capture<T>(request: SupabaseControlPlaneRequest, value: T): Promise<InfraResult<T>> {
    this.baseUrls.push(request.baseUrl);
    return Promise.resolve({ ok: true, value, diagnostics: [] });
  }
}

/*** Create a complete environment for local or production endpoint selection. */
function createContext(environment: 'local' | 'production'): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment,
    desired: {
      deployment:
        environment === 'local'
          ? { compute: { provider: 'local' }, runtime: { provider: 'minikube' } }
          : {
              compute: { provider: 'hetzner', location: 'fsn1' },
              runtime: { provider: 'k3s' },
            },
      database: { provider: 'supabase', tier: environment === 'local' ? 'dev' : 'prod' },
      networking: {
        publicBaseUrl:
          environment === 'local' ? 'http://127.0.0.1:54321' : 'https://supabase.example.test',
      },
    },
    credentials: {
      resolveAsync: () =>
        Promise.resolve({
          ok: true,
          value: {
            postgresPassword: 'postgres-password',
            jwtSecret: 'jwt-secret-that-is-at-least-thirty-two-characters',
            anonKey: 'anon-client-key',
            serviceRoleKey: 'service-role-key',
            realtimeSecretKeyBase: 'r'.repeat(64),
            realtimeDatabaseEncryptionKey: '0123456789abcdef',
            pgMetaCryptoKey: 'meta-crypto-key-that-is-at-least-32-characters',
          },
          diagnostics: [],
        }),
    },
    secrets: {
      resolveAsync: () => Promise.resolve({ ok: true, value: '', diagnostics: [] }),
    },
  };
}

/*** Create the Minikube-owned local gateway endpoint. */
function createMinikubeEndpoint(): InfraOutput {
  return {
    owner: {
      projectId: 'sample',
      environment: 'local',
      adapter: 'minikube',
      resourceId: 'endpoint:supabase-gateway',
    },
    name: 'localUrl',
    visibility: 'public',
    value: 'http://127.0.0.1:54321',
  };
}
