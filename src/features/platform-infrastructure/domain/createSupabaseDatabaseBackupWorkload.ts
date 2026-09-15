import type {
  InfraExecutionContext,
  InfraWorkloadScalarValue,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import { SUPABASE_BOOTSTRAP_CREDENTIAL, SUPABASE_IMAGES } from '../constants/supabase';
import { createSupabaseS3Values } from './createSupabaseS3Values';

const DEFAULT_BACKUP_INTERVAL_HOURS = 24;
const BACKUP_SCRIPT = `
set -eu
umask 077
printf 'user = "%s:%s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" > /tmp/ankhorage-s3-curl.conf
backup_once() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  key="database/${timestamp}.dump"
  dump="/tmp/${timestamp}.dump"
  pointer="/tmp/latest"
  pg_dump --format=custom --no-owner --no-acl --file="$dump"
  curl --fail --silent --show-error --config /tmp/ankhorage-s3-curl.conf \
    --aws-sigv4 "aws:amz:${S3_REGION}:s3" --upload-file "$dump" "${S3_URL_PREFIX}/$key"
  printf '%s' "$key" > "$pointer"
  curl --fail --silent --show-error --config /tmp/ankhorage-s3-curl.conf \
    --aws-sigv4 "aws:amz:${S3_REGION}:s3" --upload-file "$pointer" "${S3_URL_PREFIX}/database/latest"
  rm -f "$dump" "$pointer"
  touch /tmp/ankhorage-backup-ready
}
backup_once
while sleep "$BACKUP_INTERVAL_SECONDS"; do backup_once; done
`;

/*** Create the scheduled logical Postgres backup workload when backup intent is configured. */
export function createSupabaseDatabaseBackupWorkload(
  context: InfraExecutionContext,
): InfraWorkloadSpec | undefined {
  const backup = context.desired.database?.provider === 'supabase' ? context.desired.database.backup : undefined;
  if (backup === undefined) return undefined;
  const s3 = createSupabaseS3Values(backup.target);
  const intervalHours = backup.intervalHours ?? DEFAULT_BACKUP_INTERVAL_HOURS;
  return {
    id: 'supabase-db-backup',
    artifact: { kind: 'image', image: SUPABASE_IMAGES.database },
    command: ['sh'],
    args: ['-ec', BACKUP_SCRIPT],
    environment: {
      PGHOST: literal('supabase-db'),
      PGPORT: literal('5432'),
      PGDATABASE: literal('postgres'),
      PGUSER: literal('supabase_admin'),
      PGPASSWORD: bootstrapCredential('postgresPassword'),
      S3_REGION: s3.region,
      S3_URL_PREFIX: s3.urlPrefix,
      AWS_ACCESS_KEY_ID: s3.accessKeyId,
      AWS_SECRET_ACCESS_KEY: s3.secretAccessKey,
      BACKUP_INTERVAL_SECONDS: literal(String(intervalHours * 3600)),
    },
    health: {
      kind: 'command',
      command: ['test', '-f', '/tmp/ankhorage-backup-ready'],
      intervalSeconds: 30,
      timeoutSeconds: 5,
      failureThreshold: 10,
    },
    exposure: 'internal',
    replicas: 1,
    dependsOn: ['supabase-db'],
  };
}

/*** Create one literal workload value. */
function literal(value: string): InfraWorkloadScalarValue {
  return { kind: 'literal', value };
}

/*** Create one execution-only Supabase bootstrap credential reference. */
function bootstrapCredential(key: string): InfraWorkloadScalarValue {
  return { kind: 'credential', reference: SUPABASE_BOOTSTRAP_CREDENTIAL, key };
}
