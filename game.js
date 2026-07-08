'use strict';

/* =========================================================================
 * TECHNICAL DIFFICULTIES — a reverse tower defense.
 * The vehicles drive and shoot; the towers stand still and shoot back.
 * ========================================================================= */

/* ---------- tiny helpers ---------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const pick = arr => arr[(Math.random() * arr.length) | 0];

// deterministic rng for scenery so the desert looks the same every visit
let _seed = 20260708;
function srand() {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}

/* ---------- canvas ---------- */
const W = 960, H = 600;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * DPR;
canvas.height = H * DPR;
canvas.style.aspectRatio = `${W} / ${H}`;

/* =========================================================================
 * THE ROAD
 * ========================================================================= */
const WAYPOINTS = [
  { x: -50, y: 100 }, { x: 180, y: 100 }, { x: 250, y: 220 }, { x: 140, y: 330 },
  { x: 200, y: 470 }, { x: 420, y: 510 }, { x: 530, y: 400 }, { x: 470, y: 260 },
  { x: 600, y: 140 }, { x: 800, y: 170 }, { x: 840, y: 330 }, { x: 740, y: 460 },
  { x: 1010, y: 540 },
];

let pathPts = [];   // dense smoothed samples
let pathCum = [];   // cumulative distance per sample
let pathLen = 0;

