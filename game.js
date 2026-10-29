// Witch's Brew: drop ingredients into the cauldron; two of a kind brew into the next one.
(() => {
  'use strict';

  const { Engine, Bodies, Body, Composite, Events } = Matter;
  const TAU = Math.PI * 2;

  // ---- Layout, in game units. The canvas is scaled to fit the screen. ----
  const W = 480;
  const H = 700;
  const CX = W / 2;
  const WALL_L = 45;                     // inside edges of the cauldron
  const WALL_R = 435;
  const RIM_Y = 170;                     // the boil-over line
  const FLOOR_Y = 555;                   // the flat bottom of the cauldron
  const LIQUID_Y = 290;
  const DROP_Y = 82;
  const WALL_T = 40;

  // ---- Rules ----
  const STEP = 1000 / 60;
  const DROP_COOLDOWN = 450;
  const OVER_LIMIT = 2500;               // ms an ingredient may sit above the rim
  const STIR_TIME = 1700;
  const STIR_MAX = 3;
  const STIR_REWARD_TIER = 6;            // brewing a Skull or better earns a stir back
  const STIR_CENTER_Y = 420;
  const STIR_MAX_SPEED = 9;
  const LAST = INGREDIENTS.length - 1;

  const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');
  const scoreEl = $('score');
  const bestEl = $('best');
  const stirBtn = $('stir-btn');
  const chargesEl = $('stir-charges');
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

  // ---- Ingredient sprites, drawn once and reused every frame ----
  const SPRITE_RES = 3;
  const SPRITE_PAD = 2;

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const target = amt < 0 ? 0 : 255;
    const a = Math.abs(amt);
    const ch = (s) => Math.round(((n >> s) & 255) * (1 - a) + target * a);
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
  }

  function makeSprite(ing, picture) {
    const r = ing.r;
    const size = Math.ceil((r + SPRITE_PAD) * 2 * SPRITE_RES);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.scale(SPRITE_RES, SPRITE_RES);
    g.translate(r + SPRITE_PAD, r + SPRITE_PAD);

    const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, shade(ing.color, 0.35));
    grad.addColorStop(0.6, ing.color);
    grad.addColorStop(1, shade(ing.color, -0.5));
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fillStyle = grad;
    g.fill();

    if (picture) {
      g.save();
      g.beginPath();
      g.arc(0, 0, r * 0.94, 0, TAU);
      g.clip();
      const s = Math.max((2 * r) / picture.width, (2 * r) / picture.height);
      g.drawImage(picture, -picture.width * s / 2, -picture.height * s / 2, picture.width * s, picture.height * s);
      g.restore();
    } else {
      const glyph = emojiCanvas(ing, r * 1.25);
      g.drawImage(glyph, -glyph.width / SPRITE_RES / 2, -glyph.height / SPRITE_RES / 2, glyph.width / SPRITE_RES, glyph.height / SPRITE_RES);
    }

    // a little shine
    g.beginPath();
    g.ellipse(-r * 0.35, -r * 0.5, r * 0.32, r * 0.16, -0.5, 0, TAU);
    g.fillStyle = 'rgba(255, 255, 255, 0.22)';
    g.fill();

    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.lineWidth = Math.max(1.5, r * 0.06);
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    g.stroke();
    return c;
  }

  function emojiCanvas(ing, px) {
    const size = Math.ceil(px * 1.5 * SPRITE_RES);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.font = `${px * SPRITE_RES}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ing.emoji, size / 2, size / 2 + px * 0.08 * SPRITE_RES);
    if (ing.tint) {
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 0.55;
      g.fillStyle = ing.tint;
      g.fillRect(0, 0, size, size);
    }
    return c;
  }

  const sprites = INGREDIENTS.map((ing) => makeSprite(ing));

  // Swap in hand-drawn pictures once they load.
  INGREDIENTS.forEach((ing, i) => {
    if (!ing.image) return;
    const img = new Image();
    img.onload = () => {
      sprites[i] = makeSprite(ing, img);
      renderGrimoire();
    };
    img.src = ing.image;
  });

  // ---- Physics ----
  const engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
  engine.gravity.y = 1;

  function buildCauldron() {
    const opts = { isStatic: true, friction: 0.2, restitution: 0.1, label: 'wall' };
    const top = -100;
    const bottom = FLOOR_Y + WALL_T;
    return [
      Bodies.rectangle(WALL_L - WALL_T / 2, (top + bottom) / 2, WALL_T, bottom - top, opts),
      Bodies.rectangle(WALL_R + WALL_T / 2, (top + bottom) / 2, WALL_T, bottom - top, opts),
      Bodies.rectangle(CX, FLOOR_Y + WALL_T / 2, WALL_R - WALL_L + WALL_T * 2, WALL_T, opts),
      // An invisible lid above the screen so nothing can fly out.
      Bodies.rectangle(CX, -WALL_T / 2, W + WALL_T * 2, WALL_T, opts),
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
  const discovered = load('brew-discovered', INGREDIENTS.map((_, i) => i < DROP_WEIGHTS.length));
  let current = 0;
  let next = 0;
  let aimX = CX;
  let canDropAt = 0;
  let stirs = STIR_MAX;
  let stirLeft = 0;
  let stirDir = 1;
  let stirPhase = 0;
  let graceUntil = 0;
  let danger = 0;
  let shake = 0;
  let combo = 0;
  let lastMergeAt = -1e9;
  const keys = { left: false, right: false };

  function randomTier() {
    const total = DROP_WEIGHTS.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < DROP_WEIGHTS.length; i++) {
      roll -= DROP_WEIGHTS[i];
      if (roll < 0) return i;
    }
    return 0;
  }

  function makeIngredient(tier, x, y, startR = INGREDIENTS[tier].r) {
    const body = Bodies.circle(x, y, startR, {
      restitution: 0.12,
      friction: 0.25,
      frictionStatic: 0.4,
      frictionAir: 0.008,
      density: 0.0012,
      label: 'ingredient',
    });
    body.tier = tier;
    body.born = now;
    body.overSince = null;
    body.merging = false;
    body.targetR = INGREDIENTS[tier].r;
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
    stirs = STIR_MAX;
    stirLeft = 0;
    combo = 0;
    danger = 0;
    current = randomTier();
    next = randomTier();
    canDropAt = now + 250;
    graceUntil = now + 500;
    state = 'playing';
    titlePanel.classList.add('hidden');
    overPanel.classList.add('hidden');
    updateHud();
  }

  function drop() {
    if (state !== 'playing' || now < canDropAt || stirLeft > 0) return;
    const r = INGREDIENTS[current].r;
    const x = clamp(aimX, WALL_L + r + 1, WALL_R - r - 1);
    const body = makeIngredient(current, x, DROP_Y);
    Body.setAngle(body, rand(-0.3, 0.3));
    current = next;
    next = randomTier();
    canDropAt = now + DROP_COOLDOWN;
    Sound.plop();
  }

  function stir() {
    if (state !== 'playing' || stirs <= 0 || stirLeft > 0 || ingredients.size === 0) return;
    stirs--;
    stirLeft = STIR_TIME;
    stirDir = -stirDir;
    graceUntil = now + STIR_TIME + 1500;
    shake = Math.max(shake, 4);
    Sound.stir();
    updateHud();
  }

  // The stir pushes everything around the middle of the bowl and lifts it a little,
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
      const v = b.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed > STIR_MAX_SPEED) Body.setVelocity(b, { x: (v.x / speed) * STIR_MAX_SPEED, y: (v.y / speed) * STIR_MAX_SPEED });
    }
    stirLeft -= STEP;
    if (stirLeft <= 0) {
      stirLeft = 0;
      updateHud();
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
      // The new ingredient starts at the old size and swells up, so it doesn't explode the pile.
      const body = makeIngredient(nt, x, y, INGREDIENTS[tier].r);
      body.born = now - 500;
      Body.setAngle(body, (a.angle + b.angle) / 2);
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
        save('brew-discovered', discovered);
        renderGrimoire();
        floater(x, y - INGREDIENTS[nt].r - 6, `New: ${INGREDIENTS[nt].name}!`, '#b6ff7a', 24);
        Sound.discover();
      }

      if (nt >= STIR_REWARD_TIER && stirs < STIR_MAX) {
        stirs++;
        floater(x, y + 24, '+1 Stir', '#d7b3ff', 22);
        updateHud();
      }
    }
    mergeQueue = [];
  }

  function addScore(pts, x, y) {
    score += pts;
    floater(x, y, `+${pts}`, '#ffffff', 20);
    updateHud();
  }

  function checkOverflow() {
    danger = 0;
    const calm = now < graceUntil;
    for (const b of ingredients) {
      const over = b.position.y - b.circleRadius < RIM_Y && now - b.born > 900;
      if (!over || calm) {
        b.overSince = null;
        continue;
      }
      if (b.overSince === null) b.overSince = now;
      const t = (now - b.overSince) / OVER_LIMIT;
      danger = Math.max(danger, t);
      if (t >= 1) {
        gameOver();
        return;
      }
    }
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
    floaters.push({ x: clamp(x, 90, W - 90), y, text, color, size, life: 1200, max: 1200 });
  }

  function surfaceY(x, t) {
    const amp = 3 + (stirLeft > 0 ? 8 : 0);
    return LIQUID_Y + Math.sin(x * 0.035 + t * 1.7) * amp + Math.sin(x * 0.08 - t * 2.6) * amp * 0.5;
  }

  function updateEffects() {
    const t = now / 1000;

    // the fire under the cauldron, with the odd ember
    for (let i = 0; i < 3; i++) {
      const life = rand(350, 750);
      particles.push({ x: CX + rand(-105, 105), y: 655, vx: rand(-0.3, 0.3), vy: rand(-2.2, -1.1), g: 0, drag: 1, life, max: life, size: rand(6, 13), color: FLAME_COLORS[Math.floor(Math.random() * FLAME_COLORS.length)], fire: true });
    }
    if (Math.random() < 0.08) {
      particles.push({ x: CX + rand(-90, 90), y: 650, vx: rand(-0.8, 0.8), vy: rand(-3, -2), g: 0, drag: 0.99, life: 900, max: 900, size: rand(1.5, 2.5), color: '#ffd27a', fire: true });
    }

    // bubbles rising through the brew
    if (Math.random() < (stirLeft > 0 ? 0.6 : 0.18)) {
      const x = rand(WALL_L + 12, WALL_R - 12);
      bubbles.push({ x, y: FLOOR_Y - rand(10, 40), r: rand(2, 6), vy: rand(-1, -0.4), wob: Math.random() * TAU });
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
      if (b.circleRadius < b.targetR - 0.01) {
        const s = Math.min(b.targetR / b.circleRadius, 1.12);
        Body.scale(b, s, s);
      }
    }

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

  // A test mode: open the page with ?autoplay and it plays itself.
  function autoplay() {
    if (now >= canDropAt && stirLeft <= 0) {
      aimX = rand(WALL_L, WALL_R);
      drop();
    }
    if (stirs > 0 && ingredients.size > 25 && Math.random() < 0.003) stir();
  }

  // ---- Drawing ----
  const FLAME_COLORS = ['#ff3b1a', '#ff5a1f', '#ff7a22', '#ff9a2e', '#ffc04a'];

  function interiorPath() {
    const cr = 10;
    ctx.beginPath();
    ctx.moveTo(WALL_L, RIM_Y);
    ctx.lineTo(WALL_L, FLOOR_Y - cr);
    ctx.arcTo(WALL_L, FLOOR_Y, WALL_L + cr, FLOOR_Y, cr);
    ctx.lineTo(WALL_R - cr, FLOOR_Y);
    ctx.arcTo(WALL_R, FLOOR_Y, WALL_R, FLOOR_Y - cr, cr);
    ctx.lineTo(WALL_R, RIM_Y);
    ctx.closePath();
  }

  // A pot-bellied outside around the flat-bottomed inside.
  function outerPath() {
    ctx.beginPath();
    ctx.moveTo(WALL_L - 14, RIM_Y);
    ctx.bezierCurveTo(WALL_L - 48, RIM_Y + 100, WALL_L - 44, FLOOR_Y - 40, WALL_L - 8, FLOOR_Y + 18);
    ctx.quadraticCurveTo(CX, FLOOR_Y + 36, WALL_R + 8, FLOOR_Y + 18);
    ctx.bezierCurveTo(WALL_R + 44, FLOOR_Y - 40, WALL_R + 48, RIM_Y + 100, WALL_R + 14, RIM_Y);
    ctx.closePath();
  }

  function drawFire() {
    // logs
    ctx.fillStyle = '#3b2414';
    ctx.save();
    ctx.translate(CX, 664);
    ctx.rotate(0.12);
    ctx.fillRect(-110, -8, 220, 16);
    ctx.rotate(-0.24);
    ctx.fillRect(-110, -8, 220, 16);
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      if (!p.fire) continue;
      const k = p.life / p.max;
      ctx.globalAlpha = k * 0.6;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * k, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawCauldron(t) {
    // legs
    ctx.fillStyle = '#16131c';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(CX + sx * 120, FLOOR_Y + 10);
      ctx.lineTo(CX + sx * 160, FLOOR_Y + 10);
      ctx.lineTo(CX + sx * 168, 655);
      ctx.lineTo(CX + sx * 146, 655);
      ctx.closePath();
      ctx.fill();
    }

    // iron body
    outerPath();
    const iron = ctx.createLinearGradient(0, RIM_Y, W, FLOOR_Y + 30);
    iron.addColorStop(0, '#3a3546');
    iron.addColorStop(0.45, '#1c1924');
    iron.addColorStop(1, '#0a090e');
    ctx.fillStyle = iron;
    ctx.fill();
    // firelight on the underside
    const under = ctx.createRadialGradient(CX, 650, 20, CX, 620, 190);
    under.addColorStop(0, 'rgba(255, 110, 30, 0.45)');
    under.addColorStop(1, 'rgba(255, 110, 30, 0)');
    ctx.fillStyle = under;
    ctx.fill();

    // inside: dark above the brew, glowing brew below
    ctx.save();
    interiorPath();
    ctx.fillStyle = '#0b0710';
    ctx.fill();
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(WALL_L, H);
    for (let x = WALL_L; x <= WALL_R; x += 8) ctx.lineTo(x, surfaceY(x, t));
    ctx.lineTo(WALL_R, H);
    ctx.closePath();
    const brew = ctx.createLinearGradient(0, LIQUID_Y, 0, FLOOR_Y);
    brew.addColorStop(0, '#4fbf3a');
    brew.addColorStop(0.25, '#1f6b28');
    brew.addColorStop(1, '#0b2a14');
    ctx.fillStyle = brew;
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 255, 140, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.strokeStyle = 'rgba(200, 255, 170, 0.55)';
      ctx.lineWidth = 1.2;
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

  function drawRim() {
    for (const [x0, x1] of [[WALL_L - 28, WALL_L + 4], [WALL_R - 4, WALL_R + 28]]) {
      const g = ctx.createLinearGradient(0, RIM_Y - 12, 0, RIM_Y + 12);
      g.addColorStop(0, '#5a5368');
      g.addColorStop(1, '#16131c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x0, RIM_Y - 12, x1 - x0, 24, 8);
      ctx.fill();
    }

    // the boil-over line
    const pulse = danger > 0 ? 0.5 + 0.5 * Math.sin(now / (120 - danger * 70)) : 0;
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2 + danger * 2;
    ctx.strokeStyle = danger > 0 ? `rgba(255, ${80 - pulse * 60}, 60, ${0.6 + pulse * 0.4})` : 'rgba(181, 120, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(WALL_L + 4, RIM_Y);
    ctx.lineTo(WALL_R - 4, RIM_Y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSprite(tier, x, y, r, angle = 0) {
    const sprite = sprites[tier];
    const full = (INGREDIENTS[tier].r + SPRITE_PAD) * (r / INGREDIENTS[tier].r);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(sprite, -full, -full, full * 2, full * 2);
    ctx.restore();
  }

  function drawIngredients() {
    for (const b of ingredients) {
      drawSprite(b.tier, b.position.x, b.position.y, b.circleRadius, b.angle);
      if (b.overSince !== null) {
        const k = (now - b.overSince) / OVER_LIMIT;
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, b.circleRadius + 2, 0, TAU);
        ctx.strokeStyle = `rgba(255, 60, 60, ${0.4 + 0.6 * Math.abs(Math.sin(now / 90)) * k})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  // The highest point under x that a dropped ingredient would land on.
  function landingY(x, r) {
    let y = FLOOR_Y - r;
    for (const b of ingredients) {
      const reach = b.circleRadius + r;
      const dx = Math.abs(b.position.x - x);
      if (dx < reach) y = Math.min(y, b.position.y - Math.sqrt(reach * reach - dx * dx));
    }
    return y;
  }

  function drawHeld() {
    if (state !== 'playing') return;
    const r = INGREDIENTS[current].r;
    const x = clamp(aimX, WALL_L + r + 1, WALL_R - r - 1);
    const ready = now >= canDropAt && stirLeft <= 0;

    ctx.setLineDash([4, 8]);
    ctx.strokeStyle = 'rgba(220, 200, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, DROP_Y + r);
    ctx.lineTo(x, landingY(x, r));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = ready ? 1 : 0.4;
    drawSprite(current, x, DROP_Y + Math.sin(now / 300) * 2, r);
    ctx.globalAlpha = 1;
  }

  function drawLadle() {
    if (stirLeft <= 0) return;
    const env = Math.sin(Math.PI * (1 - stirLeft / STIR_TIME));
    const tipX = CX + Math.cos(stirPhase) * 130;
    const tipY = STIR_CENTER_Y + 10 + Math.sin(stirPhase) * 35;
    const topX = CX + Math.cos(stirPhase) * 50 + 70;
    const topY = 20;
    ctx.globalAlpha = Math.min(1, env * 3);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3d2414';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = '#8a5a32';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.fillStyle = '#6b4325';
    ctx.beginPath();
    ctx.ellipse(tipX, tipY, 22, 14, Math.atan2(tipY - topY, tipX - topX), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
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
    const x = W - 48, y = 58, r = 30;
    ctx.fillStyle = 'rgba(28, 17, 41, 0.85)';
    ctx.strokeStyle = '#3b2656';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    drawSprite(next, x, y, Math.min(22, INGREDIENTS[next].r));
    ctx.fillStyle = '#a594bd';
    ctx.font = '600 13px Grenze, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', x, y - r - 9);
  }

  function render() {
    const t = now / 1000;
    drawSky(t);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawFire();
    drawCauldron(t);
    drawIngredients();
    drawRim();
    drawHeld();
    drawLadle();
    drawParticles();
    drawFloaters();
    drawNext();
    ctx.restore();
  }

  // ---- The night sky, drawn behind the whole page ----
  const sky = $('sky');
  const skyCtx = sky.getContext('2d');
  const skyStars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.5, 1.7), p: Math.random() * TAU }));

  function resizeSky() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sky.width = Math.round(innerWidth * dpr);
    sky.height = Math.round(innerHeight * dpr);
    skyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawSky(t) {
    const w = innerWidth, h = innerHeight;
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
  }

  // ---- HUD ----
  function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = Math.max(best, score);
    chargesEl.textContent = '●'.repeat(stirs) + '○'.repeat(STIR_MAX - stirs);
    stirBtn.disabled = state !== 'playing' || stirs === 0 || stirLeft > 0;
    muteBtn.textContent = Sound.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', Sound.muted ? 'Sound off' : 'Sound on');
  }

  function renderGrimoire() {
    grimoireEl.replaceChildren(...INGREDIENTS.map((ing, i) => {
      const img = document.createElement('img');
      img.src = sprites[i].toDataURL();
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
  }

  // ---- Input ----
  function logicalX(e) {
    const box = canvas.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * W;
  }

  let pointerDown = false;
  canvas.addEventListener('pointermove', (e) => { aimX = logicalX(e); });
  canvas.addEventListener('pointerdown', (e) => {
    Sound.unlock();
    aimX = logicalX(e);
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (pointerDown) {
      aimX = logicalX(e);
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
    } else if (k === 's') stir();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = false;
    if (k === 'arrowright' || k === 'd') keys.right = false;
  });

  stirBtn.addEventListener('click', () => { Sound.unlock(); stir(); });
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
  if (AUTOPLAY) newGame();
  requestAnimationFrame(frame);
})();
