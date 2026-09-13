import { expect, it } from 'bun:test';

import { createFetchSupabaseControlPlane } from './index';

it('authenticates bucket operations without exposing privileged request or response data', async () => {
  const requests: { readonly url: string; readonly init?: RequestInit }[] = [];
  const controlPlane = createFetchSupabaseControlPlane({
    fetcher: (input, init) => {
      requests.push({ url: requestUrl(input), ...(init === undefined ? {} : { init }) });
      return Promise.resolve(
        new Response(JSON.stringify([{ name: 'media' }, { name: 'avatars' }]), {
          status: 200,
        }),
      );
    },
  });
  const request = {
    baseUrl: 'https://supabase.example.test',
    serviceRoleKey: 'private-service-role-key',
  };

  const listed = await controlPlane.listBucketsAsync(request);
  const created = await controlPlane.createBucketAsync({ ...request, bucket: 'documents' });
  const deleted = await controlPlane.deleteBucketAsync({ ...request, bucket: 'customer uploads' });

  expect(listed).toEqual({ ok: true, value: ['avatars', 'media'], diagnostics: [] });
  expect(created.ok).toBe(true);
  expect(deleted.ok).toBe(true);
  expect(requests.map(({ url }) => url)).toEqual([
    'https://supabase.example.test/storage/v1/bucket',
    'https://supabase.example.test/storage/v1/bucket',
    'https://supabase.example.test/storage/v1/bucket/customer%20uploads',
  ]);
  expect(requests[1]?.init).toEqual({
    method: 'POST',
    headers: {
      apikey: 'private-service-role-key',
      authorization: 'Bearer private-service-role-key',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: 'documents', name: 'documents', public: false }),
  });
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

it('sanitizes failed and malformed control-plane responses', async () => {
  const serviceRoleKey = 'private-service-role-key';
  const unavailable = createFetchSupabaseControlPlane({
    fetcher: () => Promise.resolve(new Response(serviceRoleKey, { status: 503 })),
  });
  const invalid = createFetchSupabaseControlPlane({
    fetcher: () => Promise.resolve(Response.json([{ name: serviceRoleKey }, {}])),
  });
  const request = { baseUrl: 'https://supabase.example.test', serviceRoleKey };

  const unavailableResult = await unavailable.healthAsync(request);
  const invalidResult = await invalid.listBucketsAsync(request);

  expect(unavailableResult.ok).toBe(false);
  expect(invalidResult.ok).toBe(false);
  expect(JSON.stringify([unavailableResult, invalidResult])).not.toContain(serviceRoleKey);
});
