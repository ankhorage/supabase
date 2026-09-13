import type {
  InfraExecutionContext,
  InfraResourceStatus,
  InfraResult,
} from '@ankhorage/contracts/infra';

import type { SupabaseControlPlane } from '../../../types/supabase';
import { resolveSupabaseBootstrapCredentialsAsync } from './resolveSupabaseBootstrapCredentialsAsync';
import { resolveSupabaseDesiredState } from './resolveSupabaseDesiredState';

/*** Read platform health and bucket presence through the provider control plane. */
export async function getSupabaseStatusAsync(
  controlPlane: SupabaseControlPlane,
  context: InfraExecutionContext,
): Promise<InfraResult<readonly InfraResourceStatus[]>> {
  const desired = resolveSupabaseDesiredState(context);
  if (!desired.ok) return desired;
  if (!wasPreviouslyOwned(context, 'platform')) {
    return {
      ok: true,
      value: [
        { owner: desired.value.platform.identity, state: 'absent' },
        ...desired.value.buckets.map((bucket) => ({
          owner: bucket.identity,
          state: 'absent' as const,
        })),
      ],
      diagnostics: [],
    };
  }
  const credentials = await resolveSupabaseBootstrapCredentialsAsync(context);
  if (!credentials.ok) return credentials;
  const request = {
    baseUrl: desired.value.baseUrl,
    serviceRoleKey: credentials.value.serviceRoleKey,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  };
  const health = await controlPlane.healthAsync(request);
  if (!health.ok) return health;
  const buckets = await controlPlane.listBucketsAsync(request);
  if (!buckets.ok) return buckets;
  const existing = new Set(buckets.value);
  return {
    ok: true,
    value: [
      { owner: desired.value.platform.identity, state: 'ready' },
      ...desired.value.buckets.map((bucket) => ({
        owner: bucket.identity,
        state: existing.has(bucket.externalId ?? '') ? ('ready' as const) : ('absent' as const),
      })),
    ],
    diagnostics: [],
  };
}

/*** Check exact prior-ledger ownership before probing a platform. */
function wasPreviouslyOwned(context: InfraExecutionContext, resourceId: string): boolean {
  return (
    context.previous?.resources.some(
      ({ identity }) =>
        identity.projectId === context.projectId &&
        identity.environment === context.environment &&
        identity.adapter === 'supabase' &&
        identity.resourceId === resourceId,
    ) === true
  );
}
