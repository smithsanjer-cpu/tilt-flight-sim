'use strict';
/* Tilt Flight - mobile flight simulator. No assets, no build step. */
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const RAD = Math.PI / 180;
let W = 0, H = 0, DPR = 1, safeTop = 0, landscape = false;
let vigG = null;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  landscape = W > H * 1.15;
  safeTop = $('safe').offsetHeight || 0;
  cacheVig();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

/* ---------- planes ---------- */
const PLANES = {
  cargo: { name: 'CARGO HAULER', he: 'מטוס מטען', vmin: 48, vmax: 135, stall: 54, cruise: 85, pitchMax: 20, rollMax: 30, resp: 1.6, turn: 0.55, thrRate: 0.28, accel: 0.35, startAlt: 900, dash: ['#2c3138', '#1b1f24'], accent: '#d9a441', climbK: 0.7 },
  passenger: { name: 'AIRLINER', he: 'מטוס נוסעים', vmin: 75, vmax: 240, stall: 80, cruise: 160, pitchMax: 18, rollMax: 32, resp: 2.0, turn: 0.5, thrRate: 0.4, accel: 0.5, startAlt: 1800, dash: ['#2b3440', '#171d25'], accent: '#5ec8ff', climbK: 0.8 },
  fighter: { name: 'FIGHTER JET', he: 'מטוס קרב', vmin: 95, vmax: 430, stall: 100, cruise: 230, pitchMax: 38, rollMax: 75, resp: 4.2, turn: 0.9, thrRate: 0.7, accel: 0.9, startAlt: 1500, dash: ['#1d2420', '#0e1411'], accent: '#6dff8a', climbK: 1.1 }
};
const WORLD_SPEED = 3.2;

/* ---------- weather ---------- */
const WEATHERS = [
  { id: 'clear', he: 'בהיר', cover: 0.3, dark: 0, rain: 0, fog: 0.1, warm: 0, turb: 0, light: 0, top: [38, 118, 222], hor: [186, 222, 250] },
  { id: 'cloudy', he: 'מעונן', cover: 0.85, dark: 0.2, rain: 0, fog: 0.25, warm: 0, turb: 0.12, light: 0, top: [98, 124, 156], hor: [196, 208, 220] },
  { id: 'rain', he: 'גשם', cover: 1, dark: 0.45, rain: 0.75, fog: 0.55, warm: 0, turb: 0.3, light: 0, top: [66, 80, 98], hor: [132, 144, 156] },
  { id: 'storm', he: 'סערה', cover: 1, dark: 0.72, rain: 1, fog: 0.65, warm: 0, turb: 0.8, light: 1, top: [28, 34, 46], hor: [80, 90, 104] },
  { id: 'fog', he: 'ערפל', cover: 0.45, dark: 0.1, rain: 0, fog: 1, warm: 0, turb: 0.05, light: 0, top: [150, 164, 176], hor: [214, 220, 224] },
  { id: 'sunset', he: 'שקיעה', cover: 0.55, dark: 0.12, rain: 0, fog: 0.2, warm: 1, turb: 0.05, light: 0, top: [52, 60, 128], hor: [255, 164, 96] }
];
const WX = { idx: 0, cur: null, timer: 0, auto: true };
function wxCopy(w) { return { cover: w.cover, dark: w.dark, rain: w.rain, fog: w.fog, warm: w.warm, turb: w.turb, light: w.light, top: w.top.slice(), hor: w.hor.slice() }; }
WX.cur = wxCopy(WEATHERS[0]);
function setWeather(i) { WX.idx = (i + WEATHERS.length) % WEATHERS.length; WX.timer = 0; }
function updateWeather(dt) {
  const t = WEATHERS[WX.idx], c = WX.cur, k = 1 - Math.exp(-dt / 2.2);
  for (const key of ['cover', 'dark', 'rain', 'fog', 'warm', 'turb', 'light']) c[key] = lerp(c[key], t[key], k);
  for (let i = 0; i < 3; i++) { c.top[i] = lerp(c.top[i], t.top[i], k); c.hor[i] = lerp(c.hor[i], t.hor[i], k); }
  WX.timer += dt;
  if (WX.auto && WX.timer > 45) { let n; do { n = Math.floor(Math.random() * WEATHERS.length); } while (n === WX.idx); setWeather(n); }
}

/* ---------- state ---------- */
let state = 'menu', planeKey = 'passenger', P = null, T = 0;
const ctl = { pitch: 0, roll: 0 };
const input = { motion: false, motionAsked: false, pad: false, padForced: false, keys: {}, thrIds: new Set(), brakeIds: new Set(), padId: null, padVec: [0, 0] };
const sensor = { got: false, beta: 0, gamma: 0, b0: 0, g0: 0, needCal: true, lastT: 0 };
const warn = { text: '', t: 0 };
const wp = { x: 0, z: 0, n: 1, flash: 0 };
let lightning = 0, nextBolt = 6;

function resetFlight() {
  const d = PLANES[planeKey];
  P = { x: 0, z: 0, alt: d.startAlt, hdg: 0, pitch: 0, roll: 0, spd: d.cruise, thr: 0.5, rpm: 0.5, fuel: 1, g: 1, vs: 0, shake: 0, pr: 0, ab: 0 };
  newWaypoint(true);
}
function newWaypoint(first) {
  const a = P.hdg + (Math.random() - 0.5) * 1.6, dist = first ? 14000 : 18000 + Math.random() * 9000;
  wp.x = P.x + Math.sin(a) * dist; wp.z = P.z + Math.cos(a) * dist; if (!first) { wp.n++; wp.flash = 3; }
}

