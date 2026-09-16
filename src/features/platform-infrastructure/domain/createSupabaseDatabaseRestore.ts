import type {
  InfraExecutionContext,
  InfraWorkloadFileSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import {
  SUPABASE_RECOVERY_SCHEMA,
  SUPABASE_RECOVERY_STATE_TABLE,
} from '../constants/recovery';
import { createSupabaseS3Values } from './createSupabaseS3Values';

const RESTORE_POINTER_ATTEMPTS = 60;
const RESTORE_POINTER_DELAY_SECONDS = 2;
const RESTORE_PENDING_FILE = '.ankhorage-restore-pending';
const RECOVERY_STATE_RELATION = `"${SUPABASE_RECOVERY_SCHEMA}"."${SUPABASE_RECOVERY_STATE_TABLE}"`;
const RESTORE_ENTRYPOINT_SCRIPT = `
set -eu
data="\${PGDATA:-/var/lib/postgresql/data}"
marker="$data/${RESTORE_PENDING_FILE}"
if [ -f "$marker" ]; then
  echo 'Retrying an interrupted database restore from a fresh Postgres data directory.'
  find "$data" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
fi
exec /usr/local/bin/docker-entrypoint.sh "$@"
`;
const RESTORE_SCRIPT = `
set -eu
umask 077
data="\${PGDATA:-/var/lib/postgresql/data}"
marker="$data/${RESTORE_PENDING_FILE}"
cleanup() {
  rm -f /tmp/ankhorage-s3-curl.conf /tmp/ankhorage-latest /tmp/ankhorage-roles.sql \
    /tmp/ankhorage-schema.sql
}
download_file() {
  key="$1"
  file="$2"
  status="$(curl --silent --show-error --connect-timeout 2 --max-time 30 \
    --retry 10 --retry-all-errors --retry-delay 2 \
    --config /tmp/ankhorage-s3-curl.conf \
    --aws-sigv4 "aws:amz:\${S3_REGION}:s3" --output "$file" --write-out '%{http_code}' \
    "\${S3_URL_PREFIX}/$key" || true)"
  if [ "$status" != '200' ]; then
    echo "Database backup file $key failed to download with HTTP $status." >&2
    return 1
  fi
}
create_recovery_state() {
  psql --set ON_ERROR_STOP=1 --dbname "$POSTGRES_DB" <<'SQL'
CREATE SCHEMA IF NOT EXISTS "${SUPABASE_RECOVERY_SCHEMA}";
CREATE TABLE IF NOT EXISTS ${RECOVERY_STATE_RELATION} (
  id text PRIMARY KEY,
  backup_prefix text,
  data_restored boolean NOT NULL
);
SQL
}
trap cleanup EXIT INT TERM
touch "$marker"
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

create_recovery_state
if [ "$status" = '404' ]; then
  echo 'No database backup exists yet; continuing with a fresh database.'
  psql --set ON_ERROR_STOP=1 --dbname "$POSTGRES_DB" <<'SQL'
INSERT INTO ${RECOVERY_STATE_RELATION} (id, backup_prefix, data_restored)
VALUES ('latest', NULL, TRUE)
ON CONFLICT (id) DO UPDATE
SET backup_prefix = EXCLUDED.backup_prefix,
    data_restored = EXCLUDED.data_restored;
SQL
elif [ "$status" != '200' ]; then
  echo "Database backup pointer remained unavailable after ${RESTORE_POINTER_ATTEMPTS} attempts (HTTP $status)." >&2
  return 1
else
  prefix="$(cat /tmp/ankhorage-latest)"
  suffix="\${prefix#database/}"
  case "$prefix:$suffix" in
    database/*:*/*|database/*:*..*|database/:*)
      echo 'Database backup pointer is invalid.' >&2
      return 1
      ;;
    database/*:*) ;;
    *)
      echo 'Database backup pointer is invalid.' >&2
      return 1
      ;;
  esac

  echo "Restoring database roles and schema from backup set $prefix."
  download_file "$prefix/roles.sql" /tmp/ankhorage-roles.sql
  download_file "$prefix/schema.sql" /tmp/ankhorage-schema.sql

  psql --set ON_ERROR_STOP=1 --dbname "$POSTGRES_DB" --file /tmp/ankhorage-roles.sql
  psql --set ON_ERROR_STOP=1 --dbname "$POSTGRES_DB" --file /tmp/ankhorage-schema.sql
  psql --set ON_ERROR_STOP=1 --set=backup_prefix="$prefix" --dbname "$POSTGRES_DB" <<'SQL'
INSERT INTO ${RECOVERY_STATE_RELATION} (id, backup_prefix, data_restored)
VALUES ('latest', :'backup_prefix', FALSE)
ON CONFLICT (id) DO UPDATE
SET backup_prefix = EXCLUDED.backup_prefix,
    data_restored = EXCLUDED.data_restored;
SQL
  echo 'Database roles and schema restore completed; data restore is deferred until managed schema migrations finish.'
fi
rm -f "$marker"
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
    entrypoint: {
      command: ['/bin/sh', '-c'],
      args: [RESTORE_ENTRYPOINT_SCRIPT, 'ankhorage-restore-entrypoint'],
    },
  };
}

interface SupabaseDatabaseRestoreProjection {
  readonly environment: Readonly<Record<string, InfraWorkloadValue>>;
  readonly files: readonly InfraWorkloadFileSpec[];
  readonly entrypoint?: {
    readonly command: readonly string[];
    readonly args: readonly string[];
  };
}
