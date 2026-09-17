import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createSupabaseWorkloads } from './features/platform-infrastructure/domain/createSupabaseWorkloads';

it('projects canonical sign-up policy into GoTrue email confirmation behavior', () => {
  const cases = [
    { policy: 'autoSignIn' as const, expected: 'true' },
    { policy: 'requireVerification' as const, expected: 'false' },
    { policy: undefined, expected: 'true' },
  ];

  for (const { policy, expected } of cases) {
    const auth = createSupabaseWorkloads(createContext(policy)).find(
      ({ id }) => id === 'supabase-auth',
    );
    expect(auth?.environment?.GOTRUE_MAILER_AUTOCONFIRM).toEqual({
      kind: 'literal',
      value: expected,
    });
  }
});

/*** Create one workload-generation context with an explicit or omitted sign-up policy. */
function createContext(signUpPolicy?: 'autoSignIn' | 'requireVerification'): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      database: { provider: 'supabase', tier: 'dev' },
      auth: {
        provider: 'supabase',
        signUp: {
          requiredFields: ['email', 'password'],
          ...(signUpPolicy === undefined ? {} : { signUpPolicy }),
        },
      },
      networking: { publicBaseUrl: 'http://127.0.0.1:54321' },
    },
    credentials: {
      findAsync: () => success({}),
      resolveAsync: () => success({}),
      persistAsync: () => success(null),
    },
    secrets: { resolveAsync: () => success('') },
  };
}

/*** Create one successful Infra result for workload-generation fixture ports. */
function success<T>(value: T): Promise<InfraResult<T>> {
  return Promise.resolve({ ok: true, value, diagnostics: [] });
}
