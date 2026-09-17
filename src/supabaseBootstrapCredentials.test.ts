import { createHmac } from 'node:crypto';

import type { AppEnvironmentId } from '@ankhorage/contracts/environments';
import type {
  InfraControlPlaneCredentialRef,
  InfraCredentialPort,
  InfraExecutionContext,
  InfraResult,
} from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index';

const BOOTSTRAP = { source: 'control-plane', name: 'SUPABASE_BOOTSTRAP' } as const;

it('treats a missing local bootstrap bundle as provisionable without writing during validation', async () => {
  const store = new MemoryCredentialPort();
  const adapter = createInfraAdapter();
  const result = await adapter.validateAsync(createContext('local', store));

  expect(result.ok).toBe(true);
  expect(store.persistCount).toBe(0);
  expect(store.read(BOOTSTRAP)).toBeNull();
});

it('generates one secure local bootstrap bundle and reuses it across repeated preparation', async () => {
  const store = new MemoryCredentialPort();
  const adapter = createInfraAdapter();
  const context = createContext('local', store);

  if (adapter.prepareAsync === undefined) throw new Error('Expected Supabase preparation.');
  const first = await adapter.prepareAsync(context);
  expect(first.ok).toBe(true);
  expect(store.persistCount).toBe(1);
  const generated = store.read(BOOTSTRAP);
  expect(generated).not.toBeNull();
  if (generated === null) return;

  expect(generated.postgresPassword.length).toBeGreaterThanOrEqual(32);
  expect(generated.jwtSecret.length).toBeGreaterThanOrEqual(32);
  expect(generated.realtimeSecretKeyBase.length).toBeGreaterThanOrEqual(64);
  expect(generated.realtimeDatabaseEncryptionKey).toHaveLength(16);
  expect(generated.pgMetaCryptoKey.length).toBeGreaterThanOrEqual(32);
  verifyJwt(generated.anonKey, generated.jwtSecret, 'anon');
  verifyJwt(generated.serviceRoleKey, generated.jwtSecret, 'service_role');

  const second = await adapter.prepareAsync(context);
  expect(second.ok).toBe(true);
  expect(store.persistCount).toBe(1);
  expect(store.read(BOOTSTRAP)).toEqual(generated);
});

it('reuses persisted local credentials from a fresh adapter and context', async () => {
  const store = new MemoryCredentialPort();
  const firstAdapter = createInfraAdapter();
  if (firstAdapter.prepareAsync === undefined) throw new Error('Expected Supabase preparation.');
  expect((await firstAdapter.prepareAsync(createContext('local', store))).ok).toBe(true);
  const persisted = store.read(BOOTSTRAP);

  const freshAdapter = createInfraAdapter();
  if (freshAdapter.prepareAsync === undefined) throw new Error('Expected Supabase preparation.');
  expect((await freshAdapter.prepareAsync(createContext('local', store))).ok).toBe(true);
  expect(store.persistCount).toBe(1);
  expect(store.read(BOOTSTRAP)).toEqual(persisted);
});

it('fails closed for an invalid existing local bundle without replacing it', async () => {
  const invalid = { ...validCredentialFixture(), pgMetaCryptoKey: 'too-short' };
  const store = new MemoryCredentialPort(invalid);
  const adapter = createInfraAdapter();
  const context = createContext('local', store);

  expect((await adapter.validateAsync(context)).ok).toBe(false);
  if (adapter.prepareAsync === undefined) throw new Error('Expected Supabase preparation.');
  expect((await adapter.prepareAsync(context)).ok).toBe(false);
  expect(store.persistCount).toBe(0);
  expect(store.read(BOOTSTRAP)).toEqual(invalid);
});

it('keeps missing non-local bootstrap credentials fail-closed and accepts supplied valid bundles', async () => {
  const missing = new MemoryCredentialPort();
  const adapter = createInfraAdapter();
  const preview = createContext('preview', missing);

  expect((await adapter.validateAsync(preview)).ok).toBe(false);
  if (adapter.prepareAsync === undefined) throw new Error('Expected Supabase preparation.');
  expect((await adapter.prepareAsync(preview)).ok).toBe(false);
  expect(missing.persistCount).toBe(0);

  const supplied = new MemoryCredentialPort(validCredentialFixture());
  const suppliedPreview = createContext('preview', supplied);
  expect((await adapter.validateAsync(suppliedPreview)).ok).toBe(true);
  expect((await adapter.prepareAsync(suppliedPreview)).ok).toBe(true);
  expect(supplied.persistCount).toBe(0);
});