function buildPath() {
  const P = WAYPOINTS;
  const raw = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
    const steps = Math.max(8, Math.round(dist(p1.x, p1.y, p2.x, p2.y) / 6));
    for (let j = 0; j < steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t;
      raw.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  raw.push({ ...P[P.length - 1] });
  pathPts = raw;
  pathCum = [0];
  for (let i = 1; i < raw.length; i++) {
    pathCum.push(pathCum[i - 1] + dist(raw[i].x, raw[i].y, raw[i - 1].x, raw[i - 1].y));
  }
  pathLen = pathCum[pathCum.length - 1];
}

function pointAt(s) {
  s = clamp(s, 0, pathLen);
  let lo = 0, hi = pathCum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pathCum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = pathCum[hi] - pathCum[lo] || 1;
  const t = (s - pathCum[lo]) / seg;
  const a = pathPts[lo], b = pathPts[hi];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    ang: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function distToPath(x, y) {
  let best = Infinity;
  for (let i = 0; i < pathPts.length; i += 3) {
    const d = dist(x, y, pathPts[i].x, pathPts[i].y);
    if (d < best) best = d;
  }
  return best;
}

/* =========================================================================
 * SOUND — tiny synthesized effects, no assets
 * ========================================================================= */
let audioCtx = null;
let muted = false;

function ac() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, dur, type, vol, slide) {
  const a = ac();
  if (!a || muted) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

function noise(dur, vol, lowpass) {
  const a = ac();
  if (!a || muted) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

const sfx = {
  gun:      () => tone(rand(700, 900), 0.05, 'square', 0.025, -400),
  cannon:   () => { noise(0.18, 0.09, 900); tone(120, 0.18, 'sawtooth', 0.05, -70); },
  rocket:   () => { noise(0.22, 0.05, 1600); tone(300, 0.25, 'sawtooth', 0.03, -180); },
  flak:     () => { noise(0.1, 0.05, 2400); },
  boom:     () => { noise(0.4, 0.13, 500); tone(70, 0.35, 'sine', 0.09, -35); },
  bigboom:  () => { noise(0.7, 0.18, 380); tone(55, 0.6, 'sine', 0.12, -25); },
  cash:     () => { tone(880, 0.07, 'square', 0.03); setTimeout(() => tone(1320, 0.09, 'square', 0.03), 60); },
  deploy:   () => { tone(220, 0.12, 'sawtooth', 0.04, 160); },
  hurt:     () => tone(180, 0.08, 'square', 0.03, -60),
  wave:     () => { tone(330, 0.15, 'square', 0.04); setTimeout(() => tone(440, 0.2, 'square', 0.04), 140); },
  lose:     () => { tone(300, 0.4, 'sawtooth', 0.06, -200); setTimeout(() => tone(180, 0.7, 'sawtooth', 0.06, -120), 300); },
};

/* =========================================================================
 * VEHICLE CATALOG — absurd machines of the convoy
 * ========================================================================= */
const VEHICLES = [
  {
    id: 'tuktuk', name: 'Tuk-Tuk', weapon: 'Twin Machine Guns',
    blurb: 'Three wheels, two guns, zero fear. Still licensed as a taxi.',
    cost: 120, hp: 70, speed: 55, range: 120, rof: 6, dmg: 5,
    proj: 'bullet', len: 26, wid: 14, mount: [-4, 0], barrel: 15, sound: 'gun',
  },
  {
    id: 'moped', name: 'Pizza Moped', weapon: 'Recoilless Rifle',
    blurb: 'Delivers in 30 minutes or the next warhead is free.',
    cost: 160, hp: 40, speed: 85, range: 150, rof: 0.7, dmg: 34, aoe: 26,
    proj: 'shell', len: 22, wid: 9, mount: [-2, 0], barrel: 18, sound: 'cannon',
  },
  {
    id: 'icecream', name: 'Ice-Cream Van', weapon: 'Flak Cannon',
    blurb: 'The jingle is the last thing the watchtower ever hears.',
    cost: 260, hp: 120, speed: 45, range: 150, rof: 2.2, dmg: 10, aoe: 20,
    proj: 'flak', len: 34, wid: 17, mount: [-2, 0], barrel: 22, sound: 'flak',
  },
  {
    id: 'tractor', name: 'Farm Tractor', weapon: 'Battleship Cannon',
    blurb: 'Ploughs fields in spring, flattens bunkers year-round.',
    cost: 340, hp: 170, speed: 28, range: 190, rof: 0.45, dmg: 60, aoe: 40,
    proj: 'shell', len: 30, wid: 18, mount: [-4, 0], barrel: 28, sound: 'cannon',
  },
  {
    id: 'bus', name: 'School Bus', weapon: 'Quad Rocket Pods',
    blurb: 'Please remain seated while the rockets are in motion.',
    cost: 420, hp: 260, speed: 34, range: 165, rof: 1.4, dmg: 20, aoe: 42,
    proj: 'rocket', len: 58, wid: 18, mount: [0, 0], barrel: 20, sound: 'rocket',
  },
  {
    id: 'limo', name: 'Stretch Limo', weapon: 'Tank Turret',
    blurb: 'Champagne in the back, 125mm smoothbore on the roof.',
    cost: 460, hp: 190, speed: 50, range: 170, rof: 0.8, dmg: 46, aoe: 30,
    proj: 'shell', len: 56, wid: 15, mount: [4, 0], barrel: 26, sound: 'cannon',
  },
  {
    id: 'mixer', name: 'Cement Mixer', weapon: 'Rocket Battery',
    blurb: 'Pours concrete AND redistributes it, all in one visit.',
    cost: 540, hp: 210, speed: 25, range: 210, rof: 3, dmg: 14, aoe: 34,
    proj: 'rocket', len: 44, wid: 18, mount: [-8, 0], barrel: 18, sound: 'rocket',
  },
];

/* =========================================================================
 * ENEMY CATALOG — the things that dare to stand still
 * ========================================================================= */
const STRUCTS = {
  sandbag: {
    name: 'Sandbag Nest', hp: 70, dmg: 4, rof: 3, range: 130, bounty: 35,
    proj: 'ebullet', r: 15, minWave: 1, weight: 5,
  },
  watchtower: {
    name: 'Watchtower', hp: 100, dmg: 9, rof: 1.1, range: 200, bounty: 55,
    proj: 'ebullet', r: 14, minWave: 2, weight: 4,
  },
  mortar: {
    name: 'Mortar Pit', hp: 120, dmg: 20, rof: 0.35, range: 250, bounty: 95,
    proj: 'mortar', aoe: 40, r: 15, minWave: 3, weight: 3,
  },
  pillbox: {
    name: 'Pillbox', hp: 230, dmg: 6, rof: 2.6, range: 140, bounty: 85,
    proj: 'ebullet', r: 16, minWave: 4, weight: 3,
  },
  fuel: {
    name: 'Fuel Depot', hp: 110, dmg: 0, rof: 0, range: 0, bounty: 140,
    proj: null, r: 15, minWave: 1, weight: 2, volatile: true,
  },
  hq: {
    name: 'Command Bunker', hp: 480, dmg: 8, rof: 2, range: 170, bounty: 260,
    proj: 'ebullet', r: 22, minWave: 5, weight: 0,
  },
};

// hand-placed lots beside the road where fortifications get built
const SPOTS = [
  { x: 300, y: 148 }, { x: 108, y: 205 }, { x: 262, y: 330 }, { x: 88, y: 452 },
  { x: 330, y: 425 }, { x: 588, y: 480 }, { x: 388, y: 322 }, { x: 560, y: 220 },
  { x: 690, y: 82 },  { x: 892, y: 240 }, { x: 726, y: 330 }, { x: 852, y: 468 },
  { x: 636, y: 560 }, { x: 486, y: 64 },
];

/* =========================================================================
 * GAME STATE
 * ========================================================================= */
const game = {};

function resetGame() {
  game.state = 'menu'; // menu | intermission | wave | gameover
  game.cash = 300;
  game.wave = 0;
  game.morale = 10;
  game.kills = 0;
  game.escaped = 0;
  game.lost = 0;
  game.timeScale = 1;
  game.nextWaveTimer = 0;
  game.deployCooldown = 0;
  game.vehicles = [];
  game.structures = [];
  game.projectiles = [];
  game.particles = [];
  game.decals = [];
  game.floaters = [];
  game.banner = null;
  game.loanTimer = 0;
}

/* ---------- floating text & banners ---------- */
function floater(x, y, txt, color) {
  game.floaters.push({ x, y, txt, color, life: 1.4 });
}
function banner(txt, sub) {
  game.banner = { txt, sub, life: 2.6 };
}

/* =========================================================================
 * WAVES
 * ========================================================================= */
function composeWave(n) {
  const list = [];
  if (n % 5 === 0) list.push('hq');
  const count = Math.min(SPOTS.length, 2 + Math.ceil(n * 0.9)) - list.length;
  const pool = [];
  for (const [id, t] of Object.entries(STRUCTS)) {
    if (n >= t.minWave && t.weight > 0) {
      for (let i = 0; i < t.weight; i++) pool.push(id);
    }
  }
  for (let i = 0; i < count; i++) list.push(pick(pool));
  return list;
}

function startWave() {
  game.wave++;
  const hpScale = 1 + (game.wave - 1) * 0.18;
  const bountyScale = 1 + (game.wave - 1) * 0.08;
  const spots = [...SPOTS].sort(() => Math.random() - 0.5);
  const types = composeWave(game.wave);
  game.structures = [];
  for (let i = 0; i < types.length && i < spots.length; i++) {
    const t = STRUCTS[types[i]];
    game.structures.push({
      type: types[i], t,
      x: spots[i].x, y: spots[i].y,
      hp: Math.round(t.hp * hpScale), maxhp: Math.round(t.hp * hpScale),
      bounty: Math.round(t.bounty * bountyScale),
      cool: rand(0.3, 1.2), ang: rand(TAU), flash: 0, hurt: 0,
    });
  }
  game.state = 'wave';
  banner(`WAVE ${game.wave}`, `${game.structures.length} fortifications dug in`);
  sfx.wave();
  updateUI();
}

function waveCleared() {
  const bonus = 90 + game.wave * 15;
  game.cash += bonus;
  game.state = 'intermission';
  game.nextWaveTimer = 8;
  banner(`WAVE ${game.wave} CLEARED`, `+$${bonus} contract bonus — next wave incoming`);
  sfx.cash();
  updateUI();
}

/* =========================================================================
 * DEPLOY & COMBAT
 * ========================================================================= */
const MAX_VEHICLES = 12;
const CHEAPEST = Math.min(...VEHICLES.map(v => v.cost));

function deploy(typeIdx) {
  const t = VEHICLES[typeIdx];
  if (!t) return;
  if (game.state === 'menu' || game.state === 'gameover') return;
  if (game.cash < t.cost || game.deployCooldown > 0) return;
  if (game.vehicles.length >= MAX_VEHICLES) {
    floater(pointAt(10).x + 40, pointAt(10).y, 'Road is full!', '#d4552e');
    return;
  }
  game.cash -= t.cost;
  game.deployCooldown = 0.8;
  const start = pointAt(0);
  game.vehicles.push({
    t, s: 0,
    lane: rand(-9, 9),
    hp: t.hp, maxhp: t.hp,
    cool: rand(0, 0.3),
    x: start.x, y: start.y, ang: start.ang, tAng: start.ang,
    flash: 0, hurt: 0, wobble: rand(TAU),
  });
  floater(start.x + 46, start.y - 20, `${t.name} rolling out!`, '#e8b84b');
  sfx.deploy();
  updateUI();
}

function fireVehicle(v, target) {
  const t = v.t;
  const a = Math.cos(v.ang), b = Math.sin(v.ang);
  const mx = v.x + a * t.mount[0] - b * t.mount[1];
  const my = v.y + b * t.mount[0] + a * t.mount[1];
  const sx = mx + Math.cos(v.tAng) * t.barrel;
  const sy = my + Math.sin(v.tAng) * t.barrel;
  v.flash = 0.07;
  sfx[t.sound]();
  if (t.proj === 'bullet') {
    game.projectiles.push({
      kind: 'bullet', x: sx, y: sy, tx: target.x + rand(-5, 5), ty: target.y + rand(-5, 5),
      speed: 460, dmg: t.dmg, target,
    });
  } else {
    game.projectiles.push({
      kind: t.proj, x: sx, y: sy, tx: target.x + rand(-6, 6), ty: target.y + rand(-6, 6),
      speed: t.proj === 'rocket' ? 190 : t.proj === 'flak' ? 380 : 300,
      dmg: t.dmg, aoe: t.aoe || 0, wob: rand(TAU),
    });
    if (t.id === 'moped') {
      // recoilless backblast
      for (let i = 0; i < 6; i++) {
        game.particles.push(mkSmoke(mx - Math.cos(v.tAng) * 14 + rand(-4, 4), my - Math.sin(v.tAng) * 14 + rand(-4, 4), 0.5));
      }
    }
  }
}

function fireStruct(st, target) {
  const t = st.t;
  st.flash = 0.07;
  if (t.proj === 'ebullet') {
    sfx.gun();
    game.projectiles.push({
      kind: 'ebullet', x: st.x + Math.cos(st.ang) * 14, y: st.y + Math.sin(st.ang) * 14,
      speed: 300, dmg: t.dmg, target, life: 2.5,
    });
  } else if (t.proj === 'mortar') {
    sfx.cannon();
    const dur = 1.25;
    const lead = pointAt(clamp(target.s + target.t.speed * dur * 0.6, 0, pathLen));
    game.projectiles.push({
      kind: 'mortar', sx: st.x, sy: st.y,
      tx: lead.x + rand(-14, 14), ty: lead.y + rand(-14, 14),
      t: 0, dur, dmg: t.dmg, aoe: t.aoe,
    });
  }
}

function damageStruct(st, dmg) {
  if (st.hp <= 0) return;
  st.hp -= dmg;
  st.hurt = 0.1;
  if (st.hp <= 0) killStruct(st);
}

function killStruct(st) {
  st.hp = 0;
  game.kills++;
  game.cash += st.bounty;
  floater(st.x, st.y - 22, `+$${st.bounty}`, '#7fb951');
  explode(st.x, st.y, st.t.r + 12, st.type === 'hq' || st.t.volatile);
  game.decals.push({ x: st.x, y: st.y, r: st.t.r + 6 });
  if (game.decals.length > 40) game.decals.shift();
  if (st.t.volatile) {
    // fuel depot cook-off: hurts everything nearby, both sides
    for (const o of game.structures) {
      if (o !== st && o.hp > 0 && dist(st.x, st.y, o.x, o.y) < 95) damageStruct(o, 80);
    }
    for (const v of game.vehicles) {
      if (v.hp > 0 && dist(st.x, st.y, v.x, v.y) < 95) damageVehicle(v, 40);
    }
  }
  updateUI();
}

function damageVehicle(v, dmg) {
  if (v.hp <= 0) return;
  v.hp -= dmg;
  v.hurt = 0.1;
  sfx.hurt();
  if (v.hp <= 0) {
    game.lost++;
    game.morale--;
    explode(v.x, v.y, 22, false);
    game.decals.push({ x: v.x, y: v.y, r: 14 });
    if (game.decals.length > 40) game.decals.shift();
    floater(v.x, v.y - 20, `${v.t.name} destroyed!`, '#d4552e');
    if (game.morale <= 0) gameOver();
    updateUI();
  }
}

function explode(x, y, r, big) {
  big ? sfx.bigboom() : sfx.boom();
  game.particles.push({ kind: 'ring', x, y, life: 0.35, max: 0.35, r });
  const n = big ? 26 : 14;
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), sp = rand(30, big ? 160 : 110);
    game.particles.push({
      kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.25, 0.55), max: 0.55, size: rand(1.5, 3.5),
      color: pick(['#ffd977', '#ff9d3c', '#ff5a2e', '#fff2c9']),
    });
  }
  for (let i = 0; i < (big ? 12 : 6); i++) {
    game.particles.push(mkSmoke(x + rand(-r / 2, r / 2), y + rand(-r / 2, r / 2), rand(0.7, 1.4)));
  }
}

