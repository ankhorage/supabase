import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';

import type { SupabaseBootstrapCredentials } from '../../../../types/supabase';
import { SUPABASE_BOOTSTRAP_CREDENTIAL } from '../../constants/supabase';
import { validateSupabaseBootstrapCredentials } from '../../utils/validateSupabaseBootstrapCredentials';

/*** Resolve and validate the execution-only Supabase bootstrap credential bundle. */
export async function resolveSupabaseBootstrapCredentialsAsync(
  context: InfraExecutionContext,
): Promise<InfraResult<SupabaseBootstrapCredentials>> {
  const resolved = await context.credentials.resolveAsync(SUPABASE_BOOTSTRAP_CREDENTIAL);
  return resolved.ok ? validateSupabaseBootstrapCredentials(resolved.value) : resolved;
}
