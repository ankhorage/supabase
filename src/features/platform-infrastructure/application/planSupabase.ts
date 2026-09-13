import type {
  InfraExecutionContext,
  InfraPlanAction,
  InfraResult,
} from '@ankhorage/contracts/infra';

import { resolveSupabaseDesiredState } from './resolveSupabaseDesiredState';

/*** Plan the logical platform and persistent bucket state without control-plane mutation. */
export function planSupabase(
  context: InfraExecutionContext,
): InfraResult<readonly InfraPlanAction[]> {
  const desired = resolveSupabaseDesiredState(context);
  if (!desired.ok) return desired;
  const resources = [desired.value.platform, ...desired.value.buckets];
  const current = resources.map<InfraPlanAction>((resource) => ({
    owner: resource.identity,
    operation: wasPreviouslyOwned(context, resource.identity.resourceId) ? 'noop' : 'create',
    impact: 'none',
    detail: `${resource.identity.resourceId}: ${wasPreviouslyOwned(context, resource.identity.resourceId) ? 'noop' : 'create'}.`,
    dependsOn: resource.dependsOn,
  }));
  const desiredIds = new Set(resources.map(({ identity }) => identity.resourceId));
  const stale = (context.previous?.resources ?? [])
    .filter(
      ({ identity }) =>
        identity.projectId === context.projectId &&
        identity.environment === context.environment &&
        identity.adapter === 'supabase' &&
        !desiredIds.has(identity.resourceId),
    )
    .map<InfraPlanAction>((resource) => ({
      owner: resource.identity,
      operation: resource.persistent ? 'retain' : 'delete',
      impact: 'none',
      detail: `${resource.persistent ? 'Retain' : 'Delete'} stale Supabase resource ${resource.identity.resourceId}.`,
      dependsOn: resource.dependsOn,
    }));
  return { ok: true, value: [...current, ...stale], diagnostics: [] };
}

/*** Check exact prior-ledger ownership for one logical resource. */
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
