import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createHandler } from './handler.ts';

// Public entry point; every document is authorized in the token/session-scoped RPC.
// Credentials stay in the Edge runtime and are never shipped to the Portal.
Deno.serve(createHandler({ createClient, env: (name: string) => Deno.env.get(name) }));
