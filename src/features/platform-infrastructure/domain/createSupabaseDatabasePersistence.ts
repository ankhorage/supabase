import type { InfraWorkloadSpec } from '@ankhorage/contracts/infra';

/*** Keep Postgres data and pgsodium configuration on independently retained runtime volumes. */
export function createSupabaseDatabasePersistence(
  prod: boolean,
): NonNullable<InfraWorkloadSpec['persistence']> {
  return {
    data: {
      id: 'data',
      mountPath: '/var/lib/postgresql/data',
      sizeGiB: prod ? 20 : 5,
      retention: prod ? 'retain' : 'delete-on-destroy',
    },
    config: {
      id: 'config',
      mountPath: '/etc/postgresql-custom',
      sizeGiB: 1,
      seed: 'image',
      retention: prod ? 'retain' : 'delete-on-destroy',
    },
  };
}
