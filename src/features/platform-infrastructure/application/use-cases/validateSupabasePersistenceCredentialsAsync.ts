import type {
  InfraControlPlaneCredentialRef,
  InfraExecutionContext,
  InfraResult,
  InfraS3PersistenceTarget,
} from '@ankhorage/contracts/infra';

/*** Validate every selected S3 persistence credential without serializing its resolved values. */
export async function validateSupabasePersistenceCredentialsAsync(
  context: InfraExecutionContext,
): Promise<InfraResult<null>> {
  const references = uniqueReferences(resolveTargets(context).map(({ credentials }) => credentials));
  const results = await Promise.all(
    references.map(async (reference) => validateCredentialAsync(context, reference)),
  );
  return results.find((result) => !result.ok) ?? { ok: true, value: null, diagnostics: [] };
}

/*** Collect database-backup and Storage-backend S3 targets from the selected Supabase platform. */
function resolveTargets(context: InfraExecutionContext): readonly InfraS3PersistenceTarget[] {
  const backup =
    context.desired.database?.provider === 'supabase' ? context.desired.database.backup : undefined;
  const backend =
    context.desired.objectStorage?.provider === 'supabase'
      ? context.desired.objectStorage.backend
      : undefined;
  return [backup?.target, backend].filter(
    (target): target is InfraS3PersistenceTarget => target !== undefined,
  );
}

/*** Deduplicate control-plane references without mutating shared credential state. */
function uniqueReferences(
  references: readonly InfraControlPlaneCredentialRef[],
): readonly InfraControlPlaneCredentialRef[] {
  return references.filter(
    (reference, index) =>
      references.findIndex((candidate) => candidate.name === reference.name) === index,
  );
}

/*** Resolve and validate one S3 access-key credential bundle. */
async function validateCredentialAsync(
  context: InfraExecutionContext,
  reference: InfraControlPlaneCredentialRef,
): Promise<InfraResult<null>> {
  const resolved = await context.credentials.resolveAsync(reference);
  if (!resolved.ok) return resolved;
  const { accessKeyId, secretAccessKey } = resolved.value;
  return isNonEmptyText(accessKeyId) && isNonEmptyText(secretAccessKey)
    ? { ok: true, value: null, diagnostics: [] }
    : {
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'supabase-s3-credentials-invalid',
            message: `Supabase S3 persistence credential "${reference.name}" must provide accessKeyId and secretAccessKey.`,
          },
        ],
      };
}

/*** Accept one non-empty credential field without exposing its value in diagnostics. */
function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