it('keeps prepared privileged values out of portable workload specs', async () => {
  const store = new MemoryCredentialPort();
  const adapter = createInfraAdapter();
  const context = createContext('local', store);
  if (adapter.prepareAsync === undefined) throw new Error('Expected Supabase preparation.');
  expect((await adapter.prepareAsync(context)).ok).toBe(true);
  const generated = store.read(BOOTSTRAP);
  if (generated === null) throw new Error('Expected generated Supabase credentials.');

  const workloads = await adapter.desiredWorkloadsAsync(context);
  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;
  const serialized = JSON.stringify(workloads.value);
  for (const value of Object.values(generated)) expect(serialized).not.toContain(value);
  expect(serialized).toContain('SUPABASE_BOOTSTRAP');
});

class MemoryCredentialPort implements InfraCredentialPort {
  private values: Readonly<Record<string, string>> | null;
  persistCount = 0;

  constructor(initial: Readonly<Record<string, string>> | null = null) {
    this.values = initial === null ? null : { ...initial };
  }

  findAsync(
    reference: InfraControlPlaneCredentialRef,
  ): Promise<InfraResult<Readonly<Record<string, string>> | null>> {
    return Promise.resolve(
      reference.name === BOOTSTRAP.name
        ? success(this.values === null ? null : { ...this.values })
        : success(null),
    );
  }

  resolveAsync(
    reference: InfraControlPlaneCredentialRef,
  ): Promise<InfraResult<Readonly<Record<string, string>>>> {
    if (reference.name === BOOTSTRAP.name && this.values !== null) {
      return Promise.resolve(success({ ...this.values }));
    }
    return Promise.resolve({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'infra-control-plane-credential-missing',
          message: `Control-plane credential ${reference.name} is unavailable.`,
        },
      ],
    });
  }

  persistAsync(
    reference: InfraControlPlaneCredentialRef,
    values: Readonly<Record<string, string>>,
  ): Promise<InfraResult<null>> {
    if (reference.name !== BOOTSTRAP.name) {
      return Promise.resolve({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'unexpected-test-credential',
            message: `Unexpected credential ${reference.name}.`,
          },
        ],
      });
    }
    this.values = { ...values };
    this.persistCount += 1;
    return Promise.resolve(success(null));
  }

  read(reference: InfraControlPlaneCredentialRef): Readonly<Record<string, string>> | null {
    return reference.name === BOOTSTRAP.name && this.values !== null ? { ...this.values } : null;
  }
}

/*** Create one runtime-neutral Supabase execution context for bootstrap policy tests. */
function createContext(
  environment: AppEnvironmentId,
  credentials: InfraCredentialPort,
): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment,
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: { provider: 'supabase', tier: 'dev' },
      auth: { provider: 'supabase' },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials,
    secrets: { resolveAsync: () => Promise.resolve(success('')) },
  };
}

/*** Verify one generated legacy Supabase JWT signature and provider role. */
function verifyJwt(token: string, secret: string, role: 'anon' | 'service_role'): void {
  const [header, payload, signature] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error('Expected a three-part Supabase JWT.');
  }
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  expect(signature).toBe(expected);
  expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({
    alg: 'HS256',
    typ: 'JWT',
  });
  expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toMatchObject({
    role,
    iss: 'supabase',
  });
}

/*** Provide one complete provider-valid bundle for supplied-credential policy tests. */
function validCredentialFixture(): Readonly<Record<string, string>> {
  return {
    postgresPassword: 'fixture-postgres-password',
    jwtSecret: 'fixture-jwt-secret-that-is-at-least-thirty-two-chars',
    anonKey: 'fixture-anon-key',
    serviceRoleKey: 'fixture-service-role-key',
    realtimeSecretKeyBase: 'r'.repeat(64),
    realtimeDatabaseEncryptionKey: '0123456789abcdef',
    pgMetaCryptoKey: 'fixture-pg-meta-crypto-key-at-least-thirty-two-chars',
  };
}

/*** Create one successful Infra result for the in-memory credential boundary. */
function success<T>(value: T): InfraResult<T> {
  return { ok: true, value, diagnostics: [] };
}
