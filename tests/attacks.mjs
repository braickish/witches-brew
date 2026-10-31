// Tries to cheat against the real server. Every attack must fail, and leaves nothing on the board.
// Run with: npm run test:live
import '../supabase/functions/_shared/rules.js';

const { LAST_TIER, Ledger } = globalThis.BrewRules;
const URL_BASE = 'https://dcbuizimphwlnajjtsfe.supabase.co';
const KEY = 'sb_publishable_Na-sJqr3aMiFiS-svgMBOQ_SViqUyt5';
const REST = { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };

let failures = 0;
function check(label, passed, detail = '') {
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!passed) failures++;
}

async function fn(name, body) {
  const res = await fetch(`${URL_BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const rest = (path, method = 'GET', body) =>
  fetch(`${URL_BASE}/rest/v1/${path}`, { method, headers: REST, body: body && JSON.stringify(body) });

// A believable game for this seed, with the merges all legal and the timing faked.
function fakeGame(seed, drops) {
  const ledger = new Ledger(seed);
  let tick = 0;
  for (let i = 0; i < drops; i++) {
    tick += 30;
    ledger.drop(tick);
    for (let t = 0; t <= LAST_TIER; t++) while (ledger.counts[t] >= 2) ledger.merge(tick, t);
  }
  return ledger;
}

const newRun = async () => (await fn('start-run', {})).data;
const before = await (await rest('scores?select=id')).json();

// ---- The public key should still be able to read the board ----
check('can read the board', (await rest('scores?select=id,name,score')).status === 200);

// ---- Writing to the database directly with the public key ----
const insert = await rest('scores', 'POST', { run_id: crypto.randomUUID(), name: 'Cheater', score: 999999, game_ms: 1, events: [] });
check('cannot insert a score directly', insert.status === 401 || insert.status === 403, `HTTP ${insert.status}`);
const update = await rest('scores?id=not.is.null', 'PATCH', { score: 999999 });
check('cannot change scores', [401, 403].includes(update.status), `HTTP ${update.status}`);
const del = await rest('scores?id=not.is.null', 'DELETE');
check('cannot delete scores', [401, 403].includes(del.status), `HTTP ${del.status}`);

// ---- Reading what should stay private ----
check('cannot read games or seeds', [401, 403].includes((await rest('runs?select=*')).status));
check('cannot read the hidden flag', [400, 401, 403].includes((await rest('scores?select=hidden')).status));
check('cannot read stored game logs', [400, 401, 403].includes((await rest('scores?select=events')).status));

// ---- Calling the database functions directly ----
for (const [name, args] of [
  ['record_score', { p_run_id: crypto.randomUUID(), p_name: 'Cheater', p_score: 999999, p_game_ms: 1, p_events: [] }],
  ['claim_run', { p_run_id: crypto.randomUUID() }],
  ['issue_run', { p_seed: 1, p_ip_hash: null }],
]) {
  const res = await rest(`rpc/${name}`, 'POST', args);
  check(`cannot call ${name} directly`, res.status >= 400, `HTTP ${res.status}`);
}

// ---- Posting to the submit function ----
let run = await newRun();
check('the server hands out games', Boolean(run.id) && Number.isInteger(run.seed));

let res = await fn('submit-score', { runId: run.id, name: 'Cheater', score: 999999, events: [] });
check('sending a score with no game fails', res.status === 422, res.data.error);

res = await fn('submit-score', { runId: crypto.randomUUID(), name: 'Cheater', events: fakeGame(1, 10).events });
check('a made-up game id fails', res.status === 409, res.data.error);

run = await newRun();
res = await fn('submit-score', { runId: run.id, name: 'Cheater', events: [[0, LAST_TIER], [1, LAST_TIER]] });
check('merging moons that were never dropped fails', res.status === 422, res.data.error);

run = await newRun();
res = await fn('submit-score', { runId: run.id, name: 'Cheater', events: fakeGame(run.seed + 1, 50).events });
check('a game from another seed fails', res.status === 422, res.data.error);

run = await newRun();
const tooFast = fakeGame(run.seed, 200).events;
res = await fn('submit-score', { runId: run.id, name: 'Cheater', events: tooFast });
check('a 100-second game sent straight away fails', res.status === 422, res.data.error);

// Five tries and that game is used up, even with a valid-looking request.
run = await newRun();
for (let i = 0; i < 5; i++) await fn('submit-score', { runId: run.id, name: 'Cheater', events: tooFast });
res = await fn('submit-score', { runId: run.id, name: 'Cheater', events: [] });
check('a game runs out of attempts', res.status === 409, res.data.error);

// ---- Names ----
run = await newRun();
for (const name of ['fuck', 'h1tl3r', 'f u c k', 'n1gger', '<script>x', 'way too long a name']) {
  res = await fn('submit-score', { runId: run.id, name, events: [] });
  check(`name refused: ${name}`, res.status === 422 && res.data.error.startsWith('name_'), res.data.error);
}

const after = await (await rest('scores?select=id')).json();
check('nothing reached the board', after.length === before.length, `${before.length} -> ${after.length}`);

console.log(failures ? `\n${failures} FAILED` : '\nAll attacks failed, as they should.');
process.exit(failures ? 1 : 0);
