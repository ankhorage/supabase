import type { InfraExecutionContext } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

it('projects the current self-hosted Studio native health command', async () => {
  const workloads = await createInfraAdapter().desiredWorkloadsAsync(createContext());

  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;
  expect(workloads.value.find(({ id }) => id === 'supabase-studio')?.health).toEqual({
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
