import type {
  InfraExecutionContext,
  InfraOwnedResource,
  InfraResult,
} from '@ankhorage/contracts/infra';

import type { SupabaseDesiredState } from '../../../types/supabase';

/*** Resolve the deduplicated Supabase platform, stable ownership and persistent buckets. */
export function resolveSupabaseDesiredState(
  context: InfraExecutionContext,
): InfraResult<SupabaseDesiredState> {
  if (!isSelected(context)) return invalidSelection();
  const baseUrl = context.desired.networking?.publicBaseUrl;
  if (baseUrl === undefined) return missingPublicBaseUrl();
  const bucketNames =
    context.desired.objectStorage?.provider === 'supabase'
      ? Object.keys(context.desired.objectStorage.buckets ?? {}).sort()
      : [];
  const invalidBucket = bucketNames.find((bucket) => !isBucketName(bucket));
  if (invalidBucket !== undefined) return invalidBucketName(invalidBucket);
  const platform = createPlatformOwner(context);
  return {
    ok: true,
    value: {
      baseUrl,
      platform,
      buckets: bucketNames.map((bucket) => createBucketOwner(context, platform, bucket)),
    },
    diagnostics: [],
  };
}

/*** Check whether at least one Supabase-owned sibling capability is selected. */
function isSelected(context: InfraExecutionContext): boolean {
  return (
    context.desired.database?.provider === 'supabase' ||
    context.desired.auth?.provider === 'supabase' ||
    context.desired.objectStorage?.provider === 'supabase'
  );
}

/*** Create the logical owner for one deduplicated platform instance. */
function createPlatformOwner(context: InfraExecutionContext): InfraOwnedResource {
  return {
    identity: {
      projectId: context.projectId,
      environment: context.environment,
      adapter: 'supabase',
      resourceId: 'platform',
    },
    externalId: `${context.projectId}-${context.environment}-supabase`,
    persistent: false,
    retention: 'delete-on-destroy',
    dependsOn: [
      {
        projectId: context.projectId,
        environment: context.environment,
        adapter: context.desired.deployment.runtime.provider,
        resourceId: 'workload:supabase-gateway',
      },
    ],
  };
}

/*** Create persistent ownership for one Storage bucket. */
function createBucketOwner(
  context: InfraExecutionContext,
  platform: InfraOwnedResource,
  bucket: string,
): InfraOwnedResource {
  return {
    identity: {
      projectId: context.projectId,
      environment: context.environment,
      adapter: 'supabase',
      resourceId: `bucket/${bucket}`,
    },
    externalId: bucket,
    persistent: true,
    retention: 'retain',
    dependsOn: [platform.identity],
  };
}

/*** Validate one portable Supabase Storage bucket name. */
function isBucketName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$/u.test(value);
}

/*** Reject invocation when no Supabase-owned capability is selected. */
function invalidSelection(): InfraResult<never> {
  return failure(
    'supabase-selection-invalid',
    'Supabase lifecycle requires a Supabase database, auth or object-storage selection.',
  );
}

/*** Require one explicit external origin for Auth and public platform outputs. */
function missingPublicBaseUrl(): InfraResult<never> {
  return failure(
    'supabase-public-base-url-missing',
    'Supabase lifecycle requires networking.publicBaseUrl.',
  );
}

/*** Reject one invalid desired Storage bucket name. */
function invalidBucketName(bucket: string): InfraResult<never> {
  return failure('supabase-bucket-name-invalid', `Supabase bucket name "${bucket}" is invalid.`);
}

/*** Create one sanitized desired-state failure. */
function failure(code: string, message: string): InfraResult<never> {
  return { ok: false, diagnostics: [{ severity: 'error', code, message }] };
}