function mkSmoke(x, y, life) {
  return {
    kind: 'smoke', x, y, vx: rand(-12, 12), vy: rand(-24, -8),
    life, max: life, size: rand(4, 9),
  };
}

function gameOver() {
  game.state = 'gameover';
  sfx.lose();
  document.getElementById('go-stats').innerHTML =
    `<span>🌊 Waves survived: <b>${game.wave - 1}</b></span>` +
    `<span>💥 Fortifications wrecked: <b>${game.kills}</b></span>` +
    `<span>🏁 Vehicles home safe: <b>${game.escaped}</b></span>`;
  document.getElementById('go-text').textContent =
    game.lost === 1 ? 'One truck was one truck too many. Morale broke.' :
    `${game.lost} beautiful, ridiculous machines were lost. Morale broke.`;
  document.getElementById('gameover').classList.remove('hidden');
  updateUI();
}

/* =========================================================================
 * UPDATE
 * ========================================================================= */
function update(dt) {
  if (game.state === 'menu' || game.state === 'gameover') return;

  game.deployCooldown = Math.max(0, game.deployCooldown - dt);

  // intermission countdown
  if (game.state === 'intermission') {
    game.nextWaveTimer -= dt;
    if (game.nextWaveTimer <= 0) startWave();
  }

  /* --- vehicles --- */
  for (const v of game.vehicles) {
    const t = v.t;
    v.wobble += dt * 9;
    v.flash = Math.max(0, v.flash - dt);
    v.hurt = Math.max(0, v.hurt - dt);

    // acquire nearest living fortification in range
    let target = null, best = Infinity;
    for (const st of game.structures) {
      if (st.hp <= 0) continue;
      const d = dist(v.x, v.y, st.x, st.y);
      if (d < t.range && d < best) { best = d; target = st; }
    }

    // drive (slower while engaging — gun-run pace)
    v.s += t.speed * (target ? 0.55 : 1) * dt;
    const p = pointAt(v.s);
    const nx = -Math.sin(p.ang), ny = Math.cos(p.ang);
    v.x = p.x + nx * v.lane;
    v.y = p.y + ny * v.lane;
    v.ang = p.ang;

    // aim & fire
    const want = target ? Math.atan2(target.y - v.y, target.x - v.x) : v.ang;
    let da = want - v.tAng;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    v.tAng += clamp(da, -5 * dt, 5 * dt);
    v.cool -= dt;
    if (target && v.cool <= 0 && Math.abs(da) < 0.35) {
      v.cool = 1 / t.rof;
      fireVehicle(v, target);
    }

    // made it to the end of the road
    if (v.s >= pathLen - 2) {
      v.hp = 0;
      v.escaped = true;
      game.escaped++;
      game.cash += 30;
      floater(v.x, v.y - 16, `${t.name} escaped! +$30`, '#7fb951');
      sfx.cash();
      updateUI();
    }
  }
  game.vehicles = game.vehicles.filter(v => v.hp > 0);

  // anti-softlock: broke, truckless, mid-wave — the warlord fronts you cash
  if (game.state === 'wave' && game.vehicles.length === 0 && game.cash < CHEAPEST) {
    game.loanTimer += dt;
    if (game.loanTimer > 2) {
      game.loanTimer = 0;
      game.morale--;
      game.cash += 200;
      banner('EMERGENCY LOAN', 'The boss fronts you $200. He is not smiling. (−1 morale)');
      sfx.hurt();
      if (game.morale <= 0) { gameOver(); return; }
      updateUI();
    }
  } else {
    game.loanTimer = 0;
  }

  /* --- structures --- */
  for (const st of game.structures) {
    if (st.hp <= 0) continue;
    st.flash = Math.max(0, st.flash - dt);
    st.hurt = Math.max(0, st.hurt - dt);
    const t = st.t;
    if (!t.proj) continue;
    let target = null, best = Infinity;
    for (const v of game.vehicles) {
      const d = dist(st.x, st.y, v.x, v.y);
      if (d < t.range && d < best) { best = d; target = v; }
    }
    if (target) {
      const want = Math.atan2(target.y - st.y, target.x - st.x);
      let da = want - st.ang;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      st.ang += clamp(da, -4 * dt, 4 * dt);
      st.cool -= dt;
      if (st.cool <= 0 && Math.abs(da) < 0.4) {
        st.cool = 1 / t.rof;
        fireStruct(st, target);
      }
    }
  }

  // wave cleared?
  if (game.state === 'wave' && game.structures.every(s => s.hp <= 0)) waveCleared();

  /* --- projectiles --- */
  for (const p of game.projectiles) {
    if (p.kind === 'mortar') {
      p.t += dt;
      if (p.t >= p.dur) {
        p.dead = true;
        explode(p.tx, p.ty, p.aoe * 0.6, false);
        for (const v of game.vehicles) {
          if (dist(p.tx, p.ty, v.x, v.y) < p.aoe) damageVehicle(v, p.dmg);
        }
      }
      continue;
    }
    if (p.kind === 'ebullet') {
      p.life -= dt;
      if (p.life <= 0 || !p.target || p.target.hp <= 0) { p.dead = true; continue; }
      const a = Math.atan2(p.target.y - p.y, p.target.x - p.x);
      p.x += Math.cos(a) * p.speed * dt;
      p.y += Math.sin(a) * p.speed * dt;
      if (dist(p.x, p.y, p.target.x, p.target.y) < 11) {
        p.dead = true;
        damageVehicle(p.target, p.dmg);
      }
      continue;
    }
    // vehicle ordnance flying at a fixed point
    const a = Math.atan2(p.ty - p.y, p.tx - p.x);
    const wob = p.kind === 'rocket' ? Math.sin((p.wob += dt * 14)) * 0.25 : 0;
    p.x += Math.cos(a + wob) * p.speed * dt;
    p.y += Math.sin(a + wob) * p.speed * dt;
    if (p.kind === 'rocket') {
      p.speed += 260 * dt;
      if (Math.random() < 0.6) game.particles.push(mkSmoke(p.x, p.y, 0.35));
    }
    if (dist(p.x, p.y, p.tx, p.ty) < 9) {
      p.dead = true;
      if (p.kind === 'bullet') {
        if (p.target && p.target.hp > 0) damageStruct(p.target, p.dmg);
        game.particles.push({ kind: 'spark', x: p.x, y: p.y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0.15, max: 0.15, size: 2, color: '#ffd977' });
      } else {
        explode(p.tx, p.ty, Math.max(10, p.aoe * 0.55), false);
        for (const st of game.structures) {
          if (st.hp > 0 && dist(p.tx, p.ty, st.x, st.y) < p.aoe + st.t.r) damageStruct(st, p.dmg);
        }
      }
    }
  }
  game.projectiles = game.projectiles.filter(p => !p.dead);

  /* --- particles / floaters / banner --- */
  for (const pt of game.particles) {
    pt.life -= dt;
    if (pt.vx !== undefined) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.kind === 'smoke') { pt.vy -= 10 * dt; pt.size += 8 * dt; }
      else { pt.vx *= 0.94; pt.vy *= 0.94; }
    }
  }
  game.particles = game.particles.filter(p => p.life > 0);
  for (const f of game.floaters) { f.life -= dt; f.y -= 22 * dt; }
  game.floaters = game.floaters.filter(f => f.life > 0);
  if (game.banner) {
    game.banner.life -= dt;
    if (game.banner.life <= 0) game.banner = null;
  }
}

