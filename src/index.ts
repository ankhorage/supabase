/** Public Supabase platform adapter package boundary. */
export { infraAdapterDescriptor } from './constants/infra';
export { createFetchSupabaseControlPlane } from './features/platform-infrastructure/adapters/outbound/createFetchSupabaseControlPlane';
export { createInfraAdapter } from './features/platform-infrastructure/composition/createInfraAdapter';
export type {
  SupabaseAdapterOptions,
  SupabaseControlPlane,
  SupabaseControlPlaneRequest,
} from './types/supabase';