/* ---------- noise / terrain ---------- */
function hash(x, y) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const PAL = {
  deep: [22, 62, 108], sea: [42, 104, 156], shallow: [92, 160, 188], sand: [222, 200, 150],
  grass1: [94, 150, 74], grass2: [132, 174, 90], meadow: [168, 184, 96],
  crop1: [202, 178, 98], crop2: [176, 140, 80], crop3: [152, 166, 86], plow: [148, 112, 74],
  forest: [52, 98, 58], rock: [138, 114, 90], rockHi: [186, 158, 124], snow: [238, 242, 248],
  road: [160, 150, 138], town: [178, 154, 130]
};
let tr = 0, tg = 0, tb = 0, tFade = 1, tNear2 = 0;
function terrain(wx, wz, near) {
  const s1 = vnoise(wx / 6800, wz / 6800), s2 = vnoise(wx / 2300, wz / 2300);
  const e = s1 * 0.62 + s2 * 0.38;                       // elevation 0..1
  const m = vnoise(wx / 3100 + 57, wz / 3100 + 57);      // moisture
  const cvr = WX.cur.cover;
  if (e < 0.415) {
    // sea: shallow -> deep gradient, sandy rim, moving sun glint near
    const dp = (0.415 - e) / 0.415;
    const a = dp < 0.4 ? dp / 0.4 : 1, b = dp < 0.4 ? 0 : (dp - 0.4) / 0.6;
    tr = PAL.shallow[0] + (PAL.sea[0] - PAL.shallow[0]) * a; tr += (PAL.deep[0] - PAL.sea[0]) * b;
    tg = PAL.shallow[1] + (PAL.sea[1] - PAL.shallow[1]) * a; tg += (PAL.deep[1] - PAL.sea[1]) * b;
    tb = PAL.shallow[2] + (PAL.sea[2] - PAL.shallow[2]) * a; tb += (PAL.deep[2] - PAL.sea[2]) * b;
    if (e > 0.398) { const k = (e - 0.398) / 0.017; tr += (PAL.sand[0] - tr) * k; tg += (PAL.sand[1] - tg) * k; tb += (PAL.sand[2] - tb) * k; }
    if (near) { const gl = vnoise(wx / 120 + T * 0.9, wz / 120 - T * 0.5); if (gl > 0.8 && tNear2 > 0.3) { const s = (gl - 0.8) * 90 * tNear2; tr += s; tg += s; tb += s * 0.9; } }
  } else if (e > 0.60) {
    // mountains: shaded rock, snow caps, forested skirts
    const t = (e - 0.60) / 0.40, det = s2 + (near && tNear2 > 0.02 ? (vnoise(wx / 300, wz / 300) - 0.5) * tNear2 : 0);
    const sh = 0.72 + 0.5 * det;
    tr = (PAL.rock[0] + (PAL.rockHi[0] - PAL.rock[0]) * det) * sh;
    tg = (PAL.rock[1] + (PAL.rockHi[1] - PAL.rock[1]) * det) * sh;
    tb = (PAL.rock[2] + (PAL.rockHi[2] - PAL.rock[2]) * det) * sh;
    if (e > 0.74) { let k = (e - 0.74) / 0.26; if (tNear2 > 0.05) k = clamp(k + (vnoise(wx / 520 + 31, wz / 520) - 0.5) * 0.5 * tNear2, 0, 1); tr += (PAL.snow[0] - tr) * k; tg += (PAL.snow[1] - tg) * k; tb += (PAL.snow[2] - tb) * k; }
    else if (t < 0.45 && m > 0.42) { const k = (0.45 - t) * 1.6 * m; tr += (PAL.forest[0] - tr) * k; tg += (PAL.forest[1] - tg) * k; tb += (PAL.forest[2] - tb) * k; }
  } else {
    // lowland: painterly patchwork of fields, meadows, forests, roads, towns
    const g = 0.55 + 0.45 * s2;
    tr = PAL.grass1[0] + (PAL.grass2[0] - PAL.grass1[0]) * m; tr *= g;
    tg = PAL.grass1[1] + (PAL.grass2[1] - PAL.grass1[1]) * m; tg *= g;
    tb = PAL.grass1[2] + (PAL.grass2[2] - PAL.grass1[2]) * m; tb *= g;
    // meadows wash
    const md = vnoise(wx / 5200 + 91, wz / 5200 + 91);
    if (md > 0.58) { const k = (md - 0.58) * 1.8; tr += (PAL.meadow[0] - tr) * k; tg += (PAL.meadow[1] - tg) * k; tb += (PAL.meadow[2] - tb) * k; }
    // crop patchwork
    const cx = Math.floor(wx / 430), cz = Math.floor(wz / 430), h = hash(cx, cz);
    if (h < 0.62 && m > 0.34 && tFade > 0.04) {
      const f = h < 0.16 ? PAL.crop1 : h < 0.30 ? PAL.crop2 : h < 0.44 ? PAL.crop3 : h < 0.52 ? PAL.plow : null;
      if (f) { const k = (near ? 0.75 + 0.2 * vnoise(wx / 160, wz / 160) : 0.8) * tFade; tr += (f[0] - tr) * k; tg += (f[1] - tg) * k; tb += (f[2] - tb) * k; }
      if (near && tNear2 > 0.5) { // hedgerows along field borders
        const fx = Math.abs((wx / 430) - cx - 0.5), fz = Math.abs((wz / 430) - cz - 0.5);
        if (fx > 0.472 || fz > 0.472) { tr = tr * 0.45 + 20; tg = tg * 0.5 + 24; tb = tb * 0.5 + 12; }
      }
    }
    // forest blotches with ragged edges
    const fo = vnoise(wx / 900 + 11, wz / 900 + 11) + (near ? (vnoise(wx / 210 + 3, wz / 210) - 0.5) * 0.22 * tNear2 : 0);
    if (fo > 0.62) { const k = Math.min((fo - 0.62) * 5, 1) * 0.92; tr += (PAL.forest[0] * (0.8 + 0.4 * m) - tr) * k; tg += (PAL.forest[1] * (0.8 + 0.4 * m) - tg) * k; tb += (PAL.forest[2] * (0.8 + 0.4 * m) - tb) * k; }
    if (near && tNear2 > 0.45) {
      // winding roads (ridged noise)
      const r1 = Math.abs(vnoise(wx / 1600 + 7, wz / 1600 + 7) * 2 - 1);
      if (r1 < 0.015) { const k = 1 - r1 / 0.015; tr += (PAL.road[0] - tr) * k; tg += (PAL.road[1] - tg) * k; tb += (PAL.road[2] - tb) * k; }
      // town speckle where cells say so
      if (h > 0.9 && hash(Math.floor(wx / 48), Math.floor(wz / 48)) > 0.62) { tr = PAL.town[0] * (0.85 + 0.3 * s2); tg = PAL.town[1] * (0.85 + 0.3 * s2); tb = PAL.town[2] * (0.85 + 0.3 * s2); }
    }
  }
  // drifting cloud shadows
  if (cvr > 0.15) {
    const sh = vnoise(wx / 2900 + T * 5, wz / 2900 + T * 2);
    const th = 1.02 - cvr * 0.6;
    if (sh > th) { const k = Math.min((sh - th) * 4, 1) * 0.38; tr *= 1 - k; tg *= 1 - k; tb *= 1 - k * 0.9; }
  }
}

