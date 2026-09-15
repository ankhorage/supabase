import type { InfraExecutionContext } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

it('projects the current self-hosted Studio health route', async () => {
  const workloads = await createInfraAdapter().desiredWorkloadsAsync(createContext());

  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;
  expect(workloads.value.find(({ id }) => id === 'supabase-studio')?.health).toEqual({
    kind: 'http',
    port: 3000,
    path: '/api/platform/profile',
  });
});

function createContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'minikube' },
      },
      database: { provider: 'supabase', tier: 'dev' },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: {
      resolveAsync: () => Promise.resolve({ ok: true, value: {}, diagnostics: [] }),
    },
    secrets: {
      resolveAsync: () => Promise.resolve({ ok: true, value: '', diagnostics: [] }),
    },
  };
}