/* =========================================================================
 * SCENERY — pre-rendered desert backdrop
 * ========================================================================= */
let bgCanvas = null;

function buildBackground() {
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = W * DPR;
  bgCanvas.height = H * DPR;
  const g = bgCanvas.getContext('2d');
  g.scale(DPR, DPR);

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#d9b877');
  grad.addColorStop(1, '#c9a25c');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // mottled sand
  for (let i = 0; i < 120; i++) {
    g.fillStyle = srand() > 0.5 ? 'rgba(140,110,60,0.06)' : 'rgba(255,240,200,0.05)';
    g.beginPath();
    g.ellipse(srand() * W, srand() * H, 12 + srand() * 46, 8 + srand() * 26, srand() * TAU, 0, TAU);
    g.fill();
  }

  // dirt lots where fortifications get built
  for (const s of SPOTS) {
    g.fillStyle = 'rgba(120,92,52,0.35)';
    g.beginPath();
    g.ellipse(s.x, s.y, 26, 20, 0, 0, TAU);
    g.fill();
  }

  // the road
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const road = () => {
    g.beginPath();
    g.moveTo(pathPts[0].x, pathPts[0].y);
    for (const p of pathPts) g.lineTo(p.x, p.y);
  };
  road(); g.strokeStyle = '#8a6d43'; g.lineWidth = 42; g.stroke();
  road(); g.strokeStyle = '#a5854f'; g.lineWidth = 34; g.stroke();
  road(); g.strokeStyle = 'rgba(220,190,130,0.5)'; g.lineWidth = 2; g.setLineDash([10, 14]); g.stroke();
  g.setLineDash([]);

  // scattered scenery, kept off the road and lots
  for (let i = 0; i < 46; i++) {
    const x = srand() * W, y = srand() * H;
    if (distToPath(x, y) < 42) continue;
    if (SPOTS.some(s => dist(x, y, s.x, s.y) < 38)) continue;
    const kind = srand();
    if (kind < 0.4) { // rock
      g.fillStyle = '#9b8a6b';
      g.beginPath();
      g.ellipse(x, y, 4 + srand() * 6, 3 + srand() * 4, srand() * TAU, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.ellipse(x - 1, y - 1, 2 + srand() * 2, 1.5, 0, 0, TAU); g.fill();
    } else if (kind < 0.75) { // scrub
      g.fillStyle = '#7d8a45';
      for (let j = 0; j < 5; j++) {
        g.beginPath();
        g.arc(x + srand() * 8 - 4, y + srand() * 6 - 3, 1.6 + srand() * 2, 0, TAU);
        g.fill();
      }
    } else { // cactus
      g.strokeStyle = '#5d7a35';
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x, y - 8); g.stroke();
      g.beginPath(); g.moveTo(x, y - 1); g.lineTo(x - 6, y - 3); g.lineTo(x - 6, y - 8); g.stroke();
      g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + 6, y); g.lineTo(x + 6, y - 5); g.stroke();
    }
  }

  // start & end markers
  const s0 = pointAt(6), s1 = pointAt(pathLen - 6);
  g.font = 'bold 11px Trebuchet MS, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(60,45,20,0.75)';
  g.fillText('CONVOY ▶', s0.x + 52, s0.y - 26);
  g.fillText('▶ ESCAPE', s1.x - 46, s1.y - 30);
}

