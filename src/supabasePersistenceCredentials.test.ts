import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

const bootstrap = {
  postgresPassword: 'postgres-password',
  jwtSecret: 'j'.repeat(32),
  anonKey: 'anon-key',
  serviceRoleKey: 'service-role-key',
  realtimeSecretKeyBase: 'r'.repeat(64),
  realtimeDatabaseEncryptionKey: '1234567890abcdef',
  pgMetaCryptoKey: 'm'.repeat(32),
};

it('fails validation before runtime when an S3 persistence credential is incomplete', async () => {
  const result = await createInfraAdapter().validateAsync(
    createContext({ accessKeyId: 'access-only' }),
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics[0]?.code).toBe('supabase-s3-credentials-invalid');
  expect(JSON.stringify(result)).not.toContain('access-only');
});

it('accepts a complete S3 persistence credential bundle without exposing its values', async () => {
  const result = await createInfraAdapter().validateAsync(
    createContext({ accessKeyId: 's3-access-id', secretAccessKey: 's3-secret-key' }),
  );
  expect(result).toEqual({ ok: true, value: null, diagnostics: [] });
  expect(JSON.stringify(result)).not.toContain('s3-secret-key');
});

function createContext(s3: Readonly<Record<string, string>>): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'production',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: {
        provider: 'supabase',
        tier: 'prod',
        backup: {
          mode: 'scheduled',
          target: {
            endpoint: 'https://storage.example.test',
            region: 'eu-central-1',
            bucket: 'database-backups',
            credentials: { source: 'control-plane', name: 'S3_PERSISTENCE' },
          },
        },
      },
      networking: { publicBaseUrl: 'https://api.example.test' },
    },
    credentials: {
      resolveAsync: ({ name }) => resolveCredential(name, s3),
    },
    secrets: {
      resolveAsync: () => Promise.reject(new Error('Validation needs no managed secrets.')),
    },
  };
}

function resolveCredential(
  name: string,
  s3: Readonly<Record<string, string>>,
): Promise<InfraResult<Readonly<Record<string, string>>>> {
  if (name === 'SUPABASE_BOOTSTRAP') {
    return Promise.resolve({ ok: true, value: bootstrap, diagnostics: [] });
  }
  if (name === 'S3_PERSISTENCE') {
    return Promise.resolve({ ok: true, value: s3, diagnostics: [] });
  }
  return Promise.resolve({
    ok: false,
    diagnostics: [
      { severity: 'error', code: 'unexpected-credential', message: `Unexpected ${name}.` },
    ],
  });
}
