import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createSupabaseWorkloads } from './features/platform-infrastructure/domain/createSupabaseWorkloads';

it('uses current image-native health commands without resolving Realtime credentials', () => {
  const workloads = createSupabaseWorkloads(createContext());
  const realtime = workloads.find(({ id }) => id === 'supabase-realtime');
  const studio = workloads.find(({ id }) => id === 'supabase-studio');
  const gateway = workloads.find(({ id }) => id === 'supabase-gateway');

  expect(realtime?.environment?.ANON_KEY).toEqual({
    kind: 'credential',
    reference: { source: 'control-plane', name: 'SUPABASE_BOOTSTRAP' },
    key: 'anonKey',
  });
  expect(realtime?.health).toEqual({
    kind: 'command',
    command: [
      'sh',
      '-c',
      'curl -sSfL --head -o /dev/null -H "Authorization: Bearer `printenv ANON_KEY`" http://localhost:4000/api/tenants/realtime-dev/health',
    ],
    intervalSeconds: 30,
    timeoutSeconds: 5,
    failureThreshold: 3,
  });
  expect(studio?.health).toEqual({
    kind: 'command',
    command: [
      'node',
      '-e',
      "fetch('http://localhost:3000/api/platform/profile').then((r) => {if (r.status !== 200) throw new Error(r.status)})",
    ],
    intervalSeconds: 5,
    timeoutSeconds: 10,
    failureThreshold: 3,
  });
  expect(gateway?.health).toEqual({
    kind: 'command',
    command: ['timeout', '1', 'bash', '-c', '</dev/tcp/127.0.0.1/8000'],
    intervalSeconds: 10,
    timeoutSeconds: 5,
    failureThreshold: 3,
  });
  expect(JSON.stringify(workloads)).not.toContain('anon-client-key');
});

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
      objectStorage: { provider: 'supabase', buckets: {} },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: {
      findAsync: () => Promise.reject(new Error('Health projection must not find credentials.')),
      resolveAsync: () => Promise.resolve(success({ anonKey: 'anon-client-key' })),
      persistAsync: () =>
        Promise.reject(new Error('Health projection must not persist credentials.')),
    },
    secrets: {
      resolveAsync: () => Promise.resolve(success('')),
    },
  };
}

function success<T>(value: T): InfraResult<T> {
  return { ok: true, value, diagnostics: [] };
}
