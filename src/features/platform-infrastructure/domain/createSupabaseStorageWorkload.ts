import type {
  InfraExecutionContext,
  InfraS3PersistenceTarget,
  InfraWorkloadSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import { SUPABASE_BOOTSTRAP_CREDENTIAL, SUPABASE_IMAGES } from '../constants/supabase';
import { createSupabaseS3Values } from './createSupabaseS3Values';

/*** Create Supabase Storage using either retained file storage or the selected S3 backend. */
export function createSupabaseStorageWorkload(
  context: InfraExecutionContext,
  baseUrl: string,
): InfraWorkloadSpec {
  const prod =
    context.desired.database?.provider === 'supabase' && context.desired.database.tier === 'prod';
  const backend = resolveStorageBackend(context);
  return {
    id: 'supabase-storage',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.storage },
    ports: [{ name: 'http', port: 5000 }],
    environment: createStorageEnvironment(context, baseUrl, backend),
    health: { kind: 'http', port: 5000, path: '/status' },
    ...(backend === undefined ? { persistence: createFileStoragePersistence(prod) } : {}),
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db', 'supabase-rest', 'supabase-imgproxy'],
  };
}

/*** Resolve an optional external Storage backend only when Supabase owns object storage. */
function resolveStorageBackend(
  context: InfraExecutionContext,
): InfraS3PersistenceTarget | undefined {
  return context.desired.objectStorage?.provider === 'supabase'
    ? context.desired.objectStorage.backend
    : undefined;
}

/*** Project the stable Storage environment plus the selected persistence backend. */
function createStorageEnvironment(
  context: InfraExecutionContext,
  baseUrl: string,
  backend: InfraS3PersistenceTarget | undefined,
): Readonly<Record<string, InfraWorkloadValue>> {
  return {
    ANON_KEY: {
      kind: 'credential',
      reference: SUPABASE_BOOTSTRAP_CREDENTIAL,
      key: 'anonKey',
    },
    SERVICE_KEY: {
      kind: 'credential',
      reference: SUPABASE_BOOTSTRAP_CREDENTIAL,
      key: 'serviceRoleKey',
    },
    POSTGREST_URL: { kind: 'literal', value: 'http://supabase-rest:3000' },
    AUTH_JWT_SECRET: {
      kind: 'credential',
      reference: SUPABASE_BOOTSTRAP_CREDENTIAL,
      key: 'jwtSecret',
    },
    DATABASE_URL: {
      kind: 'template',
      segments: [
        { kind: 'literal', value: 'postgres://supabase_storage_admin:' },
        {
          kind: 'credential',
          reference: SUPABASE_BOOTSTRAP_CREDENTIAL,
          key: 'postgresPassword',
        },
        {
          kind: 'literal',
          value: '@supabase-db:5432/postgres?search_path=storage&sslmode=disable',
        },
      ],
    },
    STORAGE_PUBLIC_URL: { kind: 'literal', value: baseUrl },
    REQUEST_ALLOW_X_FORWARDED_PATH: { kind: 'literal', value: 'true' },
    FILE_SIZE_LIMIT: { kind: 'literal', value: '52428800' },
    TENANT_ID: { kind: 'literal', value: context.projectId },
    REGION: { kind: 'literal', value: context.environment },
    ENABLE_IMAGE_TRANSFORMATION: { kind: 'literal', value: 'true' },
    IMGPROXY_URL: { kind: 'literal', value: 'http://supabase-imgproxy:5001' },
    ...createStorageBackendEnvironment(backend),
  };
}

/*** Project file-backed or S3-backed Storage environment without leaking resolved credentials. */
function createStorageBackendEnvironment(
  target: InfraS3PersistenceTarget | undefined,
): Readonly<Record<string, InfraWorkloadValue>> {
  if (target === undefined) {
    return {
      STORAGE_BACKEND: { kind: 'literal', value: 'file' },
      GLOBAL_S3_BUCKET: { kind: 'literal', value: 'stub' },
      FILE_STORAGE_BACKEND_PATH: { kind: 'literal', value: '/var/lib/storage' },
    };
  }
  const s3 = createSupabaseS3Values(target);
  return {
    STORAGE_BACKEND: { kind: 'literal', value: 's3' },
    STORAGE_S3_BUCKET: s3.bucket,
    STORAGE_S3_ENDPOINT: s3.endpoint,
    STORAGE_S3_FORCE_PATH_STYLE: s3.forcePathStyle,
    STORAGE_S3_REGION: s3.region,
    AWS_ACCESS_KEY_ID: s3.accessKeyId,
    AWS_SECRET_ACCESS_KEY: s3.secretAccessKey,
  };
}

/*** Create retained production or destroyable development file-storage persistence. */
function createFileStoragePersistence(
  prod: boolean,
): NonNullable<InfraWorkloadSpec['persistence']> {
  return [
    {
      id: 'data',
      mountPath: '/var/lib/storage',
      sizeGiB: prod ? 20 : 5,
      retention: prod ? 'retain' : 'delete-on-destroy',
    },
  ];
}
