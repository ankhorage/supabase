import type {
  InfraExecutionContext,
  InfraWorkloadFileSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import { createSupabaseS3Values } from './createSupabaseS3Values';

const RESTORE_SCRIPT = `
set -eu
umask 077
printf 'user = "%s:%s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" > /tmp/ankhorage-s3-curl.conf
pointer=/tmp/ankhorage-latest
status="$(curl --silent --show-error --config /tmp/ankhorage-s3-curl.conf \
  --aws-sigv4 "aws:amz:${S3_REGION}:s3" --output "$pointer" --write-out '%{http_code}' \
  "${S3_URL_PREFIX}/database/latest")"
if [ "$status" = '404' ]; then
  echo 'No database backup exists yet; continuing with a fresh database.'
  rm -f "$pointer" /tmp/ankhorage-s3-curl.conf
  exit 0
fi
if [ "$status" != '200' ]; then
  echo "Database backup pointer request failed with HTTP $status." >&2
  exit 1
fi
key="$(cat "$pointer")"
case "$key" in
  database/*.dump) ;;
  *) echo 'Database backup pointer is invalid.' >&2; exit 1 ;;
esac
dump=/tmp/ankhorage-restore.dump
status="$(curl --silent --show-error --config /tmp/ankhorage-s3-curl.conf \
  --aws-sigv4 "aws:amz:${S3_REGION}:s3" --output "$dump" --write-out '%{http_code}' \
  "${S3_URL_PREFIX}/$key")"
if [ "$status" != '200' ]; then
  echo "Database backup download failed with HTTP $status." >&2
  exit 1
fi
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname "$POSTGRES_DB" "$dump"
rm -f "$pointer" "$dump" /tmp/ankhorage-s3-curl.conf
`;

/*** Project first-boot restore state for a database protected by scheduled S3 backups. */
export function createSupabaseDatabaseRestore(context: InfraExecutionContext) {
  const backup = context.desired.database?.provider === 'supabase' ? context.desired.database.backup : undefined;
  if (backup === undefined) {
    return {
      environment: {} as Readonly<Record<string, InfraWorkloadValue>>,
      files: [] as readonly InfraWorkloadFileSpec[],
    };
  }
  const s3 = createSupabaseS3Values(backup.target);
  return {
    environment: {
      S3_REGION: s3.region,
      S3_URL_PREFIX: s3.urlPrefix,
      AWS_ACCESS_KEY_ID: s3.accessKeyId,
      AWS_SECRET_ACCESS_KEY: s3.secretAccessKey,
    } satisfies Readonly<Record<string, InfraWorkloadValue>>,
    files: [
      {
        path: '/docker-entrypoint-initdb.d/zzzz-ankhorage-restore.sh',
        content: { kind: 'literal', value: RESTORE_SCRIPT },
      },
    ] satisfies readonly InfraWorkloadFileSpec[],
  };
}
