// The scoring rules. The game and the leaderboard server both run this exact file, so they always agree.
//
// A game is a list of events in the order they happened:
//   [tick]        an ingredient was dropped (which one is decided by the seed)
//   [tick, tier]  two ingredients of that tier brewed together
// A tick is one physics step, 60 per second.
//
// If you change anything here, redeploy the server (see AGENTS.md).
(() => {
  'use strict';

  const STEP_MS = 1000 / 60;
  const LAST_TIER = 10;                  // Blood Moon; must match the end of INGREDIENTS
  const COMBO_TICKS = 54;                // 900 ms: merges closer together than this are a combo
  const DROP_COOLDOWN_TICKS = 27;        // 450 ms between drops

  // How likely each droppable ingredient is to come up next. Only these can be dropped.
  const DROP_WEIGHTS = [30, 25, 20, 15, 10];

  const points = (tier) => ((tier + 1) * (tier + 2)) / 2;

  // A small seeded random number generator (mulberry32). Same seed, same numbers, on every device.
  function seededRandom(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Ledger {
    constructor(seed) {
      this.random = seededRandom(seed);
      this.score = 0;
      this.combo = 0;
      this.lastMergeTick = -Infinity;
      this.counts = new Array(LAST_TIER + 1).fill(0);    // what's in the cauldron
      this.events = [];
      this.current = this.roll();
      this.next = this.roll();
    }

    // Bigger ingredients come up more often as the score climbs.
    roll() {
      const ramp = Math.min(1, this.score / 4000);
      const weights = DROP_WEIGHTS.map((w, i) => w * (1 + ramp * i * 0.6));
      let roll = this.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll < 0) return i;
      }
      return 0;
    }

    drop(tick) {
      this.counts[this.current]++;
      this.events.push([tick]);
      this.current = this.next;
      this.next = this.roll();
    }

    merge(tick, tier) {
      this.combo = tick - this.lastMergeTick < COMBO_TICKS ? this.combo + 1 : 1;
      this.lastMergeTick = tick;
      const mult = Math.min(this.combo, 4);
      const pts = (tier === LAST_TIER ? 100 : points(tier + 1)) * mult;
      this.score += pts;
      this.counts[tier] -= 2;
      if (tier < LAST_TIER) this.counts[tier + 1]++;
      this.events.push([tick, tier]);
      return { pts, mult };
    }
  }

  // Plays a list of events back and works out the score, or says why the game couldn't have happened.
  function replay(seed, events) {
    if (!Array.isArray(events)) return { ok: false, reason: 'not a list' };
    const ledger = new Ledger(seed);
    let lastTick = 0;
    let lastDropTick = -Infinity;
    for (const event of events) {
      if (!Array.isArray(event) || event.length < 1 || event.length > 2) return { ok: false, reason: 'bad event' };
      const [tick, tier] = event;
      if (!Number.isSafeInteger(tick) || tick < lastTick) return { ok: false, reason: 'bad tick' };
      lastTick = tick;
      if (event.length === 1) {
        // One tick of slack: the game's own cooldown can land either side of a step.
        if (tick - lastDropTick < DROP_COOLDOWN_TICKS - 1) return { ok: false, reason: 'dropped too fast' };
        lastDropTick = tick;
        ledger.drop(tick);
      } else {
        if (!Number.isInteger(tier) || tier < 0 || tier > LAST_TIER) return { ok: false, reason: 'bad tier' };
        if (ledger.counts[tier] < 2) return { ok: false, reason: 'merged ingredients that were not there' };
        ledger.merge(tick, tier);
      }
    }
    return { ok: true, score: ledger.score, gameMs: lastTick * STEP_MS };
  }

  globalThis.BrewRules = { DROP_WEIGHTS, LAST_TIER, STEP_MS, Ledger, replay };
})();
