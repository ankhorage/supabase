import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createSupabaseOperationalWorkloads } from './features/platform-infrastructure/domain/createSupabaseOperationalWorkloads';

it('uses the postgres-meta native Node health command', () => {
  const [, meta] = createSupabaseOperationalWorkloads(createContext(), 'http://127.0.0.1:54321');

  expect(meta.health).toEqual({
    kind: 'command',
    command: [
      'node',
      '-e',
      "fetch('http://localhost:8080/health').then((r) => {if (r.status !== 200) throw new Error(r.status)})",
    ],
  });
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
      objectStorage: { provider: 'supabase', buckets: [] },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: {
      resolveAsync: () => Promise.resolve(success({})),
    },
    secrets: {
      resolveAsync: () => Promise.resolve(success('')),
    },
  };
}

function success<T>(value: T): InfraResult<T> {
  return { ok: true, value, diagnostics: [] };
}
