import type {
  InfraExecutionContext,
  InfraOutput,
  InfraReconcileResult,
  InfraResult,
} from '@ankhorage/contracts/infra';

import type { SupabaseControlPlane } from '../../../../types/supabase';
import { resolveSupabaseDesiredState } from '../../domain/resolveSupabaseDesiredState';
import { resolveSupabaseControlPlaneUrl } from '../../utils/resolveSupabaseControlPlaneUrl';
import { resolveSupabaseBootstrapCredentialsAsync } from './resolveSupabaseBootstrapCredentialsAsync';

/*** Reconcile desired Storage buckets and return only safe platform outputs and ownership. */
export async function reconcileSupabaseAsync(
  controlPlane: SupabaseControlPlane,
  context: InfraExecutionContext,
  runtimeOutputs: readonly InfraOutput[],
): Promise<InfraResult<InfraReconcileResult>> {
  const desired = resolveSupabaseDesiredState(context);
  if (!desired.ok) return desired;
  const controlPlaneUrl = resolveSupabaseControlPlaneUrl(
    context,
    desired.value.baseUrl,
    runtimeOutputs,
  );
  if (!controlPlaneUrl.ok) return controlPlaneUrl;
  const credentials = await resolveSupabaseBootstrapCredentialsAsync(context);
  if (!credentials.ok) return credentials;
  const request = {
    baseUrl: controlPlaneUrl.value,
    serviceRoleKey: credentials.value.serviceRoleKey,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  };
  const existing = await controlPlane.listBucketsAsync(request);
  if (!existing.ok) return existing;
  const existingNames = new Set(existing.value);
  for (const bucket of desired.value.buckets) {
    const name = bucket.externalId ?? '';
    if (existingNames.has(name)) continue;
    const created = await controlPlane.createBucketAsync({ ...request, bucket: name });
    if (!created.ok) return created;
  }
  return {
    ok: true,
    value: {
      resources: [desired.value.platform, ...desired.value.buckets],
      outputs: createOutputs(
        desired.value.platform.identity,
        desired.value.baseUrl,
        credentials.value.anonKey,
        desired.value.buckets,
      ),
    },
    diagnostics: [],
  };
}

/*** Create public client configuration and non-secret bucket identifiers. */
function createOutputs(
  platformOwner: InfraOutput['owner'],
  baseUrl: string,
  anonKey: string,
  buckets: readonly { readonly identity: InfraOutput['owner']; readonly externalId?: string }[],
): readonly InfraOutput[] {
  return [
    {
      owner: platformOwner,
      name: 'url',
      visibility: 'public',
      value: baseUrl,
      environmentVariable: 'EXPO_PUBLIC_SUPABASE_URL',
    },
    {
      owner: platformOwner,
      name: 'anonKey',
      visibility: 'public',
      value: anonKey,
      environmentVariable: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    },
    ...buckets.map<InfraOutput>((bucket) => ({
      owner: bucket.identity,
      name: 'bucket',
      visibility: 'public',
      value: bucket.externalId ?? '',
    })),
  ];
}
