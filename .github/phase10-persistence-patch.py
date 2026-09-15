from pathlib import Path

workloads = Path('src/features/platform-infrastructure/domain/createSupabaseWorkloads.ts')
source = workloads.read_text()
source = source.replace(
    '/*** Create the persistent Postgres 17 workload and first-boot configuration. */',
    '/*** Create persistent Postgres 17 data and custom configuration for safe runtime recreation. */',
    1,
)
old = """    persistence: [
      {
        id: 'data',
        mountPath: '/var/lib/postgresql/data',
        sizeGiB: prod ? 20 : 5,
        retention: prod ? 'retain' : 'delete-on-destroy',
      },
    ],"""
new = """    persistence: [
      {
        id: 'data',
        mountPath: '/var/lib/postgresql/data',
        sizeGiB: prod ? 20 : 5,
        retention: prod ? 'retain' : 'delete-on-destroy',
      },
      {
        id: 'config',
        mountPath: '/etc/postgresql-custom',
        sizeGiB: 1,
        retention: prod ? 'retain' : 'delete-on-destroy',
      },
    ],"""
if source.count(old) != 1:
    raise SystemExit(f'Expected one database persistence block, found {source.count(old)}')
workloads.write_text(source.replace(old, new, 1))

tests = Path('src/supabaseLifecycle.test.ts')
test_source = tests.read_text()
test_source = test_source.replace(
    ").toEqual(['delete-on-destroy', 'delete-on-destroy']);",
    ").toEqual(['delete-on-destroy', 'delete-on-destroy', 'delete-on-destroy']);",
    1,
)
test_source = test_source.replace(
    ").toEqual(['retain', 'retain']);",
    ").toEqual(['retain', 'retain', 'retain']);",
    1,
)
anchor = """  expect(
    prod.value.flatMap(({ persistence }) => persistence?.map(({ retention }) => retention) ?? []),
  ).toEqual(['retain', 'retain', 'retain']);
});"""
replacement = """  expect(
    prod.value.flatMap(({ persistence }) => persistence?.map(({ retention }) => retention) ?? []),
  ).toEqual(['retain', 'retain', 'retain']);
  expect(prod.value.find(({ id }) => id === 'supabase-db')?.persistence).toEqual([
    {
      id: 'data',
      mountPath: '/var/lib/postgresql/data',
      sizeGiB: 20,
      retention: 'retain',
    },
    {
      id: 'config',
      mountPath: '/etc/postgresql-custom',
      sizeGiB: 1,
      retention: 'retain',
    },
  ]);
});"""
if test_source.count(anchor) != 1:
    raise SystemExit(f'Expected one production persistence assertion, found {test_source.count(anchor)}')
tests.write_text(test_source.replace(anchor, replacement, 1))
