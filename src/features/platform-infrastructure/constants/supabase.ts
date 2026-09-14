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
