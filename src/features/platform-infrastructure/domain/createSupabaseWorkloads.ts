import type {
  InfraExecutionContext,
  InfraWorkloadScalarValue,
  InfraWorkloadSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import {
  SUPABASE_DATABASE_JWT_SQL,
  SUPABASE_DATABASE_REALTIME_SQL,
  SUPABASE_DATABASE_ROLES_SQL,
  SUPABASE_DATABASE_WEBHOOKS_SQL,
} from '../constants/databaseBootstrap';
import {
  SUPABASE_BOOTSTRAP_CREDENTIAL,
  SUPABASE_ENVOY_CONFIG,
  SUPABASE_IMAGES,
} from '../constants/supabase';
import { createSupabaseDatabaseBackupWorkload } from './createSupabaseDatabaseBackupWorkload';
import { createSupabaseDatabasePersistence } from './createSupabaseDatabasePersistence';
import { createSupabaseDatabaseRestore } from './createSupabaseDatabaseRestore';
import { createSupabaseOperationalWorkloads } from './createSupabaseOperationalWorkloads';
import { createSupabaseStorageWorkload } from './createSupabaseStorageWorkload';

/*** Project the selected Supabase platform into one ordered runtime-neutral workload graph. */
export function createSupabaseWorkloads(
  context: InfraExecutionContext,
): readonly InfraWorkloadSpec[] {
  const baseUrl = context.desired.networking?.publicBaseUrl ?? '';
  const [imgproxy, meta, studio] = createSupabaseOperationalWorkloads(context, baseUrl);
  const backup = createSupabaseDatabaseBackupWorkload(context);
  return [
    createDatabaseWorkload(context),
    ...(backup === undefined ? [] : [backup]),
    createAuthWorkload(baseUrl),
    createRestWorkload(),
    createRealtimeWorkload(),
    imgproxy,
    createSupabaseStorageWorkload(context, baseUrl),
    meta,
    studio,
    createGatewayWorkload(context, baseUrl),
  ];
}

const SUPABASE_DATABASE_ARGUMENTS = [
  'postgres',
  '-c',
  'config_file=/etc/postgresql/postgresql.conf',
  '-c',
  'log_min_messages=fatal',
] as const;

/*** Create persistent Postgres 17 data and custom configuration for safe runtime recreation. */
function createDatabaseWorkload(context: InfraExecutionContext): InfraWorkloadSpec {
  const prod = isSupabaseProductionTier(context);
  const restore = createSupabaseDatabaseRestore(context);
  return {
    id: 'supabase-db',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.database },
    args: SUPABASE_DATABASE_ARGUMENTS,
    ports: [{ name: 'postgres', port: 5432 }],
    environment: {
      POSTGRES_DB: literal('postgres'),
      POSTGRES_HOST: literal('/var/run/postgresql'),
      POSTGRES_PORT: literal('5432'),
      PGPORT: literal('5432'),
      PGDATABASE: literal('postgres'),
      POSTGRES_PASSWORD: credential('postgresPassword'),
      PGPASSWORD: credential('postgresPassword'),
      JWT_SECRET: credential('jwtSecret'),
      JWT_EXP: literal('3600'),
      ...restore.environment,
    },
    files: [
      {
        path: '/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql',
        content: literal(SUPABASE_DATABASE_WEBHOOKS_SQL),
      },
      {
        path: '/docker-entrypoint-initdb.d/init-scripts/99-roles.sql',
        content: literal(SUPABASE_DATABASE_ROLES_SQL),
      },
      {
        path: '/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql',
        content: literal(SUPABASE_DATABASE_JWT_SQL),
      },
      {
        path: '/docker-entrypoint-initdb.d/migrations/99-realtime.sql',
        content: literal(SUPABASE_DATABASE_REALTIME_SQL),
      },
      ...restore.files,
    ],
    health: createDatabaseHealth(restore.files.length > 0),
    persistence: createSupabaseDatabasePersistence(prod),
    exposure: 'internal',
    replicas: 1,
  };
}

/*** Keep the database alive while a configured first-boot restore waits for off-host backup data. */
function createDatabaseHealth(restoreEnabled: boolean): NonNullable<InfraWorkloadSpec['health']> {
  return {
    kind: 'command',
    command: ['pg_isready', '-U', 'postgres', '-h', 'localhost'],
    intervalSeconds: 10,
    timeoutSeconds: 5,
    failureThreshold: restoreEnabled ? 60 : 3,
  };
}

/*** Create the GoTrue authentication workload using the current external Auth URL shape. */
function createAuthWorkload(baseUrl: string): InfraWorkloadSpec {
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
      GOTRUE_MAILER_AUTOCONFIRM: literal('false'),
      GOTRUE_EXTERNAL_PHONE_ENABLED: literal('false'),
    },
    health: { kind: 'http', port: 9999, path: '/health' },
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db'],
  };
}

