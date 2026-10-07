// Isolated type/syntax check only; this SDK stub is not production code.
// Full Supabase SDK + Deno runtime checking remains a separate deployment gate.
declare namespace Deno {
  namespace env { function get(name: string): string | undefined; }
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
declare module 'npm:@supabase/supabase-js@2' {
  export function createClient(...args: any[]): any;
}
