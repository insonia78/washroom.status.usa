import { createClient } from '@supabase/supabase-js';
import { gatewayAuthFetch } from './gateway-auth-fetch.ts';

let client: ReturnType<typeof createClient> | null = null;

export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { global: { fetch: gatewayAuthFetch } });
  return client;
}
