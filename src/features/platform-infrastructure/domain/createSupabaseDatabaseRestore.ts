import type {
  InfraExecutionContext,
  InfraWorkloadFileSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import { createSupabaseS3Values } from './createSupabaseS3Values';

const RESTORE_POINTER_ATTEMPTS = 60;
const RESTORE_POINTER_DELAY_SECONDS = 2;
const RESTORE_SCRIPT = `
set -eu
umask 077
cleanup() { rm -f /tmp/ankhorage-s3-curl.conf /tmp/ankhorage-latest /tmp/ankhorage-restore.dump; }
trap cleanup EXIT INT TERM
printf 'user = "%s:%s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" > /tmp/ankhorage-s3-curl.conf

echo 'Checking for a database backup to restore.'
attempt=1
status='000'
while [ "$attempt" -le "${RESTORE_POINTER_ATTEMPTS}" ]; do
  status="$(curl --silent --show-error --connect-timeout 2 --max-time 5 \
    --config /tmp/ankhorage-s3-curl.conf \
    --aws-sigv4 "aws:amz:\${S3_REGION}:s3" --output /tmp/ankhorage-latest --write-out '%{http_code}' \
    "\${S3_URL_PREFIX}/database/latest" || true)"
  case "$status" in
    200|404) break ;;
    401|403)
      echo "Database backup pointer request failed with HTTP $status." >&2
      return 1
      ;;
    *)
      echo "Database backup pointer is not reachable yet (HTTP $status); retrying."
      sleep "${RESTORE_POINTER_DELAY_SECONDS}"
      attempt="$((attempt + 1))"
      ;;
  esac
done

if [ "$status" = '404' ]; then
  echo 'No database backup exists yet; continuing with a fresh database.'
elif [ "$status" != '200' ]; then
  echo "Database backup pointer remained unavailable after ${RESTORE_POINTER_ATTEMPTS} attempts (HTTP $status)." >&2
  return 1
else
  key="$(cat /tmp/ankhorage-latest)"
  case "$key" in
    database/*.dump) ;;
    *) echo 'Database backup pointer is invalid.' >&2; return 1 ;;
  esac

  echo "Restoring database backup $key."
  status="$(curl --silent --show-error --connect-timeout 2 --max-time 30 \
    --retry 10 --retry-all-errors --retry-delay 2 \
    --config /tmp/ankhorage-s3-curl.conf \
    --aws-sigv4 "aws:amz:\${S3_REGION}:s3" --output /tmp/ankhorage-restore.dump --write-out '%{http_code}' \
    "\${S3_URL_PREFIX}/$key" || true)"
  if [ "$status" != '200' ]; then
    echo "Database backup download failed with HTTP $status." >&2
    return 1
  fi

  pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error \
    --dbname "$POSTGRES_DB" /tmp/ankhorage-restore.dump
  echo 'Database backup restore completed.'
fi
cleanup
trap - EXIT INT TERM
`;

/*** Project first-boot restore state for a database protected by scheduled S3 backups. */
export function createSupabaseDatabaseRestore(
  context: InfraExecutionContext,
): SupabaseDatabaseRestoreProjection {
  const backup =
    context.desired.database?.provider === 'supabase' ? context.desired.database.backup : undefined;
  if (backup === undefined) return { environment: {}, files: [] };
  const s3 = createSupabaseS3Values(backup.target);
  return {
    environment: {
      S3_REGION: s3.region,
      S3_URL_PREFIX: s3.urlPrefix,
      AWS_ACCESS_KEY_ID: s3.accessKeyId,
      AWS_SECRET_ACCESS_KEY: s3.secretAccessKey,
    },
    files: [
      {
        path: '/docker-entrypoint-initdb.d/zzzz-ankhorage-restore.sh',
        content: { kind: 'literal', value: RESTORE_SCRIPT },
      },
    ],
  };
}

interface SupabaseDatabaseRestoreProjection {
  readonly environment: Readonly<Record<string, InfraWorkloadValue>>;
  readonly files: readonly InfraWorkloadFileSpec[];
}