/* =========================================================================
 * ART — every sprite hand-drawn, facing +x at the origin
 * ========================================================================= */
function drawWheel(g, x, y, w, h) {
  g.fillStyle = '#221d16';
  g.fillRect(x - w / 2, y - h / 2, w, h);
}

function drawBarrel(g, len, width, color) {
  g.fillStyle = color || '#33302a';
  g.fillRect(0, -width / 2, len, width);
  g.fillRect(len - 3, -width / 2 - 1, 3, width + 2); // muzzle
}

const VEHICLE_ART = {
  tuktuk(g) {
    drawWheel(g, 10, 0, 6, 5);
    drawWheel(g, -8, -7, 7, 4);
    drawWheel(g, -8, 7, 7, 4);
    g.fillStyle = '#e8c531';
    rounded(g, -13, -7, 24, 14, 4);
    g.fillStyle = '#2f6d3a';
    rounded(g, -13, -7, 9, 14, 3); // canopy
    g.fillStyle = '#bfe3ef';
    g.fillRect(7, -5, 4, 10); // windshield
  },
  moped(g) {
    drawWheel(g, 9, 0, 6, 4);
    drawWheel(g, -9, 0, 6, 4);
    g.fillStyle = '#c8372e';
    rounded(g, -10, -3, 20, 6, 2);
    g.fillStyle = '#e0b089';
    g.beginPath(); g.arc(-2, 0, 3.4, 0, TAU); g.fill(); // rider
    g.fillStyle = '#fff';
    g.fillRect(-12, -4, 5, 8); // pizza box
  },
  icecream(g) {
    drawWheel(g, 10, -9, 7, 4);
    drawWheel(g, 10, 9, 7, 4);
    drawWheel(g, -11, -9, 7, 4);
    drawWheel(g, -11, 9, 7, 4);
    g.fillStyle = '#f4efe4';
    rounded(g, -17, -8.5, 34, 17, 4);
    g.fillStyle = '#e87ea1';
    g.fillRect(-17, -2, 34, 4); // pink stripe
    g.fillStyle = '#bfe3ef';
    g.fillRect(12, -6, 4, 12);
    g.fillStyle = '#e8a13c'; // rooftop cone
    g.beginPath(); g.moveTo(-14, -6); g.lineTo(-9, -6); g.lineTo(-11.5, -12); g.closePath(); g.fill();
    g.fillStyle = '#f2d5e2';
    g.beginPath(); g.arc(-11.5, -6, 2.6, 0, TAU); g.fill();
  },
  tractor(g) {
    drawWheel(g, -8, -9, 12, 6);
    drawWheel(g, -8, 9, 12, 6);
    drawWheel(g, 10, -7, 7, 4);
    drawWheel(g, 10, 7, 7, 4);
    g.fillStyle = '#3f7d3a';
    rounded(g, -15, -6.5, 30, 13, 3);
    g.fillStyle = '#c9c9c9';
    g.fillRect(11, -1.5, 5, 3); // exhaust
    g.fillStyle = '#bfe3ef';
    g.fillRect(-4, -4.5, 6, 9);
  },
  bus(g) {
    drawWheel(g, 20, -9, 8, 4);
    drawWheel(g, 20, 9, 8, 4);
    drawWheel(g, -20, -9, 8, 4);
    drawWheel(g, -20, 9, 8, 4);
    drawWheel(g, -10, -9, 8, 4);
    drawWheel(g, -10, 9, 8, 4);
    g.fillStyle = '#e89c31';
    rounded(g, -29, -9, 58, 18, 4);
    g.fillStyle = '#bfe3ef';
    for (let i = -22; i <= 18; i += 8) g.fillRect(i, -7, 5, 3.4);
    for (let i = -22; i <= 18; i += 8) g.fillRect(i, 3.6, 5, 3.4);
    g.fillStyle = '#333';
    g.fillRect(24, -7, 3, 14); // front grill
  },
  limo(g) {
    drawWheel(g, 21, -8, 7, 4);
    drawWheel(g, 21, 8, 7, 4);
    drawWheel(g, -21, -8, 7, 4);
    drawWheel(g, -21, 8, 7, 4);
    g.fillStyle = '#1d1d22';
    rounded(g, -28, -7.5, 56, 15, 6);
    g.fillStyle = '#4d5866';
    for (let i = -22; i <= 16; i += 7) g.fillRect(i, -5.5, 4.4, 2.6);
    for (let i = -22; i <= 16; i += 7) g.fillRect(i, 2.9, 4.4, 2.6);
    g.fillStyle = '#e8c531';
    g.fillRect(26, -4, 2, 3); g.fillRect(26, 1, 2, 3); // headlights
  },
  mixer(g) {
    drawWheel(g, 14, -9, 8, 4);
    drawWheel(g, 14, 9, 8, 4);
    drawWheel(g, -14, -9, 8, 4);
    drawWheel(g, -14, 9, 8, 4);
    drawWheel(g, -6, -9, 8, 4);
    drawWheel(g, -6, 9, 8, 4);
    g.fillStyle = '#38618c';
    rounded(g, 8, -8, 14, 16, 3); // cab
    g.fillStyle = '#bfe3ef';
    g.fillRect(17, -6, 3.4, 12);
    g.fillStyle = '#c1c7ce'; // drum
    g.beginPath(); g.ellipse(-8, 0, 14, 9, 0, 0, TAU); g.fill();
    g.strokeStyle = '#8d939b';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-18, -4); g.lineTo(2, 4); g.stroke();
    g.beginPath(); g.moveTo(-18, 4); g.lineTo(2, -4); g.stroke();
  },
};

