import {
  CAMPS, LANES, RIVER, STRUCTURES, TEAMS, HEROES, CENTER, WORLD, TOWER_CONFIG, MAP_LOCATIONS,
} from './data.js';
import { clamp, dist, distToPolyline, mulberry32, pointOnPolyline, rad } from './utils.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const screenGrad = (ctx, x0, y0, x1, y1, stops) => {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [p, c] of stops) g.addColorStop(p, c);
  return g;
};

export class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimap = minimap;
    this.mctx = minimap.getContext('2d');
    this.game = null;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.userZoom = 1;
    this.cam = { x: CENTER, y: CENTER };
    this.time = 0;
    this.mouse = { x: 0, y: 0 };
    this.aim = null;
    this.settings = { quality: true, shake: true, software: false };
    this.autoScale = 1;
    this.decor = true;
    this.terrain = null;
    this.minimapBg = null;
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d');
    this.fogMask = document.createElement('canvas');
    this.fogMaskCtx = this.fogMask.getContext('2d');
    this.fogScale = 0.55;
    this._fogStamp = -1e9;
    this._fogSig = null;
    this._fogDirty = true;
    this._visionBrush = this.buildVisionBrush(0.45, 0.78);
    this._baseBrush = this.buildVisionBrush(0.4, 0.62);
    this._fxCanvas = document.createElement('canvas');
    this._miniStamp = 0;
    this.rain = [];
    this.flies = [];
    this.leaves = [];
    this.intro = 0;
    this.flash = 0;
    this.lastLightning = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this._lastPlayerPos = { x: 0, y: 0 };
    this._heroTrail = new Map();
    this.heroTokens = {};
    for (const id of Object.keys(HEROES)) {
      const img = new Image();
      img.src = HEROES[id].portrait.replace('/heroes/', '/heroes/token-');
      this.heroTokens[id] = img;
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const prevBase = this.baseZoom || 0;
    const prevZoom = this.zoom || 0;
    const maxDpr = this.settings.software ? 1 : this.settings.quality ? 1.75 : 1.15;
    const minDpr = this.settings.software ? 0.4 : 0.5;
    this.dpr = Math.max(minDpr, Math.min(window.devicePixelRatio || 1, maxDpr) * this.autoScale);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.baseZoom = clamp(Math.min(this.w / 1360, this.h / 780), 0.55, 1.5);
    const zk = prevBase ? this.baseZoom / prevBase : 1;
    this.zoom = prevZoom ? prevZoom * zk : this.baseZoom;
    this.zoomTarget = this.zoom;
    this.fogScale = this.settings.quality ? 0.45 : 0.34;
    this.fog.width = Math.max(1, Math.floor(this.w * this.fogScale));
    this.fog.height = Math.max(1, Math.floor(this.h * this.fogScale));
    this.fogMask.width = this.fog.width;
    this.fogMask.height = this.fog.height;
    this._fogDirty = true;
    this._miniDirty = true;
    this.buildScreenFX();
  }

  buildVisionBrush(inner, mid) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const b = c.getContext('2d');
    const g = b.createRadialGradient(128, 128, 128 * inner, 128, 128, 128);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(mid, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    b.fillRect(0, 0, 256, 256);
    return c;
  }

  buildScreenFX() {
    if (!this.w || !this.h) return;
    const c = this._fxCanvas;
    c.width = Math.max(1, Math.floor(this.w / 2));
    c.height = Math.max(1, Math.floor(this.h / 2));
    const x = c.getContext('2d');
    x.setTransform(c.width / this.w, 0, 0, c.height / this.h, 0, 0);
    x.clearRect(0, 0, this.w, this.h);
    x.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const px = this.w * (0.55 + i * 0.16);
      const grd = x.createLinearGradient(px, 0, px - this.h * 0.55, this.h);
      grd.addColorStop(0, 'rgba(255, 214, 150, 0.05)');
      grd.addColorStop(0.45, 'rgba(255, 200, 130, 0.02)');
      grd.addColorStop(1, 'rgba(255, 190, 120, 0)');
      x.fillStyle = grd;
      x.beginPath();
      x.moveTo(px - 50, 0);
      x.lineTo(px + 130, 0);
      x.lineTo(px + 130 - this.h * 0.7, this.h);
      x.lineTo(px - 50 - this.h * 0.7, this.h);
      x.closePath(); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    const vg = x.createRadialGradient(this.w / 2, this.h * 0.46, this.h * 0.34, this.w / 2, this.h * 0.5, this.h * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.6, 'rgba(2, 10, 14, 0.09)');
    vg.addColorStop(1, 'rgba(1, 6, 10, 0.34)');
    x.fillStyle = vg;
    x.fillRect(0, 0, this.w, this.h);
    const grade = x.createLinearGradient(0, this.h * 0.55, 0, this.h);
    grade.addColorStop(0, 'rgba(20, 90, 100, 0)');
    grade.addColorStop(1, 'rgba(16, 70, 82, 0.06)');
    x.fillStyle = grade;
    x.fillRect(0, this.h * 0.55, this.w, this.h * 0.45);
  }

  setAutoScale(s) {
    const v = clamp(s, this.settings.software ? 0.4 : 0.5, 1);
    if (Math.abs(v - this.autoScale) < 0.005) return;
    this.autoScale = v;
    this.resize();
  }

  setDecor(on) {
    if (this.decor === on) return;
    this.decor = on;
    this._fogDirty = true;
  }
  setGame(game) {
    this.game = game;
    this.intro = 1.4;
    this.cam.x = game.player.x;
    this.cam.y = game.player.y;
    this.buildTerrain();
    this.buildRain();
    this.buildFlies();
    this._lastPlayerPos = { x: game.player.x, y: game.player.y };
  }

  setSettings(s) {
    this.settings = { ...this.settings, ...s };
    this.resize();
  }

  applyGlow(ctx, color, blur) {
    if (!this.settings.quality) return;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  buildRain() {
    this.rain = [];
    const n = this.settings.quality ? 110 : 50;
    for (let i = 0; i < n; i++) {
      this.rain.push({ x: Math.random(), y: Math.random(), len: 12 + Math.random() * 22, speed: 0.5 + Math.random() * 0.9, a: 0.08 + Math.random() * 0.18 });
    }
  }

  buildFlies() {
    const rnd = mulberry32(99);
    this.flies = [];
    for (let i = 0; i < (this.settings.quality ? 40 : 14); i++) {
      this.flies.push({ x: rnd() * WORLD, y: rnd() * WORLD, phase: rnd() * TAU, speed: 0.3 + rnd() * 0.7, color: rnd() < 0.5 ? '#ffe6a0' : '#8ff6de' });
    }
    this.leaves = [];
    const leafRnd = mulberry32(4242);
    for (let i = 0; i < (this.settings.quality ? 26 : 10); i++) {
      this.leaves.push({
        x: leafRnd() * WORLD,
        y: leafRnd() * WORLD,
        phase: leafRnd() * TAU,
        speed: 0.5 + leafRnd() * 1.1,
        size: 3 + leafRnd() * 3,
        green: leafRnd(),
      });
    }
  }

  // ---------------- terrain ----------------
  buildTreeSprites() {
    const W = 220, H = 260;
    const palettes = [
      { dark: '#0d3226', mid: '#1a543a', light: '#2f7a4c', rim: 'rgba(196,238,172,0.5)' },
      { dark: '#0f3a32', mid: '#1e5e48', light: '#347e59', rim: 'rgba(158,242,214,0.45)' },
      { dark: '#1a3a22', mid: '#2d5f33', light: '#4d8244', rim: 'rgba(236,226,152,0.42)' },
      { dark: '#0b3129', mid: '#174f40', light: '#2c7059', rim: 'rgba(174,236,228,0.4)' },
    ];
    const makeTree = (seed, pal) => {
      const rnd = mulberry32(seed);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      const bx = W / 2, by = H - 12;
      const trunkH = 86 + rnd() * 30;
      const trunkW = 11 + rnd() * 7;
      const bend = (rnd() - 0.5) * 22;
      const trunkGrad = g.createLinearGradient(bx - trunkW, 0, bx + trunkW, 0);
      trunkGrad.addColorStop(0, '#241a12');
      trunkGrad.addColorStop(0.45, '#4a3523');
      trunkGrad.addColorStop(1, '#1c140e');
      g.strokeStyle = trunkGrad;
      g.lineCap = 'round';
      g.lineWidth = trunkW;
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + bend * 0.4, by - trunkH * 0.55, bx + bend, by - trunkH);
      g.stroke();
      g.lineWidth = trunkW * 0.42;
      for (let i = 0; i < 3; i++) {
        const yy = by - trunkH * (0.58 + i * 0.13);
        const dir = i % 2 === 0 ? -1 : 1;
        g.beginPath();
        g.moveTo(bx + bend * 0.5, yy);
        g.quadraticCurveTo(bx + dir * 26, yy - 16, bx + dir * (44 + rnd() * 18), yy - 38);
        g.stroke();
      }
      // bark highlights
      g.strokeStyle = 'rgba(138,104,68,0.4)';
      g.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        const ox = (rnd() - 0.5) * trunkW * 0.7;
        g.beginPath();
        g.moveTo(bx + ox, by - 8);
        g.quadraticCurveTo(bx + ox + bend * 0.35, by - trunkH * 0.55, bx + ox + bend * 0.8, by - trunkH * 0.92);
        g.stroke();
      }
      // canopy blobs: dark silhouette first, then lit clusters
      const cx = bx + bend, cy = by - trunkH - 30;
      const R = 58 + rnd() * 12;
      const blob = (x, y, r, col, alpha) => {
        g.globalAlpha = alpha;
        const grd = g.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.12, x, y, r);
        grd.addColorStop(0, col.light);
        grd.addColorStop(0.55, col.mid);
        grd.addColorStop(1, col.dark);
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.globalAlpha = 1;
      };
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + rnd() * 0.7;
        blob(cx + Math.cos(a) * R * (0.35 + rnd() * 0.3), cy + Math.sin(a) * R * 0.5, R * (0.52 + rnd() * 0.25), pal, 0.96);
      }
      blob(cx, cy - R * 0.25, R * 0.78, pal, 1);
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 1.05 + rnd() * Math.PI * 0.75;
        const rr = R * (0.35 + rnd() * 0.4);
        blob(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, R * (0.3 + rnd() * 0.22), pal, 0.9);
      }
      // rim light
      g.strokeStyle = pal.rim;
      g.globalAlpha = 0.55;
      g.lineWidth = 3.5;
      g.beginPath(); g.arc(cx - 6, cy - 6, R * 0.82, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
      g.lineWidth = 2;
      g.beginPath(); g.arc(cx + 14, cy + 4, R * 0.55, Math.PI * 1.2, Math.PI * 1.75); g.stroke();
      g.globalAlpha = 1;
      // leaf sparkle
      for (let i = 0; i < 26; i++) {
        const a = rnd() * TAU, rr = rnd() * R * 0.95;
        g.fillStyle = rnd() < 0.55 ? 'rgba(170,235,170,0.16)' : 'rgba(6,30,20,0.28)';
        g.beginPath();
        g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, 1 + rnd() * 1.8, 0, TAU);
        g.fill();
      }
      // vines
      g.strokeStyle = 'rgba(74,124,78,0.45)';
      g.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const vx = cx + (rnd() - 0.5) * R;
        g.beginPath();
        g.moveTo(vx, cy + R * 0.4);
        g.quadraticCurveTo(vx + 6, cy + R * 0.75, vx - 3, cy + R * 0.95 + rnd() * 10);
        g.stroke();
      }
      // glowing blooms
      for (let i = 0; i < 2; i++) {
        const a = rnd() * TAU;
        g.fillStyle = i ? 'rgba(140,240,215,0.5)' : 'rgba(255,214,130,0.5)';
        g.beginPath();
        g.arc(cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.45, 1.6, 0, TAU);
        g.fill();
      }
      return c;
    };
    const makeBush = (seed, pal) => {
      const rnd = mulberry32(seed);
      const c = document.createElement('canvas');
      c.width = 120; c.height = 78;
      const g = c.getContext('2d');
      for (let i = 0; i < 4; i++) {
        const x = 34 + rnd() * 52, y = 50 + rnd() * 12, r = 20 + rnd() * 16;
        const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
        grd.addColorStop(0, pal.light);
        grd.addColorStop(0.55, pal.mid);
        grd.addColorStop(1, pal.dark);
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      g.strokeStyle = 'rgba(190,230,160,0.28)';
      g.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.arc(30 + rnd() * 60, 46 + rnd() * 14, 8 + rnd() * 12, Math.PI * 1.1, Math.PI * 1.7);
        g.stroke();
      }
      return c;
    };
    this.treeSprites = palettes.map((p, i) => makeTree(911 + i * 37, p));
    this.bushSprites = palettes.slice(0, 3).map((p, i) => makeBush(451 + i * 53, p));
  }

  buildTerrain() {
    const S = 2048;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const k = S / WORLD;
    const rnd = mulberry32(20261121);
    g.scale(k, k);

    g.fillStyle = '#122e24';
    g.fillRect(0, 0, WORLD, WORLD);
    const baseGrad = g.createRadialGradient(CENTER, CENTER, 200, CENTER, CENTER, 2400);
    baseGrad.addColorStop(0, 'rgba(46, 96, 66, 0.55)');
    baseGrad.addColorStop(0.55, 'rgba(20, 54, 41, 0.2)');
    baseGrad.addColorStop(1, 'rgba(3, 16, 12, 0.55)');
    g.fillStyle = baseGrad;
    g.fillRect(0, 0, WORLD, WORLD);

    for (let i = 0; i < 260; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD, r = 60 + rnd() * 240;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.55;
      grd.addColorStop(0, dark ? 'rgba(8, 30, 22, 0.34)' : 'rgba(74, 132, 88, 0.2)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }

    for (let i = 0; i < 5200; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD;
      const light = rnd() < 0.5;
      g.fillStyle = light ? `rgba(120,180,120,${0.04 + rnd() * 0.08})` : `rgba(2,14,10,${0.05 + rnd() * 0.1})`;
      g.fillRect(x, y, 2 + rnd() * 5, 1 + rnd() * 3);
    }

    // grass tufts
    for (let i = 0; i < 1700; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD;
      if (distToPolyline(x, y, LANES.mid.points) < 120) continue;
      if (distToPolyline(x, y, LANES.top.points) < 130) continue;
      if (distToPolyline(x, y, LANES.bot.points) < 130) continue;
      g.strokeStyle = rnd() < 0.5
        ? `rgba(96, 150, 96, ${0.08 + rnd() * 0.12})`
        : `rgba(6, 32, 20, ${0.12 + rnd() * 0.18})`;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 2, y - 6, x + 3 + rnd() * 4, y - 11 - rnd() * 8);
      g.stroke();
      if (rnd() < 0.6) {
        g.beginPath();
        g.moveTo(x + 2, y);
        g.quadraticCurveTo(x - 3, y - 5, x - 4 - rnd() * 3, y - 8 - rnd() * 5);
        g.stroke();
      }
    }

    // river
    const riverY = (x) => RIVER.from.y + (x - RIVER.from.x) * ((RIVER.to.y - RIVER.from.y) / (RIVER.to.x - RIVER.from.x));
    g.lineCap = 'round';
    // sandy shore
    g.strokeStyle = 'rgba(126, 112, 76, 0.4)'; g.lineWidth = RIVER.width + 150;
    g.beginPath(); g.moveTo(RIVER.from.x, RIVER.from.y); g.lineTo(RIVER.to.x, RIVER.to.y); g.stroke();
    g.strokeStyle = 'rgba(42, 38, 24, 0.72)'; g.lineWidth = RIVER.width + 96;
    g.beginPath(); g.moveTo(RIVER.from.x, RIVER.from.y); g.lineTo(RIVER.to.x, RIVER.to.y); g.stroke();
    // water depth gradient across the flow
    const wg = g.createLinearGradient(0, WORLD, WORLD, 0);
    wg.addColorStop(0, '#062a35');
    wg.addColorStop(0.28, '#0a4654');
    wg.addColorStop(0.5, '#0e5d6c');
    wg.addColorStop(0.72, '#0a4654');
    wg.addColorStop(1, '#062a35');
    g.strokeStyle = wg; g.lineWidth = RIVER.width + 24;
    g.beginPath(); g.moveTo(RIVER.from.x, RIVER.from.y); g.lineTo(RIVER.to.x, RIVER.to.y); g.stroke();
    g.strokeStyle = 'rgba(110, 225, 225, 0.09)'; g.lineWidth = RIVER.width * 0.5;
    g.beginPath(); g.moveTo(RIVER.from.x + 80, RIVER.from.y + 80); g.lineTo(RIVER.to.x - 80, RIVER.to.y - 80); g.stroke();
    // shore stones
    for (let i = 0; i < 90; i++) {
      const t = rnd();
      const x = RIVER.from.x + (RIVER.to.x - RIVER.from.x) * t;
      const side = rnd() < 0.5 ? -1 : 1;
      const y = riverY(x) + side * (RIVER.width / 2 + 18 + rnd() * 54);
      const rr = 6 + rnd() * 16;
      g.fillStyle = 'rgba(0,0,0,0.24)';
      g.beginPath(); g.ellipse(x + 3, y + 4, rr * 1.2, rr * 0.55, 0, 0, TAU); g.fill();
      g.fillStyle = rnd() < 0.5 ? '#4c5652' : '#3b4643';
      g.beginPath(); g.ellipse(x, y, rr, rr * 0.55, rnd() * TAU, 0, TAU); g.fill();
      g.fillStyle = 'rgba(180, 200, 180, 0.16)';
      g.beginPath(); g.ellipse(x - rr * 0.25, y - rr * 0.2, rr * 0.5, rr * 0.22, 0, 0, TAU); g.fill();
    }
    // reeds
    for (let i = 0; i < 84; i++) {
      const t = rnd();
      const x = RIVER.from.x + (RIVER.to.x - RIVER.from.x) * t;
      const side = rnd() < 0.5 ? -1 : 1;
      const y = riverY(x) + side * (RIVER.width / 2 + 8 + rnd() * 28);
      g.strokeStyle = `rgba(${60 + rnd() * 40}, ${120 + rnd() * 50}, ${80 + rnd() * 40}, 0.5)`;
      g.lineWidth = 1.4;
      for (let j = 0; j < 3; j++) {
        const hx = x + (rnd() - 0.5) * 14;
        g.beginPath();
        g.moveTo(hx, y);
        g.quadraticCurveTo(hx + 2, y - 10, hx + (rnd() - 0.5) * 10, y - 18 - rnd() * 14);
        g.stroke();
      }
    }
    for (let i = 0; i < 110; i++) {
      const t = rnd();
      const x = RIVER.from.x + (RIVER.to.x - RIVER.from.x) * t + (rnd() - 0.5) * RIVER.width * 0.85;
      const y = riverY(x) + (rnd() - 0.5) * 20;
      g.strokeStyle = `rgba(170, 250, 250, ${0.05 + rnd() * 0.14})`;
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x - 16 - rnd() * 30, y); g.lineTo(x + 10, y); g.stroke();
    }

    // lanes
    for (const lane of Object.values(LANES)) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = 'rgba(20, 24, 18, 0.55)'; g.lineWidth = 214;
      this.strokePath(g, lane.points);
      g.strokeStyle = 'rgba(74, 60, 40, 0.78)'; g.lineWidth = 190;
      this.strokePath(g, lane.points);
      const lg = g.createLinearGradient(0, WORLD, WORLD, 0);
      lg.addColorStop(0, '#6f5a3a'); lg.addColorStop(0.5, '#8d7449'); lg.addColorStop(1, '#6d5738');
      g.strokeStyle = lg; g.lineWidth = 166;
      this.strokePath(g, lane.points);
      g.strokeStyle = 'rgba(198, 172, 120, 0.22)'; g.lineWidth = 92;
      this.strokePath(g, lane.points);
      const len = lane.length;
      for (let s = 40; s < len; s += 34) {
        const p = pointOnPolyline(lane.points, s / len);
        const off = (rnd() - 0.5) * 150;
        const a = p.angle + Math.PI / 2;
        const x = p.x + Math.cos(a) * off, y = p.y + Math.sin(a) * off;
        if (rnd() < 0.35) continue;
        g.fillStyle = `rgba(${30 + rnd() * 30}, ${26 + rnd() * 24}, ${20 + rnd() * 18}, ${0.2 + rnd() * 0.3})`;
        g.beginPath(); g.ellipse(x, y, 2 + rnd() * 5, 1.2 + rnd() * 3, rnd() * TAU, 0, TAU); g.fill();
      }
      // carved stone joints
      g.lineWidth = 1.2;
      for (let s = 24; s < len; s += 30) {
        const p = pointOnPolyline(lane.points, s / len);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.angle);
        const j = (rnd() - 0.5) * 3;
        g.strokeStyle = `rgba(34, 27, 18, ${0.14 + rnd() * 0.14})`;
        g.beginPath();
        g.moveTo(-2 + j, -82);
        g.quadraticCurveTo(4 + j, 0, -3 + j, 82);
        g.stroke();
        if (rnd() < 0.4) {
          g.beginPath();
          g.moveTo(-16, -24 + rnd() * 48);
          g.lineTo(0, -20 + rnd() * 42);
          g.stroke();
        }
        g.restore();
      }
      // polished flagstones
      for (let i = 0; i < 120; i++) {
        const s = rnd() * len;
        const p = pointOnPolyline(lane.points, s / len);
        const a = p.angle + Math.PI / 2;
        const off = (rnd() - 0.5) * 140;
        const x = p.x + Math.cos(a) * off, y = p.y + Math.sin(a) * off;
        g.save();
        g.translate(x, y);
        g.rotate(p.angle + (rnd() - 0.5) * 0.35);
        g.fillStyle = rnd() < 0.5 ? 'rgba(215,192,146,0.09)' : 'rgba(28,22,14,0.12)';
        g.beginPath();
        g.roundRect(-9 - rnd() * 8, -5 - rnd() * 3, 18 + rnd() * 16, 10 + rnd() * 6, 2);
        g.fill();
        g.restore();
      }
      for (let s = 60; s < len; s += 190) {
        const p = pointOnPolyline(lane.points, s / len);
        const a = p.angle + Math.PI / 2;
        const side = rnd() < 0.5 ? -1 : 1;
        const x = p.x + Math.cos(a) * side * 150, y = p.y + Math.sin(a) * side * 150;
        g.fillStyle = 'rgba(14, 36, 26, 0.65)';
        g.beginPath(); g.ellipse(x, y, 16 + rnd() * 20, 9 + rnd() * 12, rnd() * TAU, 0, TAU); g.fill();
        g.fillStyle = 'rgba(72, 130, 80, 0.28)';
        g.beginPath(); g.ellipse(x - 4, y - 4, 10 + rnd() * 10, 6 + rnd() * 6, rnd() * TAU, 0, TAU); g.fill();
      }
    }

    // bridges at river crossing of mid lane
    const midP = pointOnPolyline(LANES.mid.points, 0.5);
    g.save();
    g.translate(midP.x, midP.y);
    g.rotate(-Math.PI / 4);
    // drop shadow + thickness
    g.fillStyle = 'rgba(0, 0, 0, 0.32)';
    g.beginPath(); g.roundRect(-214, -74, 428, 226, 16); g.fill();
    g.fillStyle = '#332a1e';
    g.fillRect(-210, -92, 420, 196);
    g.fillStyle = '#544b3c';
    g.fillRect(-210, -96, 420, 192);
    for (let i = -200; i < 210; i += 34) {
      const grd = g.createLinearGradient(i, 0, i + 30, 0);
      grd.addColorStop(0, i % 68 === 0 ? '#6c604a' : '#5a503d');
      grd.addColorStop(0.5, i % 68 === 0 ? '#7d7057' : '#6a5f49');
      grd.addColorStop(1, i % 68 === 0 ? '#4c4232' : '#463d2d');
      g.fillStyle = grd;
      g.fillRect(i, -92, 30, 184);
      g.fillStyle = 'rgba(24, 18, 11, 0.5)';
      g.fillRect(i + 29, -92, 2, 184);
      // nails
      g.fillStyle = 'rgba(214, 196, 156, 0.35)';
      g.beginPath(); g.arc(i + 8, -78, 1.6, 0, TAU); g.arc(i + 8, 78, 1.6, 0, TAU); g.fill();
      g.beginPath(); g.arc(i + 22, -78, 1.6, 0, TAU); g.arc(i + 22, 78, 1.6, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(210, 190, 140, 0.25)'; g.lineWidth = 3;
    g.strokeRect(-210, -96, 420, 192);
    // wooden rail beams + posts
    for (const side of [-1, 1]) {
      g.fillStyle = '#3f3020';
      g.fillRect(-214, side * 104 - 7, 428, 9);
      g.fillStyle = '#6b5330';
      g.fillRect(-214, side * 104 - 7, 428, 4);
      for (let px = -208; px <= 208; px += 52) {
        g.fillStyle = '#2c2114';
        g.beginPath(); g.roundRect(px - 5, side * 104 - 22, 10, 30, 3); g.fill();
        g.fillStyle = 'rgba(122, 95, 52, 0.8)';
        g.fillRect(px - 3, side * 104 - 20, 3, 26);
      }
    }
    // lantern posts
    for (const px of [-206, 206]) {
      for (const py of [-104, 104]) {
        g.fillStyle = '#3a2d1e';
        g.fillRect(px - 4, py - 40, 8, 46);
        g.fillStyle = '#8a7046';
        g.fillRect(px - 6, py - 42, 12, 4);
        const fl = 0.85 + Math.sin(px * 0.7 + py) * 0.15;
        const lant = g.createRadialGradient(px, py - 46, 1, px, py - 46, 34);
        lant.addColorStop(0, `rgba(255, 240, 200, ${0.95 * fl})`);
        lant.addColorStop(0.22, 'rgba(255, 196, 110, 0.55)');
        lant.addColorStop(1, 'rgba(255, 150, 60, 0)');
        g.fillStyle = lant;
        g.beginPath(); g.arc(px, py - 46, 34, 0, TAU); g.fill();
        g.fillStyle = '#fff1c4';
        g.beginPath(); g.arc(px, py - 46, 4.2, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255, 220, 150, 0.5)';
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(px, py - 46, 7.5, 0, TAU); g.stroke();
      }
    }
    g.restore();

    // base plazas
    for (const team of [0, 1]) {
      const b = TEAMS[team].base;
      const col = TEAMS[team].color;
      const tint = team === 0 ? '56, 128, 176' : '176, 66, 84';
      g.save();
      g.translate(b.x, b.y);
      // soft team glow
      const bg = g.createRadialGradient(0, 0, 80, 0, 0, 470);
      bg.addColorStop(0, `rgba(${tint}, 0.18)`);
      bg.addColorStop(0.55, `rgba(${tint}, 0.07)`);
      bg.addColorStop(1, `rgba(${tint}, 0)`);
      g.fillStyle = bg;
      g.beginPath(); g.arc(0, 0, 470, 0, TAU); g.fill();
      // basalt outer ring
      g.fillStyle = 'rgba(20, 28, 28, 0.5)';
      g.beginPath(); g.arc(0, 0, 452, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(214, 190, 140, 0.16)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 452, 0, TAU); g.stroke();
      // stone plaza
      const stone = g.createRadialGradient(0, -40, 40, 0, 0, 380);
      stone.addColorStop(0, 'rgba(146, 134, 106, 0.94)');
      stone.addColorStop(0.55, 'rgba(108, 98, 78, 0.9)');
      stone.addColorStop(1, 'rgba(56, 52, 40, 0.55)');
      g.fillStyle = stone;
      g.beginPath(); g.arc(0, 0, 380, 0, TAU); g.fill();
      // team sun emblem
      g.fillStyle = col;
      g.globalAlpha = 0.08;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 8;
        const a2 = 0.16;
        g.beginPath();
        g.moveTo(Math.cos(a - a2) * 150, Math.sin(a - a2) * 150);
        g.lineTo(Math.cos(a) * 350, Math.sin(a) * 350);
        g.lineTo(Math.cos(a + a2) * 150, Math.sin(a + a2) * 150);
        g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
      // concentric flagstone courses
      g.save();
      g.beginPath(); g.arc(0, 0, 376, 0, TAU); g.clip();
      const tileRnd = mulberry32(7319 + team * 97);
      for (let rr = 94; rr <= 364; rr += 27) {
        const n = Math.max(12, Math.round((TAU * rr) / 30));
        const off = tileRnd() * TAU;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          const tw = 24 + tileRnd() * 5;
          const light = tileRnd() < 0.5;
          g.save();
          g.translate(Math.cos(a) * rr, Math.sin(a) * rr);
          g.rotate(a + Math.PI / 2);
          g.fillStyle = light ? 'rgba(236, 226, 198, 0.1)' : 'rgba(44, 40, 30, 0.13)';
          g.beginPath(); g.roundRect(-tw / 2, -10.5, tw, 21, 3.5); g.fill();
          g.strokeStyle = 'rgba(52, 47, 36, 0.2)';
          g.lineWidth = 1;
          g.beginPath(); g.roundRect(-tw / 2, -10.5, tw, 21, 3.5); g.stroke();
          g.restore();
        }
      }
      g.restore();
      // outer gold rim
      g.strokeStyle = 'rgba(230, 210, 164, 0.24)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 380, 0, TAU); g.stroke();
      // tiled rings
      g.lineWidth = 2;
      for (const rr of [90, 150, 220, 280, 330, 366]) {
        g.strokeStyle = rr === 366 ? 'rgba(228, 210, 166, 0.34)' : 'rgba(228, 216, 180, 0.22)';
        g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke();
      }
      g.strokeStyle = 'rgba(40, 48, 42, 0.25)';
      g.lineWidth = 1.2;
      for (const rr of [120, 185, 250, 305, 348]) {
        g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke();
      }
      // radial inlays
      g.strokeStyle = col;
      g.globalAlpha = 0.16;
      g.lineWidth = 1.5;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * 90, Math.sin(a) * 90);
        g.lineTo(Math.cos(a) * 364, Math.sin(a) * 364);
        g.stroke();
      }
      g.globalAlpha = 1;
      // central medallion
      g.fillStyle = 'rgba(238, 228, 196, 0.16)';
      g.beginPath(); g.arc(0, 0, 150, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(232, 212, 158, 0.34)';
      g.lineWidth = 4;
      g.beginPath(); g.arc(0, 0, 150, 0, TAU); g.stroke();
      // team tint wash
      const wash = g.createRadialGradient(0, 0, 60, 0, 0, 380);
      wash.addColorStop(0, `rgba(${tint}, 0.07)`);
      wash.addColorStop(0.7, `rgba(${tint}, 0.035)`);
      wash.addColorStop(1, `rgba(${tint}, 0)`);
      g.fillStyle = wash;
      g.beginPath(); g.arc(0, 0, 380, 0, TAU); g.fill();
      // braziers
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        const bx = Math.cos(a) * 248, by = Math.sin(a) * 248;
        const fg = g.createRadialGradient(bx, by, 2, bx, by, 44);
        fg.addColorStop(0, 'rgba(255, 234, 176, 0.7)');
        fg.addColorStop(0.35, 'rgba(255, 172, 74, 0.26)');
        fg.addColorStop(1, 'rgba(255, 140, 40, 0)');
        g.fillStyle = fg;
        g.beginPath(); g.arc(bx, by, 44, 0, TAU); g.fill();
        g.fillStyle = 'rgba(18, 14, 10, 0.6)';
        g.beginPath(); g.ellipse(bx + 3, by + 9, 13, 7, 0, 0, TAU); g.fill();
        g.fillStyle = '#4d3c26';
        g.beginPath(); g.ellipse(bx, by + 4, 11, 8, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(230, 199, 135, 0.7)';
        g.lineWidth = 1.6;
        g.beginPath(); g.ellipse(bx, by + 4, 11, 8, 0, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(30, 22, 14, 0.8)';
        g.beginPath(); g.ellipse(bx, by + 2, 7.5, 5, 0, 0, TAU); g.fill();
        g.fillStyle = '#ffb85c';
        g.beginPath(); g.ellipse(bx, by - 3, 4.6, 8, 0, 0, TAU); g.fill();
        g.fillStyle = '#fff0c4';
        g.beginPath(); g.ellipse(bx, by - 5, 2.2, 4, 0, 0, TAU); g.fill();
      }
      // carved pillars
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        const x = Math.cos(a) * 328, y = Math.sin(a) * 328;
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.fillStyle = 'rgba(26, 34, 32, 0.55)';
        g.beginPath(); g.roundRect(-14, -24, 28, 48, 4); g.fill();
        g.strokeStyle = 'rgba(222, 198, 140, 0.35)';
        g.lineWidth = 2;
        g.beginPath(); g.roundRect(-14, -24, 28, 48, 4); g.stroke();
        g.fillStyle = col;
        g.globalAlpha = 0.5;
        g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
        g.restore();
      }
      g.restore();
    }

    // camp runes
    for (const camp of CAMPS) {
      const col = camp.kind === 'rage' ? '#ffb347' : '#9b8cff';
      g.save();
      g.translate(camp.x, camp.y);
      g.strokeStyle = camp.team === -1 ? 'rgba(190,200,255,0.22)' : `${TEAMS[camp.team].color}55`;
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 130, 0, TAU); g.stroke();
      g.setLineDash([12, 10]); g.globalAlpha = 0.6;
      g.beginPath(); g.arc(0, 0, 104, 0, TAU); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 0.5;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.fillStyle = col;
        g.globalAlpha = 0.28;
        g.beginPath(); g.arc(Math.cos(a) * 118, Math.sin(a) * 118, 4, 0, TAU); g.fill();
      }
      g.restore();
    }

    // Landmark zones: distinct visual identities and readable location names.
    for (const loc of MAP_LOCATIONS) {
      g.save();
      g.translate(loc.x, loc.y);
      const glow = g.createRadialGradient(0, 0, 18, 0, 0, 190);
      glow.addColorStop(0, 'rgba(235, 196, 112, 0.18)');
      glow.addColorStop(1, 'rgba(235, 196, 112, 0)');
      g.fillStyle = glow; g.beginPath(); g.arc(0, 0, 190, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(235, 205, 142, 0.38)'; g.lineWidth = 5;
      g.beginPath(); g.arc(0, 0, 118, 0, TAU); g.stroke();
      g.setLineDash([10, 12]); g.strokeStyle = 'rgba(235, 205, 142, 0.24)'; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 142, 0, TAU); g.stroke(); g.setLineDash([]);
      if (loc.kind === 'ruin') {
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8;
          g.save(); g.rotate(a); g.fillStyle = '#63543b'; g.fillRect(-13, -164, 26, 54);
          g.strokeStyle = 'rgba(239,210,155,.5)'; g.strokeRect(-13, -164, 26, 54); g.restore();
        }
      } else if (loc.kind === 'water') {
        g.fillStyle = 'rgba(40,150,170,.35)'; g.beginPath(); g.ellipse(0, 0, 76, 48, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(125,235,245,.55)'; g.lineWidth = 4; g.stroke();
      } else {
        for (let i = 0; i < 7; i++) { const a = i * TAU / 7; g.fillStyle = '#244d34'; g.beginPath(); g.arc(Math.cos(a)*72, Math.sin(a)*72, 31, 0, TAU); g.fill(); g.fillStyle = 'rgba(100,160,92,.5)'; g.beginPath(); g.arc(Math.cos(a)*72-7, Math.sin(a)*72-9, 13, 0, TAU); g.fill(); }
      }
      g.fillStyle = 'rgba(8,18,16,.82)'; g.strokeStyle = 'rgba(238,211,158,.48)'; g.lineWidth = 2;
      g.beginPath(); g.roundRect(-104, 172, 208, 48, 10); g.fill(); g.stroke();
      g.fillStyle = '#f5dfb2'; g.font = 'bold 25px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(loc.name, 0, 196);
      g.restore();
    }

    // decorative trees
    if (!this.treeSprites) this.buildTreeSprites();
    const avoid = (x, y) => {
      if (Math.max(Math.abs(x - 640), Math.abs(y - 2960)) < 620) return true;
      if (Math.max(Math.abs(x - 2960), Math.abs(y - 640)) < 620) return true;
      if (Math.abs(x - y) / Math.SQRT2 < RIVER.width / 2 + 80) return true;
      for (const lane of Object.values(LANES)) if (distToPolyline(x, y, lane.points) < 210) return true;
      for (const camp of CAMPS) if (dist(x, y, camp.x, camp.y) < 240) return true;
      return false;
    };
    // low ground cover
    for (let i = 0; i < 300; i++) {
      const x = 110 + rnd() * (WORLD - 220), y = 110 + rnd() * (WORLD - 220);
      let near = false;
      for (const lane of Object.values(LANES)) if (distToPolyline(x, y, lane.points) < 130) { near = true; break; }
      if (near || avoid(x, y)) continue;
      const spr = this.bushSprites[(rnd() * this.bushSprites.length) | 0];
      const w = 46 + rnd() * 46, h = w * (spr.height / spr.width);
      g.globalAlpha = 0.8 + rnd() * 0.2;
      g.drawImage(spr, x - w / 2, y - h * 0.82, w, h);
      g.globalAlpha = 1;
    }
    const trees = [];
    for (let i = 0; i < 280; i++) {
      const x = 120 + rnd() * (WORLD - 240), y = 120 + rnd() * (WORLD - 240);
      if (avoid(x, y)) continue;
      trees.push({ x, y, s: 0.5 + rnd() * 0.8, v: (rnd() * 4) | 0 });
    }
    trees.sort((a, b) => a.y - b.y);
    for (const tr of trees) {
      const spr = this.treeSprites[tr.v];
      const w = 120 + tr.s * 70;
      const h = w * (spr.height / spr.width);
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.32)';
      g.beginPath(); g.ellipse(tr.x + 8, tr.y + 6, w * 0.3, w * 0.1, 0, 0, TAU); g.fill();
      g.drawImage(spr, tr.x - w / 2, tr.y - h * 0.94, w, h);
      g.restore();
    }

    // rocks
    for (let i = 0; i < 46; i++) {
      const x = 140 + rnd() * (WORLD - 280), y = 140 + rnd() * (WORLD - 280);
      if (avoid(x, y) || rnd() < 0.4) continue;
      const r = 10 + rnd() * 26;
      g.save();
      g.translate(x, y);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.beginPath(); g.ellipse(5, 6, r * 1.2, r * 0.55, 0, 0, TAU); g.fill();
      g.fillStyle = '#4f5b56';
      g.beginPath();
      g.moveTo(-r, 0); g.lineTo(-r * 0.6, -r * 0.9); g.lineTo(r * 0.4, -r * 0.7); g.lineTo(r, 0); g.lineTo(r * 0.5, r * 0.5); g.lineTo(-r * 0.6, r * 0.4); g.closePath(); g.fill();
      g.fillStyle = 'rgba(160, 180, 166, 0.22)';
      g.beginPath(); g.moveTo(-r * 0.6, -r * 0.9); g.lineTo(r * 0.4, -r * 0.7); g.lineTo(0, -r * 0.2); g.closePath(); g.fill();
      g.restore();
    }

    // flowers / glow caps
    for (let i = 0; i < 210; i++) {
      const x = 100 + rnd() * (WORLD - 200), y = 100 + rnd() * (WORLD - 200);
      if (avoid(x, y)) continue;
      const c = rnd() < 0.3 ? 'rgba(255, 214, 120, 0.5)' : rnd() < 0.5 ? 'rgba(120, 240, 220, 0.32)' : 'rgba(220, 240, 220, 0.22)';
      g.fillStyle = c;
      g.beginPath(); g.arc(x, y, 1.2 + rnd() * 1.8, 0, TAU); g.fill();
    }

    // edge shadow
    const edge = g.createRadialGradient(CENTER, CENTER, 1400, CENTER, CENTER, 2100);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(1, 6, 9, 0.5)');
    g.fillStyle = edge;
    g.fillRect(0, 0, WORLD, WORLD);

    this.terrain = c;
    this.minimapBg = document.createElement('canvas');
    this.minimapBg.width = 220; this.minimapBg.height = 220;
    const mg = this.minimapBg.getContext('2d');
    mg.drawImage(c, 0, 0, 220, 220);
    mg.fillStyle = 'rgba(2, 8, 12, 0.32)';
    mg.fillRect(0, 0, 220, 220);
  }

  strokePath(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }

  // ---------------- camera helpers ----------------
  updateCamera(dt) {
    const p = this.game?.player;
    if (!p) return;
    if (this.intro > 0) this.intro = Math.max(0, this.intro - dt);
    const targetZoom = this.baseZoom * this.userZoom * (1 + Math.sin(Math.min(1, (1.4 - this.intro) / 1.4) * Math.PI) * 0.06);
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 4);
    const mw = this.screenToWorld(this.mouse.x, this.mouse.y);
    let tx = p.alive ? p.x : this.cam.x;
    let ty = p.alive ? p.y : this.cam.y;
    if (p.alive) {
      const lookX = clamp((mw.x - p.x) * 0.1, -110, 110);
      const lookY = clamp((mw.y - p.y) * 0.08, -90, 90);
      tx += lookX; ty += lookY;
    }
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 7);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 7);
    const halfW = this.w / 2 / this.zoom;
    const halfH = this.h / 2 / this.zoom;
    this.cam.x = halfW * 2 > WORLD ? CENTER : clamp(this.cam.x, halfW + 20, WORLD - halfW - 20);
    this.cam.y = halfH * 2 > WORLD ? CENTER : clamp(this.cam.y, halfH + 20, WORLD - halfH - 20);
    const shake = this.settings.shake && this.game ? this.game.shake : 0;
    const s = shake * (this.settings.quality ? 1 : 0.5);
    this.shakeX = (Math.random() - 0.5) * s;
    this.shakeY = (Math.random() - 0.5) * s;
    this.time += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.game?.storm.active) {
      if (this.time - this.lastLightning > 5 + Math.random() * 7) {
        this.lastLightning = this.time;
        this.flash = 0.5;
      }
      for (const r of this.rain) {
        r.y += r.speed * dt * 0.62;
        if (r.y > 1.05) { r.y = -0.05; r.x = Math.random(); }
      }
    }
  }

  screenToWorld(sx, sy) {
    return {
      x: this.cam.x + (sx - this.w / 2) / this.zoom,
      y: this.cam.y + (sy - this.h / 2) / this.zoom,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.cam.x) * this.zoom + this.w / 2,
      y: (wy - this.cam.y) * this.zoom + this.h / 2,
    };
  }

  // ---------------- main render ----------------
  render() {
    if (!this.game) return;
    const ctx = this.ctx;
    const g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#06110f';
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.w / 2 + this.shakeX, this.h / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    const view = this.viewRect();

    if (this.terrain) ctx.drawImage(this.terrain, 0, 0, WORLD, WORLD);
    this.drawWater(ctx, view);
    this.drawWaterRipples(ctx);
    this.drawFlies(ctx, view);
    this.drawLeaves(ctx, view);
    this.drawCampRunes(ctx);
    this.drawStructureShadows(ctx, view);

    const units = [];
    for (const u of g.units) {
      if (!u.alive) continue;
      if (u.team !== g.playerTeam && !g.canPlayerSee(u)) continue;
      if (u.x < view.x - 160 || u.x > view.x + view.w + 160 || u.y < view.y - 200 || u.y > view.y + view.h + 200) continue;
      units.push(u);
    }
    units.sort((a, b) => (a.kind === 'tower' || a.kind === 'nexus' ? -10000 : a.y) - (b.kind === 'tower' || b.kind === 'nexus' ? -10000 : b.y));
    for (const s of g.structures) {
      if (!s.alive) continue;
      if (this.inView(s, view, 220)) this.drawStructure(ctx, s);
    }
    for (const u of units) {
      if (u.kind === 'minion') this.drawMinion(ctx, u);
      else if (u.kind === 'camp') this.drawCamp(ctx, u);
      else if (u.kind === 'hero') this.drawHero(ctx, u);
    }
    this.drawZones(ctx);
    this.drawProjectiles(ctx);
    this.drawEffects(ctx);
    this.drawAim(ctx);
    this.drawMoveMarker(ctx);
    ctx.restore();

    this.drawFog();
    this.drawTexts(ctx);
    this.drawScreenFX(ctx);
    this.drawMinimap();
  }

  viewRect() {
    return {
      x: this.cam.x - this.w / 2 / this.zoom,
      y: this.cam.y - this.h / 2 / this.zoom,
      w: this.w / this.zoom,
      h: this.h / this.zoom,
    };
  }

  inView(u, view, pad = 100) {
    return u.x > view.x - pad && u.x < view.x + view.w + pad && u.y > view.y - pad && u.y < view.y + view.h + pad;
  }

  drawWater(ctx, view) {
    if (!this.settings.quality) return;
    const t = this.time;
    ctx.save();
    ctx.translate(CENTER, CENTER);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.rect(-2600, -RIVER.width / 2 - 12, 5200, RIVER.width + 24);
    ctx.clip();
    // drifting shimmer bands
    ctx.strokeStyle = '#c8fffb';
    for (let i = 0; i < 18; i++) {
      const x = ((i * 211 + t * 26) % 3400) - 1700;
      const y = Math.sin(i * 2.1 + t * 0.4) * 105;
      ctx.globalAlpha = 0.04 + (i % 5) * 0.014;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x - 60, y);
      ctx.quadraticCurveTo(x, y - 6, x + 50, y + 2);
      ctx.stroke();
    }
    // quick glints
    ctx.strokeStyle = '#eafffb';
    for (let i = 0; i < 14; i++) {
      const x = ((i * 137 + t * 58) % 2800) - 1400;
      const y = Math.sin(i * 1.3 - t * 0.9) * 118;
      ctx.globalAlpha = 0.14 + 0.1 * Math.sin(t * 2 + i);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x + 14, y); ctx.stroke();
    }
    // sparkles
    ctx.fillStyle = '#e9fffd';
    for (let i = 0; i < 12; i++) {
      const x = ((i * 301 + t * 11) % 3200) - 1600;
      const y = Math.sin(i * 0.9 + t * 0.5) * 120;
      const a = 0.18 + 0.22 * Math.sin(t * 3 + i * 1.7);
      if (a <= 0.05) continue;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(x, y, 1.2, 0, TAU); ctx.fill();
    }
    // bank foam
    ctx.strokeStyle = '#bff7ef';
    for (let i = 0; i < 10; i++) {
      const x = ((i * 317 + t * 18) % 3000) - 1500;
      const edge = i % 2 === 0 ? -RIVER.width / 2 - 2 : RIVER.width / 2 + 2;
      ctx.globalAlpha = 0.06 + 0.04 * Math.sin(t * 1.6 + i);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - 18, edge + Math.sin(t + i) * 3);
      ctx.lineTo(x + 22, edge + Math.sin(t + i) * 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // mist puffs
    for (let i = 0; this.decor && i < 3; i++) {
      const x = ((i * 811 + t * 12) % 3000) - 1500;
      const y = Math.sin(i * 2.4 + t * 0.3) * 90;
      const a = 0.035 + 0.02 * Math.sin(t * 0.7 + i);
      const puff = ctx.createRadialGradient(x, y, 10, x, y, 190);
      puff.addColorStop(0, `rgba(210, 250, 245, ${a})`);
      puff.addColorStop(1, 'rgba(210, 250, 245, 0)');
      ctx.fillStyle = puff;
      ctx.beginPath(); ctx.arc(x, y, 190, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawWaterRipples(ctx) {
    if (!this.settings.quality || !this.decor) return;
    const t = this.time;
    const g = this.game;
    if (!g) return;
    const half = RIVER.width / 2 - 30;
    for (const u of g.units) {
      if (!u.alive || u.kind === 'tower' || u.kind === 'nexus') continue;
      if (u.team !== g.playerTeam && !g.canPlayerSee(u)) continue;
      if (Math.abs(u.x - u.y) / Math.SQRT2 > half) continue;
      if (dist(u.x, u.y, 1800, 1800) < 240) continue;
      const phase = (t * 0.65 + u.id * 0.37) % 1;
      const base = 16 + (u.radius || 20) * 0.75;
      ctx.save();
      ctx.strokeStyle = `rgba(190, 250, 245, ${0.2 * (1 - phase)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + 4, base * (0.7 + phase * 0.9), base * 0.36 * (0.7 + phase * 0.9), 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + 4, base * 0.55, base * 0.2, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawLeaves(ctx, view) {
    if (!this.settings.quality || !this.decor) return;
    const t = this.time;
    for (const l of this.leaves) {
      const x = (l.x + t * l.speed * 16) % WORLD;
      const y = (l.y + t * l.speed * 7 + Math.sin(t * 0.6 + l.phase) * 34) % WORLD;
      if (x < view.x - 40 || x > view.x + view.w + 40 || y < view.y - 40 || y > view.y + view.h + 40) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 0.7 + l.phase);
      ctx.fillStyle = l.green < 0.5
        ? `rgba(110, 170, 96, ${0.3 + l.green * 0.3})`
        : `rgba(196, 178, 92, ${0.22 + l.green * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, l.size, l.size * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 40, 20, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-l.size, 0); ctx.lineTo(l.size, 0); ctx.stroke();
      ctx.restore();
    }
  }

  drawFlies(ctx, view) {
    if (!this.settings.quality || !this.decor) return;
    const t = this.time;
    for (const f of this.flies) {
      if (f.x < view.x - 40 || f.x > view.x + view.w + 40 || f.y < view.y - 40 || f.y > view.y + view.h + 40) continue;
      const x = f.x + Math.sin(t * f.speed + f.phase) * 22;
      const y = f.y + Math.cos(t * f.speed * 0.8 + f.phase) * 16;
      const a = 0.35 + 0.3 * Math.sin(t * 1.7 + f.phase);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  drawCampRunes(ctx) {
    const t = this.time;
    for (const camp of CAMPS) {
      const creep = camp.creep;
      ctx.save();
      ctx.globalAlpha = creep && creep.alive ? 0.3 : 0.14;
      ctx.strokeStyle = camp.kind === 'rage' ? '#ffbe6b' : '#b7a8ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 12]);
      ctx.beginPath(); ctx.arc(camp.x, camp.y, 70 + Math.sin(t * 1.5) * 4, t * 0.4, t * 0.4 + TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  drawStructureShadows(ctx, view) {
    for (const s of this.game.structures) {
      if (!s.alive || !this.inView(s, view, 160)) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath(); ctx.ellipse(s.x + 10, s.y + 12, s.radius * 1.5, s.radius * 0.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  drawStructure(ctx, s) {
    const team = TEAMS[s.team];
    const t = this.time;
    const isNexus = s.isNexus;
    const r = s.radius;
    const pct = clamp01(s.hp / s.maxHp);
    const flash = s.hitFlash > 0 ? 1 : 0;

    // ground ring
    ctx.save();
    ctx.translate(s.x, s.y);
    const gd = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2.4);
    gd.addColorStop(0, team.color + '30');
    gd.addColorStop(0.65, team.color + '12');
    gd.addColorStop(1, team.color + '00');
    ctx.fillStyle = gd;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(190, 170, 130, 0.26)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.78, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = team.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.55, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.setLineDash([10, 14]);
    ctx.beginPath(); ctx.arc(0, 0, r * 2.02, -t * 0.2, -t * 0.2 + TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + t * 0.1;
      ctx.strokeStyle = team.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 1.6, Math.sin(a) * r * 1.6);
      ctx.lineTo(Math.cos(a) * r * 1.72, Math.sin(a) * r * 1.72);
      ctx.stroke();
    }
    ctx.restore();

    if (isNexus) {
      this.drawNexus(ctx, s, team, t, pct, flash);
    } else {
      const tierScale = s.tier === 'base' ? 1.18 : s.tier === 'inner' ? 1.05 : 1;
      const bodyH = 104 * tierScale;
      const bw = 34 * tierScale;
      ctx.save();
      ctx.translate(s.x, s.y);
      // stone platform
      const pg = ctx.createRadialGradient(0, 2, 8, 0, 2, r * 1.5);
      pg.addColorStop(0, '#64786f');
      pg.addColorStop(0.55, '#405450');
      pg.addColorStop(1, '#1e2c2c');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.ellipse(0, 16, r * 1.42, r * 0.62, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(205, 184, 132, 0.3)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(0, 10, r * 1.3, r * 0.55, 0, 0, TAU); ctx.stroke();
      // stepped stone base
      ctx.fillStyle = '#2c3a3d';
      ctx.beginPath();
      ctx.moveTo(-r * 1.25, 8); ctx.lineTo(-r * 0.95, -8); ctx.lineTo(r * 0.95, -8); ctx.lineTo(r * 1.25, 8);
      ctx.lineTo(r * 0.9, 30); ctx.lineTo(-r * 0.9, 30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#465a5c';
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -8); ctx.lineTo(-r * 0.66, -22); ctx.lineTo(r * 0.66, -22); ctx.lineTo(r * 0.9, -8);
      ctx.lineTo(r * 0.6, 16); ctx.lineTo(-r * 0.6, 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(224, 206, 156, 0.22)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.66, -22); ctx.lineTo(r * 0.66, -22); ctx.lineTo(r * 0.48, -17); ctx.lineTo(-r * 0.48, -17);
      ctx.closePath(); ctx.fill();
      // column
      const colGrad = ctx.createLinearGradient(-bw, 0, bw, 0);
      colGrad.addColorStop(0, '#28383c');
      colGrad.addColorStop(0.35, '#5b7070');
      colGrad.addColorStop(0.6, '#3c5052');
      colGrad.addColorStop(1, '#1d2b2e');
      ctx.fillStyle = colGrad;
      ctx.beginPath();
      ctx.moveTo(-bw, -10);
      ctx.lineTo(-bw * 0.72, -bodyH);
      ctx.lineTo(bw * 0.72, -bodyH);
      ctx.lineTo(bw, -10);
      ctx.closePath(); ctx.fill();
      // gold trims
      ctx.strokeStyle = 'rgba(222, 192, 132, 0.42)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-bw * 0.78, -bodyH + 6); ctx.lineTo(bw * 0.78, -bodyH + 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-bw * 0.95, -16); ctx.lineTo(bw * 0.95, -16); ctx.stroke();
      // cracks
      ctx.strokeStyle = 'rgba(10, 18, 20, 0.4)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-bw * 0.2, -bodyH * 0.72);
      ctx.lineTo(bw * 0.05, -bodyH * 0.52);
      ctx.lineTo(-bw * 0.12, -bodyH * 0.34);
      ctx.stroke();
      // runes on column
      ctx.strokeStyle = `rgba(${s.team === 0 ? '98,196,255' : '255,132,150'},${0.35 + 0.15 * Math.sin(t * 2 + s.id)})`;
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        const yy = -bodyH * (i / 4);
        ctx.beginPath(); ctx.moveTo(-bw * 0.5, yy); ctx.lineTo(0, yy - 9); ctx.lineTo(bw * 0.5, yy); ctx.stroke();
      }
      // war banners
      for (const side of [-1, 1]) {
        const px = side * (bw + 16);
        ctx.strokeStyle = '#6b5638';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(px, 8); ctx.lineTo(px, -bodyH * 0.9); ctx.stroke();
        ctx.fillStyle = '#a98d55';
        ctx.beginPath(); ctx.arc(px, -bodyH * 0.91, 3.2, 0, TAU); ctx.fill();
        const wave = Math.sin(t * 2.4 + side * 1.4) * 2.6;
        const top = -bodyH * 0.87, bh = 36;
        ctx.fillStyle = team.color + 'd8';
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px + side * 15, top + 3);
        ctx.quadraticCurveTo(px + side * 21 + wave, top + bh * 0.55, px + side * 10, top + bh);
        ctx.lineTo(px, top + bh * 0.9);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 236, 190, 0.5)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px + side * 3, top + 3);
        ctx.quadraticCurveTo(px + side * 10 + wave * 0.5, top + bh * 0.5, px + side * 4, top + bh * 0.8);
        ctx.stroke();
      }
      // crystal
      const glow = ctx.createRadialGradient(0, -bodyH - 16, 0, 0, -bodyH - 16, 58);
      glow.addColorStop(0, team.color2); glow.addColorStop(0.35, team.color + 'aa'); glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, -bodyH - 14, 58, 0, TAU); ctx.fill();
      ctx.fillStyle = flash ? '#ffffff' : team.color;
      ctx.beginPath();
      const cy = -bodyH - 16;
      ctx.moveTo(0, cy - 30); ctx.lineTo(20, cy - 4); ctx.lineTo(12, cy + 24); ctx.lineTo(-12, cy + 24); ctx.lineTo(-20, cy - 4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, cy - 26); ctx.lineTo(0, cy + 20);
      ctx.moveTo(-12, cy - 2); ctx.lineTo(0, cy + 12); ctx.lineTo(12, cy - 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.moveTo(0, cy - 26); ctx.lineTo(9, cy - 4); ctx.lineTo(0, cy + 6); ctx.lineTo(-6, cy - 4); ctx.closePath(); ctx.fill();
      // floating shards
      for (let i = 0; i < 3; i++) {
        const a = t * 0.7 + i * 2.1;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = team.color2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * (36 + i * 8), cy + Math.sin(a) * 18, 3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // rising embers
      for (let i = 0; i < 4; i++) {
        const rise = ((t * 0.26 + i * 0.25) % 1);
        const ex = Math.sin(t * 1.4 + i * 2.2) * (14 + i * 5);
        const ey = 6 - rise * bodyH * 0.9;
        ctx.globalAlpha = (1 - rise) * 0.5;
        ctx.fillStyle = team.color2;
        ctx.beginPath(); ctx.arc(ex, ey, 1.8, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      if (s.invulnerable) this.drawShieldDome(ctx, s, team, t, false);
      if (pct < 1) this.drawWorldBar(ctx, s.x, s.y - bodyH - 78, 84, pct, team.color, s.team, s.invulnerable);
    }
  }

  drawNexus(ctx, s, team, t, pct, flash) {
    ctx.save();
    ctx.translate(s.x, s.y);
    const cy = -88;
    // platform
    ctx.fillStyle = '#1b2b2e';
    ctx.beginPath(); ctx.ellipse(0, 4, 122, 46, 0, 0, TAU); ctx.fill();
    const pp = ctx.createRadialGradient(0, -4, 10, 0, -4, 112);
    pp.addColorStop(0, '#6b7d74');
    pp.addColorStop(0.55, '#3a4c4b');
    pp.addColorStop(1, '#16201f');
    ctx.fillStyle = pp;
    ctx.beginPath(); ctx.ellipse(0, -4, 112, 40, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3c5152';
    ctx.beginPath(); ctx.ellipse(0, -8, 96, 34, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(226, 200, 142, 0.32)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 2, 120, 44, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = team.color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 64, -6 + Math.sin(a) * 23);
      ctx.lineTo(Math.cos(a) * 102, -6 + Math.sin(a) * 37);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = team.color + '77';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, -8, 72, 24, 0, t * 0.5, t * 0.5 + TAU); ctx.stroke();
    // light pillar
    const beam = ctx.createLinearGradient(0, cy - 380, 0, cy + 60);
    beam.addColorStop(0, team.color + '00');
    beam.addColorStop(0.55, team.color + '12');
    beam.addColorStop(1, team.color + '3a');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-16, cy + 60);
    ctx.lineTo(-44, cy - 380);
    ctx.lineTo(44, cy - 380);
    ctx.lineTo(16, cy + 60);
    ctx.closePath(); ctx.fill();
    // beams
    for (let i = 0; i < 4; i++) {
      const a = t * 0.35 + i * (TAU / 4);
      const gx = Math.cos(a) * 70, gy = -8 + Math.sin(a) * 20;
      const grad = ctx.createLinearGradient(gx, gy, 0, cy);
      grad.addColorStop(0, team.color + '00');
      grad.addColorStop(1, team.color + '55');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(0, cy); ctx.stroke();
    }
    // outer glow
    const glow = ctx.createRadialGradient(0, cy, 8, 0, cy, 130);
    glow.addColorStop(0, team.color2);
    glow.addColorStop(0.3, team.color + 'aa');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, cy, 130, 0, TAU); ctx.fill();
    // orbiting stone shards
    for (let i = 0; i < 5; i++) {
      const a = t * 0.45 + i * (TAU / 5);
      ctx.save();
      ctx.translate(Math.cos(a) * 118, cy + Math.sin(a) * 34);
      ctx.rotate(a * 0.7);
      ctx.fillStyle = '#2c3b3d';
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = team.color + '66';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = team.color2;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(-2, -1, 1.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // rings
    ctx.strokeStyle = team.color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.ellipse(0, cy, 86, 26, t * 0.4, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.ellipse(0, cy, 58, 92, -t * 0.3, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    // crystal
    const bob = Math.sin(t * 1.3) * 7;
    ctx.fillStyle = flash ? '#fff' : team.color;
    this.applyGlow(ctx, team.color2, 30);
    ctx.beginPath();
    const top = cy - 82 + bob, bot = cy + 40 + bob;
    ctx.moveTo(0, top); ctx.lineTo(38, cy - 24 + bob); ctx.lineTo(26, bot - 20); ctx.lineTo(0, bot); ctx.lineTo(-26, bot - 20); ctx.lineTo(-38, cy - 24 + bob);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath(); ctx.moveTo(0, top + 8); ctx.lineTo(16, cy - 24 + bob); ctx.lineTo(0, cy + 22 + bob); ctx.lineTo(-10, cy - 26 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(0, cy - 10 + bob, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, top + 10); ctx.lineTo(0, cy + 24 + bob);
    ctx.moveTo(-26, cy - 26 + bob); ctx.lineTo(0, cy - 2 + bob); ctx.lineTo(26, cy - 26 + bob);
    ctx.stroke();
    // rising light motes
    for (let i = 0; i < 8; i++) {
      const rise = ((t * 0.16 + i / 8) % 1);
      const ex = Math.sin(t * 1.1 + i * 2.4) * 66 * (0.4 + rise * 0.6);
      const ey = cy + 46 - rise * 250;
      ctx.globalAlpha = (1 - rise) * 0.55;
      ctx.fillStyle = i % 2 ? team.color2 : '#fff4d0';
      ctx.beginPath(); ctx.arc(ex, ey, 1.6, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (s.invulnerable) this.drawShieldDome(ctx, s, team, t, true);
    this.drawWorldBar(ctx, s.x, s.y - 224, 150, pct, team.color, s.team, s.invulnerable, true);
  }

  drawShieldDome(ctx, s, team, t, big) {
    const r = (big ? 148 : 92) + Math.sin(t * 2) * 3;
    ctx.save();
    ctx.translate(s.x, s.y - (big ? 80 : 48));
    ctx.globalAlpha = 0.14;
    const grad = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
    grad.addColorStop(0, 'rgba(160, 220, 255, 0)');
    grad.addColorStop(0.75, 'rgba(140, 210, 255, 0.32)');
    grad.addColorStop(1, 'rgba(200, 245, 255, 0.04)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.36;
    ctx.strokeStyle = '#b9ecff';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath(); ctx.ellipse(0, 0, r * (0.62 + i * 0.18), r * 0.24, t * (0.2 + i * 0.1), 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  drawWorldBar(ctx, x, y, w, pct, color, team, invuln, big = false) {
    const h = big ? 11 : 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(3,8,12,0.85)';
    ctx.fillRect(-w / 2 - 2, -2, w + 4, h + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(-w / 2, 0, w, h);
    const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    if (team === 0) { grad.addColorStop(0, '#2f7fe0'); grad.addColorStop(1, '#79d4ff'); }
    else { grad.addColorStop(0, '#e03950'); grad.addColorStop(1, '#ff9dab'); }
    ctx.fillStyle = grad;
    ctx.fillRect(-w / 2, 0, w * pct, h);
    ctx.strokeStyle = invuln ? 'rgba(160,220,255,0.7)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 - 1, -1, w + 2, h + 2);
    if (invuln) {
      ctx.fillStyle = 'rgba(180,230,255,0.85)';
      ctx.font = '600 8px Manrope, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('KEBAL', 0, -5);
    }
    ctx.restore();
  }

  drawMinion(ctx, m) {
    const team = TEAMS[m.team];
    const t = this.time;
    const rad = m.radius;
    const bob = Math.sin(t * 7 + m.id) * 2;
    const pct = clamp01(m.hp / m.maxHp);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 4, rad * 1.15, rad * 0.5, 0, 0, TAU); ctx.fill();
    // team glow + foot ring for readability in swarms
    const mg = ctx.createRadialGradient(0, 2, rad * 0.2, 0, 2, rad * 1.9);
    mg.addColorStop(0, team.color + '3d');
    mg.addColorStop(1, team.color + '00');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.ellipse(0, 2, rad * 1.9, rad * 1.1, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = team.color + '59';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 3, rad * 1.1, rad * 0.48, 0, 0, TAU); ctx.stroke();
    ctx.rotate(m.face + Math.PI / 2);
    const step = Math.sin(t * 9 + m.id * 1.7);
    if (m.minionType === 'cannon' || m.type === 'cannon') {
      // siege cart
      ctx.fillStyle = '#211c15';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(side * rad * 0.66, rad * 0.5, rad * 0.26, rad * 0.5, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(168, 136, 86, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(side * rad * 0.66, rad * 0.5, rad * 0.2, rad * 0.4, 0, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = '#4a3a26';
      ctx.beginPath(); ctx.roundRect(-rad * 0.82, -rad * 0.75, rad * 1.64, rad * 1.35, rad * 0.3); ctx.fill();
      ctx.strokeStyle = '#8d7448';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-rad * 0.82, -rad * 0.75, rad * 1.64, rad * 1.35, rad * 0.3); ctx.stroke();
      ctx.fillStyle = 'rgba(30, 24, 16, 0.55)';
      ctx.fillRect(-rad * 0.82, -rad * 0.15, rad * 1.64, rad * 0.2);
      // barrel
      ctx.fillStyle = '#2b3136';
      ctx.beginPath();
      ctx.moveTo(-rad * 0.26, -rad * 0.65);
      ctx.lineTo(-rad * 0.38, -rad * 1.62);
      ctx.lineTo(rad * 0.38, -rad * 1.62);
      ctx.lineTo(rad * 0.26, -rad * 0.65);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#59646a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-rad * 0.3, -rad * 1.0);
      ctx.lineTo(-rad * 0.35, -rad * 1.55);
      ctx.stroke();
      ctx.strokeStyle = team.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -rad * 1.6, rad * 0.38, rad * 0.14, 0, 0, TAU); ctx.stroke();
      // muzzle glow
      const mg2 = ctx.createRadialGradient(0, -rad * 1.58, 0, 0, -rad * 1.58, rad * 0.4);
      mg2.addColorStop(0, team.color2); mg2.addColorStop(1, team.color + '00');
      ctx.fillStyle = mg2;
      ctx.beginPath(); ctx.arc(0, -rad * 1.58, rad * 0.4, 0, TAU); ctx.fill();
      // pennant
      ctx.strokeStyle = '#6b5638';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-rad * 0.74, -rad * 0.1); ctx.lineTo(-rad * 0.74, -rad * 1.25); ctx.stroke();
      ctx.fillStyle = team.color;
      ctx.beginPath();
      ctx.moveTo(-rad * 0.74, -rad * 1.22);
      ctx.lineTo(-rad * 0.34, -rad * 1.1);
      ctx.lineTo(-rad * 0.74, -rad * 0.92);
      ctx.closePath(); ctx.fill();
      // crystal core
      ctx.fillStyle = team.color;
      ctx.beginPath(); ctx.moveTo(0, -rad * 0.5); ctx.lineTo(rad * 0.22, -rad * 0.2); ctx.lineTo(0, rad * 0.28); ctx.lineTo(-rad * 0.22, -rad * 0.2); ctx.closePath(); ctx.fill();
    } else if (m.ranged || m.minionType === 'ranged') {
      // arcanist
      ctx.fillStyle = team.dark;
      ctx.beginPath(); ctx.moveTo(0, -rad * 0.9); ctx.lineTo(rad * 0.8, rad * 0.8); ctx.lineTo(-rad * 0.8, rad * 0.8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = team.color;
      ctx.globalAlpha = 0.92;
      ctx.beginPath(); ctx.moveTo(0, -rad * 0.75); ctx.lineTo(rad * 0.42, rad * 0.5); ctx.lineTo(-rad * 0.42, rad * 0.5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255, 240, 210, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -rad * 0.7); ctx.lineTo(0, rad * 0.45); ctx.stroke();
      // hood + head
      ctx.fillStyle = team.dark;
      ctx.beginPath(); ctx.arc(0, -rad * 0.78, rad * 0.42, 0, TAU); ctx.fill();
      ctx.fillStyle = '#101a1c';
      ctx.beginPath(); ctx.arc(0, -rad * 0.74, rad * 0.26, 0, TAU); ctx.fill();
      ctx.fillStyle = team.color2;
      ctx.beginPath(); ctx.ellipse(0, -rad * 0.76, rad * 0.12, rad * 0.045, 0, 0, TAU); ctx.fill();
      // staff with orb
      ctx.strokeStyle = '#7a6038';
      ctx.lineWidth = Math.max(1.4, rad * 0.14);
      ctx.beginPath(); ctx.moveTo(rad * 0.42, rad * 0.52); ctx.lineTo(rad * 0.95, -rad * 0.48); ctx.stroke();
      ctx.fillStyle = '#d9c7a8';
      ctx.beginPath(); ctx.arc(rad * 0.5, rad * 0.4, rad * 0.08, 0, TAU); ctx.fill();
      const ox = rad * 0.99, oy = -rad * 0.62;
      const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, rad * 0.34);
      og.addColorStop(0, team.color2); og.addColorStop(0.5, team.color + 'aa'); og.addColorStop(1, team.color + '00');
      ctx.fillStyle = og;
      ctx.beginPath(); ctx.arc(ox, oy, rad * 0.34, 0, TAU); ctx.fill();
      ctx.fillStyle = team.color2;
      ctx.beginPath(); ctx.arc(ox, oy, rad * 0.11, 0, TAU); ctx.fill();
    } else {
      // armored footman
      ctx.fillStyle = team.dark;
      ctx.beginPath(); ctx.ellipse(0, rad * 0.15, rad * 0.72, rad * 0.85, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1d2629';
      ctx.beginPath(); ctx.roundRect(-rad * 0.42, rad * 0.28 + step * rad * 0.06, rad * 0.3, rad * 0.62, rad * 0.12); ctx.fill();
      ctx.beginPath(); ctx.roundRect(rad * 0.12, rad * 0.28 - step * rad * 0.06, rad * 0.3, rad * 0.62, rad * 0.12); ctx.fill();
      // torso
      ctx.fillStyle = '#3d4c50';
      ctx.beginPath(); ctx.roundRect(-rad * 0.5, -rad * 0.72, rad * 1.0, rad * 1.22, rad * 0.3); ctx.fill();
      // tabard
      ctx.fillStyle = team.color;
      ctx.beginPath(); ctx.roundRect(-rad * 0.33, -rad * 0.62, rad * 0.66, rad * 0.92, rad * 0.2); ctx.fill();
      ctx.fillStyle = team.color2;
      ctx.beginPath(); ctx.moveTo(0, -rad * 0.5); ctx.lineTo(rad * 0.15, -rad * 0.2); ctx.lineTo(0, rad * 0.15); ctx.lineTo(-rad * 0.15, -rad * 0.2); ctx.closePath(); ctx.fill();
      // belt
      ctx.strokeStyle = 'rgba(226, 196, 132, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-rad * 0.5, rad * 0.28); ctx.lineTo(rad * 0.5, rad * 0.28); ctx.stroke();
      // pauldrons
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#5b6d70';
        ctx.beginPath(); ctx.arc(side * rad * 0.56, -rad * 0.5, rad * 0.26, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(226, 196, 132, 0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(side * rad * 0.56, -rad * 0.5, rad * 0.26, 0, TAU); ctx.stroke();
      }
      // head + helm
      ctx.fillStyle = '#33424a';
      ctx.beginPath(); ctx.arc(0, -rad * 0.86, rad * 0.36, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1b2326';
      ctx.beginPath(); ctx.arc(0, -rad * 0.8, rad * 0.26, 0, TAU); ctx.fill();
      ctx.fillStyle = team.color2;
      ctx.beginPath(); ctx.ellipse(0, -rad * 0.84, rad * 0.16, rad * 0.05, 0, 0, TAU); ctx.fill();
      // crest
      ctx.fillStyle = team.color;
      ctx.beginPath(); ctx.moveTo(0, -rad * 1.32); ctx.lineTo(rad * 0.12, -rad * 1.05); ctx.lineTo(-rad * 0.12, -rad * 1.05); ctx.closePath(); ctx.fill();
      // shield
      ctx.fillStyle = '#dde7e3';
      ctx.beginPath(); ctx.ellipse(-rad * 0.7, -rad * 0.2, rad * 0.26, rad * 0.4, -0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(226, 196, 132, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(-rad * 0.7, -rad * 0.2, rad * 0.26, rad * 0.4, -0.2, 0, TAU); ctx.stroke();
      ctx.fillStyle = team.color;
      ctx.beginPath(); ctx.ellipse(-rad * 0.7, -rad * 0.2, rad * 0.11, rad * 0.2, -0.2, 0, TAU); ctx.fill();
      // sword
      ctx.fillStyle = '#dfe8ec';
      ctx.beginPath();
      ctx.moveTo(rad * 0.52, rad * 0.12);
      ctx.lineTo(rad * 0.7, -rad * 0.16);
      ctx.lineTo(rad * 1.32, -rad * 1.08);
      ctx.lineTo(rad * 1.16, -rad * 0.86);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 250, 230, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(rad * 0.66, -rad * 0.02); ctx.lineTo(rad * 1.2, -rad * 0.94); ctx.stroke();
      ctx.strokeStyle = '#b08c4f';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(rad * 0.44, rad * 0.16); ctx.lineTo(rad * 0.74, -rad * 0.2); ctx.stroke();
    }
    ctx.restore();
    if (pct < 1) {
      ctx.fillStyle = 'rgba(2,6,9,0.75)';
      ctx.fillRect(m.x - rad * 0.85, m.y - rad - 14 + bob, rad * 1.7, 4);
      ctx.fillStyle = team.color;
      ctx.fillRect(m.x - rad * 0.85, m.y - rad - 14 + bob, rad * 1.7 * pct, 4);
    }
  }

  drawCamp(ctx, u) {
    const t = this.time;
    const camp = CAMPS.find((c) => c.id === u.campId);
    const col = camp && camp.kind === 'rage' ? '#ffb347' : '#9b8cff';
    const pct = clamp01(u.hp / u.maxHp);
    const r = u.radius;
    const bob = Math.sin(t * 2.2 + u.id) * 2;
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 6, r * 1.4, r * 0.55, 0, 0, TAU); ctx.fill();
    ctx.rotate(u.face + Math.PI / 2);
    // fur spikes
    ctx.fillStyle = '#2a2433';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const sx = Math.cos(a), sy = Math.sin(a) * 1.25;
      ctx.beginPath();
      ctx.moveTo(sx * r * 0.55, sy * r * 0.55);
      ctx.lineTo(sx * r * (1.25 + (i % 3) * 0.12), sy * r * 1.15);
      ctx.lineTo(Math.cos(a + 0.35) * r * 0.6, Math.sin(a + 0.35) * r * 0.85);
      ctx.closePath(); ctx.fill();
    }
    // beast body
    ctx.fillStyle = '#332f3e';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 1.25, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4a4258';
    ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 0.75, r * 0.8, 0, 0, TAU); ctx.fill();
    // mane
    ctx.strokeStyle = 'rgba(20, 16, 26, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -r * 0.55, r * 0.72, Math.PI * 0.15, Math.PI * 0.85, true); ctx.stroke();
    // claws
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.55;
    for (const cx of [-r * 0.6, 0, r * 0.6]) {
      ctx.beginPath(); ctx.moveTo(cx - 3, r * 0.95); ctx.lineTo(cx, r * 1.3); ctx.lineTo(cx + 3, r * 0.95); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // horns
    ctx.strokeStyle = camp && camp.kind === 'rage' ? '#e8b067' : '#b9a9ff';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.6); ctx.quadraticCurveTo(-r * 1.1, -r * 1.2, -r * 0.4, -r * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 0.6); ctx.quadraticCurveTo(r * 1.1, -r * 1.2, r * 0.4, -r * 1.5); ctx.stroke();
    // eyes
    ctx.fillStyle = col;
    this.applyGlow(ctx, col, 12);
    ctx.beginPath(); ctx.arc(-r * 0.26, -r * 0.62, 3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.26, -r * 0.62, 3, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    // drifting wisps
    for (let i = 0; i < 3; i++) {
      const a = t * 0.8 + i * (TAU / 3);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.28 + Math.sin(t * 2 + i) * 0.12;
      ctx.beginPath();
      ctx.arc(u.x + Math.cos(a) * r * 1.85, u.y + Math.sin(a * 1.4) * r * 0.7 - r * 0.5, 3.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // aura
    ctx.save();
    ctx.globalAlpha = 0.14 + Math.sin(t * 2) * 0.04;
    const grad = ctx.createRadialGradient(u.x, u.y, r, u.x, u.y, r * 3);
    grad.addColorStop(0, col); grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(u.x, u.y, r * 3, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(2,6,9,0.75)';
    ctx.fillRect(u.x - 32, u.y - r - 26 + bob, 64, 5);
    ctx.fillStyle = col;
    ctx.fillRect(u.x - 32, u.y - r - 26 + bob, 64 * pct, 5);
    ctx.fillStyle = 'rgba(230,240,250,0.8)';
    ctx.font = '600 9px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(camp ? camp.name : 'Roh', u.x, u.y - r - 33 + bob);
  }

  drawHero(ctx, h) {
    const t = this.time;
    const def = h.def;
    const team = TEAMS[h.team];
    const pct = clamp01(h.hp / h.maxHp);
    const moving = h.vx || h.vy;
    const walk = moving ? Math.sin(t * 12) : 0;
    const bob = Math.sin(t * 2.2 + h.id) * 1.6 + (moving ? Math.abs(walk) * 2.2 : 0);
    const scale = 1 + (h.sizeScale - 1) * 0.7;
    const isPlayer = h.isPlayer;
    const facing = Math.cos(h.face) >= 0 ? 1 : -1;
    const invis = h.hasBuff('invis');

    ctx.save();
    ctx.globalAlpha = invis ? 0.45 : 1;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(h.x, h.y + 8, 30 * scale, 12 * scale, 0, 0, TAU); ctx.fill();

    // team ring
    ctx.save();
    ctx.translate(h.x, h.y + 6);
    ctx.strokeStyle = team.color;
    ctx.lineWidth = isPlayer ? 3.5 : 2.5;
    ctx.globalAlpha = isPlayer ? 0.95 : 0.55;
    ctx.beginPath(); ctx.ellipse(0, 0, 32 * scale, 14 * scale, 0, 0, TAU); ctx.stroke();
    if (isPlayer) {
      ctx.strokeStyle = '#ffe6a0';
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.ellipse(0, 0, 38 * scale, 17 * scale, 0, t * 0.6, t * 0.6 + TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // player chevron
    if (isPlayer) {
      const cy = h.y - 104 + Math.sin(t * 3) * 3;
      ctx.fillStyle = '#ffe6a0';
      this.applyGlow(ctx, '#ffcf6a', 10);
      ctx.beginPath(); ctx.moveTo(h.x - 8, cy); ctx.lineTo(h.x + 8, cy); ctx.lineTo(h.x, cy + 9); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (h.recallT > 0) {
      ctx.save();
      ctx.strokeStyle = '#9ff6ff';
      ctx.globalAlpha = 0.5 + Math.sin(t * 10) * 0.2;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 4, 40, 17, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(120,230,255,0.12)';
      ctx.beginPath(); ctx.arc(h.x, h.y - 20, 32, 0, TAU); ctx.fill();
      ctx.restore();
    }

    const attack = clamp01(h.attackAnim / 0.25);
    const cast = clamp01(h.castAnim / 0.3);
    const nudge = attack > 0 ? Math.sin(attack * Math.PI) * 8 : 0;
    const R = 34 * scale;
    ctx.save();
    ctx.translate(h.x + Math.cos(h.face) * nudge, h.y - 30 + bob);

    // aura
    if (h.hasBuff('dmg')) {
      ctx.globalAlpha = 0.3;
      const ag = ctx.createRadialGradient(0, 6, 6, 0, 6, R * 2.1);
      ag.addColorStop(0, '#ffb347'); ag.addColorStop(1, 'transparent');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(0, 6, R * 2.1, 0, TAU); ctx.fill();
      ctx.globalAlpha = invis ? 0.45 : 1;
    }
    if (cast > 0) {
      ctx.globalAlpha = cast * 0.5;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 4, R + 4 + (1 - cast) * 24, 0, TAU); ctx.stroke();
      ctx.globalAlpha = invis ? 0.45 : 1;
    }

    const token = this.heroTokens[def.id];
    if (token && token.complete && token.naturalWidth > 0) {
      this.drawHeroToken(ctx, h, token, R, t, walk);
    } else {
      ctx.scale(scale * facing, scale);
      this.drawHeroBody(ctx, h, t, walk, attack);
    }

    // weapon swing flash
    if (attack > 0) {
      ctx.globalAlpha = attack * 0.5;
      ctx.strokeStyle = '#fff6d8';
      ctx.lineWidth = 3;
      ctx.save();
      ctx.rotate(Math.atan2(Math.sin(h.face) * 0.5, Math.cos(h.face)));
      ctx.beginPath(); ctx.arc(R + 7, 0, R * 0.85, -0.75, 0.55); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = invis ? 0.45 : 1;
    }
    ctx.restore();
    ctx.restore();

    // status ring
    if (h.hasBuff('stun')) {
      ctx.save();
      ctx.fillStyle = '#ffe08a';
      for (let i = 0; i < 3; i++) {
        const a = t * 3 + i * (TAU / 3);
        ctx.beginPath(); ctx.arc(h.x + Math.cos(a) * 40, h.y - 30 + Math.sin(a) * 12, 3.2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    if (h.hasBuff('shield')) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#9ff6ff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(h.x, h.y - 30, 42, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#9ff6ff';
      ctx.beginPath(); ctx.arc(h.x, h.y - 30, 42, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (h.hasBuff('slow')) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#8fd8ff';
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 6, 36, 16, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    // health bar
    const barW = isPlayer ? 76 : 60;
    const barY = h.y - 82;
    ctx.save();
    ctx.fillStyle = 'rgba(2,6,10,0.82)';
    ctx.fillRect(h.x - barW / 2 - 2, barY - 2, barW + 4, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(h.x - barW / 2, barY, barW, 8);
    const hpGrad = ctx.createLinearGradient(h.x - barW / 2, 0, h.x + barW / 2, 0);
    if (h.team === 0) { hpGrad.addColorStop(0, '#2fae6c'); hpGrad.addColorStop(1, '#78f0ae'); }
    else { hpGrad.addColorStop(0, '#c53a4e'); hpGrad.addColorStop(1, '#ff92a2'); }
    ctx.fillStyle = hpGrad;
    ctx.fillRect(h.x - barW / 2, barY, barW * pct, 8);
    const shieldPct = clamp01(h.shield / h.maxHp);
    if (shieldPct > 0) {
      ctx.fillStyle = 'rgba(235,250,255,0.8)';
      ctx.fillRect(h.x - barW / 2, barY, Math.min(barW, barW * (pct + shieldPct)), 2);
    }
    ctx.strokeStyle = isPlayer ? '#ffe6a0' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth = isPlayer ? 1.6 : 1;
    ctx.strokeRect(h.x - barW / 2 - 1, barY - 1, barW + 2, 10);
    // level pip
    ctx.fillStyle = h.team === 0 ? '#4ea8ff' : '#ff5a6e';
    ctx.beginPath(); ctx.arc(h.x - barW / 2 - 11, barY + 4, 7.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 8px Manrope, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(h.level), h.x - barW / 2 - 11, barY + 4.5);
    // mana
    if (isPlayer) {
      ctx.fillStyle = 'rgba(2,6,10,0.75)';
      ctx.fillRect(h.x - barW / 2, barY + 10, barW, 4);
      ctx.fillStyle = '#55a8ff';
      ctx.fillRect(h.x - barW / 2, barY + 10, barW * h.mpPct, 4);
    }
    if (isPlayer) {
      ctx.fillStyle = 'rgba(255,240,200,0.9)';
      ctx.font = '600 9px Manrope, sans-serif';
      ctx.fillText(def.name, h.x, barY - 8);
    } else if (h.team === 0) {
      ctx.fillStyle = 'rgba(190,215,225,0.6)';
      ctx.font = '600 8px Manrope, sans-serif';
      ctx.fillText(def.name, h.x, barY - 7);
    }
    ctx.restore();
  }

  drawHeroBody(ctx, h, t, walk, attack) {
    const def = h.def;
    const col = def.color;
    const acc = def.accent || '#ffd88a';
    const leg = walk * 3;
    // legs / robe base
    ctx.fillStyle = 'rgba(10, 18, 26, 0.95)';
    ctx.beginPath(); ctx.ellipse(0, 8, 16, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(-13, 10); ctx.lineTo(-10, -28); ctx.lineTo(10, -28); ctx.lineTo(13, 10); ctx.quadraticCurveTo(0, 16, -13, 10); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // torso
    const bodyGrad = ctx.createLinearGradient(0, -34, 0, 8);
    bodyGrad.addColorStop(0, acc);
    bodyGrad.addColorStop(0.35, col);
    bodyGrad.addColorStop(1, 'rgba(12,20,28,0.95)');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(-11, -30);
    ctx.quadraticCurveTo(-16, -12, -9, 6);
    ctx.lineTo(9, 6);
    ctx.quadraticCurveTo(16, -12, 11, -30);
    ctx.closePath(); ctx.fill();
    // head
    ctx.fillStyle = def.id === 'barong' || def.id === 'rangda' ? '#e8c9a0' : '#f0d5b0';
    ctx.beginPath(); ctx.arc(0, -38, 9.5, 0, TAU); ctx.fill();
    // headdress / hair
    ctx.fillStyle = acc;
    ctx.beginPath(); ctx.arc(0, -41, 10, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(8,14,20,0.9)';
    ctx.beginPath(); ctx.arc(-2, -37.5, 1.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(3, -37.5, 1.4, 0, TAU); ctx.fill();
    // arms
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-10, -24); ctx.lineTo(-17, -8 + leg); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, -24); ctx.lineTo(17 + attack * 7, -10 - attack * 4); ctx.stroke();
    // hero-specific features
    ctx.save();
    if (def.id === 'garuda') {
      ctx.fillStyle = 'rgba(120, 225, 255, 0.82)';
      ctx.beginPath(); ctx.moveTo(-9, -26); ctx.quadraticCurveTo(-38, -50, -30, -12); ctx.quadraticCurveTo(-22, -18, -9, -18); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9, -26); ctx.quadraticCurveTo(38, -50, 30, -12); ctx.quadraticCurveTo(22, -18, 9, -18); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = acc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, -10 - attack * 4); ctx.lineTo(30, -30); ctx.stroke();
    } else if (def.id === 'hanuman') {
      ctx.fillStyle = '#c9a06a';
      ctx.beginPath(); ctx.arc(-9, -43, 4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -43, 4, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#d9b174'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-8, -2); ctx.quadraticCurveTo(-28, 8, -20, -18); ctx.stroke();
      ctx.strokeStyle = acc; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(18, -8); ctx.lineTo(28, -46); ctx.stroke();
    } else if (def.id === 'barong') {
      ctx.fillStyle = '#b8402a';
      ctx.beginPath(); ctx.arc(0, -42, 13, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = acc;
      ctx.beginPath(); ctx.moveTo(-10, -46); ctx.quadraticCurveTo(-24, -60, -16, -40); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(10, -46); ctx.quadraticCurveTo(24, -60, 16, -40); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,160,0.9)';
      ctx.beginPath(); ctx.arc(-4, -37, 2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -37, 2, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#e8c9a0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -32, 6, 0.2, Math.PI - 0.2); ctx.stroke();
    } else if (def.id === 'rangda') {
      ctx.strokeStyle = '#d94f7a'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const sx = -9 + i * 6;
        ctx.beginPath(); ctx.moveTo(sx, -44); ctx.quadraticCurveTo(sx - 10 + i * 4, -56, sx + 4, -58); ctx.stroke();
      }
      ctx.strokeStyle = '#f0d5b0'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-14, -12); ctx.lineTo(-22, -4); ctx.moveTo(-11, -10); ctx.lineTo(-19, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(14, -12); ctx.lineTo(22, -4); ctx.stroke();
    } else if (def.id === 'nyai') {
      ctx.fillStyle = 'rgba(80, 220, 210, 0.75)';
      ctx.beginPath(); ctx.arc(17 + Math.sin(t * 2) * 3, -16, 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#bfffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(17 + Math.sin(t * 2) * 3, -16, 8, 0, TAU); ctx.stroke();
      ctx.fillStyle = acc;
      ctx.beginPath(); ctx.moveTo(-7, -47); ctx.lineTo(-4, -55); ctx.lineTo(0, -47); ctx.lineTo(4, -55); ctx.lineTo(7, -47); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(90, 210, 200, 0.5)';
      ctx.beginPath(); ctx.moveTo(-13, 10); ctx.quadraticCurveTo(-20, 26, -8, 30); ctx.lineTo(8, 30); ctx.quadraticCurveTo(20, 26, 13, 10); ctx.closePath(); ctx.fill();
    } else if (def.id === 'kala') {
      ctx.strokeStyle = '#2b1d2e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-7, -46); ctx.quadraticCurveTo(-16, -58, -8, -62); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, -46); ctx.quadraticCurveTo(16, -58, 8, -62); ctx.stroke();
      ctx.fillStyle = acc;
      ctx.beginPath(); ctx.arc(-3, -38, 1.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -38, 1.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#c9b7d6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, -8); ctx.lineTo(26, -22); ctx.moveTo(-16, -8); ctx.lineTo(-24, -18); ctx.stroke();
    }
    ctx.restore();
  }

  drawHeroToken(ctx, h, img, R, t, walk) {
    const isPlayer = h.isPlayer;
    const team = TEAMS[h.team];
    const tint = h.team === 0 ? 'rgba(88, 196, 255,' : 'rgba(255, 96, 118,';

    // ground glow
    const glow = ctx.createRadialGradient(0, R * 0.75, R * 0.3, 0, R * 0.75, R * 2.1);
    glow.addColorStop(0, tint + '0.26)');
    glow.addColorStop(1, tint + '0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, R * 0.75, R * 2.1, 0, TAU); ctx.fill();

    // pedestal
    ctx.fillStyle = 'rgba(2, 8, 12, 0.55)';
    ctx.beginPath(); ctx.ellipse(0, R * 0.92, R * 0.95, R * 0.3, 0, 0, TAU); ctx.fill();

    ctx.save();
    ctx.rotate(Math.sin(t * 5 + h.id) * 0.02 + (walk ? walk * 0.015 : 0));
    ctx.drawImage(img, -R, -R, R * 2, R * 2);
    // inner shadow rim
    ctx.strokeStyle = 'rgba(4, 10, 14, 0.78)';
    ctx.lineWidth = Math.max(2, R * 0.12);
    ctx.beginPath(); ctx.arc(0, 0, R - 1, 0, TAU); ctx.stroke();
    // team / player ring
    ctx.strokeStyle = isPlayer ? '#ffe3a1' : team.color;
    ctx.lineWidth = Math.max(1.5, R * 0.08);
    ctx.beginPath(); ctx.arc(0, 0, R + Math.max(1.5, R * 0.06), 0, TAU); ctx.stroke();
    // outer hairline
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, R + Math.max(3, R * 0.16), 0, TAU); ctx.stroke();
    // gloss
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.beginPath(); ctx.arc(0, 0, R - Math.max(3, R * 0.16), Math.PI * 1.08, Math.PI * 1.55); ctx.stroke();
    // player ornament ticks
    if (isPlayer) {
      ctx.strokeStyle = 'rgba(255,227,161,0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + t * 0.25;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (R + 4), Math.sin(a) * (R + 4));
        ctx.lineTo(Math.cos(a) * (R + 8), Math.sin(a) * (R + 8));
        ctx.stroke();
      }
    }
    ctx.restore();

    // facing indicator
    ctx.save();
    ctx.translate(0, R * 0.92);
    ctx.rotate(Math.atan2(Math.sin(h.face) * 0.45, Math.cos(h.face)));
    ctx.fillStyle = isPlayer ? 'rgba(255,227,161,0.95)' : 'rgba(235,245,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(R * 0.8, 0); ctx.lineTo(R * 0.44, -R * 0.15); ctx.lineTo(R * 0.44, R * 0.15);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawZones(ctx) {
    const t = this.time;
    for (const z of this.game.zones) {
      if (z.dead) continue;
      const p = clamp01(z.elapsed / z.duration);
      ctx.save();
      ctx.translate(z.x, z.y);
      const grad = ctx.createRadialGradient(0, 0, z.radius * 0.2, 0, 0, z.radius);
      grad.addColorStop(0, z.color + '4d');
      grad.addColorStop(0.7, z.color + '22');
      grad.addColorStop(1, z.color + '05');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, z.radius, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, z.radius, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([10, 16]);
      ctx.beginPath(); ctx.arc(0, 0, z.radius * 0.82, t * 0.6, t * 0.6 + TAU); ctx.stroke();
      ctx.setLineDash([]);
      const left = 1 - p;
      ctx.globalAlpha = 0.35 + Math.sin(t * 3) * 0.08;
      for (let i = 0; i < 5; i++) {
        const a = t * 0.7 + i * (TAU / 5);
        ctx.fillStyle = z.color;
        ctx.beginPath(); ctx.arc(Math.cos(a) * z.radius * 0.65, Math.sin(a) * z.radius * 0.65, 3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, z.radius * 0.9, -Math.PI / 2, -Math.PI / 2 + left * TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawProjectiles(ctx) {
    for (const p of this.game.projectiles) {
      if (p.dead) continue;
      const angle = p.homing && p.targetId ? (() => {
        const tg = this.game.getUnitById(p.targetId);
        return tg ? Math.atan2(tg.y - p.y, tg.x - p.x) : p.angle;
      })() : p.angle;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.isTowerShot) {
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.3, p.color);
        grad.addColorStop(1, p.color + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
      } else if (p.isBasic) {
        ctx.rotate(angle);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5;
        this.applyGlow(ctx, p.color, 8);
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(8, 0); ctx.stroke();
        ctx.fillStyle = '#fff6dd';
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(4, -3.4); ctx.lineTo(4, 3.4); ctx.closePath(); ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, (p.size || 8) * 2.4);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, p.color);
        grad.addColorStop(1, p.color + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(0, 0, (p.size || 8) * 2.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, Math.max(2, (p.size || 8) * 0.5), 0, TAU); ctx.fill();
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-Math.cos(angle) * 30, -Math.sin(angle) * 30); ctx.lineTo(0, 0); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawAim(ctx) {
    if (!this.aim) return;
    const { ability, wx, wy } = this.aim;
    const p = this.game.player;
    if (!p.alive) return;
    const range = ability.range || 500;
    const d = dist(p.x, p.y, wx, wy);
    const ang = Math.atan2(wy - p.y, wx - p.x);
    const tx = p.x + Math.cos(ang) * Math.min(d, range);
    const ty = p.y + Math.sin(ang) * Math.min(d, range);
    ctx.save();
    ctx.fillStyle = 'rgba(232,194,106,0.05)';
    ctx.strokeStyle = 'rgba(232,194,106,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, range, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    const kind = ability.kind;
    if (kind === 'aoe' || kind === 'zone') {
      const rad = ability.radius || 150;
      ctx.fillStyle = (ability.color || '#ffe6a0') + '33';
      ctx.strokeStyle = ability.color || '#ffe6a0';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(tx, ty, rad, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([8, 10]);
      ctx.beginPath(); ctx.arc(tx, ty, rad * 0.7, this.time, this.time + TAU); ctx.stroke();
      ctx.setLineDash([]);
      // line to target
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ffe6a0';
      ctx.beginPath(); ctx.arc(tx, ty, 4, 0, TAU); ctx.fill();
    } else if (kind === 'cone') {
      const spread = ability.spread || 0.7;
      ctx.fillStyle = (ability.color || '#ffe6a0') + '2b';
      ctx.strokeStyle = ability.color || '#ffe6a0';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, range, ang - spread / 2, ang + spread / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (kind === 'dash' || kind === 'leap' || kind === 'blink') {
      ctx.strokeStyle = ability.color || '#8ff6de';
      ctx.lineWidth = 26;
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(tx, ty, 12, 0, TAU); ctx.stroke();
    } else if (kind === 'selfBuff' || kind === 'auraShield' || kind === 'stealth') {
      ctx.strokeStyle = ability.color || '#ffe6a0';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 52 + Math.sin(this.time * 6) * 5, 0, TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = ability.color || '#ffe6a0';
      ctx.lineWidth = 22;
      ctx.globalAlpha = 0.16;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = '#ffe6a0';
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(ang) * 12, ty + Math.sin(ang) * 12);
      ctx.lineTo(tx + Math.cos(ang + 2.4) * 9, ty + Math.sin(ang + 2.4) * 9);
      ctx.lineTo(tx + Math.cos(ang - 2.4) * 9, ty + Math.sin(ang - 2.4) * 9);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawMoveMarker(ctx) {
    const p = this.game.player;
    if (!p.alive) return;
    if (p.moveTarget) {
      const t = this.time;
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#ffe6a0';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.moveTarget.x, p.moveTarget.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.8;
      const r = 12 + Math.sin(t * 6) * 3;
      ctx.beginPath(); ctx.arc(p.moveTarget.x, p.moveTarget.y, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(p.moveTarget.x, p.moveTarget.y, 3, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (p.attackTargetId) {
      const tg = this.game.getUnitById(p.attackTargetId);
      if (tg && tg.alive) {
        ctx.save();
        ctx.strokeStyle = '#ff7d8d';
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2;
        const r = tg.radius + 12 + Math.sin(this.time * 5) * 3;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = this.time * 0.6 + i * (TAU / 4);
          ctx.moveTo(tg.x + Math.cos(a) * r, tg.y + Math.sin(a) * r);
          ctx.lineTo(tg.x + Math.cos(a) * (r + 8), tg.y + Math.sin(a) * (r + 8));
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ---------------- effects ----------------
  drawEffects(ctx) {
    for (const e of this.game.effects) {
      const p = clamp01(e.t / e.life);
      const x = e.x, y = e.y;
      const a = 1 - p;
      ctx.save();
      switch (e.type) {
        case 'slash':
          ctx.translate(x, y);
          ctx.rotate(e.angle || 0);
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a;
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, 0, e.radius + p * 14, -0.9, 0.9); ctx.stroke();
          ctx.globalAlpha = a * 0.4;
          ctx.lineWidth = 10;
          ctx.beginPath(); ctx.arc(0, 0, e.radius + p * 10, -0.8, 0.8); ctx.stroke();
          break;
        case 'impact':
        case 'hitSpark':
        case 'shockwave':
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a * 0.85;
          ctx.lineWidth = e.type === 'shockwave' ? 6 : 3;
          ctx.beginPath(); ctx.arc(x, y, e.radius * (0.35 + p * 1.2), 0, TAU); ctx.stroke();
          if (e.type !== 'shockwave') {
            for (let i = 0; i < 6; i++) {
              const ang = (i / 6) * TAU + p;
              ctx.beginPath();
              ctx.moveTo(x + Math.cos(ang) * e.radius * p * 0.6, y + Math.sin(ang) * e.radius * p * 0.6);
              ctx.lineTo(x + Math.cos(ang) * e.radius * (0.5 + p), y + Math.sin(ang) * e.radius * (0.5 + p));
              ctx.stroke();
            }
          }
          break;
        case 'death':
          ctx.fillStyle = e.color;
          for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * TAU + e.id;
            const rr = p * e.radius;
            ctx.globalAlpha = a;
            ctx.beginPath(); ctx.arc(x + Math.cos(ang) * rr, y - p * 30 + Math.sin(ang) * rr * 0.6, 3 * a + 1, 0, TAU); ctx.fill();
          }
          break;
        case 'soul':
          ctx.globalAlpha = a * 0.8;
          ctx.fillStyle = e.color;
          this.applyGlow(ctx, e.color, 16);
          ctx.beginPath(); ctx.arc(x + Math.sin(p * 6) * 10, y - p * 70, 6 * a, 0, TAU); ctx.fill();
          break;
        case 'heal':
          ctx.globalAlpha = a;
          ctx.strokeStyle = '#7dffb0';
          ctx.lineWidth = 2.5;
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * TAU + p * 2;
            const rx = x + Math.cos(ang) * 22, ry = y + Math.sin(ang) * 10 - p * 34;
            ctx.beginPath(); ctx.moveTo(rx - 4, ry); ctx.lineTo(rx + 4, ry); ctx.moveTo(rx, ry - 4); ctx.lineTo(rx, ry + 4); ctx.stroke();
          }
          break;
        case 'levelup':
          ctx.globalAlpha = a * 0.8;
          const lg = ctx.createLinearGradient(x, y - 130, x, y + 20);
          lg.addColorStop(0, 'transparent'); lg.addColorStop(0.5, e.color); lg.addColorStop(1, 'transparent');
          ctx.fillStyle = lg;
          ctx.fillRect(x - 22, y - 130, 44, 150);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 2;
          ctx.globalAlpha = a;
          ctx.beginPath(); ctx.ellipse(x, y, 40 + p * 50, 16 + p * 18, 0, 0, TAU); ctx.stroke();
          break;
        case 'stun':
          ctx.fillStyle = '#ffe08a';
          for (let i = 0; i < 4; i++) {
            const ang = p * 5 + i * (TAU / 4);
            ctx.globalAlpha = a;
            ctx.beginPath(); ctx.arc(x + Math.cos(ang) * e.radius, y - 26 + Math.sin(ang) * 7, 3, 0, TAU); ctx.fill();
          }
          break;
        case 'teleport':
        case 'spawn':
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a * 0.9;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(x, y, e.radius * (0.3 + p * 1.1), e.radius * (0.12 + p * 0.4), 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = a * 0.25;
          ctx.fillStyle = e.color;
          ctx.fillRect(x - e.radius * 0.22, y - 150 * p, e.radius * 0.44, 150 * p);
          break;
        case 'towerShot':
          ctx.translate(x, y);
          ctx.rotate(e.angle || 0);
          ctx.fillStyle = e.color;
          ctx.globalAlpha = a;
          ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(0, -12); ctx.lineTo(4, 0); ctx.lineTo(0, 12); ctx.closePath(); ctx.fill();
          break;
        case 'towerDeath':
        case 'nexusBreak':
          ctx.globalAlpha = a;
          const grd = ctx.createRadialGradient(x, y, 0, x, y, e.radius * (0.4 + p));
          grd.addColorStop(0, '#fff8dd'); grd.addColorStop(0.3, e.color); grd.addColorStop(1, 'transparent');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(x, y, e.radius * (0.4 + p), 0, TAU); ctx.fill();
          for (let i = 0; i < 16; i++) {
            const ang = (i / 16) * TAU + e.id;
            const rr = p * e.radius * 1.2;
            ctx.fillStyle = i % 2 ? e.color : '#e6d6ae';
            ctx.globalAlpha = a;
            ctx.beginPath(); ctx.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr - p * 30, 5 * a + 1, 0, TAU); ctx.fill();
          }
          break;
        case 'rubble':
          ctx.globalAlpha = a * 0.8;
          ctx.fillStyle = '#6b6152';
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * TAU;
            const rr = 20 + p * e.radius * 0.8;
            ctx.beginPath(); ctx.ellipse(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.5 + 6, 10 * a + 3, 5 * a + 2, ang, 0, TAU); ctx.fill();
          }
          break;
        case 'campSpawn':
        case 'campDeath':
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(x, y, e.radius * (0.4 + p), e.radius * (0.15 + p * 0.4), 0, 0, TAU); ctx.stroke();
          break;
        case 'shieldHit':
        case 'shieldBreak':
          ctx.strokeStyle = '#9ff6ff';
          ctx.globalAlpha = a;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 26 + p * 20, -0.8, 0.8); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 26 + p * 20, 2.2, 3.8); ctx.stroke();
          break;
        case 'stormBolt':
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a;
          ctx.lineWidth = 5;
          this.applyGlow(ctx, e.color, 18);
          ctx.beginPath();
          let bx = x, by = y - 600;
          ctx.moveTo(bx, by);
          for (let i = 0; i < 7; i++) {
            by += 80;
            bx += Math.sin(e.id + i * 2.3) * 26;
            ctx.lineTo(bx, by);
          }
          ctx.lineTo(x, y); ctx.stroke();
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + 20, y - 380); ctx.lineTo(x + 52, y - 300); ctx.moveTo(x - 16, y - 240); ctx.lineTo(x - 44, y - 170); ctx.stroke();
          break;
        case 'dust':
        case 'smoke':
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * TAU + e.id;
            const rr = p * e.radius * 0.8;
            ctx.globalAlpha = a * 0.35;
            ctx.fillStyle = e.type === 'smoke' ? '#adb7b5' : e.color;
            ctx.beginPath(); ctx.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.5 - p * 12, 8 + p * 10, 0, TAU); ctx.fill();
          }
          break;
        case 'telegraph':
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, e.radius, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = e.color;
          ctx.beginPath(); ctx.arc(x, y, e.radius * p, 0, TAU); ctx.fill();
          break;
        case 'zoneStart':
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a;
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(x, y, e.radius * (0.2 + p * 0.9), 0, TAU); ctx.stroke();
          break;
        case 'zoneTick':
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a * 0.5;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, e.radius * (0.3 + p), 0, TAU); ctx.stroke();
          break;
        case 'dashEnd':
          ctx.strokeStyle = '#fff';
          ctx.globalAlpha = a * 0.5;
          ctx.lineWidth = 2;
          for (let i = 0; i < 4; i++) {
            ctx.beginPath(); ctx.moveTo(x - 30 + i * 16, y - 20 + i * 8); ctx.lineTo(x - 60 + i * 16, y - 20 + i * 8); ctx.stroke();
          }
          break;
        case 'stormHit':
          break;
        default:
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = a * 0.7;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, e.radius * (0.4 + p), 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawTexts(ctx) {
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    for (const t of this.game.texts) {
      const a = clamp01(t.t / t.life);
      const alpha = 1 - a;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${t.crit ? 26 : t.size}px Manrope, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
    ctx.restore();
  }

  drawFog() {
    if (!this.decor) return;
    const g = this.game;
    const now = performance.now();
    const interval = this.settings.quality ? 90 : 130;
    let sig = Math.round(this.cam.x * 0.5) | 0;
    for (const u of g.units) {
      if (!u.alive || u.team !== g.playerTeam) continue;
      sig = (sig * 31 + (u.x | 0) + ((u.y | 0) * 7)) | 0;
    }
    for (const s of g.structures) {
      if (s.alive && s.team === g.playerTeam) sig = (sig * 31 + (s.hp | 0)) | 0;
    }
    if (this._fogDirty || (sig !== this._fogSig && now - this._fogStamp >= interval)) {
      const mctx = this.fogMaskCtx;
      const fctx = this.fogCtx;
      const sx = this.fog.width / this.w;
      const sy = this.fog.height / this.h;
      mctx.setTransform(sx, 0, 0, sy, 0, 0);
      mctx.clearRect(0, 0, this.w, this.h);
      for (const u of g.units) {
        if (!u.alive || u.team !== g.playerTeam) continue;
        const s = this.worldToScreen(u.x, u.y);
        if (s.x < -100 || s.x > this.w + 100 || s.y < -100 || s.y > this.h + 100) continue;
        const r = (u.sight || 500) * 0.95 * this.zoom;
        mctx.drawImage(this._visionBrush, s.x - r, s.y - r, r * 2, r * 2);
      }
      // allied structures grant a permanent vision halo (own base always readable)
      for (const s of g.structures) {
        if (!s.alive || s.team !== g.playerTeam) continue;
        const p = this.worldToScreen(s.x, s.y);
        if (p.x < -260 || p.x > this.w + 260 || p.y < -260 || p.y > this.h + 260) continue;
        const r = (s.isNexus ? 520 : 400) * this.zoom;
        mctx.drawImage(this._baseBrush, p.x - r, p.y - r, r * 2, r * 2);
      }
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.fillStyle = 'rgba(2, 7, 11, 0.68)';
      fctx.fillRect(0, 0, this.fog.width, this.fog.height);
      fctx.globalCompositeOperation = 'destination-out';
      fctx.drawImage(this.fogMask, 0, 0);
      fctx.globalCompositeOperation = 'source-over';
      this._fogStamp = now;
      this._fogSig = sig;
      this._fogDirty = false;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.drawImage(this.fog, 0, 0, this.w, this.h);
  }

  drawScreenFX(ctx) {
    const g = this.game;
    const p = g.player;
    const t = this.time;
    // cinematic grade: baked sun shafts + vignette
    ctx.save();
    ctx.drawImage(this._fxCanvas, 0, 0, this.w, this.h);
    ctx.restore();
    const hp = p.hp / p.maxHp;
    if (hp < 0.28 && p.alive) {
      const intensity = (0.28 - hp) / 0.28;
      const grad = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.3, this.w / 2, this.h / 2, this.h * 0.72);
      grad.addColorStop(0, 'rgba(120,0,10,0)');
      grad.addColorStop(1, `rgba(120,4,14,${0.36 * intensity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (g.storm.active) {
      ctx.save();
      ctx.strokeStyle = 'rgba(150, 220, 255, 0.16)';
      ctx.lineWidth = 1;
      for (const r of this.rain) {
        const x = r.x * this.w, y = r.y * this.h;
        ctx.globalAlpha = r.a;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + r.len); ctx.stroke();
      }
      ctx.restore();
      if (this.flash > 0) {
        ctx.fillStyle = `rgba(180, 225, 255, ${this.flash * 0.22})`;
        ctx.fillRect(0, 0, this.w, this.h);
      }
    }
    if (g.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  // ---------------- minimap ----------------
  drawMinimap() {
    const now = performance.now();
    if (!this._miniDirty && now - this._miniStamp < 66) return;
    this._miniStamp = now;
    this._miniDirty = false;
    const m = this.mctx;
    const g = this.game;
    const S = 220;
    const k = S / WORLD;
    m.clearRect(0, 0, S, S);
    if (this.minimapBg) m.drawImage(this.minimapBg, 0, 0);
    else { m.fillStyle = '#0a1a18'; m.fillRect(0, 0, S, S); }
    for (const s of g.structures) {
      if (!s.alive) continue;
      const x = s.x * k, y = s.y * k;
      m.fillStyle = s.team === 0 ? '#4ea8ff' : '#ff5a6e';
      m.beginPath();
      if (s.isNexus) { m.arc(x, y, 5, 0, TAU); m.fill(); }
      else { m.rect(x - 2.5, y - 2.5, 5, 5); m.fill(); }
    }
    for (const c of CAMPS) {
      if (c.creep && c.creep.alive) {
        m.fillStyle = c.kind === 'rage' ? '#ffb347' : '#9b8cff';
        m.beginPath(); m.arc(c.x * k, c.y * k, 2.2, 0, TAU); m.fill();
      }
    }
    for (const u of g.units) {
      if (!u.alive || u.kind === 'tower' || u.kind === 'nexus') continue;
      if (u.team !== g.playerTeam && !g.canPlayerSee(u)) continue;
      const x = u.x * k, y = u.y * k;
      if (u.kind === 'minion') {
        m.fillStyle = u.team === 0 ? 'rgba(78,168,255,0.7)' : 'rgba(255,90,110,0.7)';
        m.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
      } else if (u.kind === 'camp') {
        m.fillStyle = '#b7a8ff';
        m.beginPath(); m.arc(x, y, 2, 0, TAU); m.fill();
      } else if (u.kind === 'hero') {
        m.fillStyle = u.team === 0 ? '#7fd0ff' : '#ff97a4';
        m.beginPath(); m.arc(x, y, u.isPlayer ? 4 : 3, 0, TAU); m.fill();
        if (u.isPlayer) {
          m.strokeStyle = '#ffe6a0'; m.lineWidth = 1.5;
          m.beginPath(); m.arc(x, y, 5.5, 0, TAU); m.stroke();
        }
      }
    }
    // camera rect
    const view = this.viewRect();
    m.strokeStyle = 'rgba(255,235,180,0.6)';
    m.lineWidth = 1;
    m.strokeRect(view.x * k, view.y * k, view.w * k, view.h * k);
    // fog vignette
    m.save();
    const vg = m.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    m.fillStyle = vg;
    m.fillRect(0, 0, S, S);
    m.restore();
  }
}
