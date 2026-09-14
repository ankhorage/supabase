import type { InfraServiceAdapter } from '@ankhorage/contracts/infra';

import { infraAdapterDescriptor } from '../../../constants/infra';
import type { SupabaseAdapterOptions } from '../../../types/supabase';
import { createFetchSupabaseControlPlane } from '../adapters/outbound/createFetchSupabaseControlPlane';
import { destroySupabaseAsync } from '../application/use-cases/destroySupabaseAsync';
import { getSupabaseStatusAsync } from '../application/use-cases/getSupabaseStatusAsync';
import { planSupabase } from '../application/use-cases/planSupabase';
import { reconcileSupabaseAsync } from '../application/use-cases/reconcileSupabaseAsync';
import { validateSupabaseAsync } from '../application/use-cases/validateSupabaseAsync';
import { createSupabaseWorkloads } from '../domain/createSupabaseWorkloads';
import { resolveSupabaseDesiredState } from '../domain/resolveSupabaseDesiredState';

/***
 * Create the canonical runtime-neutral Supabase platform adapter.
 *
 * The provider contributes portable workloads and reconciles Supabase-owned API resources after
 * the selected runtime is ready. Resolved bootstrap secrets never cross the execution boundary.
 *
 * @readme
 */
export function createInfraAdapter(options: SupabaseAdapterOptions = {}): InfraServiceAdapter {
  const controlPlane = options.controlPlane ?? createFetchSupabaseControlPlane();
  return {
    descriptor: infraAdapterDescriptor,
    validateAsync: (context) => validateSupabaseAsync(context),
    planAsync: (context) => Promise.resolve(planSupabase(context)),
    desiredWorkloadsAsync: (context) => {
      const desired = resolveSupabaseDesiredState(context);
      return Promise.resolve(
        desired.ok
          ? { ok: true, value: createSupabaseWorkloads(context), diagnostics: [] }
          : desired,
      );
    },
    reconcileAsync: (context, runtimeOutputs) =>
      reconcileSupabaseAsync(controlPlane, context, runtimeOutputs),
    statusAsync: (context) => getSupabaseStatusAsync(controlPlane, context),
    destroyAsync: (context, request) => destroySupabaseAsync(controlPlane, context, request),
  };
}
