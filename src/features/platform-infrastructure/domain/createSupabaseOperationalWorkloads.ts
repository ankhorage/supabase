import type {
  InfraExecutionContext,
  InfraWorkloadScalarValue,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import { SUPABASE_BOOTSTRAP_CREDENTIAL, SUPABASE_IMAGES } from '../constants/supabase';

/*** Create the operational services supporting Storage and the self-hosted Studio. */
export function createSupabaseOperationalWorkloads(
  context: InfraExecutionContext,
  baseUrl: string,
): readonly [InfraWorkloadSpec, InfraWorkloadSpec, InfraWorkloadSpec] {
  return [createImgproxyWorkload(), createMetaWorkload(), createStudioWorkload(context, baseUrl)];
}

/*** Create the self-hosted image transformation workload required by Storage. */
function createImgproxyWorkload(): InfraWorkloadSpec {
  return {
    id: 'supabase-imgproxy',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.imgproxy },
    ports: [{ name: 'http', port: 5001 }],
    environment: {
      IMGPROXY_BIND: literal(':5001'),
      IMGPROXY_LOCAL_FILESYSTEM_ROOT: literal('/'),
      IMGPROXY_USE_ETAG: literal('true'),
      IMGPROXY_AUTO_WEBP: literal('true'),
      IMGPROXY_MAX_SRC_RESOLUTION: literal('16.8'),
    },
    health: { kind: 'command', command: ['imgproxy', 'health'] },
    exposure: 'internal',
    replicas: 1,
  };
}

/*** Create the Postgres Meta workload used by the self-hosted Studio. */
function createMetaWorkload(): InfraWorkloadSpec {
  return {
    id: 'supabase-meta',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.meta },
    ports: [{ name: 'http', port: 8080 }],
    environment: {
      PG_META_PORT: literal('8080'),
      PG_META_DB_HOST: literal('supabase-db'),
      PG_META_DB_PORT: literal('5432'),
      PG_META_DB_NAME: literal('postgres'),
      PG_META_DB_USER: literal('postgres'),
      PG_META_DB_PASSWORD: credential('postgresPassword'),
      CRYPTO_KEY: credential('pgMetaCryptoKey'),
    },
    health: {
      kind: 'command',
      command: [
        'node',
        '-e',
        "fetch('http://localhost:8080/health').then((r) => {if (r.status !== 200) throw new Error(r.status)})",
      ],
    },
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db'],
  };
}

/*** Create the self-hosted Studio without exposing privileged credentials as outputs. */
function createStudioWorkload(context: InfraExecutionContext, baseUrl: string): InfraWorkloadSpec {
  return {
    id: 'supabase-studio',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.studio },
    ports: [{ name: 'http', port: 3000 }],
    environment: {
      HOSTNAME: literal('0.0.0.0'),
      STUDIO_PG_META_URL: literal('http://supabase-meta:8080'),
      POSTGRES_PORT: literal('5432'),
      POSTGRES_HOST: literal('supabase-db'),
      POSTGRES_DB: literal('postgres'),
      POSTGRES_PASSWORD: credential('postgresPassword'),
      POSTGRES_USER_READ_WRITE: literal('postgres'),
      PG_META_CRYPTO_KEY: credential('pgMetaCryptoKey'),
      PGRST_DB_SCHEMAS: literal('public,storage,graphql_public'),
      PGRST_DB_MAX_ROWS: literal('1000'),
      PGRST_DB_EXTRA_SEARCH_PATH: literal('public'),
      DEFAULT_ORGANIZATION_NAME: literal('Ankhorage'),
      DEFAULT_PROJECT_NAME: literal(context.projectId),
      SUPABASE_URL: literal('http://supabase-gateway:8000'),
      SUPABASE_PUBLIC_URL: literal(baseUrl),
      SUPABASE_ANON_KEY: credential('anonKey'),
      SUPABASE_SERVICE_KEY: credential('serviceRoleKey'),
      AUTH_JWT_SECRET: credential('jwtSecret'),
      ENABLED_FEATURES_LOGS_ALL: literal('false'),
    },
    health: {
      kind: 'command',
      command: [
        'node',
        '-e',
        "fetch('http://localhost:3000/api/platform/profile').then((r) => {if (r.status !== 200) throw new Error(r.status)})",
      ],
      intervalSeconds: 5,
      timeoutSeconds: 10,
      failureThreshold: 3,
    },
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db', 'supabase-meta'],
  };
}

/*** Create one literal workload value. */
function literal(value: string): InfraWorkloadScalarValue {
  return { kind: 'literal', value };
}

/*** Create one execution-only control-plane credential field reference. */
function credential(key: string): InfraWorkloadScalarValue {
  return { kind: 'credential', reference: SUPABASE_BOOTSTRAP_CREDENTIAL, key };
}