/* ---------- ground (mode-7 style) ---------- */
const GW = 240, GH = 132;
const gOff = document.createElement('canvas'); gOff.width = GW; gOff.height = GH;
const gCtx = gOff.getContext('2d'); const gImg = gCtx.createImageData(GW, GH); const g32 = new Uint32Array(gImg.data.buffer);
function drawGround(cx, hy, f) {
  const c = WX.cur, Hr = H * 1.7, X0 = cx - W * 1.7, Xw = W * 3.4;
  const Fx = Math.sin(P.hdg), Fz = Math.cos(P.hdg), Rx = Math.cos(P.hdg), Rz = -Math.sin(P.hdg);
  const dim = 1 - c.dark * 0.62, warm = c.warm;
  const mr = dim * (1 + 0.18 * warm), mg = dim * (1 - 0.02 * warm), mb = dim * (1 - 0.28 * warm);
  const fogDist = lerp(26000, 1500, c.fog), hr = c.hor[0], hg = c.hor[1], hb = c.hor[2];
  for (let j = 0; j < GH; j++) {
    const y = (j + 0.5) / GH * Hr + 1.5; // px below horizon
    let d = f * P.alt / y; if (d > 60000) d = 60000;
    const ft = 1 - Math.exp(-d / fogDist), near = d < 9000;
    tFade = 1 - clamp((d - 9000) / 9000, 0, 1);
    tNear2 = clamp((9000 - d) / 5500, 0, 1);
    const lat0 = (X0 - cx) * d / f, stepL = (Xw / GW) * d / f;
    let wx = P.x + Fx * d + Rx * lat0, wz = P.z + Fz * d + Rz * lat0;
    const sx = Rx * stepL, sz = Rz * stepL, row = j * GW;
    for (let i = 0; i < GW; i++) {
      terrain(wx, wz, near);
      const r = (tr * mr) * (1 - ft) + hr * ft, g = (tg * mg) * (1 - ft) + hg * ft, b = (tb * mb) * (1 - ft) + hb * ft;
      g32[row + i] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
      wx += sx; wz += sz;
    }
  }
  gCtx.putImageData(gImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(gOff, X0, hy, Xw, Hr);
}

/* ---------- clouds ---------- */
function makeCloudSprite(tone) {
  const s = document.createElement('canvas'); s.width = 320; s.height = 160; const g = s.getContext('2d');
  const puffs = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 15; i++) {
    const t = i / 14, x = 40 + t * 240 + (rnd() - 0.5) * 34, arch = Math.sin(t * Math.PI);
    puffs.push([x, 108 - arch * 34 - rnd() * 16, 16 + arch * 26 + rnd() * 14]);
  }
  const paint = (dy, rs, col, a0) => {
    for (const [x, y, r] of puffs) {
      const rr = r * rs, gr = g.createRadialGradient(x, y + dy - rr * 0.2, rr * 0.15, x, y + dy, rr);
      gr.addColorStop(0, `rgba(${col},${a0})`); gr.addColorStop(0.65, `rgba(${col},${(a0 * 0.55).toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y + dy, rr, 0, 7); g.fill();
    }
  };
  paint(30, 1.15, tone.shade.join(','), 0.4);   // flat base
  paint(14, 1.05, tone.shade.join(','), 0.85);  // shaded body
  paint(-6, 0.8, tone.lit.join(','), 0.95);     // sunlit tops
  return s;
}
const cloudLight = makeCloudSprite({ lit: [255, 255, 255], shade: [196, 208, 226] });
const cloudDark = makeCloudSprite({ lit: [150, 158, 172], shade: [70, 78, 96] });
const cloudWarm = makeCloudSprite({ lit: [255, 228, 190], shade: [214, 156, 126] });
const CLOUDS = []; const NCLOUD = 70, CR = 12000;
for (let i = 0; i < NCLOUD; i++) CLOUDS.push({ x: 0, y: 0, z: 0, s: 0, f: 0, init: false, order: i / NCLOUD });
function placeCloud(c, ahead) {
  const a = P.hdg + (ahead ? (Math.random() - 0.5) * 2.4 : Math.random() * 6.28), d = ahead ? 4000 + Math.random() * (CR - 4500) : Math.random() * CR;
  c.x = P.x + Math.sin(a) * d; c.z = P.z + Math.cos(a) * d;
  c.y = P.alt + (Math.random() - 0.4) * 1800 + (Math.random() < 0.5 ? 0 : 300); if (c.y < 250) c.y = 250 + Math.random() * 600;
  c.s = 380 + Math.random() * 900; c.f = Math.random() > 0.5 ? 1 : -1; c.init = true;
}
function drawClouds(cx, hy, f) {
  const cover = WX.cur.cover, n = Math.floor(NCLOUD * clamp(cover + 0.05, 0, 1));
  const Fx = Math.sin(P.hdg), Fz = Math.cos(P.hdg), Rx = Math.cos(P.hdg), Rz = -Math.sin(P.hdg);
  const list = [];
  for (let i = 0; i < n; i++) {
    const c = CLOUDS[i]; if (!c.init) placeCloud(c, false);
    const dx = c.x - P.x, dz = c.z - P.z;
    let fwd = dx * Fx + dz * Fz;
    if (fwd * fwd + (dx * Rx + dz * Rz) ** 2 > CR * CR * 1.1 || fwd < -1500) { placeCloud(c, true); continue; }
    if (fwd < 40) continue;
    c._fwd = fwd; c._lat = dx * Rx + dz * Rz; list.push(c);
  }
  list.sort((a, b) => b._fwd - a._fwd);
  const dark = WX.cur.dark, baseSpr = WX.cur.warm > 0.5 ? cloudWarm : cloudLight;
  for (const c of list) {
    const sc = f / c._fwd, r = c.s * sc, sx = cx + c._lat * sc, sy = hy - (c.y - P.alt) * sc;
    if (r < 2 || sx < -r * 2 - W || sx > W * 2 + r * 2 || sy < -r * 2 - H * 1.5 || sy > H * 3) continue;
    let a = clamp((CR - c._fwd) / 3500, 0, 1) * clamp(c._fwd / (c.s * 1.2), 0, 1);
    if (a <= 0.01) continue;
    const w = r * 2.6, h = w * 0.5;
    ctx.globalAlpha = a * 0.95; ctx.drawImage(baseSpr, sx - w / 2, sy - h * 0.62, w, h);
    if (dark > 0.05) { ctx.globalAlpha = a * dark * 1.1 > 1 ? 1 : a * dark * 1.1; ctx.drawImage(cloudDark, sx - w / 2, sy - h * 0.62, w, h); }
  }
  // distant stratus deck hugging the horizon
  const deck = clamp((cover - 0.35) / 0.65, 0, 1) * clamp(1 - WX.cur.fog * 0.7, 0, 1);
  if (deck > 0.02) {
    for (let i = 0; i < 4; i++) {
      const off = ((i * 0.618 + P.hdg * 0.35) % 1.4 + 1.4) % 1.4 - 0.2;
      const w = W * (1.1 + i * 0.28), h = 24 + i * 15;
      ctx.globalAlpha = deck * (0.34 - i * 0.05);
      ctx.drawImage(baseSpr, W * off, hy - 26 + i * 13 - w * 0, w, h);
    }
  }
  ctx.globalAlpha = 1;
}

/* ---------- audio ---------- */
const Snd = {
  ctx: null, muted: false, eng: null,
  unlock() {
    // iOS suspends the AudioContext after permission dialogs / backgrounding; resume on every gesture.
    const c = this.ctx; if (!c) return;
    if (c.state !== 'running') { try { const p = c.resume(); if (p && p.catch) p.catch(() => { }); } catch (_) { } }
  },
  init() {
    if (this.ctx) { this.unlock(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); const a = this.ctx;
    this.master = a.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(a.destination);
    const nb = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb; this.build(planeKey);
    this.unlock();
    if (!this._hooked) {
      this._hooked = true;
      const kick = () => this.unlock();
      window.addEventListener('pointerdown', kick, { passive: true });
      window.addEventListener('touchend', kick, { passive: true });
      window.addEventListener('keydown', kick);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    }
  },
  noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; },
  build(key) {
    if (!this.ctx) return; const a = this.ctx;
    if (this.eng) { try { this.eng.stop(); } catch (e) { } this.eng.out.disconnect(); }
    const out = a.createGain(); out.gain.value = 0; out.connect(this.master);
    const oscs = [], e = { out, key, oscs };
    const o1 = a.createOscillator(); o1.type = 'sawtooth'; const o2 = a.createOscillator(); o2.type = key === 'passenger' ? 'sine' : 'square';
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g1 = a.createGain(), g2 = a.createGain(); g1.gain.value = 0.35; g2.gain.value = key === 'passenger' ? 0.16 : 0.18;
    o1.connect(g1).connect(lp); o2.connect(g2).connect(lp);
    const am = a.createGain(); am.gain.value = 1; lp.connect(am); am.connect(out);
    let lfo = null;
    if (key === 'cargo') { lfo = a.createOscillator(); lfo.type = 'sine'; const lg = a.createGain(); lg.gain.value = 0.35; am.gain.value = 0.65; lfo.connect(lg).connect(am.gain); lfo.start(); oscs.push(lfo); }
    const ns = this.noise(), nf = a.createBiquadFilter(); nf.type = key === 'passenger' ? 'bandpass' : 'lowpass'; nf.frequency.value = 900; nf.Q.value = 0.7;
    const ng = a.createGain(); ng.gain.value = 0; ns.connect(nf).connect(ng).connect(out);
    const ws = this.noise(), wf = a.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1200; wf.Q.value = 0.4;
    const wg = a.createGain(); wg.gain.value = 0; ws.connect(wf).connect(wg).connect(this.master);
    o1.start(); o2.start(); oscs.push(o1, o2);
    Object.assign(e, { o1, o2, lp, lfo, nf, ng, wg, wf, ns, ws, stop() { oscs.forEach(o => { try { o.stop(); } catch (_) { } }); try { ns.stop(); ws.stop(); } catch (_) { } } });
    this.eng = e;
  },
  update(thr, spd, vmax) {
    const e = this.eng; if (!e || !this.ctx) return; const t = this.ctx.currentTime, S = 0.08;
    const sp = clamp(spd / vmax, 0, 1);
    if (e.key === 'cargo') {
      e.o1.frequency.setTargetAtTime(55 + thr * 78, t, S); e.o2.frequency.setTargetAtTime((55 + thr * 78) * 2.01, t, S);
      e.lp.frequency.setTargetAtTime(520 + thr * 1150, t, S); e.lfo.frequency.setTargetAtTime(16 + thr * 32, t, S);
      e.ng.gain.setTargetAtTime(0.07 + 0.26 * thr, t, S); e.nf.frequency.setTargetAtTime(700 + thr * 1200, t, S);
      e.out.gain.setTargetAtTime(0.55 + 0.35 * thr, t, S);
    } else if (e.key === 'passenger') {
      e.o1.frequency.setTargetAtTime(92 + thr * 76, t, S); e.o2.frequency.setTargetAtTime(300 + thr * 780, t, S);
      e.lp.frequency.setTargetAtTime(480, t, S);
      e.ng.gain.setTargetAtTime(0.16 + 0.6 * thr, t, S); e.nf.frequency.setTargetAtTime(900 + thr * 2600, t, S);
      e.out.gain.setTargetAtTime(0.5 + 0.32 * thr, t, S);
    } else {
      e.o1.frequency.setTargetAtTime(95 + thr * 130, t, S); e.o2.frequency.setTargetAtTime(650 + thr * 950, t, S);
      e.lp.frequency.setTargetAtTime(700 + thr * 900, t, S);
      const ab = thr > 0.85 ? (thr - 0.85) / 0.15 : 0;
      e.ng.gain.setTargetAtTime(0.24 + 0.5 * thr + 0.35 * ab, t, S); e.nf.frequency.setTargetAtTime(900 + thr * 2800, t, S);
      e.out.gain.setTargetAtTime(0.55 + 0.4 * thr, t, S);
    }
    e.wg.gain.setTargetAtTime(0.02 + 0.16 * sp * sp, t, 0.2); e.wf.frequency.setTargetAtTime(700 + sp * 1800, t, 0.2);
  },
  thunder() {
    if (!this.ctx) return; const a = this.ctx, t = a.currentTime;
    const s = a.createBufferSource(); s.buffer = this.noiseBuf; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(70, t + 2.5);
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 3);
  },
  beep(freq) {
    if (!this.ctx) return; const a = this.ctx, t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = freq || 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }
};

/* ---------- input ---------- */
function screenAngle() { const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (typeof window.orientation === 'number' ? window.orientation : 0); return ((a % 360) + 360) % 360; }
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  sensor.got = true; sensor.beta = e.beta; sensor.gamma = e.gamma; sensor.lastT = performance.now();
  if (sensor.needCal) { sensor.b0 = e.beta; sensor.g0 = e.gamma; sensor.needCal = false; }
}
window.addEventListener('deviceorientation', onOrient);
const dz = v => { const s = Math.sign(v), a = Math.abs(v); return a < 0.06 ? 0 : s * Math.pow((a - 0.06) / 0.94, 1.15); };
function motionCtl() {
  let db = sensor.beta - sensor.b0, dg = sensor.gamma - sensor.g0;
  if (db > 180) db -= 360; if (db < -180) db += 360;
  const a = screenAngle(); let pitch, roll;
  if (a === 90) { pitch = -dg; roll = db; } else if (a === 270) { pitch = dg; roll = -db; } else if (a === 180) { pitch = -db; roll = -dg; } else { pitch = db; roll = dg; }
  return [clamp(pitch / 24, -1, 1), clamp(roll / 28, -1, 1)];
}
function padGeom() { const r = Math.min(W, H) * 0.14; return { x: r + 14, y: H * (landscape ? 0.52 : 0.55), r: Math.max(r, 46) }; }
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); Snd.init();
  const pg = padGeom();
  if (input.pad && input.padId === null && Math.hypot(e.clientX - pg.x, e.clientY - pg.y) < pg.r * 1.6) { input.padId = e.pointerId; movePad(e); }
  else if (e.clientX > W / 2) input.thrIds.add(e.pointerId); else input.brakeIds.add(e.pointerId);
  try { cv.setPointerCapture(e.pointerId); } catch (_) { }
});
function movePad(e) { const pg = padGeom(); input.padVec = [clamp((e.clientX - pg.x) / pg.r, -1, 1), clamp((e.clientY - pg.y) / pg.r, -1, 1)]; const m = Math.hypot(...input.padVec); if (m > 1) input.padVec = input.padVec.map(v => v / m); }
cv.addEventListener('pointermove', e => { if (e.pointerId === input.padId) movePad(e); });
const up = e => { input.thrIds.delete(e.pointerId); input.brakeIds.delete(e.pointerId); if (e.pointerId === input.padId) { input.padId = null; input.padVec = [0, 0]; } };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
cv.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => { input.keys[e.key.toLowerCase()] = true; if (e.key === ' ') e.preventDefault(); Snd.init(); });
window.addEventListener('keyup', e => { input.keys[e.key.toLowerCase()] = false; });

async function requestMotion() {
  const msg = $('msg'); msg.textContent = '';
  let granted = false, denied = false;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission(); granted = r === 'granted'; denied = !granted;
      if (granted && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') { try { await DeviceMotionEvent.requestPermission(); } catch (_) { } }
    } else if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission(); granted = r === 'granted'; denied = !granted;
    } else granted = 'DeviceOrientationEvent' in window;
  } catch (err) { denied = true; }
  sensor.got = false; sensor.needCal = true;
  if (granted) {
    // wait briefly for real sensor data (desktops report null)
    for (let i = 0; i < 12 && !sensor.got; i++) await new Promise(r => setTimeout(r, 100));
  }
  input.motion = granted && sensor.got;
  input.pad = !input.motion;
  if (denied) msg.textContent = 'ההרשאה לחיישני תנועה נדחתה - עוברים לבקרת מגע (ג\'ויסטיק בצד שמאל).';
  else if (!input.motion) msg.textContent = 'לא זוהו חיישני תנועה - עוברים לבקרת מגע (ג\'ויסטיק בצד שמאל).';
  return input.motion;
}
async function startFlight() {
  Snd.init(); Snd.build(planeKey);
  $('start').disabled = true;
  await requestMotion();
  Snd.init(); Snd.unlock(); // iOS suspends audio during the motion-permission dialog
  $('start').disabled = false;
  resetFlight(); state = 'fly';
  $('menu').classList.add('hide'); $('hud').hidden = false; updPadBtn();
  setTimeout(() => { if (state === 'fly') $('menu').style.display = 'none'; }, 450);
}
function updPadBtn() { $('bPad').style.opacity = input.pad ? 1 : 0.55; }
$('start').addEventListener('click', startFlight);
document.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => {
  document.querySelectorAll('.card').forEach(x => x.classList.remove('sel')); c.classList.add('sel');
  planeKey = c.dataset.plane; Snd.init(); Snd.build(planeKey); if (state === 'menu') resetFlight();
}));
$('bMenu').addEventListener('click', () => { state = 'menu'; $('menu').style.display = ''; requestAnimationFrame(() => $('menu').classList.remove('hide')); $('hud').hidden = true; $('msg').textContent = ''; });
$('bWeather').addEventListener('click', () => { WX.auto = false; setWeather(WX.idx + 1); setTimeout(() => { WX.auto = true; }, 100); });
$('bSound').addEventListener('click', () => { Snd.init(); Snd.setMuted(!Snd.muted); $('bSound').textContent = Snd.muted ? '🔇' : '🔊'; });
$('bCal').addEventListener('click', () => { sensor.needCal = true; warn.text = 'CALIBRATED'; warn.t = 1.2; warn.ok = true; });
$('bPad').addEventListener('click', () => { input.pad = !input.pad; input.padVec = [0, 0]; input.padId = null; updPadBtn(); });

/* ---------- simulation ---------- */
function computeCtl(dt) {
  let p = 0, r = 0;
  if (state === 'menu') { p = Math.sin(T * 0.3) * 0.12; r = Math.sin(T * 0.21) * 0.35; }
  else {
    if (input.motion) { const m = motionCtl(); p = dz(m[0]); r = dz(m[1]); }
    if (input.pad) { p += -input.padVec[1]; r += input.padVec[0]; }
    const k = input.keys;
    if (k['arrowup'] || k['w']) p += 1; if (k['arrowdown'] || k['s']) p -= 1;
    if (k['arrowleft'] || k['a']) r -= 1; if (k['arrowright'] || k['d']) r += 1;
  }
  ctl.pitch = clamp(p, -1, 1); ctl.roll = clamp(r, -1, 1);
}
function setWarn(t) { warn.text = t; warn.t = 0.25; warn.ok = false; }
function update(dt) {
  T += dt; updateWeather(dt); computeCtl(dt);
  const d = PLANES[planeKey], w = WX.cur;
  const thrUp = state === 'menu' ? false : (input.thrIds.size > 0 || input.keys['shift'] || input.keys[' ']);
  const thrDn = input.brakeIds.size > 0 || input.keys['control'] || input.keys['x'];
  if (state === 'menu') P.thr += (0.5 - P.thr) * dt;
  else if (thrUp) P.thr += d.thrRate * dt; else if (thrDn) P.thr -= d.thrRate * 1.2 * dt; else P.thr -= 0.035 * dt;
  P.thr = clamp(P.thr, 0.08, 1);
  P.rpm += (P.thr - P.rpm) * (1 - Math.exp(-dt * 2.2));
  P.ab = d === PLANES.fighter ? clamp((P.thr - 0.85) / 0.15, 0, 1) : 0;
  // turbulence
  const tb = w.turb * (0.6 + 0.4 * Math.sin(T * 0.37));
  const nx = (Math.sin(T * 3.1) + Math.sin(T * 5.3 + 1) * 0.7 + Math.sin(T * 9.1) * 0.4) * tb, ny = (Math.sin(T * 2.7 + 2) + Math.sin(T * 6.1) * 0.6) * tb;
  P.shake = tb;
  const rk = 1 - Math.exp(-d.resp * dt);
  const tRoll = ctl.roll * d.rollMax * RAD + nx * 0.07, tPitch = ctl.pitch * d.pitchMax * RAD + ny * 0.035;
  P.roll += (tRoll - P.roll) * rk; const op = P.pitch; P.pitch += (tPitch - P.pitch) * rk;
  // speed
  const target = d.vmin + (d.vmax - d.vmin) * P.thr - Math.sin(P.pitch) * 90 * d.climbK;
  const prev = P.spd; P.spd += (target - P.spd) * (1 - Math.exp(-d.accel * dt)); P.spd = clamp(P.spd, 20, d.vmax * 1.05);
  // stall: nose drops
  if (P.spd < d.stall && state === 'fly') { P.pitch -= (d.stall - P.spd) * 0.004 * dt * 60 * 0.3; setWarn('STALL'); }
  // heading + position
  const sf = Math.sqrt(120 / clamp(P.spd, 60, 500));
  P.hdg += d.turn * Math.sin(P.roll) * sf * dt * 1.1;
  const ws = P.spd * WORLD_SPEED;
  P.x += Math.sin(P.hdg) * Math.cos(P.pitch) * ws * dt; P.z += Math.cos(P.hdg) * Math.cos(P.pitch) * ws * dt;
  const vs = Math.sin(P.pitch) * ws * 0.55; P.vs += (vs - P.vs) * (1 - Math.exp(-dt * 3));
  P.alt += vs * dt;
  P.g += ((1 + Math.abs(Math.tan(clamp(P.roll, -1.3, 1.3))) * 0.9 + (P.pitch - op) / Math.max(dt, 0.001) * 0.9 * (P.spd / 120)) - P.g) * (1 - Math.exp(-dt * 4));
  P.g = clamp(P.g, -2, 9);
  if (P.alt > 6500) { P.alt = 6500; if (P.pitch > 0) P.pitch *= 0.9; }
  if (P.alt < 10) { P.alt = 10; if (P.pitch < 0) P.pitch = 0; P.spd *= 1 - 0.15 * dt; }
  if (P.alt < 160 && P.vs < -8 && state === 'fly') setWarn('PULL UP');
  if (state === 'fly' && w.turb > 0.5 && warn.t <= 0) { warn.text = 'TURBULENCE'; warn.t = 0.25; warn.ok = false; }
  P.fuel -= dt * 0.0008 * (0.3 + P.thr); if (P.fuel < 0.03) P.fuel = 1;
  if (Math.hypot(wp.x - P.x, wp.z - P.z) < 1200) newWaypoint(false);
  if (wp.flash > 0) wp.flash -= dt;
  if (warn.t > 0) { warn.t -= dt; if (!warn.ok && Snd.ctx && Math.floor(T * 2.5) !== warn._b) { warn._b = Math.floor(T * 2.5); Snd.beep(warn.text === 'PULL UP' ? 1000 : 700); } }
  // lightning
  if (w.light > 0.5) { nextBolt -= dt; if (nextBolt < 0) { lightning = 1; nextBolt = 5 + Math.random() * 8; setTimeout(() => Snd.thunder(), 500 + Math.random() * 900); } }
  if (lightning > 0) lightning = Math.max(0, lightning - dt * (lightning > 0.6 ? 6 : 2.2));
  Snd.update(P.rpm, P.spd, d.vmax);
}

/* ---------- rendering ---------- */
const rain = []; for (let i = 0; i < 160; i++) rain.push({ x: Math.random(), y: Math.random(), l: 0.4 + Math.random() * 0.6 });
/* distant painterly ridge lines (screen-space, bearing-based) */
const RIDGES = [
  { amp: 0.055, freq: 1.6, seed: 3.7, col: [112, 126, 150], haze: 0.84 },
  { amp: 0.095, freq: 2.6, seed: 9.2, col: [96, 108, 130], haze: 0.62 },
  { amp: 0.150, freq: 4.2, seed: 15.9, col: [80, 90, 108], haze: 0.40 }
];
function drawRidges(cx, hy, f) {
  const c = WX.cur, vis = clamp(1 - c.fog * 1.15, 0, 1); if (vis <= 0.04) return;
  const hr = c.hor[0], hg = c.hor[1], hb = c.hor[2], dim = 1 - c.dark * 0.45, step = Math.max(10, W / 60);
  for (const L of RIDGES) {
    const hz = L.haze + (1 - L.haze) * (1 - vis);
    let r = (L.col[0] * (1 - hz) + hr * hz) * dim, g = (L.col[1] * (1 - hz) + hg * hz) * dim, b = (L.col[2] * (1 - hz) + hb * hz) * dim;
    const wk = c.warm * (1 - hz) * 0.5; r += 42 * wk; g += 6 * wk; b -= 22 * wk;
    ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${vis})`;
    ctx.beginPath(); ctx.moveTo(-W * 0.3, hy + 4);
    for (let sx = -W * 0.3; sx <= W * 1.3; sx += step) {
      const ang = P.hdg + (sx - cx) / f;
      let h = vnoise(ang * L.freq, L.seed); h = 1 - Math.abs(h * 2 - 1);
      h = h * h * (0.5 + 0.5 * vnoise(ang * L.freq * 0.31, L.seed + 40));
      ctx.lineTo(sx, hy - h * L.amp * f);
    }
    ctx.lineTo(W * 1.3, hy + 4); ctx.closePath(); ctx.fill();
  }
}
/* fine grain kills gradient banding and adds a painted tooth */
const grain = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const im = g.createImageData(128, 128); for (let i = 0; i < im.data.length; i += 4) { const v = 118 + (Math.random() * 20 | 0); im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); return c; })();
function cacheVig() { vigG = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.42, W / 2, H * 0.55, Math.max(W, H) * 0.78); vigG.addColorStop(0, 'rgba(8,12,22,0)'); vigG.addColorStop(1, 'rgba(8,12,22,0.32)'); }