const TURRET_ART = {
  tuktuk(g) {
    g.fillStyle = '#33302a';
    g.fillRect(0, -3.4, 14, 2.2);
    g.fillRect(0, 1.2, 14, 2.2);
    g.fillStyle = '#5a5348';
    g.beginPath(); g.arc(0, 0, 3.4, 0, TAU); g.fill();
  },
  moped(g) {
    drawBarrel(g, 18, 3.4, '#6b6f5a');
    g.fillRect(-8, -1.7, 8, 3.4); // venturi sticking out the back
  },
  icecream(g) {
    g.fillStyle = '#7d8177';
    g.fillRect(-4, -6, 8, 12); // gun shield
    drawBarrel(g, 22, 3, '#4a4e44');
  },
  tractor(g) {
    g.fillStyle = '#4a4e55';
    g.beginPath(); g.arc(0, 0, 6.5, 0, TAU); g.fill();
    drawBarrel(g, 28, 5, '#3a3e45');
    g.fillStyle = '#3a3e45';
    g.fillRect(22, -4, 4, 8); // muzzle brake
  },
  bus(g) {
    g.fillStyle = '#4a4e44';
    g.fillRect(-6, -7, 12, 14);
    g.fillStyle = '#2c2f28';
    g.fillRect(4, -6.4, 16, 2.6);
    g.fillRect(4, -2.2, 16, 2.6);
    g.fillRect(4, 2, 16, 2.6);
    g.fillRect(4, 6 - 1.8, 16, 2.6);
  },
  limo(g) {
    g.fillStyle = '#3a4048';
    g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    drawBarrel(g, 26, 4, '#2c3138');
  },
  mixer(g) {
    g.fillStyle = '#5a4a3a';
    g.fillRect(-4, -7, 10, 14);
    g.fillStyle = '#33302a';
    for (const y of [-5, -1.6, 1.8, 5.2]) g.fillRect(4, y - 1.1, 15, 2.2);
  },
};

function rounded(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}

function drawVehicle(g, v) {
  const t = v.t;
  g.save();
  g.translate(v.x, v.y + Math.sin(v.wobble) * 0.6);
  // shadow
  g.fillStyle = 'rgba(50,35,15,0.3)';
  g.beginPath();
  g.ellipse(2, 3, t.len / 2 + 2, t.wid / 2 + 2, v.ang, 0, TAU);
  g.fill();
  g.rotate(v.ang);
  VEHICLE_ART[t.id](g);
  // turret rotates independently of the hull
  g.translate(t.mount[0], t.mount[1]);
  g.rotate(v.tAng - v.ang);
  TURRET_ART[t.id](g);
  if (v.flash > 0) {
    g.fillStyle = '#ffe9a3';
    g.beginPath();
    g.arc(t.barrel + 3, 0, 5, 0, TAU);
    g.fill();
  }
  g.restore();

  if (v.hurt > 0) {
    g.fillStyle = 'rgba(255,80,60,0.35)';
    g.beginPath(); g.arc(v.x, v.y, t.len / 2 + 4, 0, TAU); g.fill();
  }
  if (v.hp < v.maxhp) drawHPBar(g, v.x, v.y - t.wid - 10, v.hp / v.maxhp, '#7fb951');
}

