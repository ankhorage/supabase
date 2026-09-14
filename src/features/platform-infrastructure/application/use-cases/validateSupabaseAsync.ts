import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';

import { resolveSupabaseDesiredState } from '../../domain/resolveSupabaseDesiredState';
import { resolveSupabaseBootstrapCredentialsAsync } from './resolveSupabaseBootstrapCredentialsAsync';

/*** Validate Supabase selection, public origin, buckets and bootstrap credentials without mutation. */
export async function validateSupabaseAsync(
  context: InfraExecutionContext,
): Promise<InfraResult<null>> {
  const desired = resolveSupabaseDesiredState(context);
  if (!desired.ok) return desired;
  const credentials = await resolveSupabaseBootstrapCredentialsAsync(context);
  return credentials.ok ? { ok: true, value: null, diagnostics: [] } : credentials;
}
