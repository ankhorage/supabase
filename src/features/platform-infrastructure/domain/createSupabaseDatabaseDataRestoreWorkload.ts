import type {
  InfraExecutionContext,
  InfraWorkloadScalarValue,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import {
  SUPABASE_DATA_RESTORE_WORKLOAD_ID,
  SUPABASE_RECOVERY_SCHEMA,
  SUPABASE_RECOVERY_STATE_TABLE,
} from '../constants/recovery';
import { SUPABASE_BOOTSTRAP_CREDENTIAL, SUPABASE_IMAGES } from '../constants/supabase';
import { createSupabaseS3Values } from './createSupabaseS3Values';

const DATA_RESTORE_READY_FILE = '/tmp/ankhorage-data-restore-ready';
const RECOVERY_STATE_RELATION = `"${SUPABASE_RECOVERY_SCHEMA}"."${SUPABASE_RECOVERY_STATE_TABLE}"`;
const DATA_RESTORE_SCRIPT = `
set -eu
umask 077
ready='${DATA_RESTORE_READY_FILE}'
cleanup() {
  rm -f /tmp/ankhorage-s3-curl.conf /tmp/ankhorage-data.sql /tmp/ankhorage-data-restore.sql
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
trap cleanup EXIT INT TERM
rm -f "$ready"
printf 'user = "%s:%s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" > /tmp/ankhorage-s3-curl.conf
prefix="$(psql --set ON_ERROR_STOP=1 --dbname "$PGDATABASE" --tuples-only --no-align \
  --command "SELECT backup_prefix FROM ${RECOVERY_STATE_RELATION} WHERE id = 'latest' AND NOT data_restored;")"

if [ -n "$prefix" ]; then
  suffix="\${prefix#database/}"
  case "$prefix:$suffix" in
    database/*:*/*|database/*:*..*|database/:*)
      echo 'Database recovery state contains an invalid backup pointer.' >&2
      exit 1
      ;;
    database/*:*) ;;
    *)
      echo 'Database recovery state contains an invalid backup pointer.' >&2
      exit 1
      ;;
  esac

  echo "Restoring database data from backup set $prefix after managed schema migrations."
  download_file "$prefix/data.sql" /tmp/ankhorage-data.sql
  cat /tmp/ankhorage-data.sql > /tmp/ankhorage-data-restore.sql
  cat >> /tmp/ankhorage-data-restore.sql <<'SQL'
UPDATE ${RECOVERY_STATE_RELATION}
SET data_restored = TRUE
WHERE id = 'latest';
SQL
  psql --single-transaction --set ON_ERROR_STOP=1 --dbname "$PGDATABASE" \
    --file /tmp/ankhorage-data-restore.sql
  echo 'Database data restore completed.'
else
  echo 'No pending database data restore exists.'
fi

touch "$ready"
cleanup
trap - EXIT INT TERM
while :; do sleep 3600; done
`;

/*** Create the post-migration data recovery workload for a database protected by S3 backups. */
export function createSupabaseDatabaseDataRestoreWorkload(
  context: InfraExecutionContext,
  ownsObjectStorage: boolean,
): InfraWorkloadSpec | undefined {
  const backup =
    context.desired.database?.provider === 'supabase' ? context.desired.database.backup : undefined;
  if (backup === undefined) return undefined;
  const s3 = createSupabaseS3Values(backup.target);
  return {
    id: SUPABASE_DATA_RESTORE_WORKLOAD_ID,
    artifact: { kind: 'image', image: SUPABASE_IMAGES.database },
    command: ['sh'],
    args: ['-ec', DATA_RESTORE_SCRIPT],
    environment: {
      PGHOST: literal('supabase-db'),
      PGPORT: literal('5432'),
      PGDATABASE: literal('postgres'),
      PGUSER: literal('postgres'),
      PGPASSWORD: bootstrapCredential('postgresPassword'),
      S3_REGION: s3.region,
      S3_URL_PREFIX: s3.urlPrefix,
      AWS_ACCESS_KEY_ID: s3.accessKeyId,
      AWS_SECRET_ACCESS_KEY: s3.secretAccessKey,
    },
    health: {
      kind: 'command',
      command: ['test', '-f', DATA_RESTORE_READY_FILE],
      intervalSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 120,
    },
    exposure: 'internal',
    replicas: 1,
    dependsOn: { 'supabase-auth': true, ...(ownsObjectStorage ? { 'supabase-storage': true } : {}) },
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
