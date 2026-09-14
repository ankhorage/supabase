import type { InfraExecutionContext, InfraOutput, InfraResult } from '@ankhorage/contracts/infra';

/*** Resolve the reachable runtime endpoint used for local Supabase control-plane operations. */
export function resolveSupabaseControlPlaneUrl(
  context: InfraExecutionContext,
  publicBaseUrl: string,
  runtimeOutputs: readonly InfraOutput[],
): InfraResult<string> {
  if (context.environment !== 'local') {
    return { ok: true, value: publicBaseUrl, diagnostics: [] };
  }
  const endpoint = runtimeOutputs.find(
    (output) =>
      output.owner.projectId === context.projectId &&
      output.owner.environment === context.environment &&
      output.owner.adapter === context.desired.deployment.runtime.provider &&
      isGatewayEndpoint(output),
  );
  const origin =
    endpoint?.visibility === 'public' && typeof endpoint.value === 'string'
      ? parseHttpOrigin(endpoint.value)
      : undefined;
  return origin === undefined
    ? missingRuntimeEndpoint()
    : { ok: true, value: origin, diagnostics: [] };
}

/*** Match the selected runtime's public output for the Supabase gateway workload. */
function isGatewayEndpoint(output: InfraOutput): boolean {
  return (
    (output.owner.resourceId === 'endpoint:supabase-gateway' && output.name === 'localUrl') ||
    (output.owner.resourceId === 'service:supabase-gateway' && output.name === 'endpoint')
  );
}

/*** Normalize one trusted HTTP endpoint to its origin. */
function parseHttpOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/*** Refuse local control-plane mutation until the runtime proves a reachable gateway endpoint. */
function missingRuntimeEndpoint(): InfraResult<never> {
  return {
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        code: 'supabase-runtime-endpoint-missing',
        message: 'The selected local runtime did not report a reachable Supabase gateway endpoint.',
      },
    ],
  };
}
