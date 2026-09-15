import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';

import { resolveSupabaseDesiredState } from '../../domain/resolveSupabaseDesiredState';
import { resolveSupabaseBootstrapCredentialsAsync } from './resolveSupabaseBootstrapCredentialsAsync';
import { validateSupabasePersistenceCredentialsAsync } from './validateSupabasePersistenceCredentialsAsync';

/*** Validate Supabase selection, public origin, buckets and execution-only credentials. */
export async function validateSupabaseAsync(
  context: InfraExecutionContext,
): Promise<InfraResult<null>> {
  const desired = resolveSupabaseDesiredState(context);
  if (!desired.ok) return desired;
  const bootstrap = await resolveSupabaseBootstrapCredentialsAsync(context);
  if (!bootstrap.ok) return bootstrap;
  return validateSupabasePersistenceCredentialsAsync(context);
}
