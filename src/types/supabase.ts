import type { InfraOwnedResource, InfraResult } from '@ankhorage/contracts/infra';

export interface SupabaseControlPlaneRequest {
  readonly baseUrl: string;
  readonly serviceRoleKey: string;
  readonly signal?: AbortSignal;
}

export interface SupabaseControlPlane {
  healthAsync(request: SupabaseControlPlaneRequest): Promise<InfraResult<null>>;
  listBucketsAsync(request: SupabaseControlPlaneRequest): Promise<InfraResult<readonly string[]>>;
  createBucketAsync(
    request: SupabaseControlPlaneRequest & { readonly bucket: string },
  ): Promise<InfraResult<null>>;
  deleteBucketAsync(
    request: SupabaseControlPlaneRequest & { readonly bucket: string },
  ): Promise<InfraResult<null>>;
}

export interface SupabaseAdapterOptions {
  readonly controlPlane?: SupabaseControlPlane;
}

export interface SupabaseBootstrapCredentials {
  readonly postgresPassword: string;
  readonly jwtSecret: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
  readonly realtimeSecretKeyBase: string;
  readonly realtimeDatabaseEncryptionKey: string;
  readonly pgMetaCryptoKey: string;
}

export interface SupabaseDesiredState {
  readonly baseUrl: string;
  readonly platform: InfraOwnedResource;
  readonly buckets: readonly InfraOwnedResource[];
}
