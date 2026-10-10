// First-party FIRBO company-memory owner review. JWT is verified by Supabase
// before entry and independently by the handler. No provider/model requests.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createCompanyMemoryHandler } from './handler.ts';
Deno.serve(createCompanyMemoryHandler({createClient,env:key=>Deno.env.get(key)}));
