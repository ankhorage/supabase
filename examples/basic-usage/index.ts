import { createInfraAdapter, infraAdapterDescriptor } from '@ankhorage/supabase';

const adapter = createInfraAdapter();

console.log(infraAdapterDescriptor.id, adapter.descriptor.package);
