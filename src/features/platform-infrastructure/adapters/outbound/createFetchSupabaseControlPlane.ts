import type { InfraResult } from '@ankhorage/contracts/infra';

import type { SupabaseControlPlane, SupabaseControlPlaneRequest } from '../../../../types/supabase';

interface FetchSupabaseControlPlaneOptions {
  readonly fetcher?: FetchLike;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/*** Create a sanitized HTTP adapter for self-hosted Supabase health and bucket lifecycle. */
export function createFetchSupabaseControlPlane(
  options: FetchSupabaseControlPlaneOptions = {},
): SupabaseControlPlane {
  const fetcher = options.fetcher ?? fetch;
  return {
    healthAsync: (request) => requestEmptyAsync(fetcher, request, '/auth/v1/health', 'GET'),
    listBucketsAsync: (request) => listBucketsAsync(fetcher, request),
    createBucketAsync: (request) =>
      requestEmptyAsync(fetcher, request, '/storage/v1/bucket', 'POST', {
        id: request.bucket,
        name: request.bucket,
        public: false,
      }),
    deleteBucketAsync: (request) =>
      requestEmptyAsync(
        fetcher,
        request,
        `/storage/v1/bucket/${encodeURIComponent(request.bucket)}`,
        'DELETE',
      ),
  };
}

/*** List storage buckets without returning privileged request metadata. */
async function listBucketsAsync(
  fetcher: FetchLike,
  request: SupabaseControlPlaneRequest,
): Promise<InfraResult<readonly string[]>> {
  const response = await requestAsync(fetcher, request, '/storage/v1/bucket', 'GET');
  if (!response.ok) return response;
  try {
    const payload: unknown = await response.value.json();
    if (!Array.isArray(payload)) return invalidResponse();
    const names = payload.flatMap((value: unknown) => (isNamedBucket(value) ? [value.name] : []));
    return names.length === payload.length
      ? { ok: true, value: names.sort(), diagnostics: [] }
      : invalidResponse();
  } catch {
    return invalidResponse();
  }
}

/*** Narrow one untrusted storage response item to its public bucket name. */
function isNamedBucket(value: unknown): value is { readonly name: string } {
  if (typeof value !== 'object' || value === null || !('name' in value)) return false;
  return typeof value.name === 'string';
}

/*** Execute one response-body-free control-plane request. */
async function requestEmptyAsync(
  fetcher: FetchLike,
  request: SupabaseControlPlaneRequest,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: Readonly<Record<string, unknown>>,
): Promise<InfraResult<null>> {
  const response = await requestAsync(fetcher, request, path, method, body);
  return response.ok ? { ok: true, value: null, diagnostics: [] } : response;
}

/*** Execute one authenticated request and expose only the trusted Response boundary. */
async function requestAsync(
  fetcher: FetchLike,
  request: SupabaseControlPlaneRequest,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: Readonly<Record<string, unknown>>,
): Promise<InfraResult<Response>> {
  try {
    const response = await fetcher(`${request.baseUrl}${path}`, {
      method,
      headers: {
        apikey: request.serviceRoleKey,
        authorization: `Bearer ${request.serviceRoleKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return response.ok ? { ok: true, value: response, diagnostics: [] } : requestFailure();
  } catch {
    return requestFailure();
  }
}

/*** Reject a failed HTTP request without leaking response or credential detail. */
function requestFailure(): InfraResult<never> {
  return {
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        code: 'supabase-control-plane-unavailable',
        message: 'The Supabase control plane request failed.',
      },
    ],
  };
}

/*** Reject a malformed storage response without exposing its body. */
function invalidResponse(): InfraResult<never> {
  return {
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        code: 'supabase-control-plane-response-invalid',
        message: 'The Supabase control plane returned an invalid bucket response.',
      },
    ],
  };
}
