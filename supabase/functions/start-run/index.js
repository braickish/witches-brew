// Hands out a one-time game: an id and the seed that decides the order of the ingredients.
import { createClient } from '@supabase/supabase-js';
import { json, preflight } from '../_shared/http.js';

const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

// Only used to slow down anyone asking for games too quickly. Salted, and deleted with the game after a day.
async function hashIp(req) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  if (!ip) return null;
  const bytes = new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') + ip);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const seed = crypto.getRandomValues(new Int32Array(1))[0];
  const { data, error } = await db.rpc('issue_run', { p_seed: seed, p_ip_hash: await hashIp(req) });
  if (error?.message.includes('too_many_runs')) return json(req, 429, { error: 'too_many_runs' });
  if (error) {
    console.error(error);
    return json(req, 500, { error: 'server_error' });
  }
  return json(req, 200, { id: data, seed });
});
