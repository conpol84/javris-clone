// Firbo Dark voice. Auth/organization boundaries stay on the server.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createSpeechHandler } from './handler.ts';
Deno.serve(createSpeechHandler({ createClient, env: name => Deno.env.get(name) }));
