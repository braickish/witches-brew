// Takes a name and a game's event list, works out the score itself, and adds it to the leaderboard.
// Nothing sent here says what the score is: a score only exists if the events add up to one.
import { createClient } from '@supabase/supabase-js';
import { json, preflight } from '../_shared/http.js';
import { cleanName, isOffensive } from '../_shared/names.js';
import '../_shared/rules.js';

const { replay } = globalThis.BrewRules;
const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

const MAX_BODY = 1_000_000;
const CLOCK_SLACK_MS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function submit(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) return json(req, 413, { error: 'too_big' });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(req, 400, { error: 'bad_request' });
  }
  const { runId, name: rawName, events } = body ?? {};
  if (typeof runId !== 'string' || !UUID.test(runId)) return json(req, 400, { error: 'bad_request' });

  // The name comes first, and doesn't use up an attempt, so a rejected name can simply be changed.
  const name = cleanName(rawName);
  if (!name) return json(req, 422, { error: 'name_format' });
  if (isOffensive(name)) return json(req, 422, { error: 'name_rejected' });

  const { data: claimed, error: claimError } = await db.rpc('claim_run', { p_run_id: runId });
  if (claimError) throw claimError;
  const run = claimed?.[0];
  if (!run) return json(req, 409, { error: 'run_unavailable' });

  const result = replay(Number(run.seed), events);
  if (!result.ok) {
    console.warn('rejected game', runId, result.reason);
    return json(req, 422, { error: 'invalid_game' });
  }
  if (result.score <= 0) return json(req, 422, { error: 'invalid_game' });
  const elapsedMs = Date.now() - new Date(run.created_at).getTime();
  if (result.gameMs > elapsedMs + CLOCK_SLACK_MS) {
    console.warn('rejected game', runId, 'claimed more time than has passed');
    return json(req, 422, { error: 'invalid_game' });
  }

  const { data: recorded, error: recordError } = await db.rpc('record_score', {
    p_run_id: runId,
    p_name: name,
    p_score: result.score,
    p_game_ms: Math.round(result.gameMs),
    p_events: events,
  });
  if (recordError?.message.includes('run_used')) return json(req, 409, { error: 'run_unavailable' });
  if (recordError?.message.includes('not_top')) return json(req, 409, { error: 'not_top', score: result.score });
  if (recordError) throw recordError;
  return json(req, 200, { id: recorded[0].entry_id, rank: recorded[0].entry_rank, name, score: result.score });
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  try {
    return await submit(req);
  } catch (error) {
    console.error(error);
    return json(req, 500, { error: 'server_error' });
  }
});
