import type {
  InfraExecutionContext,
  InfraWorkloadScalarValue,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import { SUPABASE_BOOTSTRAP_CREDENTIAL, SUPABASE_IMAGES } from '../constants/supabase';
import { createSupabaseS3Values } from './createSupabaseS3Values';

const DEFAULT_BACKUP_INTERVAL_HOURS = 24;
const INTERNAL_SCHEMA_PATTERN = [
  'information_schema',
  'pg_*',
  '_analytics',
  '_realtime',
  '_supavisor',
  'auth',
  'etl',
  'extensions',
  'pgbouncer',
  'realtime',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'cron',
  'dbdev',
  'graphql',
  'graphql_public',
  'net',
  'pgmq',
  'pgsodium',
  'pgsodium_masks',
  'pgtle',
  'repack',
  'tiger',
  'tiger_data',
  'timescaledb_*',
  '_timescaledb_*',
  'topology',
  'vault',
].join('|');
const DATA_EXCLUDED_SCHEMA_PATTERN = [
  'information_schema',
  'pg_*',
  'graphql',
  'graphql_public',
  'pgsodium',
  'pgsodium_masks',
  'pgtle',
  'repack',
  'tiger',
  'tiger_data',
  'timescaledb_*',
  '_timescaledb_*',
  'topology',
  'vault',
  'etl',
  'extensions',
  'pgbouncer',
  'realtime',
  'supabase_migrations',
  '_analytics',
  '_realtime',
  '_supavisor',
].join('|');
const RESERVED_ROLE_PATTERN = [
  'anon',
  'authenticated',
  'authenticator',
  'cli_login_.*',
  'dashboard_user',
  'pgbouncer',
  'postgres',
  'service_role',
  'supabase_.*',
  'pgsodium_keyholder',
  'pgsodium_keyiduser',
  'pgsodium_keymaker',
  'pgtle_admin',
].join('|');
const ALLOWED_CONFIG_PATTERN = [
  'pgaudit.*',
  'pgrst.*',
  'session_replication_role',
  'statement_timeout',
  'track_io_timing',
].join('|');
const BACKUP_SCRIPT = `
set -eu
umask 077
cleanup() {
  rm -f /tmp/ankhorage-s3-curl.conf /tmp/ankhorage-roles.sql /tmp/ankhorage-schema.sql \
    /tmp/ankhorage-data.sql /tmp/ankhorage-latest
}
trap cleanup EXIT INT TERM
upload_file() {
  file="$1"
  key="$2"
  curl --fail --silent --show-error --config /tmp/ankhorage-s3-curl.conf \
    --aws-sigv4 "aws:amz:\${S3_REGION}:s3" --upload-file "$file" "\${S3_URL_PREFIX}/$key"
}
backup_once() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  prefix="database/\${timestamp}"
  printf 'user = "%s:%s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" > /tmp/ankhorage-s3-curl.conf

  pg_dumpall --roles-only --role postgres --quote-all-identifiers --no-role-passwords --no-comments \
    | sed -E 's/^\\(un)?restrict .*$/-- &/' \
    | sed -E "s/^CREATE ROLE \"(${RESERVED_ROLE_PATTERN})\"/-- &/" \
    | sed -E "s/^ALTER ROLE \"(${RESERVED_ROLE_PATTERN})\"/-- &/" \
    | sed -E 's/ (NOSUPERUSER|NOREPLICATION)//g' \
    | sed -E "s/^-- (.* SET \"(${ALLOWED_CONFIG_PATTERN})\" .*)/\\1/" \
    | sed -E "s/GRANT \".*\" TO \"(${RESERVED_ROLE_PATTERN})\"/-- &/" \
    | uniq > /tmp/ankhorage-roles.sql
  printf '\nRESET ALL;\n' >> /tmp/ankhorage-roles.sql

  pg_dump --schema-only --quote-all-identifiers --role postgres \
    --exclude-schema '${INTERNAL_SCHEMA_PATTERN}' \
    | sed -E 's/^\\(un)?restrict .*$/-- &/' \
    | sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
    | sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
    | sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
    | sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
    | sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
    | sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
    | sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
    | sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
    | sed -E 's/^         WHEN TAG IN /-- &/' \
    | sed -E 's/^   EXECUTE FUNCTION /-- &/' \
    | sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
    | sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
    | sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
    | sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
    | sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
    | sed -E "s/^GRANT (.+) ON (.+) \"(${INTERNAL_SCHEMA_PATTERN})\"/-- &/" \
    | sed -E "s/^REVOKE (.+) ON (.+) \"(${INTERNAL_SCHEMA_PATTERN})\"/-- &/" \
    | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\\1;/' \
    | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\\1;/' \
    | sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\\1;/' \
    | sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
    | sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
    | sed -E 's/^ALTER TABLE "cron"/-- &/' \
    | sed -E 's/^SET transaction_timeout = 0;/-- &/' \
    > /tmp/ankhorage-schema.sql

  printf 'SET session_replication_role = replica;\n\n' > /tmp/ankhorage-data.sql
  pg_dump --data-only --quote-all-identifiers --role postgres \
    --exclude-schema '${DATA_EXCLUDED_SCHEMA_PATTERN}' \
    --exclude-table 'auth.schema_migrations' \
    --exclude-table 'storage.migrations' \
    --exclude-table 'supabase_functions.migrations' \
    --schema '*' \
    | sed -E 's/^\\(un)?restrict .*$/-- &/' >> /tmp/ankhorage-data.sql
  printf '\nRESET ALL;\n' >> /tmp/ankhorage-data.sql

  upload_file /tmp/ankhorage-roles.sql "\${prefix}/roles.sql"
  upload_file /tmp/ankhorage-schema.sql "\${prefix}/schema.sql"
  upload_file /tmp/ankhorage-data.sql "\${prefix}/data.sql"
  printf '%s' "$prefix" > /tmp/ankhorage-latest
  upload_file /tmp/ankhorage-latest 'database/latest'
  cleanup
  touch /tmp/ankhorage-backup-ready
}
backup_once
while sleep "$BACKUP_INTERVAL_SECONDS"; do backup_once; done
`;

/*** Create the scheduled logical Postgres backup workload when backup intent is configured. */
export function createSupabaseDatabaseBackupWorkload(
  context: InfraExecutionContext,
): InfraWorkloadSpec | undefined {
  const backup =
    context.desired.database?.provider === 'supabase' ? context.desired.database.backup : undefined;
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
      PGUSER: literal('postgres'),
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