const STRUCT_ART = {
  sandbag(g, st) {
    g.fillStyle = '#8a7448';
    g.beginPath(); g.arc(0, 0, 13, 0, TAU); g.fill();
    g.fillStyle = '#c2a86f';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      g.beginPath(); g.ellipse(Math.cos(a) * 13, Math.sin(a) * 13, 5, 3.4, a, 0, TAU); g.fill();
    }
    g.save(); g.rotate(st.ang);
    g.fillStyle = '#33302a'; g.fillRect(4, -1.4, 13, 2.8);
    g.restore();
    g.fillStyle = '#4a4438';
    g.beginPath(); g.arc(0, 0, 3.4, 0, TAU); g.fill();
  },
  watchtower(g, st) {
    g.strokeStyle = '#6b4f2e';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-11, -11); g.lineTo(11, 11);
    g.moveTo(11, -11); g.lineTo(-11, 11);
    g.stroke();
    g.fillStyle = '#8a6a3e';
    g.fillRect(-10, -10, 20, 20);
    g.strokeStyle = '#5d451f';
    g.lineWidth = 2;
    g.strokeRect(-10, -10, 20, 20);
    g.save(); g.rotate(st.ang);
    g.fillStyle = '#33302a'; g.fillRect(4, -1.6, 15, 3.2);
    g.restore();
    g.fillStyle = '#4a4438';
    g.beginPath(); g.arc(0, 0, 3.6, 0, TAU); g.fill();
  },
  mortar(g, st) {
    g.fillStyle = '#7d6339';
    g.beginPath(); g.arc(0, 0, 14, 0, TAU); g.fill();
    g.fillStyle = '#c2a86f';
    for (let i = 0; i < 7; i++) {
      const a = (i / 10) * TAU + 1.9;
      g.beginPath(); g.ellipse(Math.cos(a) * 13, Math.sin(a) * 13, 5, 3.2, a, 0, TAU); g.fill();
    }
    g.save(); g.rotate(st.ang);
    g.fillStyle = '#3a3e45';
    g.beginPath(); g.ellipse(2, 0, 6, 4.4, 0, 0, TAU); g.fill();
    g.fillRect(0, -2.2, 12, 4.4);
    g.restore();
  },
  pillbox(g, st) {
    g.fillStyle = '#9a978c';
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + st.x; // fixed pseudo-random facet rotation per spot
      const m = i ? 'lineTo' : 'moveTo';
      g[m](Math.cos(a) * 16, Math.sin(a) * 16);
    }
    g.closePath(); g.fill();
    g.strokeStyle = '#6e6b60'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#7b786d';
    g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();
    g.save(); g.rotate(st.ang);
    g.fillStyle = '#1d1b16'; g.fillRect(7, -4, 6, 8); // firing slit
    g.fillStyle = '#33302a'; g.fillRect(9, -1.4, 10, 2.8);
    g.restore();
  },
  fuel(g) {
    g.fillStyle = 'rgba(70,50,25,0.5)';
    g.beginPath(); g.ellipse(0, 2, 17, 12, 0, 0, TAU); g.fill();
    const barrel = (x, y, c) => {
      g.fillStyle = c;
      g.beginPath(); g.arc(x, y, 6.4, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, 6.4, 0, TAU); g.stroke();
      g.beginPath(); g.arc(x, y, 3, 0, TAU); g.stroke();
    };
    barrel(-6, -4, '#b3402e');
    barrel(6, -3, '#8c5b28');
    barrel(0, 6, '#b3402e');
    g.fillStyle = '#e8c531';
    g.font = 'bold 9px sans-serif';
    g.textAlign = 'center';
    g.fillText('⚠', 0, -10);
  },
  hq(g, st) {
    g.fillStyle = '#8d8a7e';
    rounded(g, -20, -15, 40, 30, 4);
    g.fillStyle = '#767368';
    rounded(g, -15, -10, 30, 20, 3);
    g.strokeStyle = '#55534a';
    g.lineWidth = 1.6;
    g.strokeRect(-20, -15, 40, 30);
    g.save(); g.rotate(st.ang);
    g.fillStyle = '#33302a'; g.fillRect(10, -2, 16, 4);
    g.restore();
    // antenna + flag
    g.strokeStyle = '#44423a'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(12, -12); g.lineTo(12, -24); g.stroke();
    g.fillStyle = '#b3402e';
    g.beginPath(); g.moveTo(12, -24); g.lineTo(22, -21); g.lineTo(12, -18); g.closePath(); g.fill();
  },
};

function drawStruct(g, st) {
  g.save();
  g.translate(st.x, st.y);
  STRUCT_ART[st.type](g, st);
  if (st.flash > 0) {
    g.save(); g.rotate(st.ang);
    g.fillStyle = '#ffe9a3';
    g.beginPath(); g.arc(st.t.r + 4, 0, 4.5, 0, TAU); g.fill();
    g.restore();
  }
  if (st.hurt > 0) {
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath(); g.arc(0, 0, st.t.r + 3, 0, TAU); g.fill();
  }
  g.restore();
  if (st.hp < st.maxhp) drawHPBar(g, st.x, st.y - st.t.r - 10, st.hp / st.maxhp, '#d4552e');
}

function drawHPBar(g, x, y, frac, color) {
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(x - 13, y, 26, 4);
  g.fillStyle = color;
  g.fillRect(x - 12, y + 1, 24 * clamp(frac, 0, 1), 2);
}

