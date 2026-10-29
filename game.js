// Witch's Brew: drop ingredients into the cauldron; two of a kind brew into the next one.
(() => {
  'use strict';

  const { Engine, Body, Composite, Events, Vertices } = Matter;
  const TAU = Math.PI * 2;

  // ---- Layout, in game units. The canvas is scaled to fit the screen. ----
  const W = 540;
  const H = 700;
  const CX = W / 2;
  const WALL_L = 75;                     // inside edges of the cauldron
  const WALL_R = 465;
  const INSIDE_W = WALL_R - WALL_L;
  const RIM_Y = 170;                     // the boil-over line
  const FLOOR_Y = 555;                   // the flat bottom of the cauldron
  const DROP_Y = 82;
  const WALL_T = 40;
  const INK = '#0a0610';

  // ---- Rules ----
  const STEP = 1000 / 60;
  const DROP_COOLDOWN = 450;
  const OVER_LIMIT = 2000;               // ms an ingredient may sit above the rim
  const LIQUID_LIMIT = 1500;             // ms the brew may sit at the rim
  const STIR_TIME = 1700;
  const STIR_CENTER_Y = 420;
  const STIR_MAX_SPEED = 9;
  const LAST = INGREDIENTS.length - 1;

  // ---- The brew ----
  // There's a fixed amount of liquid. Anything under the surface pushes it up,
  // so the fuller the cauldron, the higher the brew.
  const LIQUID_START_Y = 355;
  const LIQUID_AREA = INSIDE_W * (FLOOR_Y - LIQUID_START_Y);
  const BUOYANCY = 0.35;                 // how much of gravity the brew cancels when fully under
  const BREW_DRAG = 0.025;

  // ---- The spoon ----
  // It leans against the cauldron. Click it once to stir; then it's gone.
  const SPOON_LEN = 530;
  const SPOON_BOWL = { x: WALL_R + 50, y: 648 };
  const SPOON_TOP = { x: WALL_R + 16, y: RIM_Y - 52 };

  const params = new URLSearchParams(location.search);
  const AUTOPLAY = params.has('autoplay');      // the game plays itself (for testing)
  const SHOW_SHAPES = params.has('shapes');     // outline each ingredient's physics shape

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');
  const scoreEl = $('score');
  const bestEl = $('best');
  const muteBtn = $('mute-btn');
  const titlePanel = $('title-panel');
  const overPanel = $('over-panel');
  const grimoireEl = $('grimoire');

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---- Ingredient shapes ----
  // Each ingredient's physics shape is traced from its picture: the outline of its
  // visible pixels, shrink-wrapped (a convex hull) and trimmed to a few corners.
  const TRACE = 160;                     // px canvas the picture is traced on
  const TRACE_PX = 100;                  // px size of the picture inside it
  const MAX_CORNERS = 14;
  const SPRITE_RES = 3;
  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

  // Some devices draw newer emoji (like the black cat) as two separate pictures; use the fallback there.
  function glyphFor(ing) {
    if (!ing.fallback) return ing.emoji;
    const g = document.createElement('canvas').getContext('2d');
    g.font = `100px ${EMOJI_FONT}`;
    return g.measureText(ing.emoji).width > g.measureText(ing.fallback).width * 1.5 ? ing.fallback : ing.emoji;
  }

  function drawPicture(g, ing, picture, center, px) {
    if (picture) {
      const s = px / Math.max(picture.width, picture.height);
      g.drawImage(picture, center - (picture.width * s) / 2, center - (picture.height * s) / 2, picture.width * s, picture.height * s);
    } else {
      g.font = `${px}px ${EMOJI_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ing.glyph, center, center + px * 0.08);
    }
  }

  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  // Drop the corners that matter least until only a few are left.
  function simplify(hull) {
    const pts = hull.slice();
    const tri = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    while (pts.length > MAX_CORNERS) {
      let best = 0;
      let bestArea = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = tri(pts[(i - 1 + pts.length) % pts.length], pts[i], pts[(i + 1) % pts.length]);
        if (a < bestArea) {
          bestArea = a;
          best = i;
        }
      }
      pts.splice(best, 1);
    }
    return pts;
  }

  function polygonStats(pts) {
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const c = a.x * b.y - b.x * a.y;
      area += c;
      cx += (a.x + b.x) * c;
      cy += (a.y + b.y) * c;
    }
    area /= 2;
    return { area: Math.abs(area), cx: cx / (6 * area), cy: cy / (6 * area) };
  }

  function traceOutline(ing, picture) {
    const c = document.createElement('canvas');
    c.width = c.height = TRACE;
    const g = c.getContext('2d', { willReadFrequently: true });
    drawPicture(g, ing, picture, TRACE / 2, TRACE_PX);
    let data;
    try {
      data = g.getImageData(0, 0, TRACE, TRACE).data;
    } catch {
      return null;
    }
    const pts = [];
    for (let y = 0; y < TRACE; y++) {
      let left = -1, right = -1;
      for (let x = 0; x < TRACE; x++) {
        if (data[(y * TRACE + x) * 4 + 3] > 64) {
          if (left < 0) left = x;
          right = x;
        }
      }
      if (left < 0) continue;
      const y0 = y - TRACE / 2;
      const l = left - TRACE / 2, r = right + 1 - TRACE / 2;
      pts.push({ x: l, y: y0 }, { x: l, y: y0 + 1 }, { x: r, y: y0 }, { x: r, y: y0 + 1 });
    }
    return pts.length >= 6 ? simplify(convexHull(pts)) : null;
  }

  function circleOutline(radius) {
    return Array.from({ length: 12 }, (_, i) => ({ x: Math.cos((i / 12) * TAU) * radius, y: Math.sin((i / 12) * TAU) * radius }));
  }

  function makeCanvas(w, h = w) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function buildShape(ing, picture) {
    const hull = traceOutline(ing, picture) || circleOutline(TRACE_PX * 0.45);
    const { area, cx, cy } = polygonStats(hull);
    // Size it so its area matches a circle of radius r, without letting long shapes get too long.
    const reach = Math.max(...hull.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    const s = Math.min(Math.sqrt((Math.PI * ing.r * ing.r) / area), (ing.r * 1.4) / reach);
    const verts = hull.map((p) => ({ x: (p.x - cx) * s, y: (p.y - cy) * s }));

    // The picture as a sticker: a soft glow in its color, an ink outline, then the picture.
    const box = TRACE * s;
    const size = Math.ceil(box * SPRITE_RES);
    const glyph = makeCanvas(size);
    const gg = glyph.getContext('2d');
    drawPicture(gg, ing, picture, size / 2, TRACE_PX * s * SPRITE_RES);
    if (ing.tint) {
      gg.globalCompositeOperation = 'source-atop';
      gg.globalAlpha = 0.55;
      gg.fillStyle = ing.tint;
      gg.fillRect(0, 0, size, size);
    }
    const ink = makeCanvas(size);
    const ig = ink.getContext('2d');
    ig.drawImage(glyph, 0, 0);
    ig.globalCompositeOperation = 'source-in';
    ig.fillStyle = INK;
    ig.fillRect(0, 0, size, size);

    const sprite = makeCanvas(size);
    const g = sprite.getContext('2d');
    g.shadowColor = ing.color;
    g.shadowBlur = 9 * SPRITE_RES;
    g.drawImage(ink, 0, 0);
    g.shadowColor = 'transparent';
    const o = 1.8 * SPRITE_RES;
    for (let i = 0; i < 12; i++) g.drawImage(ink, Math.cos((i / 12) * TAU) * o, Math.sin((i / 12) * TAU) * o);
    g.drawImage(glyph, 0, 0);

    const xs = verts.map((p) => p.x), ys = verts.map((p) => p.y);
    return {
      verts,
      sprite,
      box,
      offX: -cx * s,                     // where the picture's center sits relative to the body
      offY: -cy * s,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  for (const ing of INGREDIENTS) ing.glyph = glyphFor(ing);
  const shapes = INGREDIENTS.map((ing) => buildShape(ing));

  // Swap in hand-drawn pictures once they load.
  INGREDIENTS.forEach((ing, i) => {
    if (!ing.image) return;
    const img = new Image();
    img.onload = () => {
      shapes[i] = buildShape(ing, img);
      renderGrimoire();
    };
    img.src = ing.image;
  });

  // ---- Physics ----
  const engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
  engine.gravity.y = 1;

  function buildCauldron() {
    const opts = { isStatic: true, friction: 0.3, restitution: 0.1, label: 'wall' };
    const rect = (x, y, w, h) => Matter.Bodies.rectangle(x, y, w, h, opts);
    const top = -100;
    const bottom = FLOOR_Y + WALL_T;
    return [
      rect(WALL_L - WALL_T / 2, (top + bottom) / 2, WALL_T, bottom - top),
      rect(WALL_R + WALL_T / 2, (top + bottom) / 2, WALL_T, bottom - top),
      rect(CX, FLOOR_Y + WALL_T / 2, INSIDE_W + WALL_T * 2, WALL_T),
      // An invisible lid above the screen so nothing can fly out.
      rect(CX, -WALL_T / 2, W + WALL_T * 2, WALL_T),
    ];
  }

  Composite.add(engine.world, buildCauldron());

  // ---- Game state ----
  let state = 'title';                   // 'title' | 'playing' | 'over'
  let now = 0;
  const ingredients = new Set();
  let mergeQueue = [];
  let particles = [];
  let floaters = [];
  let bubbles = [];
  let score = 0;
  let best = load('brew-best', 0);
  const discovered = load('brew-discovered-2', INGREDIENTS.map((_, i) => i < DROP_WEIGHTS.length));
  let current = 0;
  let next = 0;
  let aimX = CX;
  let canDropAt = 0;
  let spoon = 'leaning';                 // 'leaning' | 'stirring' | 'gone'
  let stirLeft = 0;
  let stirDir = 1;
  let stirPhase = 0;
  let graceUntil = 0;
  let liquidY = LIQUID_START_Y;
  let liquidOverSince = null;
  let danger = 0;
  let shake = 0;
  let combo = 0;
  let lastMergeAt = -1e9;
  const keys = { left: false, right: false };

  // Bigger ingredients come up more often as the score climbs.
  function randomTier() {
    const ramp = Math.min(1, score / 4000);
    const weights = DROP_WEIGHTS.map((w, i) => w * (1 + ramp * i * 0.6));
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll < 0) return i;
    }
    return 0;
  }

  // k < 1 makes it start smaller and swell up to full size.
  function makeIngredient(tier, x, y, k = 1) {
    const verts = shapes[tier].verts.map((p) => ({ x: p.x * k, y: p.y * k }));
    const body = Body.create({
      position: { x, y },
      vertices: Vertices.clockwiseSort(verts),
      restitution: 0.1,
      friction: 0.4,
      frictionStatic: 0.6,
      frictionAir: 0.008,
      density: 0.0012,
      label: 'ingredient',
    });
    body.tier = tier;
    body.k = k;
    body.born = now;
    body.overSince = null;
    body.merging = false;
    Composite.add(engine.world, body);
    ingredients.add(body);
    return body;
  }

  function removeIngredient(body) {
    Composite.remove(engine.world, body);
    ingredients.delete(body);
  }

  function onCollide(e) {
    if (state !== 'playing') return;
    for (const { bodyA: a, bodyB: b } of e.pairs) {
      if (a.tier === undefined || a.tier !== b.tier || a.merging || b.merging) continue;
      a.merging = b.merging = true;
      mergeQueue.push([a, b]);
    }
  }
  Events.on(engine, 'collisionStart', onCollide);
  Events.on(engine, 'collisionActive', onCollide);

  function newGame() {
    for (const b of ingredients) Composite.remove(engine.world, b);
    ingredients.clear();
    mergeQueue = [];
    floaters = [];
    score = 0;
    spoon = 'leaning';
    stirLeft = 0;
    combo = 0;
    danger = 0;
    liquidY = LIQUID_START_Y;
    liquidOverSince = null;
    current = randomTier();
    next = randomTier();
    canDropAt = now + 250;
    graceUntil = now + 500;
    state = 'playing';
    titlePanel.classList.add('hidden');
    overPanel.classList.add('hidden');
    updateHud();
  }

  function heldX() {
    const sh = shapes[current];
    return clamp(aimX, WALL_L - sh.minX + 1, WALL_R - sh.maxX - 1);
  }

  function drop() {
    if (state !== 'playing' || now < canDropAt || stirLeft > 0) return;
    makeIngredient(current, heldX(), DROP_Y);
    current = next;
    next = randomTier();
    canDropAt = now + DROP_COOLDOWN;
    Sound.plop();
  }

  function stir() {
    if (state !== 'playing' || spoon !== 'leaning' || ingredients.size === 0) return;
    spoon = 'stirring';
    stirLeft = STIR_TIME;
    stirDir = -stirDir;
    graceUntil = now + STIR_TIME + 1500;
    shake = Math.max(shake, 4);
    burst(SPOON_TOP.x, SPOON_TOP.y + 40, '#d7b3ff', 18, 3);
    Sound.stir();
  }

  // The stir pushes everything around the middle of the cauldron and lifts it a little,
  // so the pile churns and new neighbours meet.
  function applyStir() {
    const env = Math.sin(Math.PI * (1 - stirLeft / STIR_TIME));
    stirPhase += 0.1 * stirDir * (0.3 + env);
    for (const b of ingredients) {
      const dx = b.position.x - CX;
      const dy = b.position.y - STIR_CENTER_Y;
      const d = Math.hypot(dx, dy) || 1;
      const m = b.mass * env;
      Body.applyForce(b, b.position, {
        x: (-dy / d) * stirDir * 0.0013 * m + rand(-0.0002, 0.0002) * m,
        y: (dx / d) * stirDir * 0.0013 * m - 0.0006 * m,
      });
      Body.setAngularVelocity(b, b.angularVelocity + rand(-0.01, 0.01) * env);
      const v = b.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed > STIR_MAX_SPEED) Body.setVelocity(b, { x: (v.x / speed) * STIR_MAX_SPEED, y: (v.y / speed) * STIR_MAX_SPEED });
    }
    stirLeft -= STEP;
    if (stirLeft <= 0) {
      stirLeft = 0;
      spoon = 'gone';
      const p = spoonPose();
      burst(p.bowl.x, p.bowl.y - 60, '#d7b3ff', 30, 4);
    }
  }

  // ---- The brew level ----
  // Area of the part of a shape that's below the surface line.
  function areaBelow(verts, level) {
    let area = 0;
    let first = null, prev = null;
    const add = (p) => {
      if (prev) area += prev.x * p.y - p.x * prev.y;
      else first = p;
      prev = p;
    };
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const aIn = a.y >= level, bIn = b.y >= level;
      if (aIn) add(a);
      if (aIn !== bIn) {
        const t = (level - a.y) / (b.y - a.y);
        add({ x: a.x + (b.x - a.x) * t, y: level });
      }
    }
    if (prev && first) area += prev.x * first.y - first.x * prev.y;
    return Math.abs(area) / 2;
  }

  function submerged(b, level) {
    if (b.bounds.max.y <= level) return 0;
    if (b.bounds.min.y >= level) return b.area;
    return areaBelow(b.vertices, level);
  }

  function updateLiquid() {
    // The level depends on how much is under it, which depends on the level, so settle it in a few passes.
    let level = liquidY;
    for (let i = 0; i < 4; i++) {
      let under = 0;
      for (const b of ingredients) under += submerged(b, level);
      level = FLOOR_Y - (LIQUID_AREA + under) / INSIDE_W;
    }
    liquidY += (level - liquidY) * 0.06;

    // Things in the brew float a little and move slowly.
    for (const b of ingredients) {
      const frac = submerged(b, liquidY) / b.area;
      if (!frac) continue;
      Body.applyForce(b, b.position, { x: 0, y: -b.mass * 0.001 * BUOYANCY * frac });
      const drag = 1 - BREW_DRAG * frac;
      Body.setVelocity(b, { x: b.velocity.x * drag, y: b.velocity.y * drag });
      Body.setAngularVelocity(b, b.angularVelocity * drag);
    }
  }

  function points(tier) {
    return ((tier + 1) * (tier + 2)) / 2;
  }

  function processMerges() {
    for (const [a, b] of mergeQueue) {
      if (!ingredients.has(a) || !ingredients.has(b)) continue;
      removeIngredient(a);
      removeIngredient(b);
      const tier = a.tier;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      combo = now - lastMergeAt < 900 ? combo + 1 : 1;
      lastMergeAt = now;
      const mult = Math.min(combo, 4);

      if (tier === LAST) {
        addScore(100 * mult, x, y);
        burst(x, y, '#ffd76a', 70, 8);
        burst(x, y, INGREDIENTS[tier].tint, 50, 5);
        floater(x, y - 40, 'The potion is complete!', '#ffd76a', 28);
        shake = 16;
        Sound.finale();
        continue;
      }

      const nt = tier + 1;
      // The new ingredient starts at the old size and swells up, so it doesn't blow the pile apart.
      const body = makeIngredient(nt, x, y, INGREDIENTS[tier].r / INGREDIENTS[nt].r);
      body.born = now - 500;
      Body.setAngle(body, a.angle);
      Body.setVelocity(body, {
        x: (a.velocity.x + b.velocity.x) / 2,
        y: Math.min(0, (a.velocity.y + b.velocity.y) / 2) - 1.5,
      });
      addScore(points(nt) * mult, x, y);
      burst(x, y, INGREDIENTS[nt].color, 14 + nt * 3, 2 + nt * 0.35);
      Sound.merge(nt);
      if (nt >= 7) shake = Math.max(shake, nt - 2);
      if (combo >= 2) floater(x, y - INGREDIENTS[nt].r - 28, `Combo ×${mult}!`, '#ff8a2a', 22);

      if (!discovered[nt]) {
        discovered[nt] = true;
        save('brew-discovered-2', discovered);
        renderGrimoire();
        floater(x, y - INGREDIENTS[nt].r - 6, `New: ${INGREDIENTS[nt].name}!`, '#b6ff7a', 24);
        Sound.discover();
      }
    }
    mergeQueue = [];
  }

  function addScore(pts, x, y) {
    score += pts;
    floater(x, y, `+${pts}`, '#ffffff', 20);
    updateHud();
  }

  // Boil-over happens when an ingredient stays above the rim, or the brew itself reaches it.
  function checkOverflow() {
    danger = 0;
    const calm = now < graceUntil;
    for (const b of ingredients) {
      const over = b.bounds.min.y < RIM_Y && now - b.born > 900;
      if (!over || calm) {
        b.overSince = null;
        continue;
      }
      if (b.overSince === null) b.overSince = now;
      danger = Math.max(danger, (now - b.overSince) / OVER_LIMIT);
    }
    if (!calm && liquidY <= RIM_Y + 2) {
      if (liquidOverSince === null) liquidOverSince = now;
      danger = Math.max(danger, (now - liquidOverSince) / LIQUID_LIMIT);
    } else {
      liquidOverSince = null;
    }
    if (danger >= 1) gameOver();
  }

  function gameOver() {
    state = 'over';
    const isBest = score > best;
    if (isBest) {
      best = score;
      save('brew-best', best);
    }
    for (let x = WALL_L; x <= WALL_R; x += 12) {
      particles.push({ x, y: RIM_Y, vx: rand(-1.5, 1.5), vy: rand(-4, -1), g: 0.12, drag: 0.98, life: 1200, max: 1200, size: rand(3, 7), color: '#9dff6a' });
    }
    $('final-score').textContent = score;
    $('new-best').classList.toggle('hidden', !isBest);
    overPanel.classList.remove('hidden');
    Sound.over();
    updateHud();
    if (AUTOPLAY) setTimeout(newGame, 2500);
  }

  // ---- Effects ----
  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(0.3, 1) * speed;
      const life = rand(400, 900);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, g: 0.06, drag: 0.96, life, max: life, size: rand(2, 5), color });
    }
  }

  function floater(x, y, text, color, size) {
    floaters.push({ x: clamp(x, 110, W - 110), y, text, color, size, life: 1200, max: 1200 });
  }

  function surfaceY(x, t) {
    const amp = 3 + (stirLeft > 0 ? 8 : 0);
    return liquidY + Math.sin(x * 0.035 + t * 1.7) * amp + Math.sin(x * 0.08 - t * 2.6) * amp * 0.5;
  }

  function updateEffects() {
    const t = now / 1000;

    // embers drifting up from the fire
    if (Math.random() < 0.15) {
      particles.push({ x: CX + rand(-90, 90), y: 640, vx: rand(-0.6, 0.6), vy: rand(-2.6, -1.6), g: 0, drag: 0.99, life: 700, max: 700, size: rand(1.5, 2.5), color: '#ffd27a', fire: true });
    }

    // bubbles rising through the brew, faster as it nears the rim
    const boil = clamp((RIM_Y + 80 - liquidY) / 80, 0, 1);
    if (Math.random() < (stirLeft > 0 ? 0.6 : 0.18 + boil * 0.5)) {
      const x = rand(WALL_L + 12, WALL_R - 12);
      bubbles.push({ x, y: rand(Math.min(liquidY + 20, FLOOR_Y - 10), FLOOR_Y - 5), r: rand(2, 6), vy: rand(-1, -0.4), wob: Math.random() * TAU });
    }
    for (const b of bubbles) {
      b.y += b.vy;
      b.wob += 0.1;
      b.x += Math.sin(b.wob) * 0.3;
      if (b.y <= surfaceY(b.x, t)) {
        b.popped = true;
        particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, g: 0, drag: 1, life: 250, max: 250, size: b.r, color: '#b6ff8a', ring: true });
        if (Math.random() < 0.06) Sound.blip();
      }
    }
    bubbles = bubbles.filter((b) => !b.popped);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= STEP;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const f of floaters) {
      f.y -= 0.6;
      f.life -= STEP;
    }
    floaters = floaters.filter((f) => f.life > 0);

    shake *= 0.9;
    if (shake < 0.2) shake = 0;
  }

  // ---- Main loop ----
  function step() {
    now += STEP;

    if (AUTOPLAY && state === 'playing') autoplay();
    if (keys.left) aimX -= 6;
    if (keys.right) aimX += 6;
    aimX = clamp(aimX, WALL_L, WALL_R);

    if (state === 'playing' && stirLeft > 0) applyStir();

    for (const b of ingredients) {
      if (b.k < 0.999) {
        const s = Math.min(1 / b.k, 1.06);
        Body.scale(b, s, s);
        b.k *= s;
      }
    }

    updateLiquid();
    Engine.update(engine, STEP);
    processMerges();
    if (state === 'playing') checkOverflow();
    updateEffects();
  }

  let last = performance.now();
  let acc = 0;
  function frame(ts) {
    acc += Math.min(ts - last, 100);
    last = ts;
    while (acc >= STEP) {
      step();
      acc -= STEP;
    }
    render();
    requestAnimationFrame(frame);
  }

  function autoplay() {
    if (now >= canDropAt && stirLeft <= 0) {
      aimX = rand(WALL_L, WALL_R);
      drop();
    }
    if (ingredients.size > 15 && Math.random() < 0.003) stir();
  }

  // ---- Hand-drawn artwork ----
  // The cauldron, legs, logs and spoon are sketched with rough.js once, onto their own
  // canvases, and reused every frame. Fixed seeds keep the wobbles the same each time.
  const OUTER_D = `M ${WALL_L - 14} ${RIM_Y}
    C ${WALL_L - 48} ${RIM_Y + 100}, ${WALL_L - 44} ${FLOOR_Y - 40}, ${WALL_L - 8} ${FLOOR_Y + 18}
    Q ${CX} ${FLOOR_Y + 36}, ${WALL_R + 8} ${FLOOR_Y + 18}
    C ${WALL_R + 44} ${FLOOR_Y - 40}, ${WALL_R + 48} ${RIM_Y + 100}, ${WALL_R + 14} ${RIM_Y} Z`;
  const INSIDE_D = `M ${WALL_L} ${RIM_Y} L ${WALL_L} ${FLOOR_Y - 10} Q ${WALL_L} ${FLOOR_Y} ${WALL_L + 10} ${FLOOR_Y}
    L ${WALL_R - 10} ${FLOOR_Y} Q ${WALL_R} ${FLOOR_Y} ${WALL_R} ${FLOOR_Y - 10} L ${WALL_R} ${RIM_Y}`;
  const OUTER = new Path2D(OUTER_D);
  const INSIDE = new Path2D(INSIDE_D + ' Z');

  let bodyArt = null;
  let frontArt = null;
  let spoonArt = null;

  function rotRect(cx, cy, w, h, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  }

  function artCanvas(f) {
    const c = makeCanvas(Math.ceil(W * f), Math.ceil(H * f));
    const g = c.getContext('2d');
    g.scale(f, f);
    return [c, g, rough.canvas(c)];
  }

  function buildArt(f) {
    let g, rc;

    // Behind the brew: logs, legs, the iron pot and its dark inside.
    [bodyArt, g, rc] = artCanvas(f);

    const logs = [[CX - 22, 660, 240, 20, 0.08, 11], [CX + 26, 668, 230, 20, -0.07, 12]];
    for (const [x, y, w, h, a, seed] of logs) {
      const pts = rotRect(x, y, w, h, a);
      rc.polygon(pts, { fill: '#6b4325', fillStyle: 'solid', stroke: INK, strokeWidth: 2.2, roughness: 1.4, seed });
      rc.polygon(pts, { fill: '#3d2414', fillStyle: 'hachure', hachureAngle: (a * 180) / Math.PI, hachureGap: 5, fillWeight: 0.9, stroke: 'none', seed: seed + 10 });
      const end = [x + (w / 2) * Math.cos(a), y + (w / 2) * Math.sin(a)];
      rc.ellipse(end[0], end[1], 12, h, { fill: '#c58f58', fillStyle: 'solid', stroke: INK, strokeWidth: 1.6, seed: seed + 20 });
      rc.ellipse(end[0], end[1], 5, h * 0.45, { stroke: '#6b4325', strokeWidth: 1, seed: seed + 30 });
    }

    for (const sx of [-1, 1]) {
      const leg = [[CX + sx * 118, FLOOR_Y + 4], [CX + sx * 164, FLOOR_Y + 4], [CX + sx * 170, 646], [CX + sx * 184, 660], [CX + sx * 140, 662], [CX + sx * 146, 646]];
      rc.polygon(leg, { fill: '#221e29', fillStyle: 'solid', stroke: INK, strokeWidth: 2.5, roughness: 1.2, seed: sx + 40 });
      rc.polygon(leg, { fill: 'rgba(0, 0, 0, 0.5)', fillStyle: 'hachure', hachureAngle: 70, hachureGap: 5, stroke: 'none', seed: sx + 50 });
    }

    rc.path(OUTER_D, { fill: '#2c2737', fillStyle: 'solid', stroke: 'none', seed: 1 });
    g.save();
    g.clip(OUTER);
    const shadeGrad = g.createLinearGradient(WALL_L - 50, 0, WALL_R + 50, 0);
    shadeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    shadeGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.1)');
    shadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    g.fillStyle = shadeGrad;
    g.fillRect(0, 0, W, H);
    g.beginPath();
    g.rect(CX, 0, W, H);
    g.rect(0, FLOOR_Y - 10, W, H);
    g.clip();
    rc.path(OUTER_D, { fill: 'rgba(0, 0, 0, 0.45)', fillStyle: 'cross-hatch', hachureAngle: 50, hachureGap: 6, fillWeight: 1, stroke: 'none', seed: 2 });
    g.restore();
    rc.curve([[WALL_L - 30, RIM_Y + 40], [WALL_L - 38, RIM_Y + 150], [WALL_L - 34, FLOOR_Y - 90]], { stroke: 'rgba(255, 255, 255, 0.4)', strokeWidth: 2.5, roughness: 1.5, seed: 3 });
    rc.curve([[WALL_L + 30, FLOOR_Y + 22], [CX - 60, FLOOR_Y + 30]], { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 2, roughness: 1.5, seed: 4 });
    rc.path(OUTER_D, { stroke: INK, strokeWidth: 3.5, roughness: 1.3, bowing: 1.5, seed: 5 });

    g.fillStyle = '#0b0710';
    g.fill(INSIDE);

    // In front of everything in the pot: the inside's ink edge, the rim, the "next" circle.
    [frontArt, g, rc] = artCanvas(f);
    rc.path(INSIDE_D, { stroke: INK, strokeWidth: 3, roughness: 1, seed: 6 });
    for (const [x0, seed] of [[WALL_L - 32, 7], [WALL_R - 6, 8]]) {
      rc.rectangle(x0, RIM_Y - 13, 38, 26, { fill: '#4a4458', fillStyle: 'solid', stroke: INK, strokeWidth: 2.5, roughness: 1.1, seed });
      rc.line(x0 + 6, RIM_Y - 7, x0 + 30, RIM_Y - 8, { stroke: 'rgba(255, 255, 255, 0.45)', strokeWidth: 2, seed: seed + 10 });
    }
    rc.circle(W - 48, 58, 62, { fill: 'rgba(28, 17, 41, 0.85)', fillStyle: 'solid', stroke: '#4a3166', strokeWidth: 2, roughness: 1.3, seed: 9 });

    // The wooden spoon, drawn standing up with its bowl at (0, 0) and handle going up.
    const sw = 70, sh = SPOON_LEN + 50;
    spoonArt = makeCanvas(Math.ceil(sw * f), Math.ceil(sh * f));
    g = spoonArt.getContext('2d');
    g.scale(f, f);
    g.translate(sw / 2, SPOON_LEN + 25);
    rc = rough.canvas(spoonArt);
    const handle = [[-5, -SPOON_LEN], [5, -SPOON_LEN], [7, -18], [-7, -18]];
    rc.polygon(handle, { fill: '#a8703c', fillStyle: 'solid', stroke: INK, strokeWidth: 2, roughness: 1, seed: 20 });
    rc.line(-1, -SPOON_LEN + 20, 1, -40, { stroke: '#6b4325', strokeWidth: 1.2, seed: 21 });
    rc.line(3, -SPOON_LEN + 80, 3, -120, { stroke: '#6b4325', strokeWidth: 1, seed: 22 });
    rc.circle(0, -SPOON_LEN + 14, 6, { fill: '#2a1a0e', fillStyle: 'solid', stroke: INK, strokeWidth: 1, seed: 23 });
    rc.ellipse(0, 0, 46, 34, { fill: '#8a5a32', fillStyle: 'solid', stroke: INK, strokeWidth: 2.2, roughness: 1, seed: 24 });
    rc.ellipse(0, 2, 32, 22, { fill: '#5e3a1e', fillStyle: 'solid', stroke: 'rgba(10, 6, 16, 0.6)', strokeWidth: 1.2, seed: 25 });
    rc.curve([[-14, -8], [-6, -13], [4, -13]], { stroke: 'rgba(255, 240, 210, 0.5)', strokeWidth: 1.5, seed: 26 });
  }

  // ---- Drawing ----
  const FLAMES = Array.from({ length: 8 }, (_, i) => ({ x: CX - 98 + i * 28 + rand(-5, 5), w: rand(14, 20), h: rand(60, 95), phase: rand(0, TAU), speed: rand(5, 8) }));

  function flamePath(x, base, w, h, sway) {
    ctx.beginPath();
    ctx.moveTo(x - w, base);
    ctx.bezierCurveTo(x - w * 1.1, base - h * 0.45, x - w * 0.2 + sway * 0.5, base - h * 0.7, x + sway, base - h);
    ctx.bezierCurveTo(x + w * 0.2 + sway * 0.5, base - h * 0.7, x + w * 1.1, base - h * 0.45, x + w, base);
    ctx.closePath();
  }

  function drawFire(t) {
    // a soft shadow on the ground, squashed flat
    ctx.save();
    ctx.scale(1, 0.12);
    const shadow = ctx.createRadialGradient(CX, 672 / 0.12, 10, CX, 672 / 0.12, 260);
    shadow.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = shadow;
    ctx.fillRect(CX - 260, (672 - 40) / 0.12, 520, 80 / 0.12);
    ctx.restore();

    const layers = [[1, '#d9361a'], [0.68, '#ff8a1f'], [0.4, '#ffd04a']];
    const base = 664;
    for (const [k, color] of layers) {
      const shapesOf = FLAMES.map((f) => {
        const flick = 0.8 + 0.2 * Math.sin(t * f.speed + f.phase) + 0.1 * Math.sin(t * f.speed * 2.3 + f.phase * 2);
        return [f.x, f.w * (0.45 + 0.55 * k), f.h * k * flick, Math.sin(t * 3 + f.phase) * 7 * k];
      });
      if (k === 1) {
        ctx.strokeStyle = '#2a0b04';
        ctx.lineWidth = 4;
        for (const [x, w, h, sway] of shapesOf) {
          flamePath(x, base, w, h, sway);
          ctx.stroke();
        }
      }
      ctx.fillStyle = color;
      for (const [x, w, h, sway] of shapesOf) {
        flamePath(x, base, w, h, sway);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      if (!p.fire) continue;
      const k = p.life / p.max;
      ctx.globalAlpha = k * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * k, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // The brew turns from green to angry orange as it nears the rim.
  function brewColor(alpha) {
    const k = clamp((RIM_Y + 70 - liquidY) / 70, 0, 1);
    const mix = (a, b) => Math.round(a + (b - a) * k);
    return `rgba(${mix(79, 235)}, ${mix(191, 90)}, ${mix(58, 40)}, ${alpha})`;
  }

  function surfacePath(t) {
    ctx.beginPath();
    ctx.moveTo(WALL_L, H);
    for (let x = WALL_L; x <= WALL_R; x += 8) ctx.lineTo(x, surfaceY(x, t));
    ctx.lineTo(WALL_R, H);
    ctx.closePath();
  }

  function drawCauldron(t) {
    ctx.drawImage(bodyArt, 0, 0, W, H);

    // firelight flickering on the underside
    ctx.save();
    ctx.clip(OUTER);
    const flicker = 0.35 + 0.08 * Math.sin(t * 9) + 0.05 * Math.sin(t * 23);
    const under = ctx.createRadialGradient(CX, 640, 20, CX, 610, 200);
    under.addColorStop(0, `rgba(255, 110, 30, ${flicker})`);
    under.addColorStop(1, 'rgba(255, 110, 30, 0)');
    ctx.fillStyle = under;
    ctx.fillRect(0, RIM_Y, W, H);
    ctx.restore();

    ctx.save();
    ctx.clip(INSIDE);
    surfacePath(t);
    const brew = ctx.createLinearGradient(0, liquidY, 0, FLOOR_Y);
    brew.addColorStop(0, brewColor(1));
    brew.addColorStop(0.3, '#1f6b28');
    brew.addColorStop(1, '#0b2a14');
    ctx.fillStyle = brew;
    ctx.fill();
    ctx.restore();
  }

  // A see-through layer of brew over the ingredients, so they look sunk in it.
  function drawBrewFront(t) {
    ctx.save();
    ctx.clip(INSIDE);
    surfacePath(t);
    ctx.fillStyle = 'rgba(40, 150, 50, 0.18)';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = brewColor(0.95);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.strokeStyle = 'rgba(200, 255, 170, 0.6)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    if (stirLeft > 0) {
      const env = Math.sin(Math.PI * (1 - stirLeft / STIR_TIME));
      ctx.strokeStyle = `rgba(200, 255, 170, ${0.3 * env})`;
      ctx.lineWidth = 3;
      for (const [rad, len] of [[70, 1.6], [120, 1.2], [170, 0.9]]) {
        for (let k = 0; k < 2; k++) {
          const a0 = stirPhase * (220 / rad) + k * Math.PI;
          ctx.beginPath();
          ctx.arc(CX, STIR_CENTER_Y, rad, a0, a0 + len);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function drawRimLine() {
    const pulse = danger > 0 ? 0.5 + 0.5 * Math.sin(now / (120 - danger * 70)) : 0;
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2 + danger * 2;
    ctx.strokeStyle = danger > 0 ? `rgba(255, ${80 - pulse * 60}, 60, ${0.6 + pulse * 0.4})` : 'rgba(181, 120, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(WALL_L + 6, RIM_Y);
    ctx.lineTo(WALL_R - 6, RIM_Y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draws an ingredient with (x, y) at its body's center of mass.
  function drawShape(tier, x, y, angle = 0, k = 1) {
    const sh = shapes[tier];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(k, k);
    ctx.drawImage(sh.sprite, sh.offX - sh.box / 2, sh.offY - sh.box / 2, sh.box, sh.box);
    ctx.restore();
  }

  // Draws an ingredient's picture centered on (x, y), scaled to fit `fit` units across.
  function drawIcon(tier, x, y, fit) {
    const sh = shapes[tier];
    const s = fit / (INGREDIENTS[tier].r * 2);
    ctx.drawImage(sh.sprite, x - (sh.box * s) / 2, y - (sh.box * s) / 2, sh.box * s, sh.box * s);
  }

  function drawIngredients() {
    for (const b of ingredients) {
      drawShape(b.tier, b.position.x, b.position.y, b.angle, b.k);
      if (SHOW_SHAPES || b.overSince !== null) {
        const k = b.overSince === null ? 0 : (now - b.overSince) / OVER_LIMIT;
        ctx.beginPath();
        const v = b.vertices;
        ctx.moveTo(v[0].x, v[0].y);
        for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
        ctx.closePath();
        ctx.strokeStyle = b.overSince === null ? 'rgba(255, 255, 255, 0.6)' : `rgba(255, 60, 60, ${0.4 + 0.6 * Math.abs(Math.sin(now / 90)) * k})`;
        ctx.lineWidth = b.overSince === null ? 1 : 3;
        ctx.stroke();
      }
    }
  }

  // Roughly where a dropped ingredient would first touch something.
  function landingY(x) {
    let y = FLOOR_Y;
    for (const b of ingredients) {
      if (x > b.bounds.min.x && x < b.bounds.max.x) y = Math.min(y, b.bounds.min.y);
    }
    return y;
  }

  function drawHeld() {
    if (state !== 'playing') return;
    const x = heldX();
    const ready = now >= canDropAt && stirLeft <= 0;

    ctx.setLineDash([4, 8]);
    ctx.strokeStyle = 'rgba(220, 200, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, DROP_Y + shapes[current].maxY);
    ctx.lineTo(x, landingY(x));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = ready ? 1 : 0.4;
    drawShape(current, x, DROP_Y + Math.sin(now / 300) * 2);
    ctx.globalAlpha = 1;
  }

  // Where the spoon is: leaning on the pot, or swirling through the brew.
  function spoonPose() {
    const lean = { bowl: SPOON_BOWL, top: SPOON_TOP };
    if (spoon !== 'stirring') return lean;
    const tip = { x: CX + Math.cos(stirPhase) * 130, y: STIR_CENTER_Y + 10 + Math.sin(stirPhase) * 35 };
    const top = { x: CX + Math.cos(stirPhase) * 50 + 70, y: 20 };
    const k = clamp((STIR_TIME - stirLeft) / 300, 0, 1);
    const e = k * k * (3 - 2 * k);
    return {
      bowl: { x: lerp(lean.bowl.x, tip.x, e), y: lerp(lean.bowl.y, tip.y, e) },
      top: { x: lerp(lean.top.x, top.x, e), y: lerp(lean.top.y, top.y, e) },
    };
  }

  function drawSpoon() {
    if (spoon === 'gone') return;
    const { bowl, top } = spoonPose();
    ctx.save();
    if (spoon === 'stirring') ctx.globalAlpha = clamp(stirLeft / 300, 0, 1);
    ctx.translate(bowl.x, bowl.y);
    ctx.rotate(Math.atan2(top.x - bowl.x, bowl.y - top.y));
    ctx.drawImage(spoonArt, -35, -(SPOON_LEN + 25), 70, SPOON_LEN + 50);
    ctx.restore();

    // Now and then a little glint, for anyone paying attention.
    if (spoon === 'leaning' && state === 'playing') {
      const glint = Math.pow(Math.max(0, Math.sin(now / 900)), 12);
      if (glint > 0.02) {
        const gx = lerp(bowl.x, top.x, 0.82), gy = lerp(bowl.y, top.y, 0.82);
        ctx.globalAlpha = glint;
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU, r = i % 2 ? 2 : 9;
          ctx.lineTo(gx + Math.cos(a) * r, gy + Math.sin(a) * r);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function overSpoon(x, y) {
    if (spoon !== 'leaning') return false;
    const ax = SPOON_BOWL.x, ay = SPOON_BOWL.y, bx = SPOON_TOP.x, by = SPOON_TOP.y;
    const t = clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2), 0, 1);
    return Math.hypot(x - lerp(ax, bx, t), y - lerp(ay, by, t)) < 22;
  }

  function drawParticles() {
    for (const p of particles) {
      if (p.fire) continue;
      const k = p.life / p.max;
      ctx.globalAlpha = k;
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (2 - k), 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, (f.life / f.max) * 2);
      ctx.font = `${f.size}px Creepster, Grenze, fantasy`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10, 4, 18, 0.9)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawNext() {
    if (state !== 'playing') return;
    const x = W - 48, y = 58;
    drawIcon(next, x, y, 40);
    ctx.fillStyle = '#a594bd';
    ctx.font = '600 13px Grenze, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', x, y - 40);
  }

  function render() {
    const t = now / 1000;
    drawSky(t);
    ctx.clearRect(0, 0, W, H);
    if (!bodyArt) return;
    ctx.save();
    if (shake) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawFire(t);
    drawCauldron(t);
    drawIngredients();
    drawBrewFront(t);
    ctx.drawImage(frontArt, 0, 0, W, H);
    drawRimLine();
    drawHeld();
    drawSpoon();
    drawParticles();
    drawFloaters();
    drawNext();
    ctx.restore();
  }

  // ---- The night sky, drawn behind the whole page ----
  const sky = $('sky');
  const skyCtx = sky.getContext('2d');
  const skyStars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.5, 1.7), p: Math.random() * TAU }));
  const bats = Array.from({ length: 3 }, () => ({ x: -1, y: 0, vx: 0, s: 1, flap: 0, wait: rand(2, 12) }));
  let graveyard = null;
  let lastSkyT = 0;

  // A silhouette of hills, gravestones and a dead tree along the bottom of the page.
  function buildGraveyard(w, h, dpr) {
    graveyard = makeCanvas(Math.round(w * dpr), Math.round(h * dpr));
    const g = graveyard.getContext('2d');
    g.scale(dpr, dpr);
    const hill = (x) => h - 70 + Math.sin(x / 140) * 18 + Math.sin(x / 57 + 1) * 8;
    g.fillStyle = '#07040c';
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) g.lineTo(x, hill(x));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(120, 80, 170, 0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x <= w; x += 6) g.lineTo(x, hill(x));
    g.stroke();

    for (let x = 30; x < w; x += 70 + ((x * 7) % 60)) {
      const y = hill(x) + 4;
      const tall = 22 + ((x * 13) % 14);
      g.save();
      g.translate(x, y);
      g.rotate((((x * 31) % 20) - 10) / 100);
      if ((x * 17) % 3 === 0) {
        g.fillRect(-2.5, -tall - 6, 5, tall + 6);
        g.fillRect(-9, -tall + 2, 18, 5);
      } else {
        g.beginPath();
        g.moveTo(-9, 0);
        g.lineTo(-9, -tall + 9);
        g.arc(0, -tall + 9, 9, Math.PI, 0);
        g.lineTo(9, 0);
        g.fill();
      }
      g.restore();
    }

    const tx = w * 0.88, ty = hill(w * 0.88) + 4;
    g.strokeStyle = '#07040c';
    g.lineCap = 'round';
    const branch = (x, y, len, a, width) => {
      if (len < 6) return;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      branch(x2, y2, len * 0.7, a - 0.5, width * 0.65);
      branch(x2, y2, len * 0.62, a + 0.42, width * 0.65);
    };
    branch(tx, ty, 55, -Math.PI / 2 - 0.08, 9);
  }

  function resizeSky() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sky.width = Math.round(innerWidth * dpr);
    sky.height = Math.round(innerHeight * dpr);
    skyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildGraveyard(innerWidth, innerHeight, dpr);
  }

  function drawBat(x, y, s, flap) {
    const f = 1 + Math.sin(flap) * 0.7;
    skyCtx.beginPath();
    skyCtx.moveTo(x, y);
    for (const d of [-1, 1]) {
      skyCtx.moveTo(x, y);
      skyCtx.quadraticCurveTo(x + d * 6 * s, y - 8 * s * f, x + d * 16 * s, y - 4 * s * f);
      skyCtx.quadraticCurveTo(x + d * 12 * s, y - s, x + d * 11 * s, y + 2 * s);
      skyCtx.quadraticCurveTo(x + d * 8 * s, y, x + d * 6 * s, y + 3 * s);
      skyCtx.quadraticCurveTo(x + d * 3 * s, y + s, x, y + 3 * s);
      skyCtx.closePath();
    }
    skyCtx.fill();
  }

  function drawSky(t) {
    const w = innerWidth, h = innerHeight;
    const dt = Math.min(0.1, Math.max(0, t - lastSkyT));
    lastSkyT = t;
    const g = skyCtx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0d0716');
    g.addColorStop(0.6, '#1e1030');
    g.addColorStop(1, '#120a1c');
    skyCtx.fillStyle = g;
    skyCtx.fillRect(0, 0, w, h);

    skyCtx.fillStyle = '#e9dcff';
    for (const s of skyStars) {
      skyCtx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.5 + s.p);
      skyCtx.beginPath();
      skyCtx.arc(s.x * w, s.y * h, s.r, 0, TAU);
      skyCtx.fill();
    }
    skyCtx.globalAlpha = 1;

    // a crescent moon: a full moon with a bite clipped out of it
    const mx = Math.max(60, w * 0.16), my = Math.max(110, h * 0.17);
    const glow = skyCtx.createRadialGradient(mx, my, 10, mx, my, 80);
    glow.addColorStop(0, 'rgba(255, 240, 200, 0.22)');
    glow.addColorStop(1, 'rgba(255, 240, 200, 0)');
    skyCtx.fillStyle = glow;
    skyCtx.fillRect(mx - 80, my - 80, 160, 160);
    skyCtx.save();
    skyCtx.beginPath();
    skyCtx.rect(0, 0, w, h);
    skyCtx.arc(mx + 11, my - 6, 21, 0, TAU, true);
    skyCtx.clip('evenodd');
    skyCtx.fillStyle = '#f3e7c4';
    skyCtx.beginPath();
    skyCtx.arc(mx, my, 24, 0, TAU);
    skyCtx.fill();
    skyCtx.restore();

    skyCtx.fillStyle = '#05030a';
    for (const b of bats) {
      if (b.x < 0 || b.x > w + 40) {
        b.wait -= dt;
        if (b.wait > 0) continue;
        const fromLeft = Math.random() < 0.5;
        b.x = fromLeft ? 1 : w + 39;
        b.vx = (fromLeft ? 1 : -1) * rand(50, 110);
        b.y = rand(h * 0.08, h * 0.45);
        b.s = rand(0.7, 1.3);
        b.wait = rand(6, 16);
      }
      b.x += b.vx * dt;
      b.flap += dt * 14;
      drawBat(b.x, b.y + Math.sin(b.flap * 0.3) * 6, b.s, b.flap);
    }

    if (graveyard) skyCtx.drawImage(graveyard, 0, 0, w, h);
  }

  // ---- HUD ----
  function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = Math.max(best, score);
    muteBtn.textContent = Sound.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', Sound.muted ? 'Sound off' : 'Sound on');
  }

  function renderGrimoire() {
    grimoireEl.replaceChildren(...INGREDIENTS.map((ing, i) => {
      const img = document.createElement('img');
      img.src = shapes[i].sprite.toDataURL();
      img.alt = discovered[i] ? ing.name : 'Undiscovered';
      img.title = discovered[i] ? ing.name : '???';
      if (!discovered[i]) img.className = 'locked';
      return img;
    }));
  }

  function resize() {
    const box = stage.getBoundingClientRect();
    const scale = Math.min(box.width / W, box.height / H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    buildArt(canvas.width / W);
  }

  // ---- Input ----
  function logical(e) {
    const box = canvas.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H };
  }

  let pointerDown = false;
  canvas.addEventListener('pointermove', (e) => {
    const p = logical(e);
    aimX = p.x;
    canvas.style.cursor = overSpoon(p.x, p.y) ? 'pointer' : 'crosshair';
  });
  canvas.addEventListener('pointerdown', (e) => {
    Sound.unlock();
    const p = logical(e);
    if (state === 'playing' && overSpoon(p.x, p.y)) {
      stir();
      return;
    }
    aimX = p.x;
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (pointerDown) {
      aimX = logical(e).x;
      drop();
    }
    pointerDown = false;
  });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  window.addEventListener('keydown', (e) => {
    Sound.unlock();
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = true;
    else if (k === 'arrowright' || k === 'd') keys.right = true;
    else if (k === ' ' || k === 'enter' || k === 'arrowdown') {
      e.preventDefault();
      if (state === 'playing') drop();
      else if (!e.repeat) newGame();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = false;
    if (k === 'arrowright' || k === 'd') keys.right = false;
  });

  muteBtn.addEventListener('click', () => {
    Sound.unlock();
    Sound.setMuted(!Sound.muted);
    updateHud();
  });
  $('restart-btn').addEventListener('click', () => {
    if (state === 'playing' && score > 0 && !confirm('Pour out this brew and start over?')) return;
    Sound.unlock();
    newGame();
  });
  $('start-btn').addEventListener('click', () => { Sound.unlock(); newGame(); });
  $('again-btn').addEventListener('click', () => { Sound.unlock(); newGame(); });

  // ---- Start ----
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resizeSky);
  resize();
  resizeSky();
  renderGrimoire();
  updateHud();
  if (AUTOPLAY) {
    window.brewDebug = () => {
      let top = FLOOR_Y, solid = 0;
      for (const b of ingredients) { top = Math.min(top, b.bounds.min.y); solid += b.area; }
      return { liquidY: Math.round(liquidY), pileTop: Math.round(top), n: ingredients.size, solid: Math.round(solid), state, spoon };
    };
    newGame();
  }
  requestAnimationFrame(frame);
})();