function drawSky(cx, cy0, hy, f) {
  const c = WX.cur, top = `rgb(${c.top.map(Math.round)})`, hor = `rgb(${c.hor.map(Math.round)})`;
  const gr = ctx.createLinearGradient(0, hy - H * 1.1, 0, hy); gr.addColorStop(0, top); gr.addColorStop(1, hor);
  ctx.fillStyle = gr; ctx.fillRect(cx - W * 3, hy - H * 4, W * 6, H * 4 + 1);
  ctx.save(); ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(grain, cx - W * 3, hy - H * 4, W * 6, H * 4 + 1); ctx.restore();
  // soft haze band melting into the horizon
  const hb2 = ctx.createLinearGradient(0, hy - H * 0.14, 0, hy);
  hb2.addColorStop(0, `rgba(${Math.round(c.hor[0])},${Math.round(c.hor[1])},${Math.round(c.hor[2])},0)`);
  hb2.addColorStop(1, `rgba(${Math.round(c.hor[0])},${Math.round(c.hor[1])},${Math.round(c.hor[2])},${0.35 + 0.45 * c.fog})`);
  ctx.fillStyle = hb2; ctx.fillRect(cx - W * 3, hy - H * 0.14, W * 6, H * 0.14);
  // sun
  const da = ((0.6 - P.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (Math.abs(da) < 1.3) {
    const el = lerp(0.62, 0.07, c.warm), sx = cx + f * Math.tan(da), sy = hy - f * Math.tan(el), vis = clamp(1 - c.cover * 0.8 - c.fog * 0.5 - c.dark, 0, 1);
    if (vis > 0.02) {
      const R = f * 0.55, g = ctx.createRadialGradient(sx, sy, 2, sx, sy, R);
      g.addColorStop(0, `rgba(255,${c.warm > 0.5 ? 210 : 245},${c.warm > 0.5 ? 150 : 210},${vis})`); g.addColorStop(0.08, `rgba(255,${c.warm > 0.5 ? 190 : 235},150,${vis * 0.8})`); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
    }
  }
}
function drawRain(dt) {
  const r = WX.cur.rain; if (r < 0.04) return;
  const n = Math.floor(rain.length * r); ctx.strokeStyle = `rgba(210,225,245,${0.25 + 0.25 * r})`; ctx.lineWidth = 1.3; ctx.beginPath();
  const spd = 1.8 + P.spd / 150, sk = Math.sin(P.roll) * 0.4 + 0.12;
  for (let i = 0; i < n; i++) {
    const p = rain[i]; p.y += dt * spd * p.l; p.x -= dt * sk * p.l * 0.6; if (p.y > 1) { p.y = -0.1; p.x = Math.random(); } if (p.x < -0.2) p.x += 1.4;
    const x = p.x * W, y = p.y * H * 0.9, l = 22 * p.l * (1 + P.spd / 200);
    ctx.moveTo(x, y); ctx.lineTo(x - sk * l * 0.5, y + l);
  }
  ctx.stroke();
  // droplets on glass
  ctx.fillStyle = 'rgba(200,220,240,0.18)';
  for (let i = 0; i < n / 8; i++) { const q = rain[i]; ctx.beginPath(); ctx.arc((q.x * 7.31 % 1) * W, (q.y * 3.17 % 1) * H * 0.62, 1.5 + q.l * 2, 0, 7); ctx.fill(); }
}
function dashLayout() { return { top: H * (landscape ? 0.62 : 0.665) }; }
function drawWorld(dt) {
  const f = Math.min(W, H) * 1.0 * (landscape ? 1.1 : 0.95), cx = W / 2, cy0 = H * (landscape ? 0.34 : 0.36);
  const hy = cy0 + f * Math.tan(clamp(P.pitch, -0.9, 0.9));
  const shx = (Math.sin(T * 41) * P.shake * 2.2), shy = (Math.sin(T * 37 + 1) * P.shake * 2.2);
  ctx.save(); ctx.translate(shx, shy);
  ctx.translate(cx, cy0); ctx.rotate(-P.roll); ctx.translate(-cx, -cy0);
  drawSky(cx, cy0, hy, f);
  drawRidges(cx, hy, f);
  ctx.fillStyle = `rgb(${WX.cur.hor.map(Math.round)})`; ctx.fillRect(cx - W * 3, hy, W * 6, H * 4);
  drawGround(cx, hy, f);
  drawClouds(cx, hy, f);
  if (planeKey === 'fighter' && state === 'fly') drawLadder(cx, hy, f);
  ctx.restore();
  drawRain(dt);
  // painterly finishing: grade + vignette
  const wc = WX.cur;
  if (wc.warm > 0.03) { ctx.fillStyle = `rgba(255,150,60,${(0.05 * wc.warm).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  if (wc.dark > 0.03) { ctx.fillStyle = `rgba(16,24,46,${(0.09 * wc.dark).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  if (vigG) { ctx.fillStyle = vigG; ctx.fillRect(0, 0, W, H); }
  if (lightning > 0) { ctx.fillStyle = `rgba(230,236,255,${lightning * 0.75})`; ctx.fillRect(0, 0, W, H); }
}
function drawLadder(cx, hy, f) {
  ctx.save(); ctx.strokeStyle = 'rgba(110,255,140,0.85)'; ctx.fillStyle = 'rgba(110,255,140,0.9)'; ctx.lineWidth = 1.5; ctx.font = '11px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
  for (let a = -30; a <= 30; a += 10) {
    const y = hy - f * Math.tan(a * RAD); const hw = a === 0 ? W * 0.5 : 34;
    ctx.beginPath(); if (a === 0) { ctx.moveTo(cx - hw, y); ctx.lineTo(cx - 26, y); ctx.moveTo(cx + 26, y); ctx.lineTo(cx + hw, y); }
    else { ctx.setLineDash(a < 0 ? [5, 4] : []); ctx.moveTo(cx - hw, y); ctx.lineTo(cx - 12, y); ctx.moveTo(cx + 12, y); ctx.lineTo(cx + hw, y); ctx.moveTo(cx - hw, y); ctx.lineTo(cx - hw, y + (a > 0 ? 6 : -6)); ctx.moveTo(cx + hw, y); ctx.lineTo(cx + hw, y + (a > 0 ? 6 : -6)); }
    ctx.stroke(); ctx.setLineDash([]); if (a !== 0) { ctx.fillText(String(Math.abs(a)), cx - hw - 12, y + 4); ctx.fillText(String(Math.abs(a)), cx + hw + 12, y + 4); }
  }
  ctx.restore();
}

/* cockpit frames */
function poly(pts, fill) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
function drawFrame(top) {
  const d = PLANES[planeKey], cx = W / 2, c = d.dash;
  const dim = 1 - WX.cur.dark * 0.3;
  if (planeKey === 'cargo') {
    const hdr = H * 0.065, pw = W * 0.11;
    let g = ctx.createLinearGradient(0, 0, 0, hdr); g.addColorStop(0, '#15181c'); g.addColorStop(1, '#2d3238');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hdr);
    poly([[0, 0], [pw, 0], [pw * 0.28, top], [0, top]], '#262b31'); poly([[W, 0], [W - pw, 0], [W - pw * 0.28, top], [W, top]], '#262b31');
    ctx.fillStyle = '#1f2327'; ctx.fillRect(cx - 4, 0, 8, top * 0.9);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(cx - 4, 0, 2, top * 0.9);
    // wing struts / nose cowl
    poly([[0, top - 40], [W * 0.14, top - 6], [0, top - 6]], '#3a4048'); poly([[W, top - 40], [W * 0.86, top - 6], [W, top - 6]], '#3a4048');
    // prop disc blur
    const a = T * 90; ctx.save(); ctx.globalAlpha = 0.07 + 0.05 * P.rpm; ctx.fillStyle = '#ccd'; ctx.beginPath(); ctx.ellipse(cx, top + 6, W * 0.22, 10, 0, 0, 7); ctx.fill(); ctx.restore();
  } else if (planeKey === 'passenger') {
    const hdr = H * 0.04, pw = W * 0.06;
    let g = ctx.createLinearGradient(0, 0, 0, hdr); g.addColorStop(0, '#d9dde2'); g.addColorStop(1, '#8d949c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hdr);
    poly([[0, 0], [pw, 0], [pw * 0.2, top], [0, top]], '#aeb4bb'); poly([[W, 0], [W - pw, 0], [W - pw * 0.2, top], [W, top]], '#aeb4bb');
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, hdr, W, 3);
    // glareshield
    g = ctx.createLinearGradient(0, top - 26, 0, top); g.addColorStop(0, 'rgba(15,18,22,0)'); g.addColorStop(1, 'rgba(15,18,22,0.95)'); ctx.fillStyle = g; ctx.fillRect(0, top - 26, W, 26);
    ctx.fillStyle = '#e3e6ea'; ctx.fillRect(0, hdr, W, 1);
  } else {
    // fighter canopy: curved bow + side rails
    ctx.fillStyle = '#10151a'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.045); ctx.quadraticCurveTo(cx, H * 0.1, 0, H * 0.045); ctx.closePath(); ctx.fill();
    poly([[0, 0], [W * 0.035, 0], [W * 0.02, top], [0, top]], '#0f1418'); poly([[W, 0], [W * 0.965, 0], [W * 0.98, top], [W, top]], '#0f1418');
    ctx.strokeStyle = 'rgba(110,255,140,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(W * 0.18, H * 0.08, W * 0.64, top * 0.8);
  }
  // dash panel
  const g2 = ctx.createLinearGradient(0, top, 0, H); g2.addColorStop(0, c[0]); g2.addColorStop(1, c[1]);
  ctx.fillStyle = g2; ctx.fillRect(0, top, W, H - top);
  ctx.fillStyle = d.accent; ctx.globalAlpha = 0.55; ctx.fillRect(0, top, W, 2); ctx.globalAlpha = 1;
  if (dim < 1) { ctx.fillStyle = `rgba(0,0,0,${(1 - dim) * 0.3})`; ctx.fillRect(0, 0, W, top); }
}

/* gauges */
const FONT = 'ui-monospace,Menlo,Consolas,monospace';
function bezel(x, y, r) { const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); g.addColorStop(0, '#1b2128'); g.addColorStop(1, '#06080a'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#9aa4af'; ctx.lineWidth = Math.max(2, r * 0.05); ctx.stroke(); }
function label(txt, x, y, size, col, align) { ctx.fillStyle = col || '#cdd6df'; ctx.font = `600 ${size}px ${FONT}`; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y); }
function dial(x, y, r, val, min, max, o) {
  bezel(x, y, r); const a0 = 135 * RAD, a1 = 405 * RAD, t = clamp((val - min) / (max - min), 0, 1);
  const n = Math.round((max - min) / o.step);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n, c = Math.cos(a), s = Math.sin(a);
    ctx.strokeStyle = (o.red && min + i * o.step >= o.red) ? '#ff5a4a' : '#e8edf2'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + c * r * 0.82, y + s * r * 0.82); ctx.lineTo(x + c * r * 0.94, y + s * r * 0.94); ctx.stroke();
    if (i % o.every === 0) label(String(o.fmt ? o.fmt(min + i * o.step) : min + i * o.step), x + c * r * 0.64, y + s * r * 0.64, r * 0.17);
  }
  const a = a0 + (a1 - a0) * t; ctx.strokeStyle = '#ffae2a'; ctx.lineWidth = Math.max(2, r * 0.045); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r * 0.12, y - Math.sin(a) * r * 0.12); ctx.lineTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x, y, r * 0.07, 0, 7); ctx.fill();
  label(o.name, x, y + r * 0.3, r * 0.17, '#8fa0b2'); label(o.txt, x, y + r * 0.52, r * 0.2, '#8dff9f');
}
function wDial(kind, x, y, r) {
  const d = PLANES[planeKey];
  if (kind === 'asi') {
    const mx = Math.ceil(d.vmax * 1.944 / 100) * 100; const kt = P.spd * 1.944;
    dial(x, y, r, kt, 0, mx, { step: mx > 400 ? 100 : 20, every: mx > 400 ? 1 : 5, name: 'SPEED KT', txt: Math.round(kt), red: d.vmax * 1.944 * 0.97 });
    if (P.spd < d.stall) { ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * 1.0, 0, 7); ctx.stroke(); }
  } else if (kind === 'alt') {
    const ft = P.alt * 3.281; bezel(x, y, r);
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i / 10 * Math.PI * 2; ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); ctx.lineTo(x + Math.cos(a) * r * 0.94, y + Math.sin(a) * r * 0.94); ctx.stroke(); label(String(i), x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64, r * 0.18); }
    const hand = (v, len, w, col) => { const a = -Math.PI / 2 + v * Math.PI * 2; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * len, y + Math.sin(a) * r * len); ctx.stroke(); ctx.lineCap = 'butt'; };
    hand((ft / 10000) % 1, 0.45, Math.max(3, r * 0.07), '#e8edf2'); hand((ft / 1000) % 1, 0.78, Math.max(2, r * 0.045), '#ffae2a');
    label('ALT FT', x, y - r * 0.28, r * 0.16, '#8fa0b2'); label(String(Math.round(ft / 10) * 10), x, y + r * 0.5, r * 0.22, '#8dff9f');
  } else if (kind === 'att') {
    bezel(x, y, r); ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, 7); ctx.clip();
    ctx.translate(x, y); ctx.rotate(-P.roll); const off = P.pitch / RAD * r / 28;
    ctx.fillStyle = '#3d86d6'; ctx.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3); ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-r * 2, off, r * 4, r * 3);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r * 2, off); ctx.lineTo(r * 2, off); ctx.stroke();
    for (let a = -30; a <= 30; a += 10) { if (!a) continue; const yy = off - a * r / 28, w = r * (a % 20 ? 0.18 : 0.32); ctx.beginPath(); ctx.moveTo(-w, yy); ctx.lineTo(w, yy); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = Math.max(3, r * 0.06); ctx.beginPath(); ctx.moveTo(x - r * 0.6, y); ctx.lineTo(x - r * 0.2, y); ctx.lineTo(x - r * 0.2, y + r * 0.1); ctx.moveTo(x + r * 0.6, y); ctx.lineTo(x + r * 0.2, y); ctx.lineTo(x + r * 0.2, y + r * 0.1); ctx.stroke();
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(x, y, r * 0.04, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(-P.roll); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(-r * 0.07, -r * 0.76); ctx.lineTo(r * 0.07, -r * 0.76); ctx.fill(); ctx.restore();
    label('ATT', x, y + r * 0.72, r * 0.15, '#9fb0c0');
  } else if (kind === 'hdg') {
    bezel(x, y, r); ctx.save(); ctx.translate(x, y); ctx.rotate(-P.hdg);
    for (let i = 0; i < 36; i++) { const a = -Math.PI / 2 + i / 36 * Math.PI * 2, L = i % 3 ? 0.9 : 0.82; ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = i % 9 ? 1.5 : 2.5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * L, Math.sin(a) * r * L); ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); ctx.stroke(); }
    ['N', 'E', 'S', 'W'].forEach((t, i) => { const a = -Math.PI / 2 + i * Math.PI / 2; label(t, Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, r * 0.22, t === 'N' ? '#ff6a5a' : '#e8edf2'); });
    ctx.restore(); ctx.fillStyle = '#ffae2a'; ctx.beginPath(); ctx.moveTo(x, y - r * 0.98); ctx.lineTo(x - r * 0.07, y - r * 0.82); ctx.lineTo(x + r * 0.07, y - r * 0.82); ctx.fill();
    ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y - r * 0.3); ctx.lineTo(x, y + r * 0.3); ctx.moveTo(x - r * 0.25, y + r * 0.05); ctx.lineTo(x + r * 0.25, y + r * 0.05); ctx.stroke();
    label(String(Math.round(((P.hdg / RAD) % 360 + 360) % 360)).padStart(3, '0'), x, y + r * 0.5, r * 0.2, '#8dff9f');
  } else if (kind === 'g') {
    dial(x, y, r, P.g, -3, 9, { step: 1, every: 3, name: 'G', txt: P.g.toFixed(1), red: 7 });
  } else if (kind === 'radar') {
    bezel(x, y, r); const rr = r * 0.88; ctx.save(); ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.clip(); ctx.fillStyle = '#031a0a'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeStyle = 'rgba(80,255,120,0.35)'; ctx.lineWidth = 1; for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(x, y, rr * k / 3, 0, 7); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(x - rr, y); ctx.lineTo(x + rr, y); ctx.moveTo(x, y - rr); ctx.lineTo(x, y + rr); ctx.stroke();
    const sw = (T * 2.2) % (Math.PI * 2); const gr = ctx.createConicGradient ? ctx.createConicGradient(sw - 1.1, x, y) : null;
    if (gr) { gr.addColorStop(0, 'rgba(80,255,120,0)'); gr.addColorStop(0.17, 'rgba(80,255,120,0.55)'); gr.addColorStop(0.1750, 'rgba(80,255,120,0)'); gr.addColorStop(1, 'rgba(80,255,120,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill(); }
    for (let i = 0; i < 6; i++) {
      const tx = Math.sin(i * 2.1 + 1) * 9000 + Math.cos(T * 0.03 + i) * 600, tz = Math.cos(i * 1.7) * 9000 + Math.sin(T * 0.04 + i) * 600;
      const dx = tx - (P.x % 20000), dz2 = tz - (P.z % 20000), lat = dx * Math.cos(P.hdg) - dz2 * Math.sin(P.hdg), fw = dx * Math.sin(P.hdg) + dz2 * Math.cos(P.hdg);
      const px = x + lat / 7000 * rr, py = y - fw / 7000 * rr; if (Math.hypot(px - x, py - y) < rr) { ctx.fillStyle = `rgba(255,90,80,${0.5 + 0.5 * Math.sin(T * 4 + i)})`; ctx.fillRect(px - 2, py - 2, 4, 4); }
    }
    ctx.restore(); ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x - 4, y + 4); ctx.lineTo(x + 4, y + 4); ctx.fill(); label('RADAR', x, y + r * 0.72, r * 0.14, '#7dff9a');
  }
}
function wBar(x, y, w, h, frac, col) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, h); ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
function panel(x, y, w, h, title, rows) {
  ctx.fillStyle = 'rgba(4,8,12,0.75)'; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; rrect(x - w / 2, y - h / 2, w, h, 8); ctx.fill(); ctx.stroke();
  const fs = clamp(Math.min(h / (rows.length + 1.6), w / 11), 9, 15); label(title, x, y - h / 2 + fs * 0.95, fs * 0.9, PLANES[planeKey].accent);
  rows.forEach((r, i) => {
    const yy = y - h / 2 + fs * 2.3 + i * fs * 1.35; ctx.textAlign = 'left'; label(r[0], x - w / 2 + 8, yy, fs * 0.82, '#8fa0b2', 'left');
    if (r[2] !== undefined) { wBar(x + w * 0.02, yy - fs * 0.3, w * 0.46, fs * 0.6, r[2], r[3] || '#59d27a'); label(String(r[1]), x + w / 2 - 6, yy, fs * 0.82, '#e8f4ff', 'right'); }
    else label(String(r[1]), x + w / 2 - 8, yy, fs * 0.9, r[3] || '#8dff9f', 'right');
  });
}
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function thrWidget(x, y, w, h, ab) {
  const bw = Math.min(w * 0.3, 36), bh = h * 0.82, bx = x - bw / 2, by = y - bh / 2 + 4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by, bw, bh); const fh = bh * P.thr;
  const g = ctx.createLinearGradient(0, by + bh, 0, by); g.addColorStop(0, '#3fd16a'); g.addColorStop(ab ? 0.85 : 1, '#e8d23a'); g.addColorStop(1, ab ? '#ff6a2a' : '#e8d23a'); ctx.fillStyle = g; ctx.fillRect(bx, by + bh - fh, bw, fh);
  if (ab) { ctx.strokeStyle = '#ff8a3a'; ctx.beginPath(); ctx.moveTo(bx - 4, by + bh * 0.15); ctx.lineTo(bx + bw + 4, by + bh * 0.15); ctx.stroke(); label('AB', bx + bw + 14, by + bh * 0.15, 10, '#ff8a3a'); }
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh); label('THR', x, y - h / 2 + 7, 10, '#9fb0c0'); label(Math.round(P.rpm * 100) + '%', x, y + h / 2 - 1, 12, '#8dff9f');
  ctx.save(); ctx.translate(x + bw * 0.9 + 14, y); ctx.restore();
}
function drawDash(top) {
  const kinds = { cargo: ['asi', 'att', 'alt', 'thr', 'eng', 'cargo'], passenger: ['asi', 'att', 'alt', 'hdg', 'nav', 'status'], fighter: ['asi', 'att', 'alt', 'radar', 'g', 'thr'] }[planeKey];
  const cols = landscape ? 6 : 3, rows = landscape ? 1 : 2, x0 = W * 0.015, y0 = top + 8, cw = (W * 0.97) / cols, ch = (H - y0 - 6) / rows;
  kinds.forEach((k, i) => {
    const cx = x0 + (i % cols + 0.5) * cw, cy = y0 + (Math.floor(i / cols) + 0.5) * ch, r = Math.min(cw, ch) * 0.46;
    if (['asi', 'att', 'alt', 'hdg', 'g', 'radar'].includes(k)) wDial(k, cx, cy, r);
    else if (k === 'thr') thrWidget(cx, cy, cw * 0.9, ch * 0.92, planeKey === 'fighter');
    else {
      const w = cw * 0.94, h = ch * 0.94, ft = P.alt * 3.281, fuel = Math.round(P.fuel * 100);
      if (k === 'eng') panel(cx, cy, w, h, 'ENGINE', [['EGT', Math.round(420 + P.rpm * 380) + 'C', P.rpm * 0.8 + 0.2, '#e8a23a'], ['OIL', Math.round(55 + P.rpm * 25) + 'psi', 0.7, '#59b2e8'], ['FLAP', P.spd < 75 ? 'DOWN' : 'UP', undefined, P.spd < 75 ? '#ffae2a' : '#8dff9f'], ['FUEL', fuel + '%', P.fuel, '#59d27a']]);
      if (k === 'cargo') panel(cx, cy, w, h, 'CARGO', [['PAYLOAD', '18,400kg'], ['GROSS', (46.2 + (1 - P.fuel) * -3.1).toFixed(1) + 't'], ['GEAR', P.alt < 150 ? 'DOWN' : 'UP', undefined, P.alt < 150 ? '#ffae2a' : '#8dff9f'], ['CG', 'OK']]);
      if (k === 'nav') { const dist = Math.hypot(wp.x - P.x, wp.z - P.z), eta = dist / Math.max(P.spd * WORLD_SPEED, 1), mm = Math.floor(eta / 60), ss = Math.floor(eta % 60); panel(cx, cy, w, h, 'NAV WPT-' + wp.n, [['DIST', (dist / 1000).toFixed(1) + 'km'], ['ETA', mm + ':' + String(ss).padStart(2, '0')], ['HDG', String(Math.round((((Math.atan2(wp.x - P.x, wp.z - P.z) / RAD) % 360) + 360) % 360)).padStart(3, '0')], ['AP', 'OFF', undefined, '#ffae2a']]); }
      if (k === 'status') panel(cx, cy, w, h, 'CABIN', [['BELTS', WX.cur.turb > 0.2 ? 'ON' : 'OFF', undefined, WX.cur.turb > 0.2 ? '#ff6a4a' : '#8dff9f'], ['CAB ALT', Math.round(Math.min(ft, 40000) * 0.16 / 100) * 100 + 'ft'], ['PAX', '186'], ['FUEL', fuel + '%', P.fuel, '#59d27a']]);
    }
  });
  if (wp.flash > 0) label('WAYPOINT REACHED', W / 2, top - 22, 14, '#8dff9f');
}
function drawTopHud() {
  const d = PLANES[planeKey], w = WEATHERS[WX.idx];
  ctx.save(); ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(8,16,28,0.5)'; rrect(8, safeTop + 8, 138, 42, 12); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '600 13px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillText(d.he, 16, safeTop + 21);
  ctx.font = `11px ${FONT}`; ctx.fillStyle = '#b9cbe0'; ctx.fillText(w.he + ' · ' + (input.motion ? 'MOTION' : (input.pad ? 'TOUCH' : 'KEYS')), 16, safeTop + 39); ctx.restore();
  if (warn.t > 0) {
    const bl = warn.ok || Math.floor(T * 4) % 2 === 0; if (bl) { ctx.fillStyle = warn.ok ? '#8dff9f' : '#ff4a3a'; ctx.font = `700 ${landscape ? 22 : 26}px ${FONT}`; ctx.textAlign = 'center'; ctx.shadowColor = '#000'; ctx.shadowBlur = 6; ctx.fillText(warn.text, W / 2, H * 0.2); ctx.shadowBlur = 0; }
  }
}
function drawPad() {
  if (!input.pad || state !== 'fly') return; const g = padGeom();
  ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = 'rgba(10,20,35,0.45)'; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 7); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.beginPath(); ctx.moveTo(g.x - g.r, g.y); ctx.lineTo(g.x + g.r, g.y); ctx.moveTo(g.x, g.y - g.r); ctx.lineTo(g.x, g.y + g.r); ctx.stroke();
  const kx = g.x + input.padVec[0] * g.r * 0.7, ky = g.y + input.padVec[1] * g.r * 0.7; ctx.fillStyle = 'rgba(255,190,70,0.9)'; ctx.beginPath(); ctx.arc(kx, ky, g.r * 0.3, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('▲', g.x, g.y - g.r + 12); ctx.fillText('▼', g.x, g.y + g.r - 8); ctx.restore();
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.textAlign = 'center'; ctx.font = `600 ${landscape ? 13 : 12}px system-ui`;
  ctx.restore();
}
function drawThrottleHint() {
  if (state !== 'fly') return; const top = dashLayout().top, held = input.thrIds.size > 0;
  const x = W - 52, y = top - 78;
  ctx.save(); ctx.globalAlpha = held ? 0.95 : 0.5; ctx.fillStyle = held ? 'rgba(255,170,40,0.55)' : 'rgba(10,20,35,0.45)'; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  rrect(x - 36, y - 30, 72, 60, 16); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('THROTTLE', x, y + 20); ctx.font = '22px system-ui'; ctx.fillText('⇧', x, y - 4); ctx.restore();
}