/* =========================================================================
 * RENDER
 * ========================================================================= */
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  // scorch decals
  for (const d of game.decals) {
    ctx.fillStyle = 'rgba(35,25,15,0.4)';
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.r, d.r * 0.75, 0, 0, TAU);
    ctx.fill();
  }

  for (const st of game.structures) if (st.hp > 0) drawStruct(ctx, st);

  // mortar shells get a ground shadow + aerial arc
  for (const p of game.projectiles) {
    if (p.kind !== 'mortar') continue;
    const t = p.t / p.dur;
    const x = p.sx + (p.tx - p.sx) * t;
    const y = p.sy + (p.ty - p.sy) * t;
    const h = Math.sin(t * Math.PI) * 70;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y, 4, 2.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a3e45';
    ctx.beginPath(); ctx.arc(x, y - h, 3.4, 0, TAU); ctx.fill();
    if (t > 0.75) { // incoming!
      ctx.strokeStyle = 'rgba(212,85,46,0.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.tx, p.ty, 8 + Math.sin(performance.now() / 60) * 2, 0, TAU); ctx.stroke();
    }
  }

  for (const v of game.vehicles) drawVehicle(ctx, v);

  // flat-trajectory projectiles
  for (const p of game.projectiles) {
    if (p.kind === 'mortar') continue;
    if (p.kind === 'bullet' || p.kind === 'ebullet') {
      const a = Math.atan2((p.ty ?? p.target.y) - p.y, (p.tx ?? p.target.x) - p.x);
      ctx.strokeStyle = p.kind === 'ebullet' ? '#ff8862' : '#ffe9a3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(a) * 7, p.y - Math.sin(a) * 7);
      ctx.stroke();
    } else if (p.kind === 'flak') {
      ctx.fillStyle = '#d9d9d9';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = p.kind === 'rocket' ? '#c8552e' : '#33302a';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.kind === 'rocket' ? 3 : 3.4, 0, TAU); ctx.fill();
      if (p.kind === 'rocket') {
        ctx.fillStyle = '#ffb347';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, TAU); ctx.fill();
      }
    }
  }

  // particles
  for (const pt of game.particles) {
    const a = clamp(pt.life / pt.max, 0, 1);
    if (pt.kind === 'smoke') {
      ctx.fillStyle = `rgba(90,80,70,${0.3 * a})`;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, TAU); ctx.fill();
    } else if (pt.kind === 'spark') {
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (pt.kind === 'ring') {
      const r = pt.r * (1.6 - a * 0.9);
      ctx.strokeStyle = `rgba(255,200,110,${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, TAU); ctx.stroke();
    }
  }

  // floating text
  ctx.font = 'bold 12px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  for (const f of game.floaters) {
    ctx.globalAlpha = clamp(f.life, 0, 1);
    ctx.fillStyle = '#1c160d';
    ctx.fillText(f.txt, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  // wave banner
  if (game.banner) {
    const a = clamp(Math.min(game.banner.life, 0.5) * 2, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(20,14,8,0.65)';
    ctx.fillRect(0, H / 2 - 44, W, 88);
    ctx.fillStyle = '#e8b84b';
    ctx.font = 'bold 34px Trebuchet MS, sans-serif';
    ctx.fillText(game.banner.txt, W / 2, H / 2 - 2);
    ctx.fillStyle = '#ead9b8';
    ctx.font = '15px Trebuchet MS, sans-serif';
    ctx.fillText(game.banner.sub, W / 2, H / 2 + 24);
    ctx.globalAlpha = 1;
  }

  // intermission countdown hint
  if (game.state === 'intermission' && !game.banner) {
    ctx.fillStyle = 'rgba(28,22,13,0.75)';
    ctx.font = 'bold 15px Trebuchet MS, sans-serif';
    ctx.fillText(`Next wave in ${Math.ceil(game.nextWaveTimer)}… stock up!`, W / 2, 24);
  }
}

/* =========================================================================
 * UI
 * ========================================================================= */
const els = {
  cash: document.getElementById('ui-cash'),
  wave: document.getElementById('ui-wave'),
  morale: document.getElementById('ui-morale'),
  kills: document.getElementById('ui-kills'),
  btnWave: document.getElementById('btn-wave'),
  btnSpeed: document.getElementById('btn-speed'),
  btnSound: document.getElementById('btn-sound'),
  cards: document.getElementById('cards'),
};

function buildCards() {
  els.cards.innerHTML = '';
  VEHICLES.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = `card-${t.id}`;
    const dps = Math.round(t.dmg * t.rof);
    card.innerHTML =
      `<canvas width="${92 * DPR}" height="${52 * DPR}"></canvas>` +
      `<div class="name">${t.name} <span class="weapon">+ ${t.weapon}</span><span class="key">${i + 1}</span></div>` +
      `<div class="meta"><span class="cost">$${t.cost}</span><span>❤${t.hp}</span><span>⚔${dps}/s</span><span>🏁${t.speed}</span></div>` +
      `<div class="blurb">${t.blurb}</div>`;
    card.addEventListener('click', () => deploy(i));
    els.cards.appendChild(card);

    // draw the little garage portrait with the same sprite art
    const cg = card.querySelector('canvas').getContext('2d');
    cg.scale(DPR, DPR);
    cg.translate(46, 27);
    const scale = Math.min(1.15, 66 / t.len);
    cg.scale(scale, scale);
    cg.rotate(-0.06);
    VEHICLE_ART[t.id](cg);
    cg.translate(t.mount[0], t.mount[1]);
    cg.rotate(-0.38);
    TURRET_ART[t.id](cg);
  });
}

function updateUI() {
  els.cash.textContent = game.cash;
  els.wave.textContent = game.wave;
  els.morale.textContent = game.morale;
  els.kills.textContent = game.kills;

  if (game.state === 'wave') {
    els.btnWave.disabled = true;
    const left = game.structures.filter(s => s.hp > 0).length;
    els.btnWave.textContent = `${left} standing…`;
  } else if (game.state === 'intermission') {
    els.btnWave.disabled = false;
    els.btnWave.textContent = `Send Wave Now (${Math.ceil(game.nextWaveTimer)})`;
  } else {
    els.btnWave.disabled = true;
    els.btnWave.textContent = 'Start Wave';
  }

  for (const t of VEHICLES) {
    const card = document.getElementById(`card-${t.id}`);
    if (!card) continue;
    const ok = game.cash >= t.cost && game.deployCooldown <= 0 &&
      game.vehicles.length < MAX_VEHICLES &&
      game.state !== 'menu' && game.state !== 'gameover';
    card.classList.toggle('disabled', !ok);
  }
}

/* ---------- input ---------- */
document.getElementById('btn-start').addEventListener('click', () => {
  document.getElementById('splash').classList.add('hidden');
  ac();
  game.state = 'intermission';
  game.nextWaveTimer = 5;
  banner('CONVOY ASSEMBLED', 'Buy your first technicals — wave 1 is coming');
  updateUI();
});

document.getElementById('btn-restart').addEventListener('click', () => {
  document.getElementById('gameover').classList.add('hidden');
  resetGame();
  game.state = 'intermission';
  game.nextWaveTimer = 5;
  banner('CONVOY REBUILT', 'Fresh trucks, fresh paint, same terrible ideas');
  updateUI();
});

els.btnWave.addEventListener('click', () => {
  if (game.state === 'intermission') startWave();
});

els.btnSpeed.addEventListener('click', () => {
  game.timeScale = game.timeScale === 1 ? 2 : 1;
  els.btnSpeed.innerHTML = `${game.timeScale}&times;`;
});

els.btnSound.addEventListener('click', () => {
  muted = !muted;
  els.btnSound.textContent = muted ? '🔇' : '🔊';
});

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= VEHICLES.length) deploy(n - 1);
  if (e.code === 'Space') {
    e.preventDefault();
    if (game.state === 'intermission') startWave();
  }
});

/* =========================================================================
 * MAIN LOOP
 * ========================================================================= */
let lastT = performance.now();
let uiTick = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  update(dt * game.timeScale);
  render();
  uiTick += dt;
  if (uiTick > 0.25) { uiTick = 0; updateUI(); }
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
resetGame();
buildPath();
buildBackground();
buildCards();
updateUI();
requestAnimationFrame(frame);
