export const SUPABASE_BOOTSTRAP_CREDENTIAL = {
  source: 'control-plane',
  name: 'SUPABASE_BOOTSTRAP',
} as const;

export const SUPABASE_IMAGES = {
  database: 'supabase/postgres:17.6.1.136',
  auth: 'supabase/gotrue:v2.196.0',
  rest: 'postgrest/postgrest:v14.17',
  realtime: 'supabase/realtime:v2.134.10',
  storage: 'supabase/storage-api:v1.74.0',
  imgproxy: 'darthsim/imgproxy:v3.31.4',
  meta: 'supabase/postgres-meta:v0.99.0',
  gateway: 'envoyproxy/envoy:v1.39.1',
  studio: 'supabase/studio:2026.09.07-sha-7996410',
} as const;

export const SUPABASE_DATABASE_WEBHOOKS_SQL = `BEGIN;
  CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
  CREATE SCHEMA supabase_functions AUTHORIZATION supabase_admin;
  GRANT USAGE ON SCHEMA supabase_functions TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

  CREATE TABLE supabase_functions.migrations (
    version text PRIMARY KEY,
    inserted_at timestamptz NOT NULL DEFAULT NOW()
  );

  INSERT INTO supabase_functions.migrations (version) VALUES ('initial');

  CREATE TABLE supabase_functions.hooks (
    id bigserial PRIMARY KEY,
    hook_table_id integer NOT NULL,
    hook_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    request_id bigint
  );

  CREATE INDEX supabase_functions_hooks_request_id_idx ON supabase_functions.hooks USING btree (request_id);
  CREATE INDEX supabase_functions_hooks_h_table_id_h_name_idx ON supabase_functions.hooks USING btree (hook_table_id, hook_name);
  COMMENT ON TABLE supabase_functions.hooks IS 'Supabase Functions Hooks: Audit trail for triggered hooks.';

  CREATE FUNCTION supabase_functions.http_request()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      request_id bigint;
      payload jsonb;
      url text := TG_ARGV[0]::text;
      method text := TG_ARGV[1]::text;
      headers jsonb DEFAULT '{}'::jsonb;
      params jsonb DEFAULT '{}'::jsonb;
      timeout_ms integer DEFAULT 1000;
    BEGIN
      IF url IS NULL OR url = 'null' THEN
        RAISE EXCEPTION 'url argument is missing';
      END IF;

      IF method IS NULL OR method = 'null' THEN
        RAISE EXCEPTION 'method argument is missing';
      END IF;

      IF TG_ARGV[2] IS NULL OR TG_ARGV[2] = 'null' THEN
        headers = '{"Content-Type": "application/json"}'::jsonb;
      ELSE
        headers = TG_ARGV[2]::jsonb;
      END IF;

      IF TG_ARGV[3] IS NULL OR TG_ARGV[3] = 'null' THEN
        params = '{}'::jsonb;
      ELSE
        params = TG_ARGV[3]::jsonb;
      END IF;

      IF TG_ARGV[4] IS NULL OR TG_ARGV[4] = 'null' THEN
        timeout_ms = 1000;
      ELSE
        timeout_ms = TG_ARGV[4]::integer;
      END IF;

      CASE
        WHEN method = 'GET' THEN
          SELECT http_get INTO request_id FROM net.http_get(
            url,
            params,
            headers,
            timeout_ms
          );
        WHEN method = 'POST' THEN
          payload = jsonb_build_object(
            'old_record', OLD,
            'record', NEW,
            'type', TG_OP,
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA
          );

          SELECT http_post INTO request_id FROM net.http_post(
            url,
            payload,
            params,
            headers,
            timeout_ms
          );
        ELSE
          RAISE EXCEPTION 'method argument % is invalid', method;
      END CASE;

      INSERT INTO supabase_functions.hooks
        (hook_table_id, hook_name, request_id)
      VALUES
        (TG_RELID, TG_NAME, request_id);

      RETURN NEW;
    END
  $function$;

  DO
  $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;
  END
  $$;

  GRANT ALL PRIVILEGES ON SCHEMA supabase_functions TO supabase_functions_admin;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA supabase_functions TO supabase_functions_admin;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA supabase_functions TO supabase_functions_admin;
  ALTER USER supabase_functions_admin SET search_path = "supabase_functions";
  ALTER table "supabase_functions".migrations OWNER TO supabase_functions_admin;
  ALTER table "supabase_functions".hooks OWNER TO supabase_functions_admin;
  ALTER function "supabase_functions".http_request() OWNER TO supabase_functions_admin;
  GRANT supabase_functions_admin TO postgres;

  DO
  $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_pg_net_admin'
    )
    THEN
      REASSIGN OWNED BY supabase_pg_net_admin TO supabase_admin;
      DROP OWNED BY supabase_pg_net_admin;
      DROP ROLE supabase_pg_net_admin;
    END IF;
  END
  $$;

  DO
  $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'pg_net'
    )
    THEN
      GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END
  $$;

  CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access()
  RETURNS event_trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_event_trigger_ddl_commands() AS ev
      JOIN pg_extension AS ext
      ON ev.objid = ext.oid
      WHERE ext.extname = 'pg_net'
    )
    THEN
      GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END;
  $$;

  COMMENT ON FUNCTION extensions.grant_pg_net_access IS 'Grants access to pg_net';

  DO
  $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_event_trigger
      WHERE evtname = 'issue_pg_net_access'
    ) THEN
      CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end WHEN TAG IN ('CREATE EXTENSION')
      EXECUTE PROCEDURE extensions.grant_pg_net_access();
    END IF;
  END
  $$;

  INSERT INTO supabase_functions.migrations (version) VALUES ('20210809183423_update_grants');
  ALTER function supabase_functions.http_request() SECURITY DEFINER;
  ALTER function supabase_functions.http_request() SET search_path = supabase_functions;
  REVOKE ALL ON FUNCTION supabase_functions.http_request() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION supabase_functions.http_request() TO postgres, anon, authenticated, service_role;
COMMIT;
`;

