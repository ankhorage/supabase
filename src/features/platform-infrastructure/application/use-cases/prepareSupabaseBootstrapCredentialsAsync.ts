import { createHmac, randomBytes } from 'node:crypto';

import type { InfraExecutionContext, InfraResult } from '@ankhorage/contracts/infra';

import type { SupabaseBootstrapCredentials } from '../../../../types/supabase';
import { SUPABASE_BOOTSTRAP_CREDENTIAL } from '../../constants/supabase';
import { validateSupabaseBootstrapCredentials } from '../../utils/validateSupabaseBootstrapCredentials';
import { resolveSupabaseBootstrapCredentialsAsync } from './resolveSupabaseBootstrapCredentialsAsync';

const SUPABASE_JWT_LIFETIME_SECONDS = 5 * 365 * 24 * 60 * 60;

/*** Provision one missing local bootstrap bundle while reusing every valid existing credential. */
export async function prepareSupabaseBootstrapCredentialsAsync(
  context: InfraExecutionContext,
): Promise<InfraResult<null>> {
  const found = await context.credentials.findAsync(SUPABASE_BOOTSTRAP_CREDENTIAL);
  if (!found.ok) return found;
  if (found.value !== null) {
    const validated = validateSupabaseBootstrapCredentials(found.value);
    return validated.ok ? success() : validated;
  }
  if (context.environment !== 'local') {
    const required = await resolveSupabaseBootstrapCredentialsAsync(context);
    return required.ok ? success() : required;
  }
  const generated = generateSupabaseBootstrapCredentials();
  const persisted = await context.credentials.persistAsync(SUPABASE_BOOTSTRAP_CREDENTIAL, {
    ...generated,
  });
  if (!persisted.ok) return persisted;
  const resolved = await resolveSupabaseBootstrapCredentialsAsync(context);
  return resolved.ok ? success() : resolved;
}

/*** Generate one cryptographically random provider-owned Supabase bootstrap bundle. */
function generateSupabaseBootstrapCredentials(): SupabaseBootstrapCredentials {
  const issuedAt = Math.floor(Date.now() / 1000);
  const jwtSecret = randomBytes(30).toString('base64');
  return {
    postgresPassword: randomBytes(24).toString('hex'),
    jwtSecret,
    anonKey: signSupabaseJwt(jwtSecret, 'anon', issuedAt),
    serviceRoleKey: signSupabaseJwt(jwtSecret, 'service_role', issuedAt),
    realtimeSecretKeyBase: randomBytes(48).toString('base64'),
    realtimeDatabaseEncryptionKey: randomBytes(8).toString('hex'),
    pgMetaCryptoKey: randomBytes(24).toString('base64'),
  };
}

/*** Sign one legacy Supabase HS256 API token from the generated JWT secret. */
function signSupabaseJwt(secret: string, role: 'anon' | 'service_role', issuedAt: number): string {
  const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJwtPart({
    role,
    iss: 'supabase',
    iat: issuedAt,
    exp: issuedAt + SUPABASE_JWT_LIFETIME_SECONDS,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

/*** Serialize one JWT object using unpadded base64url encoding. */
function encodeJwtPart(value: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/*** Return one successful preparation result without exposing credential values. */
function success(): InfraResult<null> {
  return { ok: true, value: null, diagnostics: [] };
}