/*** Create the PostgREST Data API workload. */
function createRestWorkload(): InfraWorkloadSpec {
  return {
    id: 'supabase-rest',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.rest },
    command: ['postgrest'],
    ports: [{ name: 'http', port: 3000 }],
    environment: {
      PGRST_DB_URI: databaseUrl('authenticator'),
      PGRST_DB_SCHEMAS: literal('public,storage,graphql_public'),
      PGRST_DB_MAX_ROWS: literal('1000'),
      PGRST_DB_EXTRA_SEARCH_PATH: literal('public'),
      PGRST_DB_ANON_ROLE: literal('anon'),
      PGRST_ADMIN_SERVER_PORT: literal('3001'),
      PGRST_ADMIN_SERVER_HOST: literal('localhost'),
      PGRST_JWT_SECRET: credential('jwtSecret'),
      PGRST_DB_USE_LEGACY_GUCS: literal('false'),
      PGRST_APP_SETTINGS_JWT_SECRET: credential('jwtSecret'),
      PGRST_APP_SETTINGS_JWT_EXP: literal('3600'),
    },
    health: { kind: 'command', command: ['postgrest', '--ready'] },
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db'],
  };
}

/*** Create the Realtime workload without runtime-specific networking assumptions. */
function createRealtimeWorkload(): InfraWorkloadSpec {
  return {
    id: 'supabase-realtime',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.realtime },
    ports: [{ name: 'http', port: 4000 }],
    environment: {
      PORT: literal('4000'),
      DB_HOST: literal('supabase-db'),
      DB_PORT: literal('5432'),
      DB_USER: literal('supabase_admin'),
      DB_PASSWORD: credential('postgresPassword'),
      DB_NAME: literal('postgres'),
      DB_AFTER_CONNECT_QUERY: literal('SET search_path TO _realtime'),
      DB_ENC_KEY: credential('realtimeDatabaseEncryptionKey'),
      API_JWT_SECRET: credential('jwtSecret'),
      ANON_KEY: credential('anonKey'),
      SECRET_KEY_BASE: credential('realtimeSecretKeyBase'),
      METRICS_JWT_SECRET: credential('jwtSecret'),
      ERL_AFLAGS: literal('-proto_dist inet_tcp'),
      DNS_NODES: literal("''"),
      RLIMIT_NOFILE: literal('10000'),
      APP_NAME: literal('realtime'),
      SEED_SELF_HOST: literal('true'),
      RUN_JANITOR: literal('true'),
      DISABLE_HEALTHCHECK_LOGGING: literal('true'),
    },
    health: {
      kind: 'command',
      command: [
        'sh',
        '-c',
        'curl -sSfL --head -o /dev/null -H "Authorization: Bearer `printenv ANON_KEY`" http://localhost:4000/api/tenants/realtime-dev/health',
      ],
      intervalSeconds: 30,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db'],
  };
}

/*** Create the current Envoy gateway with portable service-DNS routes. */
function createGatewayWorkload(context: InfraExecutionContext, baseUrl: string): InfraWorkloadSpec {
  const publishedPort = resolveLocalPublishedPort(context, baseUrl);
  return {
    id: 'supabase-gateway',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.gateway },
    command: ['envoy'],
    args: ['-c', '/etc/envoy/envoy.yaml'],
    ports: [
      {
        name: 'http',
        port: 8000,
        ...(publishedPort === undefined ? {} : { publishedPort }),
      },
    ],
    files: [
      {
        path: '/etc/envoy/envoy.yaml',
        content: literal(SUPABASE_ENVOY_CONFIG),
      },
    ],
    health: {
      kind: 'command',
      command: ['timeout', '1', 'bash', '-c', '</dev/tcp/127.0.0.1/8000'],
      intervalSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    exposure: 'public',
    replicas: 1,
    dependsOn: ['supabase-auth', 'supabase-rest', 'supabase-realtime', 'supabase-storage'],
  };
}

/*** Decide whether the selected Supabase database tier requires production persistence policy. */
function isSupabaseProductionTier(context: InfraExecutionContext): boolean {
  return (
    context.desired.database?.provider === 'supabase' && context.desired.database.tier === 'prod'
  );
}

/*** Resolve an exact plain-HTTP listener only for the local runtime boundary. */
function resolveLocalPublishedPort(
  context: InfraExecutionContext,
  baseUrl: string,
): number | undefined {
  if (context.environment !== 'local') return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:') return undefined;
    return url.port === '' ? 80 : Number(url.port);
  } catch {
    return undefined;
  }
}

/*** Create one literal workload value. */
function literal(value: string): InfraWorkloadScalarValue {
  return { kind: 'literal', value };
}

/*** Create one execution-only control-plane credential field reference. */
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
