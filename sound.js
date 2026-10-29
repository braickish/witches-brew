// Every sound is synthesized with the Web Audio API, so there are no files to load.
const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem('brew-muted') === '1'; } catch {}

  // Browsers only allow audio after a tap or key press, so the game calls this then.
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function ready() {
    return ctx && !muted && ctx.state === 'running';
  }

  function tone({ type = 'sine', from, to = from, dur, vol = 0.3, delay = 0, vibrato = 0 }) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise({ dur, vol = 0.2, from = 400, to = 400, q = 1, delay = 0 }) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
  }

  return {
    unlock,
    get muted() { return muted; },
    setMuted(value) {
      muted = value;
      try { localStorage.setItem('brew-muted', value ? '1' : '0'); } catch {}
      if (master) master.gain.value = muted ? 0 : 0.6;
    },
    plop() {
      tone({ from: 320, to: 140, dur: 0.12, vol: 0.25 });
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
    discover() {
      [660, 830, 990, 1320].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.18, vol: 0.12, delay: i * 0.07 }));
    },
    finale() {
      noise({ dur: 0.8, vol: 0.3, from: 2000, to: 200, q: 0.7 });
      [392, 494, 587, 784].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.9, vol: 0.1, delay: i * 0.05 }));
    },
    over() {
      [392, 330, 277, 196].forEach((f, i) => tone({ type: 'sawtooth', from: f, to: f * 0.97, dur: 0.35, vol: 0.07, delay: i * 0.22 }));
      noise({ dur: 1.4, vol: 0.15, from: 200, to: 900, q: 1 });
    },
  };
})();
