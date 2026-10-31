// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import '../supabase/functions/_shared/rules.js';

const { DROP_WEIGHTS, LAST_TIER, Ledger, replay } = globalThis.BrewRules;

// Plays a pretend game that merges whenever it can, the way the real cauldron eventually would.
function playGame(seed, drops) {
  const ledger = new Ledger(seed);
  let tick = 0;
  for (let i = 0; i < drops; i++) {
    tick += 30;
    ledger.drop(tick);
    for (let t = 0; t <= LAST_TIER; t++) {
      while (ledger.counts[t] >= 2) ledger.merge((tick += 20), t);
    }
  }
  return ledger;
}

test('the ladder in ingredients.js matches the rules', () => {
  const context = {};
  vm.runInNewContext(`${readFileSync('ingredients.js', 'utf8')}; this.count = INGREDIENTS.length;`, context);
  assert.equal(context.count - 1, LAST_TIER);
});

test('the same seed gives the same ingredients', () => {
  const a = new Ledger(42);
  const b = new Ledger(42);
  for (let i = 0; i < 200; i++) {
    assert.equal(a.current, b.current);
    assert.ok(a.current < DROP_WEIGHTS.length);
    a.drop(i * 30);
    b.drop(i * 30);
  }
  assert.notDeepEqual(playGame(1, 50).events, playGame(2, 50).events);
});

test('a replay finds the same score the game did', () => {
  const game = playGame(7, 400);
  const result = replay(7, game.events);
  assert.equal(result.ok, true);
  assert.equal(result.score, game.score);
  assert.ok(game.score > 0);
});

test('points and combos', () => {
  const ledger = new Ledger(1);
  ledger.counts[0] = 4;
  ledger.counts[LAST_TIER] = 2;
  assert.deepEqual(ledger.merge(100, 0), { pts: 3, mult: 1 });
  assert.deepEqual(ledger.merge(153, 0), { pts: 6, mult: 2 });   // 53 ticks later: a combo
  assert.deepEqual(ledger.merge(207, 1), { pts: 6, mult: 1 });   // 54 ticks later: too slow
  assert.deepEqual(ledger.merge(1000, LAST_TIER), { pts: 100, mult: 1 });
});

test('rejects a game from a different seed', () => {
  const game = playGame(7, 100);
  assert.equal(replay(8, game.events).ok, false);
});

test('rejects merging ingredients that were never dropped', () => {
  assert.equal(replay(1, [[0, LAST_TIER]]).ok, false);
  const repeated = Array.from({ length: 1000 }, (_, i) => [i, LAST_TIER]);
  assert.equal(replay(1, repeated).ok, false);
});

test('rejects dropping faster than the cooldown', () => {
  assert.equal(replay(1, [[100], [110]]).ok, false);
  assert.equal(replay(1, [[100], [126]]).ok, true);
});

test('rejects time running backwards and malformed events', () => {
  assert.equal(replay(1, [[100], [50]]).ok, false);
  for (const bad of ['nope', null, [[-1]], [['1']], [[1.5]], [[]], [[1, 2, 3]], [[1, -1]], [[1, 99]], [[1, 0.5]], ['x']]) {
    assert.equal(replay(1, bad).ok, false, JSON.stringify(bad));
  }
});
