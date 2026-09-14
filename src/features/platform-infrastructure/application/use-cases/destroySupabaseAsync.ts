import type {
  InfraDestroyRequest,
  InfraExecutionContext,
  InfraReconcileResult,
  InfraResourceIdentity,
  InfraResult,
} from '@ankhorage/contracts/infra';

import type { SupabaseControlPlane } from '../../../../types/supabase';
import { resolveSupabaseDesiredState } from '../../domain/resolveSupabaseDesiredState';
import { resolveSupabaseControlPlaneUrl } from '../../utils/resolveSupabaseControlPlaneUrl';
import { resolveSupabaseBootstrapCredentialsAsync } from './resolveSupabaseBootstrapCredentialsAsync';

/*** Remove only explicitly confirmed persistent buckets and retain all other provider data. */
export async function destroySupabaseAsync(
  controlPlane: SupabaseControlPlane,
  context: InfraExecutionContext,
  request: InfraDestroyRequest,
): Promise<InfraResult<InfraReconcileResult>> {
  if (!isConfirmed(context, request)) return unconfirmedDestroy();
  const desired = resolveSupabaseDesiredState(context);
  if (!desired.ok) return desired;
  const confirmed =
    request.persistence.policy === 'delete' ? request.persistence.confirmedResources : [];
  const removed = desired.value.buckets.filter((bucket) =>
    confirmed.some((identity) => isSameIdentity(identity, bucket.identity)),
  );
  if (removed.length > 0) {
    const controlPlaneUrl = resolveSupabaseControlPlaneUrl(
      context,
      desired.value.baseUrl,
      context.previous?.outputs ?? [],
    );
    if (!controlPlaneUrl.ok) return controlPlaneUrl;
    const credentials = await resolveSupabaseBootstrapCredentialsAsync(context);
    if (!credentials.ok) return credentials;
    const controlRequest = {
      baseUrl: controlPlaneUrl.value,
      serviceRoleKey: credentials.value.serviceRoleKey,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    };
    for (const bucket of removed) {
      const deletion = await controlPlane.deleteBucketAsync({
        ...controlRequest,
        bucket: bucket.externalId ?? '',
      });
      if (!deletion.ok) return deletion;
    }
  }
  const resources = desired.value.buckets.filter(
    (bucket) => !removed.some(({ identity }) => isSameIdentity(identity, bucket.identity)),
  );
  return { ok: true, value: { resources, outputs: [] }, diagnostics: [] };
}

/*** Require exact project and environment confirmation for every destroy. */
function isConfirmed(context: InfraExecutionContext, request: InfraDestroyRequest): boolean {
  return (
    request.projectId === context.projectId &&
    request.environment === context.environment &&
    request.confirmation.projectId === context.projectId &&
    request.confirmation.environment === context.environment
  );
}

/*** Compare full stable resource identities before destructive work. */
function isSameIdentity(left: InfraResourceIdentity, right: InfraResourceIdentity): boolean {
  return (
    left.projectId === right.projectId &&
    left.environment === right.environment &&
    left.adapter === right.adapter &&
    left.resourceId === right.resourceId
  );
}

/*** Reject destructive work without exact confirmation. */
function unconfirmedDestroy(): InfraResult<never> {
  return {
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        code: 'supabase-destroy-unconfirmed',
        message: 'Supabase destroy requires exact project and environment confirmation.',
      },
    ],
  };
}
