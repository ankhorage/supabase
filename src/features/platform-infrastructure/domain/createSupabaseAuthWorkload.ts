import type {
  InfraExecutionContext,
  InfraWorkloadScalarValue,
  InfraWorkloadSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import { SUPABASE_BOOTSTRAP_CREDENTIAL, SUPABASE_IMAGES } from '../constants/supabase';

/*** Create the GoTrue authentication workload from the external Auth URL and authored sign-up policy. */
export function createSupabaseAuthWorkload(
  context: InfraExecutionContext,
  baseUrl: string,
): InfraWorkloadSpec {
  return {
    id: 'supabase-auth',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.auth },
    ports: [{ name: 'http', port: 9999 }],
    environment: {
      GOTRUE_API_HOST: literal('0.0.0.0'),
      GOTRUE_API_PORT: literal('9999'),
      API_EXTERNAL_URL: literal(`${baseUrl}/auth/v1`),
      GOTRUE_SITE_URL: literal(baseUrl),
      GOTRUE_URI_ALLOW_LIST: literal(''),
      GOTRUE_DB_DRIVER: literal('postgres'),
      GOTRUE_DB_DATABASE_URL: databaseUrl('supabase_auth_admin'),
      DB_NAMESPACE: literal('auth'),
      GOTRUE_JWT_ADMIN_ROLES: literal('service_role'),
      GOTRUE_JWT_AUD: literal('authenticated'),
      GOTRUE_JWT_DEFAULT_GROUP_NAME: literal('authenticated'),
      GOTRUE_JWT_EXP: literal('3600'),
      GOTRUE_JWT_SECRET: credential('jwtSecret'),
      GOTRUE_JWT_ISSUER: literal(`${baseUrl}/auth/v1`),
      GOTRUE_EXTERNAL_EMAIL_ENABLED: literal('true'),
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: literal('false'),
      GOTRUE_MAILER_AUTOCONFIRM: literal(
        context.desired.auth?.signUp?.signUpPolicy === 'requireVerification' ? 'false' : 'true',
      ),
      GOTRUE_EXTERNAL_PHONE_ENABLED: literal('false'),
    },
    health: { kind: 'http', port: 9999, path: '/health' },
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db'],
  };
}

/*** Create one literal authentication workload value. */
function literal(value: string): InfraWorkloadScalarValue {
  return { kind: 'literal', value };
}

/*** Create one execution-only Supabase bootstrap credential reference. */
function credential(key: string): InfraWorkloadScalarValue {
  return { kind: 'credential', reference: SUPABASE_BOOTSTRAP_CREDENTIAL, key };
}

/*** Create one password-bearing Postgres URL materialized only by the selected runtime. */
function databaseUrl(user: string): InfraWorkloadValue {
  return {
    kind: 'template',
    segments: [
      literal(`postgres://${user}:`),
      credential('postgresPassword'),
      literal('@supabase-db:5432/postgres'),
    ],
  };
}