export const SUPABASE_DATABASE_ROLES_SQL = `\\set pgpass \`echo "$POSTGRES_PASSWORD"\`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
`;

export const SUPABASE_DATABASE_JWT_SQL = `\\set jwt_secret \`echo "$JWT_SECRET"\`
\\set jwt_exp \`echo "$JWT_EXP"\`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
`;

export const SUPABASE_DATABASE_REALTIME_SQL = `\\set pguser \`echo "$POSTGRES_USER"\`

create schema if not exists _realtime;
alter schema _realtime owner to :pguser;
`;

export const SUPABASE_ENVOY_CONFIG = `static_resources:
  listeners:
    - name: supabase
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 8000
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: supabase
                normalize_path: true
                merge_slashes: true
                upgrade_configs:
                  - upgrade_type: websocket
                route_config:
                  name: supabase
                  virtual_hosts:
                    - name: supabase
                      domains: ["*"]
                      cors:
                        allow_origin_string_match:
                          - safe_regex:
                              regex: ".*"
                        allow_methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD"
                        allow_headers: "*"
                      routes:
                        - match: { prefix: "/auth/v1/" }
                          route: { cluster: auth, prefix_rewrite: "/", timeout: 30s }
                        - match: { prefix: "/rest/v1/" }
                          route: { cluster: rest, prefix_rewrite: "/", timeout: 30s }
                        - match: { prefix: "/realtime/v1/" }
                          route: { cluster: realtime, prefix_rewrite: "/", timeout: 30s }
                        - match: { prefix: "/storage/v1/" }
                          route: { cluster: storage, prefix_rewrite: "/", timeout: 30s }
                http_filters:
                  - name: envoy.filters.http.cors
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.cors.v3.Cors
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  clusters:
    - name: auth
      connect_timeout: 5s
      type: STRICT_DNS
      load_assignment:
        cluster_name: auth
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address: { socket_address: { address: supabase-auth, port_value: 9999 } }
    - name: rest
      connect_timeout: 5s
      type: STRICT_DNS
      load_assignment:
        cluster_name: rest
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address: { socket_address: { address: supabase-rest, port_value: 3000 } }
    - name: realtime
      connect_timeout: 5s
      type: STRICT_DNS
      load_assignment:
        cluster_name: realtime
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address: { socket_address: { address: supabase-realtime, port_value: 4000 } }
    - name: storage
      connect_timeout: 5s
      type: STRICT_DNS
      load_assignment:
        cluster_name: storage
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address: { socket_address: { address: supabase-storage, port_value: 5000 } }
`;
