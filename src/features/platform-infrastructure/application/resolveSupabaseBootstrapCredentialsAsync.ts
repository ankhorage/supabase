import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';

import type { SupabaseBootstrapCredentials } from '../../../types/supabase';
import { SUPABASE_BOOTSTRAP_CREDENTIAL } from '../constants/supabase';

/*** Resolve and validate the execution-only Supabase bootstrap credential bundle. */
export async function resolveSupabaseBootstrapCredentialsAsync(
  context: InfraExecutionContext,
): Promise<InfraResult<SupabaseBootstrapCredentials>> {
  const resolved = await context.credentials.resolveAsync(SUPABASE_BOOTSTRAP_CREDENTIAL);
  if (!resolved.ok) return resolved;
  const credentials = readCredentials(resolved.value);
  if (!credentials.ok) return credentials;
  if (credentials.value.jwtSecret.length < 32) return weakCredential('jwtSecret', 32);
  if (credentials.value.realtimeSecretKeyBase.length < 64) {
    return weakCredential('realtimeSecretKeyBase', 64);
  }
  if (credentials.value.realtimeDatabaseEncryptionKey.length !== 16) {
    return exactLengthCredential('realtimeDatabaseEncryptionKey', 16);
  }
  return credentials;
}

/*** Read every required field without using dynamic access to privileged values. */
function readCredentials(
  values: Readonly<Record<string, string>>,
): InfraResult<SupabaseBootstrapCredentials> {
  const {
    postgresPassword,
    jwtSecret,
    anonKey,
    serviceRoleKey,
    realtimeSecretKeyBase,
    realtimeDatabaseEncryptionKey,
  } = values;
  if (!postgresPassword) return missingCredential('postgresPassword');
  if (!jwtSecret) return missingCredential('jwtSecret');
  if (!anonKey) return missingCredential('anonKey');
  if (!serviceRoleKey) return missingCredential('serviceRoleKey');
  if (!realtimeSecretKeyBase) return missingCredential('realtimeSecretKeyBase');
  if (!realtimeDatabaseEncryptionKey) {
    return missingCredential('realtimeDatabaseEncryptionKey');
  }
  return {
    ok: true,
    value: {
      postgresPassword,
      jwtSecret,
      anonKey,
      serviceRoleKey,
      realtimeSecretKeyBase,
      realtimeDatabaseEncryptionKey,
    },
    diagnostics: [],
  };
}

/*** Report one missing credential field without exposing any credential values. */
function missingCredential(key: string): InfraResult<never> {
  return failure(
    'supabase-credential-missing',
    `Supabase bootstrap credential field ${key} is required.`,
  );
}

/*** Report one credential whose minimum length is not satisfied. */
function weakCredential(key: string, minimum: number): InfraResult<never> {
  return failure(
    'supabase-credential-invalid',
    `Supabase bootstrap credential field ${key} must contain at least ${minimum} characters.`,
  );
}

/*** Report one credential whose exact length is not satisfied. */
function exactLengthCredential(key: string, length: number): InfraResult<never> {
  return failure(
    'supabase-credential-invalid',
    `Supabase bootstrap credential field ${key} must contain exactly ${length} characters.`,
  );
}

/*** Create one sanitized bootstrap-credential failure. */
function failure(code: string, message: string): InfraResult<never> {
  return { ok: false, diagnostics: [{ severity: 'error', code, message }] };
}