let last = 0;
function frame(ts) {
  const dt = Math.min((ts - last) / 1000 || 0.016, 0.05); last = ts;
  if (!P) resetFlight();
  update(dt);
  ctx.clearRect(0, 0, W, H);
  drawWorld(dt);
  const top = dashLayout().top;
  if (state === 'fly') { drawFrame(top); drawDash(top); drawTopHud(); drawPad(); drawThrottleHint(); }
  else { drawFrame(top); drawDash(top); }
  requestAnimationFrame(frame);
}
/* QA / deep-link params: ?plane=fighter&weather=storm&go=1 (go starts without the permission step) */
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('plane') && PLANES[q.get('plane')]) { planeKey = q.get('plane'); document.querySelectorAll('.card').forEach(c => c.classList.toggle('sel', c.dataset.plane === planeKey)); }
  const wi = WEATHERS.findIndex(w => w.id === q.get('weather')); if (wi >= 0) { WX.idx = wi; WX.cur = wxCopy(WEATHERS[wi]); WX.auto = false; }
  resetFlight();
  if (q.get('go')) { input.pad = true; state = 'fly'; $('menu').style.display = 'none'; $('hud').hidden = false; updPadBtn(); }
  window.__sim = { P: () => P, ctl, input, WX, sensor, get state() { return state; }, setWeather, Snd };
})();
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { if (Snd.ctx) { if (document.hidden) Snd.ctx.suspend(); else Snd.ctx.resume(); } });
