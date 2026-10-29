// Every sound is synthesized with the Web Audio API, so there are no files to load.
const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  let pan = 0;                           // where in the stereo field the next sounds play
  try { muted = localStorage.getItem('brew-muted') === '1'; } catch {}

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // A short silent WAV, made on the spot.
  function silentWavUrl() {
    const samples = 4410;
    const b = new DataView(new ArrayBuffer(44 + samples));
    const str = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); b.setUint32(4, 36 + samples, true); str(8, 'WAVE');
    str(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, 44100, true); b.setUint32(28, 44100, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true);
    str(36, 'data'); b.setUint32(40, samples, true);
    for (let i = 0; i < samples; i++) b.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }

  // On iPhones, Web Audio is silenced by the ring/silent switch unless the page says it's
  // playing real media. Newer iOS lets us say so directly; older iOS needs a silent
  // <audio> element kept playing to get the same effect.
  let keepAlive = null;
  function asMedia() {
    try {
      if (navigator.audioSession) {
        navigator.audioSession.type = 'playback';
        return;
      }
    } catch {}
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))) return;
    if (!keepAlive) {
      keepAlive = new Audio(silentWavUrl());
      keepAlive.loop = true;
      keepAlive.setAttribute('playsinline', '');
    }
    if (keepAlive.paused) keepAlive.play().catch(() => {});
  }

  // Browsers only allow audio after a tap or key press, so this runs on every one.
  function unlock() {
    asMedia();
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
    }
    // iOS also pauses audio ('interrupted') after a call, the lock screen, or switching apps.
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // Playing one silent sample inside the tap is what finally wakes audio on some iOS versions.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  }

  // iOS only counts some events as a real tap for audio (touchend and click, not touchstart),
  // so listen for all of them.
  for (const type of ['touchend', 'pointerup', 'click', 'keydown']) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });

  function ready() {
    return ctx && !muted && ctx.state === 'running';
  }

  function output() {
    if (!pan || !ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    return p;
  }

  // A pitched sound. `path` is a list of [seconds, frequency] points for glides like a meow or a howl.
  function tone({ type = 'sine', from, to = from, path, dur, vol = 0.3, delay = 0, attack = 0.015, vibrato = 0, rate = 6, filter }) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    if (path) {
      osc.frequency.setValueAtTime(path[0][1], t);
      for (const [at, f] of path.slice(1)) osc.frequency.linearRampToValueAtTime(f, t + at);
    } else {
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = rate;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.value = filter.freq;
      f.Q.value = filter.q || 1;
      node = node.connect(f);
    }
    node.connect(gain).connect(output());
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // A burst of filtered noise: hisses, whooshes, clicks and splashes.
  function noise({ dur, vol = 0.2, from = 400, to = from, q = 1, delay = 0, type = 'bandpass', attack = 0.3 }) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(output());
    src.start(t);
  }

  // What each ingredient sounds like. ingredients.js picks one by name for each ingredient.
  const voices = {
    squelch() {
      noise({ dur: 0.18, vol: 0.25, from: 900, to: 200, q: 3, attack: 0.1 });
      tone({ from: 220, to: 70, dur: 0.15, vol: 0.22 });
    },
    wriggle() {
      tone({ type: 'triangle', path: [[0, 160], [0.1, 240], [0.2, 150], [0.3, 220], [0.4, 140]], dur: 0.45, vol: 0.14, vibrato: 30, rate: 22 });
      noise({ dur: 0.4, vol: 0.06, from: 500, to: 300, q: 2 });
    },
    scurry() {
      for (let i = 0; i < 12; i++) noise({ dur: 0.02, vol: rand(0.08, 0.18), from: 4200, to: 3000, q: 2, delay: i * 0.03 + Math.random() * 0.012, attack: 0.2 });
    },
    screech() {
      for (let i = 0; i < 3; i++) {
        tone({ from: 3200, to: 5400, dur: 0.05, vol: 0.09, delay: i * 0.09 });
        noise({ dur: 0.07, vol: 0.16, from: 500, to: 250, q: 0.8, delay: i * 0.09 + 0.04, type: 'lowpass' });
      }
    },
    poof() {
      noise({ dur: 0.35, vol: 0.3, from: 1400, to: 200, q: 0.7, type: 'lowpass', attack: 0.05 });
      tone({ from: 200, to: 110, dur: 0.2, vol: 0.15 });
    },
    squeak() {
      tone({ type: 'triangle', path: [[0, 2100], [0.04, 2900], [0.09, 2300]], dur: 0.1, vol: 0.1 });
      tone({ type: 'triangle', path: [[0, 2300], [0.05, 3100], [0.11, 2500]], dur: 0.12, vol: 0.1, delay: 0.14 });
    },
    hiss() {
      noise({ dur: 0.8, vol: 0.18, from: 5000, to: 6500, q: 0.6, type: 'highpass', attack: 0.35 });
    },
    rattle() {
      for (let i = 0; i < 7; i++) noise({ dur: 0.03, vol: 0.2, from: 1800, to: 1400, q: 5, delay: i * 0.045 + Math.random() * 0.02, attack: 0.2 });
      tone({ type: 'triangle', from: 320, to: 180, dur: 0.12, vol: 0.15 });
    },
    meow() {
      tone({ type: 'sawtooth', path: [[0, 450], [0.15, 720], [0.55, 400]], dur: 0.65, vol: 0.14, attack: 0.08, filter: { type: 'bandpass', freq: 1400, q: 2 }, vibrato: 8, rate: 7 });
    },
    wooo() {
      tone({ path: [[0, 380], [0.5, 620], [1.3, 340]], dur: 1.4, vol: 0.12, attack: 0.3, vibrato: 14, rate: 5 });
      tone({ path: [[0, 570], [0.5, 930], [1.3, 510]], dur: 1.4, vol: 0.04, attack: 0.3, vibrato: 14, rate: 5 });
    },
    gong() {
      [110, 166, 224, 331].forEach((f, i) => tone({ from: f, to: f * 0.99, dur: 2.2, vol: 0.18 / (i + 1), attack: 0.01 }));
    },
  };

  // Spooky noises from somewhere out in the dark.
  const ambience = {
    owl() {
      tone({ path: [[0, 400], [0.08, 420], [0.35, 380]], dur: 0.4, vol: 0.07, attack: 0.08 });
      tone({ path: [[0, 380], [0.1, 400], [0.6, 340]], dur: 0.7, vol: 0.07, attack: 0.1, delay: 0.55 });
    },
    howl() {
      tone({ path: [[0, 280], [0.6, 560], [1.8, 520], [2.6, 380]], dur: 2.8, vol: 0.06, attack: 0.5, vibrato: 6, rate: 5 });
      tone({ path: [[0, 560], [0.6, 1120], [1.8, 1040], [2.6, 760]], dur: 2.8, vol: 0.015, attack: 0.5, vibrato: 6, rate: 5 });
    },
    wind() {
      noise({ dur: 4, vol: 0.08, from: 300, to: 700, q: 0.8, type: 'lowpass', attack: 0.5 });
    },
    creak() {
      let at = 0;
      for (let i = 0; i < 14; i++) {
        noise({ dur: 0.025, vol: 0.12, from: 900 + i * 40, q: 8, delay: at, attack: 0.2 });
        at += 0.09 - i * 0.004;
      }
    },
    crow() {
      for (let i = 0; i < 3; i++) tone({ type: 'sawtooth', path: [[0, 620], [0.12, 520], [0.2, 480]], dur: 0.22, vol: 0.05, delay: i * 0.32, filter: { type: 'bandpass', freq: 1100, q: 3 } });
    },
    whisper() {
      noise({ dur: 1.6, vol: 0.05, from: 2500, to: 3500, q: 4, attack: 0.4 });
      noise({ dur: 1.2, vol: 0.04, from: 3200, to: 2200, q: 5, delay: 0.5, attack: 0.4 });
    },
  };

  return {
    unlock,
    get running() { return ready(); },
    get muted() { return muted; },
    setMuted(value) {
      muted = value;
      try { localStorage.setItem('brew-muted', value ? '1' : '0'); } catch {}
      if (master) master.gain.value = muted ? 0 : 0.6;
    },
    voice(name) {
      if (voices[name]) voices[name]();
    },
    ambient() {
      const names = Object.keys(ambience);
      pan = rand(-0.8, 0.8);
      ambience[names[Math.floor(Math.random() * names.length)]]();
      pan = 0;
    },
    plop() {
      tone({ from: 320, to: 140, dur: 0.12, vol: 0.15 });
    },
    // Bigger ingredients make deeper bloops.
    merge(tier) {
      const base = 900 * Math.pow(0.82, tier);
      tone({ from: base * 1.6, to: base, dur: 0.18, vol: 0.28 });
      tone({ type: 'triangle', from: base * 0.5, to: base * 0.4, dur: 0.25, vol: 0.14 });
      if (tier >= 6) tone({ from: 90, to: 45, dur: 0.4, vol: 0.35 });
    },
    blip() {
      const f = 250 + Math.random() * 300;
      tone({ from: f, to: f * 1.6, dur: 0.06, vol: 0.04 });
    },
    stir() {
      noise({ dur: 1.7, vol: 0.22, from: 300, to: 1400, q: 2 });
      tone({ from: 520, to: 330, dur: 1.6, vol: 0.08, vibrato: 18 });
      tone({ type: 'triangle', from: 260, to: 170, dur: 1.6, vol: 0.06, vibrato: 10, delay: 0.1 });
    },
    clack() {
      tone({ type: 'triangle', from: 700, to: 400, dur: 0.06, vol: 0.2 });
      tone({ type: 'triangle', from: 600, to: 350, dur: 0.06, vol: 0.14, delay: 0.12 });
    },
    discover() {
      [660, 830, 990, 1320].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.18, vol: 0.12, delay: i * 0.07 }));
    },
    finale() {
      noise({ dur: 0.8, vol: 0.3, from: 2000, to: 200, q: 0.7 });
      [392, 494, 587, 784].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.9, vol: 0.1, delay: i * 0.05 }));
    },
    // The brew surging up and over: a rising rumble full of big bubbles.
    boilOver() {
      noise({ dur: 2.4, vol: 0.3, from: 120, to: 600, q: 0.8, type: 'lowpass', attack: 0.6 });
      for (let i = 0; i < 22; i++) {
        const f = rand(90, 260);
        tone({ from: f, to: f * 2.2, dur: 0.09, vol: rand(0.1, 0.22), delay: i * 0.1 + Math.random() * 0.06 });
      }
    },
    sizzle() {
      noise({ dur: 2.2, vol: 0.25, from: 3000, to: 5000, q: 0.5, type: 'highpass', attack: 0.05 });
      noise({ dur: 1.4, vol: 0.12, from: 400, to: 150, q: 0.6, type: 'lowpass', attack: 0.05 });
    },
    over() {
      [392, 330, 277, 196].forEach((f, i) => tone({ type: 'sawtooth', from: f, to: f * 0.97, dur: 0.35, vol: 0.07, delay: i * 0.22 }));
    },
  };
})();
