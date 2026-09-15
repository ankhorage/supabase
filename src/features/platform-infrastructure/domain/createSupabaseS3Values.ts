import type {
  InfraS3PersistenceTarget,
  InfraWorkloadScalarValue,
} from '@ankhorage/contracts/infra';

/*** Project one portable S3 target into execution-only workload values and a concrete URL prefix. */
export function createSupabaseS3Values(target: InfraS3PersistenceTarget) {
  return {
    endpoint: literal(target.endpoint),
    region: literal(target.region),
    bucket: literal(target.bucket),
    forcePathStyle: literal(String(target.forcePathStyle ?? true)),
    accessKeyId: credential(target, 'accessKeyId'),
    secretAccessKey: credential(target, 'secretAccessKey'),
    urlPrefix: literal(resolveS3UrlPrefix(target)),
  } as const;
}

/*** Resolve path-style by default while preserving explicit virtual-host addressing intent. */
function resolveS3UrlPrefix(target: InfraS3PersistenceTarget): string {
  const endpoint = new URL(target.endpoint);
  if (target.forcePathStyle !== false) {
    return `${endpoint.origin}/${encodeURIComponent(target.bucket)}`;
  }
  endpoint.hostname = `${target.bucket}.${endpoint.hostname}`;
  return endpoint.origin;
}

/*** Create one plain workload value. */
function literal(value: string): InfraWorkloadScalarValue {
  return { kind: 'literal', value };
}

/*** Create one execution-only S3 credential field reference. */
function credential(
  target: InfraS3PersistenceTarget,
  key: 'accessKeyId' | 'secretAccessKey',
): InfraWorkloadScalarValue {
  return { kind: 'credential', reference: target.credentials, key };
}
