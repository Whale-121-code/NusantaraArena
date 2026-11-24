const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.music = null;
    this.volume = 0.7;
    this.musicVolume = 0.35;
    this.last = new Map();
    this.ambient = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.volume;
    this.sfx.connect(this.master);

    this.music = this.ctx.createGain();
    this.music.gain.value = this.musicVolume * 0.5;
    this.music.connect(this.master);

    this.noise = this.makeNoiseBuffer(1.2);
  }

  makeNoiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2 + white * 0.35;
    }
    return buf;
  }

  setVolume(v) {
    this.volume = clamp01(v);
    if (this.sfx) this.sfx.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v) {
    this.musicVolume = clamp01(v);
    if (this.music) this.music.gain.setTargetAtTime(this.musicVolume * 0.5, this.ctx.currentTime, 0.1);
  }

  makeOsc(type, freq, t0, dur, gain = 0.2, dest = this.sfx, detune = 0) {
    if (!this.ctx) return null;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return { o, g };
  }

  noiseBurst(t0, dur, gain, filterType = 'bandpass', freq = 900, q = 0.8, dest = this.sfx) {
    if (!this.ctx || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  play(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const throttle = this.last.get(name) || 0;
    const gap = name === 'hit' ? 0.055 : name === 'arrow' ? 0.07 : 0.02;
    if (now - throttle < gap) return;
    this.last.set(name, now);

    switch (name) {
      case 'click':
        this.makeOsc('triangle', 620, now, 0.06, 0.1);
        this.makeOsc('sine', 1240, now + 0.02, 0.05, 0.05);
        break;
      case 'hover':
        this.makeOsc('sine', 880, now, 0.04, 0.025);
        break;
      case 'cast':
        this.noiseBurst(now, 0.22, 0.16, 'bandpass', 1500, 1.4);
        this.makeOsc('sawtooth', 320, now, 0.2, 0.06);
        break;
      case 'castUlt':
        this.makeOsc('sawtooth', 110, now, 0.5, 0.14);
        this.makeOsc('sine', 220, now + 0.03, 0.55, 0.12);
        this.noiseBurst(now, 0.5, 0.18, 'lowpass', 900, 0.7);
        break;
      case 'arrow':
        this.noiseBurst(now, 0.1, 0.11, 'highpass', 2400, 1);
        this.makeOsc('sine', 1400, now, 0.08, 0.04);
        break;
      case 'hit':
        this.makeOsc('sine', 150, now, 0.09, 0.16);
        this.noiseBurst(now, 0.07, 0.1, 'lowpass', 500, 0.7);
        break;
      case 'explosion':
        this.makeOsc('sine', 90, now, 0.4, 0.28);
        this.noiseBurst(now, 0.45, 0.3, 'lowpass', 380, 0.6);
        break;
      case 'kill':
        this.makeOsc('sawtooth', 180, now, 0.16, 0.14);
        this.makeOsc('sine', 60, now + 0.02, 0.35, 0.2);
        this.noiseBurst(now, 0.18, 0.12, 'bandpass', 1200, 1);
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.makeOsc('triangle', f, now + i * 0.07, 0.25, 0.1));
        break;
      case 'buy':
        [880, 1320].forEach((f, i) => this.makeOsc('sine', f, now + i * 0.06, 0.18, 0.09));
        break;
      case 'error':
        this.makeOsc('square', 190, now, 0.12, 0.05);
        this.makeOsc('square', 150, now + 0.08, 0.1, 0.04);
        break;
      case 'recall':
        [392, 523, 659, 880].forEach((f, i) => this.makeOsc('sine', f, now + i * 0.09, 0.4, 0.055));
        break;
      case 'teleport':
        this.noiseBurst(now, 0.3, 0.1, 'highpass', 1800, 1.2);
        this.makeOsc('sine', 1400, now, 0.25, 0.04);
        break;
      case 'tower':
        this.makeOsc('sine', 70, now, 0.7, 0.3);
        this.noiseBurst(now, 0.65, 0.24, 'lowpass', 300, 0.5);
        break;
      case 'storm':
        this.makeOsc('sawtooth', 55, now, 0.9, 0.2);
        this.noiseBurst(now, 0.8, 0.2, 'lowpass', 700, 0.4);
        break;
      case 'victory':
        [[392, 0], [523, 0.16], [659, 0.32], [784, 0.48], [1047, 0.66]].forEach(([f, t]) => {
          this.makeOsc('triangle', f, now + t, 1.2, 0.09);
          this.makeOsc('sine', f / 2, now + t, 1.1, 0.06);
        });
        break;
      case 'defeat':
        [[330, 0], [277, 0.22], [220, 0.46], [165, 0.72]].forEach(([f, t]) => this.makeOsc('sine', f, now + t, 1.1, 0.1));
        break;
      case 'announce':
        this.makeOsc('sine', 880, now, 0.3, 0.05);
        this.makeOsc('sine', 1320, now + 0.12, 0.35, 0.04);
        break;
      default:
        break;
    }
  }

  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const now = this.ctx.currentTime;
    const group = this.ctx.createGain();
    group.gain.value = 0;
    group.gain.linearRampToValueAtTime(1, now + 2.5);
    group.connect(this.music);
    const nodes = [];
    const base = [55, 82.5, 110, 164.8];
    base.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = [0.05, 0.035, 0.028, 0.018][i];
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.017;
      const lg = this.ctx.createGain();
      lg.gain.value = 0.012;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(group);
      o.start(); lfo.start();
      nodes.push(o, lfo);
    });
    const wind = this.ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 420; wf.Q.value = 0.4;
    const wg = this.ctx.createGain(); wg.gain.value = 0.02;
    wind.connect(wf); wf.connect(wg); wg.connect(group);
    wind.start();
    nodes.push(wind);
    this.ambient = { group, nodes };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const { group, nodes } = this.ambient;
    const now = this.ctx.currentTime;
    group.gain.cancelScheduledValues(now);
    group.gain.setTargetAtTime(0, now, 0.4);
    nodes.forEach((n) => {
      try { n.stop(now + 1.6); } catch (e) { /* already stopped */ }
    });
    this.ambient = null;
  }
}

export const audio = new AudioEngine();
