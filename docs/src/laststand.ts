import { beep, chord } from "./sfx";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const canvas = $("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const W = canvas.width;
const H = canvas.height;
const MARGIN = 26;
const SAVE_KEY = "rfp_laststand_best_v1";
const CC_HP = 1200;
const CC_R = 34;

type EnemyType = "zergling" | "hydralisk" | "baneling" | "mutalisk" | "ultralisk";
type BuildType = "turret" | "bunker" | "tank";
type StructType = "cc" | BuildType;

interface Vec { x: number; y: number; }

interface EnemyDef {
  hp: number; speed: number; dmg: number; range: number; radius: number;
  atkRate: number; flying: boolean; ranged: boolean; aoe: number; color: string; name: string;
}

const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  zergling:  { hp: 30,  speed: 64, dmg: 6,  range: 18,  radius: 9,  atkRate: 0.8, flying: false, ranged: false, aoe: 0,  color: "#ff5347", name: "Zergling" },
  hydralisk: { hp: 75,  speed: 42, dmg: 10, range: 215, radius: 12, atkRate: 1.4, flying: false, ranged: true,  aoe: 0,  color: "#8ee04f", name: "Hydralisk" },
  baneling:  { hp: 26,  speed: 88, dmg: 55, range: 16,  radius: 10, atkRate: 0,   flying: false, ranged: false, aoe: 78, color: "#c6ff4d", name: "Baneling" },
  mutalisk:  { hp: 130, speed: 98, dmg: 13, range: 20,  radius: 11, atkRate: 0.7, flying: true,  ranged: false, aoe: 0,  color: "#c07bf2", name: "Mutalisk" },
  ultralisk: { hp: 950, speed: 27, dmg: 65, range: 36,  radius: 26, atkRate: 1.6, flying: false, ranged: false, aoe: 0,  color: "#e0447c", name: "Ultralisk" },
};

interface BuildDef {
  id: BuildType; name: string; icon: string; cost: number; desc: string; key: string;
  hp: number; range: number; dmg: number; rate: number; aoe: number; radius: number; groundOnly: boolean;
}

const BUILDS: BuildDef[] = [
  { id: "turret", name: "Missile Turret", icon: "🔫", cost: 50,  desc: "rapid fire, hits air + ground",  key: "1", hp: 160, range: 175, dmg: 9,  rate: 2.2,  aoe: 0,  radius: 14, groundOnly: false },
  { id: "bunker", name: "Bunker",         icon: "🛡️", cost: 90,  desc: "tough wall that also shoots",    key: "2", hp: 650, range: 125, dmg: 6,  rate: 3.0,  aoe: 0,  radius: 17, groundOnly: false },
  { id: "tank",   name: "Siege Tank",     icon: "💣", cost: 200, desc: "long range splash, ground only", key: "3", hp: 320, range: 265, dmg: 42, rate: 0.55, aoe: 62, radius: 17, groundOnly: true },
];

interface UpgradeDef { id: string; name: string; icon: string; desc: string; key: string; base: number; mult: number; max: number; }

const UPGRADES: UpgradeDef[] = [
  { id: "scv",    name: "Train SCV",       icon: "👷", desc: "+1 SCV miner",                       key: "5", base: 75,  mult: 1.8, max: 8 },
  { id: "mining", name: "Mining Drills",   icon: "⛏️", desc: "+4 minerals per trip, mines faster", key: "6", base: 100, mult: 2.0, max: 6 },
  { id: "weap",   name: "Weapons Bay",     icon: "⚔️", desc: "+35% turret / bunker / tank damage", key: "7", base: 120, mult: 2.1, max: 8 },
  { id: "armor",  name: "Armor Plating",   icon: "🔩", desc: "+30% hull for all structures",       key: "8", base: 150, mult: 2.1, max: 8 },
  { id: "marine", name: "Marine Training", icon: "🪖", desc: "+45% marine damage",                 key: "9", base: 100, mult: 2.0, max: 8 },
  { id: "repair", name: "Auto-Repair",     icon: "🔧", desc: "Command Center regenerates 2 hp/s",  key: "0", base: 150, mult: 2.2, max: 6 },
];

interface Struct { type: StructType; x: number; y: number; hp: number; maxHp: number; cd: number; angle: number; radius: number; }
interface Enemy {
  type: EnemyType; x: number; y: number; hp: number; maxHp: number; speed: number; dmg: number;
  range: number; radius: number; atkRate: number; flying: boolean; ranged: boolean; aoe: number;
  target: Struct | null; retargetT: number; atkCd: number; flash: number; wob: number; face: number;
}
interface Proj {
  x: number; y: number; vx: number; vy: number; speed: number; dmg: number; aoe: number;
  targetE: Enemy | null; targetS: Struct | null; tx: number; ty: number;
  life: number; kind: "bolt" | "shell" | "spine"; groundOnly: boolean;
}
interface MineralField { x: number; y: number; amount: number; max: number; }
interface SCV { x: number; y: number; state: "toField" | "mining" | "toCC" | "idle"; field: MineralField | null; t: number; carry: number; }
interface Pickup { x: number; y: number; amount: number; t: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number; }
interface FloatT { x: number; y: number; txt: string; life: number; color: string; size: number; }
interface Hero { x: number; y: number; hp: number; maxHp: number; alive: boolean; respawnT: number; move: Vec | null; atkCd: number; angle: number; stimT: number; stimCd: number; nadeCd: number; }

interface State {
  minerals: number; earned: number; wave: number; phase: "prep" | "fight" | "over";
  phaseT: number; spawnQueue: EnemyType[]; spawnT: number;
  structs: Struct[]; enemies: Enemy[]; projs: Proj[]; scvs: SCV[]; fields: MineralField[];
  pickups: Pickup[]; parts: Particle[]; floats: FloatT[];
  hero: Hero; up: Record<string, number>;
  kills: number; placing: BuildType | null;
  mouse: Vec; keys: Record<string, boolean>;
  shake: number; banner: string; bannerT: number; paused: boolean; started: boolean; time: number; hudT: number;
}

const FIELD_SPOTS: Vec[] = [
  { x: 110, y: 110 }, { x: 850, y: 110 }, { x: 70, y: 300 },
  { x: 890, y: 300 }, { x: 290, y: 70 }, { x: 670, y: 70 },
];

const STARS = Array.from({ length: 90 }, () => ({
  x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.3, a: Math.random() * 0.5 + 0.2,
}));

let S: State;
let best = 0;

function fmt(n: number): string {
  if (n < 1000) return Math.floor(n).toString();
  const units = ["k", "M", "B", "T", "Qa", "Qi"];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return n.toFixed(n < 100 ? 2 : 1) + units[u];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const cc = (): Struct => S.structs[0];
const weapMul = (): number => 1 + 0.35 * S.up.weap;
const marineDmg = (): number => 13 * (1 + 0.45 * S.up.marine);
const mineAmount = (): number => 8 + 4 * S.up.mining;
const mineTime = (): number => Math.max(0.4, 1.2 - 0.15 * S.up.mining);
const upgradeCost = (u: UpgradeDef): number => Math.ceil(u.base * Math.pow(u.mult, S.up[u.id]));

function makeFields(): MineralField[] {
  return FIELD_SPOTS.map((p) => ({ x: p.x, y: p.y, amount: 900, max: 900 }));
}

function makeScv(): SCV {
  const c = cc();
  return { x: c.x + 40 + Math.random() * 20, y: c.y + 20 + Math.random() * 10, state: "idle", field: null, t: 0, carry: 0 };
}

function reset(): void {
  S = {
    minerals: 150, earned: 0, wave: 0, phase: "prep", phaseT: 12,
    spawnQueue: [], spawnT: 0,
    structs: [{ type: "cc", x: W / 2, y: H - 140, hp: CC_HP, maxHp: CC_HP, cd: 0, angle: -Math.PI / 2, radius: CC_R }],
    enemies: [], projs: [], scvs: [], fields: makeFields(),
    pickups: [], parts: [], floats: [],
    hero: { x: W / 2 - 60, y: H - 140, hp: 160, maxHp: 160, alive: true, respawnT: 0, move: null, atkCd: 0, angle: -Math.PI / 2, stimT: 0, stimCd: 0, nadeCd: 0 },
    up: { scv: 0, mining: 0, weap: 0, armor: 0, marine: 0, repair: 0 },
    kills: 0, placing: null, mouse: { x: W / 2, y: H / 2 }, keys: {},
    shake: 0, banner: "", bannerT: 0, paused: false, started: false, time: 0, hudT: 0,
  };
  S.scvs.push(makeScv(), makeScv());
}

function loadBest(): number {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return (JSON.parse(raw) as { best?: number }).best ?? 0;
  } catch (e) {}
  return 0;
}

function saveBest(): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ best })); } catch (e) {}
}

function toast(msg: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 3500);
}

function banner(txt: string): void {
  S.banner = txt;
  S.bannerT = 2.2;
}

function waveComp(w: number): EnemyType[] {
  const q: EnemyType[] = [];
  const add = (t: EnemyType, c: number): void => { for (let i = 0; i < c; i++) q.push(t); };
  add("zergling", 5 + 3 * w);
  if (w >= 3) add("hydralisk", Math.floor(1 + w / 2));
  if (w >= 4) add("baneling", Math.floor(w / 2));
  if (w >= 5) add("mutalisk", Math.floor(w / 2));
  if (w % 5 === 0) add("ultralisk", Math.max(1, Math.floor(w / 5)));
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = q[i]; q[i] = q[j]; q[j] = tmp;
  }
  return q;
}

function startWave(w: number): void {
  S.wave = w;
  S.phase = "fight";
  S.spawnQueue = waveComp(w);
  S.spawnT = 0.4;
  if (w % 5 === 0) { banner(`⚠ WAVE ${w} — ULTRALISK ⚠`); beep(70, 0.8, "sawtooth", 0.1, -30); }
  else { banner(`WAVE ${w}`); chord([440, 554, 659], 0.25, "triangle", 0.05); }
}

function spawnEnemy(type: EnemyType): void {
  const d = ENEMY_DEFS[type];
  const hpMul = 1 + 0.18 * (S.wave - 1);
  const dmgMul = 1 + 0.12 * (S.wave - 1);
  let x: number, y: number;
  const r = Math.random();
  if (r < 0.55) { x = 30 + Math.random() * (W - 60); y = -12; }
  else if (r < 0.8) { x = -12; y = 40 + Math.random() * (H - 80); }
  else { x = W + 12; y = 40 + Math.random() * (H - 80); }
  const hp = d.hp * hpMul;
  S.enemies.push({
    type, x, y, hp, maxHp: hp,
    speed: d.speed * (1 + Math.min(0.3, 0.02 * S.wave)),
    dmg: d.dmg * dmgMul, range: d.range, radius: d.radius, atkRate: d.atkRate,
    flying: d.flying, ranged: d.ranged, aoe: d.aoe,
    target: null, retargetT: Math.random() * 0.4, atkCd: 0, flash: 0, wob: Math.random() * 10, face: Math.PI / 2,
  });
  if (type === "ultralisk") S.shake = Math.max(S.shake, 10);
}

function pickTarget(e: Enemy): Struct {
  const c = cc();
  if (e.flying) return c;
  let bestS: Struct | null = null;
  let bd = 190;
  for (const s of S.structs) {
    const d = Math.hypot(s.x - e.x, s.y - e.y);
    if (d < bd) { bd = d; bestS = s; }
  }
  return bestS ?? c;
}

function spark(x: number, y: number, color: string, n: number, spd = 90): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = spd * (0.4 + Math.random());
    S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7, size: 1.5 + Math.random() * 2.5, color, grav: 60 });
  }
}

function goo(e: Enemy): void {
  spark(e.x, e.y, ENEMY_DEFS[e.type].color, e.type === "ultralisk" ? 40 : 14, e.type === "ultralisk" ? 160 : 100);
}

function damageEnemy(e: Enemy, dmg: number): void {
  let crit = false;
  if (Math.random() < 0.12) { dmg *= 3; crit = true; }
  e.hp -= dmg;
  e.flash = 0.08;
  S.floats.push({
    x: e.x + (Math.random() * 12 - 6), y: e.y - e.radius - 4,
    txt: crit ? `CRIT ${Math.round(dmg)}` : String(Math.round(dmg)),
    life: 0.7, color: crit ? "#ffd23c" : "#eaf6ff", size: crit ? 15 : 11,
  });
  if (e.hp <= 0) {
    e.hp = -1;
    S.kills++;
    goo(e);
    if (e.type === "ultralisk") {
      S.shake = Math.max(S.shake, 14);
      banner("ULTRALISK DOWN");
      beep(60, 0.7, "sawtooth", 0.1, -25);
      chord([523, 659, 784, 1046], 0.3, "triangle", 0.05);
    } else {
      beep(200 + Math.random() * 120, 0.06, "square", 0.025, -120);
    }
    if (Math.random() < 0.25) S.pickups.push({ x: e.x, y: e.y, amount: 15 + S.wave * 2, t: 20 });
  }
}

function damageStruct(s: Struct, dmg: number): void {
  s.hp -= dmg;
  spark(s.x + (Math.random() * 16 - 8), s.y + (Math.random() * 12 - 6), "#ffb14d", 4, 70);
  if (s.type !== "cc" && s.hp <= 0) {
    s.hp = -1;
    spark(s.x, s.y, "#ff8c42", 22, 130);
    S.shake = Math.max(S.shake, 6);
    beep(110, 0.3, "sawtooth", 0.08, -60);
    toast(`${s.type.toUpperCase()} destroyed!`);
  }
}

function damageHero(dmg: number): void {
  const h = S.hero;
  if (!h.alive) return;
  h.hp -= dmg;
  if (h.hp <= 0) {
    h.alive = false;
    h.respawnT = 8;
    spark(h.x, h.y, "#aebfd2", 24, 140);
    S.shake = Math.max(S.shake, 8);
    banner("MARINE DOWN — respawning");
    beep(140, 0.5, "sawtooth", 0.09, -80);
  }
}

function explodeShell(p: Proj): void {
  p.life = 0;
  for (const e of S.enemies) {
    if (p.groundOnly && e.flying) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < p.aoe + e.radius) damageEnemy(e, p.dmg * (1 - (d / (p.aoe + e.radius)) * 0.5));
  }
  spark(p.x, p.y, "#ffb14d", 18, 150);
  spark(p.x, p.y, "#ff5f3c", 10, 100);
  S.shake = Math.max(S.shake, p.aoe > 50 ? 8 : 3);
  beep(120, 0.25, "sawtooth", 0.07, -70);
}

function explodeBaneling(e: Enemy): void {
  for (const s of S.structs) {
    const d = Math.hypot(s.x - e.x, s.y - e.y);
    if (d < e.aoe + s.radius) damageStruct(s, e.dmg * (1 - (d / (e.aoe + s.radius)) * 0.5));
  }
  const h = S.hero;
  if (h.alive && Math.hypot(h.x - e.x, h.y - e.y) < e.aoe + 12) damageHero(e.dmg * 0.7);
  spark(e.x, e.y, "#c6ff4d", 26, 160);
  spark(e.x, e.y, "#7ac74f", 12, 110);
  S.shake = Math.max(S.shake, 10);
  beep(100, 0.35, "sawtooth", 0.09, -60);
}

function muzzle(s: Struct, ang: number): void {
  S.parts.push({
    x: s.x + Math.cos(ang) * (s.radius + 8), y: s.y + Math.sin(ang) * (s.radius + 8),
    vx: Math.cos(ang) * 40, vy: Math.sin(ang) * 40, life: 0.08, max: 0.08, size: 4, color: "#ffe08a", grav: 0,
  });
}

function updateHero(dt: number): void {
  const h = S.hero;
  const c = cc();
  if (!h.alive) {
    h.respawnT -= dt;
    if (h.respawnT <= 0) {
      h.alive = true;
      h.hp = h.maxHp;
      h.x = c.x - 50;
      h.y = c.y;
      banner("MARINE REDEPLOYED");
      chord([660, 880], 0.15, "triangle", 0.05);
    }
    return;
  }
  h.stimCd = Math.max(0, h.stimCd - dt);
  h.nadeCd = Math.max(0, h.nadeCd - dt);
  h.stimT = Math.max(0, h.stimT - dt);
  h.hp = Math.min(h.maxHp, h.hp + 3 * dt);
  let mx = 0, my = 0;
  if (S.keys["KeyW"] || S.keys["ArrowUp"]) my -= 1;
  if (S.keys["KeyS"] || S.keys["ArrowDown"]) my += 1;
  if (S.keys["KeyA"] || S.keys["ArrowLeft"]) mx -= 1;
  if (S.keys["KeyD"] || S.keys["ArrowRight"]) mx += 1;
  const sp = 165 * (h.stimT > 0 ? 2.2 : 1);
  if (mx !== 0 || my !== 0) {
    const d = Math.hypot(mx, my);
    h.x += (mx / d) * sp * dt;
    h.y += (my / d) * sp * dt;
    h.move = null;
  } else if (h.move) {
    const dx = h.move.x - h.x, dy = h.move.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) h.move = null;
    else {
      h.x += (dx / d) * sp * dt;
      h.y += (dy / d) * sp * dt;
    }
  }
  h.x = clamp(h.x, MARGIN, W - MARGIN);
  h.y = clamp(h.y, MARGIN, H - MARGIN);
  let t: Enemy | null = null;
  let bd = 195;
  for (const e of S.enemies) {
    const d = Math.hypot(e.x - h.x, e.y - h.y) - e.radius;
    if (d < bd) { bd = d; t = e; }
  }
  if (t) {
    h.angle = Math.atan2(t.y - h.y, t.x - h.x);
    h.atkCd -= dt;
    if (h.atkCd <= 0) {
      h.atkCd = 0.22;
      S.projs.push({
        x: h.x, y: h.y - 6, vx: Math.cos(h.angle) * 600, vy: Math.sin(h.angle) * 600, speed: 600,
        dmg: marineDmg(), aoe: 0, targetE: t, targetS: null, tx: t.x, ty: t.y, life: 0.8, kind: "bolt", groundOnly: false,
      });
      beep(980 + Math.random() * 200, 0.03, "square", 0.018, -300);
    }
  }
}

function heroStim(): void {
  const h = S.hero;
  if (!h.alive || h.stimCd > 0 || !S.started || S.phase === "over") return;
  h.stimT = 4;
  h.stimCd = 18;
  spark(h.x, h.y, "#ffb14d", 12, 80);
  beep(500, 0.15, "sawtooth", 0.05, 300);
}

function heroNade(): void {
  const h = S.hero;
  if (!h.alive || h.nadeCd > 0 || !S.started || S.phase === "over") return;
  h.nadeCd = 8;
  const ang = Math.atan2(S.mouse.y - h.y, S.mouse.x - h.x);
  S.projs.push({
    x: h.x, y: h.y - 6, vx: Math.cos(ang) * 380, vy: Math.sin(ang) * 380, speed: 380,
    dmg: marineDmg() * 5, aoe: 85, targetE: null, targetS: null, tx: S.mouse.x, ty: S.mouse.y, life: 2, kind: "shell", groundOnly: false,
  });
  beep(300, 0.1, "square", 0.05, 120);
}

function nearestField(s: SCV): MineralField | null {
  let f: MineralField | null = null;
  let bd = Infinity;
  for (const fl of S.fields) {
    if (fl.amount <= 0) continue;
    const d = Math.hypot(fl.x - s.x, fl.y - s.y);
    if (d < bd) { bd = d; f = fl; }
  }
  return f;
}

function updateScvs(dt: number): void {
  const c = cc();
  for (const s of S.scvs) {
    if (s.state === "toField" && s.field) {
      const dx = s.field.x - s.x, dy = s.field.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 18) { s.state = "mining"; s.t = mineTime(); }
      else { s.x += (dx / d) * 85 * dt; s.y += (dy / d) * 85 * dt; }
    } else if (s.state === "mining" && s.field) {
      s.t -= dt;
      if (Math.random() < 0.3) {
        S.parts.push({ x: s.field.x + Math.random() * 16 - 8, y: s.field.y + Math.random() * 10 - 5, vx: 0, vy: -30, life: 0.4, max: 0.4, size: 2, color: "#6ee7ff", grav: 0 });
      }
      if (s.t <= 0) {
        const take = Math.min(mineAmount(), Math.max(0, s.field.amount));
        s.field.amount -= take;
        s.carry = take;
        if (s.field.amount <= 0) s.field = null;
        s.state = "toCC";
      }
    } else if (s.state === "toCC") {
      const dx = c.x - s.x, dy = c.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d < c.radius + 8) {
        if (s.carry > 0) {
          S.minerals += s.carry;
          S.earned += s.carry;
          S.floats.push({ x: c.x, y: c.y - c.radius - 10, txt: `+${s.carry}`, life: 0.8, color: "#35f0d0", size: 12 });
          beep(1250, 0.04, "sine", 0.03, 150);
        }
        s.carry = 0;
        const f = nearestField(s);
        if (f) { s.field = f; s.state = "toField"; } else { s.state = "idle"; }
      } else { s.x += (dx / d) * 95 * dt; s.y += (dy / d) * 95 * dt; }
    } else {
      const a = S.time * 0.7 + s.x;
      s.x += Math.cos(a) * 8 * dt;
      s.y += Math.sin(a) * 3 * dt;
      const f = nearestField(s);
      if (f) { s.field = f; s.state = "toField"; }
    }
  }
}

function updateStructs(dt: number): void {
  for (const s of S.structs) {
    if (s.type === "cc") continue;
    const def = BUILDS.find((b) => b.id === s.type);
    if (!def) continue;
    s.cd -= dt;
    let t: Enemy | null = null;
    let bd = def.range;
    for (const e of S.enemies) {
      if (def.groundOnly && e.flying) continue;
      const d = Math.hypot(e.x - s.x, e.y - s.y) - e.radius;
      if (d < bd) { bd = d; t = e; }
    }
    if (t) {
      s.angle = Math.atan2(t.y - s.y, t.x - s.x);
      if (s.cd <= 0) {
        s.cd = 1 / def.rate;
        const dmg = def.dmg * weapMul();
        if (def.aoe > 0) {
          S.projs.push({ x: s.x, y: s.y, vx: Math.cos(s.angle) * 300, vy: Math.sin(s.angle) * 300, speed: 300, dmg, aoe: def.aoe, targetE: null, targetS: null, tx: t.x, ty: t.y, life: 1.4, kind: "shell", groundOnly: true });
        } else {
          S.projs.push({ x: s.x, y: s.y, vx: Math.cos(s.angle) * 520, vy: Math.sin(s.angle) * 520, speed: 520, dmg, aoe: 0, targetE: t, targetS: null, tx: t.x, ty: t.y, life: 1.1, kind: "bolt", groundOnly: false });
        }
        muzzle(s, s.angle);
        if (Math.random() < 0.6) beep(def.aoe > 0 ? 180 : 760 + Math.random() * 120, 0.04, def.aoe > 0 ? "sawtooth" : "square", 0.02, def.aoe > 0 ? -80 : -200);
      }
    }
  }
  S.structs = S.structs.filter((s) => s.type === "cc" || s.hp > 0);
}

function updateEnemies(dt: number): void {
  for (const e of S.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    e.wob += dt * 6;
    e.retargetT -= dt;
    if (e.retargetT <= 0) {
      e.retargetT = 0.4;
      e.target = pickTarget(e);
    }
    const t = e.target ?? cc();
    const dx = t.x - e.x, dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.face = Math.atan2(dy, dx);
    const reach = e.range + t.radius + e.radius - 4;
    if (e.ranged) {
      if (d <= e.range + t.radius) {
        e.atkCd -= dt;
        if (e.atkCd <= 0) {
          e.atkCd = e.atkRate;
          S.projs.push({ x: e.x, y: e.y, vx: Math.cos(e.face) * 280, vy: Math.sin(e.face) * 280, speed: 280, dmg: e.dmg, aoe: 0, targetE: null, targetS: t, tx: t.x, ty: t.y, life: 1.6, kind: "spine", groundOnly: true });
          beep(320, 0.05, "sawtooth", 0.025, 60);
        }
      } else {
        e.x += (dx / d) * e.speed * dt;
        e.y += (dy / d) * e.speed * dt;
      }
    } else if (d <= reach) {
      if (e.type === "baneling") {
        explodeBaneling(e);
        e.hp = -1;
      } else {
        e.atkCd -= dt;
        if (e.atkCd <= 0) {
          e.atkCd = e.atkRate;
          damageStruct(t, e.dmg);
          beep(150, 0.05, "square", 0.03, -60);
        }
      }
    } else {
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
    }
  }
  S.enemies = S.enemies.filter((e) => e.hp > 0);
  for (let i = 0; i < S.enemies.length; i++) {
    for (let j = i + 1; j < S.enemies.length; j++) {
      const a = S.enemies[i], b = S.enemies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.radius + b.radius;
      if (d > 0 && d < min) {
        const push = ((min - d) / 2) * 0.6;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
}

function updateProjs(dt: number): void {
  for (const p of S.projs) {
    p.life -= dt;
    if (p.kind === "bolt" && p.targetE && p.targetE.hp > 0) {
      const dx = p.targetE.x - p.x, dy = p.targetE.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.vx = (dx / d) * p.speed;
      p.vy = (dy / d) * p.speed;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === "bolt") {
      const t = p.targetE;
      if (t && t.hp > 0 && Math.hypot(t.x - p.x, t.y - p.y) < t.radius + 4) {
        damageEnemy(t, p.dmg);
        p.life = 0;
        spark(p.x, p.y, "#7df9ff", 4, 60);
      }
    } else if (p.kind === "shell") {
      if (Math.hypot(p.tx - p.x, p.ty - p.y) < 8 || p.life <= 0) explodeShell(p);
    } else if (p.kind === "spine") {
      for (const s of S.structs) {
        if (Math.hypot(s.x - p.x, s.y - p.y) < s.radius + 3) {
          damageStruct(s, p.dmg);
          p.life = 0;
          spark(p.x, p.y, "#c6ff4d", 5, 70);
          break;
        }
      }
    }
  }
  S.projs = S.projs.filter((p) => p.life > 0 && p.x > -60 && p.x < W + 60 && p.y > -60 && p.y < H + 60);
}

function updatePickups(dt: number): void {
  for (const p of S.pickups) {
    p.t -= dt;
    const h = S.hero;
    if (h.alive && Math.hypot(h.x - p.x, h.y - p.y) < 20) {
      p.t = 0;
    } else {
      for (const s of S.scvs) {
        if (Math.hypot(s.x - p.x, s.y - p.y) < 18) { p.t = 0; break; }
      }
    }
    if (p.t <= 0) {
      S.minerals += p.amount;
      S.earned += p.amount;
      S.floats.push({ x: p.x, y: p.y - 8, txt: `+${p.amount}`, life: 0.8, color: "#35f0d0", size: 12 });
      beep(1500, 0.05, "sine", 0.04, 200);
    }
  }
  S.pickups = S.pickups.filter((p) => p.t > 0);
}

function updateParts(dt: number): void {
  for (const p of S.parts) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.grav * dt;
  }
  S.parts = S.parts.filter((p) => p.life > 0);
  for (const f of S.floats) {
    f.life -= dt;
    f.y -= 30 * dt;
  }
  S.floats = S.floats.filter((f) => f.life > 0);
}

function update(dt: number): void {
  S.time += dt;
  if (S.phase === "prep") {
    S.phaseT -= dt;
    if (S.phaseT <= 0) startWave(S.wave + 1);
  } else if (S.phase === "fight") {
    if (S.spawnQueue.length > 0) {
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        const t = S.spawnQueue.shift();
        if (t) spawnEnemy(t);
        S.spawnT = Math.max(0.25, 0.8 - S.wave * 0.03);
      }
    } else if (S.enemies.length === 0) {
      const bonus = 40 + 10 * S.wave;
      S.minerals += bonus;
      S.earned += bonus;
      toast(`Wave ${S.wave} cleared! +${bonus} minerals`);
      chord([523, 659, 784], 0.2, "triangle", 0.05);
      S.phase = "prep";
      S.phaseT = 10;
      banner(`WAVE ${S.wave} CLEARED`);
    }
  }
  updateHero(dt);
  updateScvs(dt);
  updateStructs(dt);
  updateEnemies(dt);
  updateProjs(dt);
  updatePickups(dt);
  updateParts(dt);
  const c = cc();
  if (S.up.repair > 0 && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + 2 * S.up.repair * dt);
  if (c.hp <= 0 && S.phase !== "over") gameOver();
  S.shake = Math.max(0, S.shake - dt * 30);
  S.bannerT = Math.max(0, S.bannerT - dt);
}

function gameOver(): void {
  S.phase = "over";
  S.placing = null;
  best = Math.max(best, S.wave);
  saveBest();
  S.shake = 20;
  beep(90, 1, "sawtooth", 0.1, -50);
  chord([330, 262, 196, 131], 0.6, "triangle", 0.06);
  $("ovTitle").textContent = "💥 COMMAND CENTER LOST";
  $("ovText").textContent = `The swarm overran your base on wave ${S.wave}. ${S.kills} zerg slain · ${fmt(S.earned)} minerals mined · best: wave ${best}.`;
  ($("ovBtn") as HTMLButtonElement).textContent = "↻ REDEPLOY";
  $("overlay").classList.remove("hidden");
}

function startGame(): void {
  reset();
  S.started = true;
  $("overlay").classList.add("hidden");
  banner("DEFEND THE COMMAND CENTER");
  chord([392, 523, 659], 0.3, "triangle", 0.06);
  updateHud();
}

function canPlace(x: number, y: number, def: BuildDef): boolean {
  if (S.minerals < def.cost) return false;
  if (x < MARGIN + def.radius || x > W - MARGIN - def.radius || y < MARGIN + def.radius || y > H - MARGIN - def.radius) return false;
  for (const s of S.structs) {
    if (Math.hypot(s.x - x, s.y - y) < s.radius + def.radius + 8) return false;
  }
  for (const f of S.fields) {
    if (Math.hypot(f.x - x, f.y - y) < 36) return false;
  }
  return true;
}

function tryPlace(x: number, y: number): void {
  if (!S.placing) return;
  const def = BUILDS.find((b) => b.id === S.placing);
  if (!def) return;
  if (!canPlace(x, y, def)) {
    beep(140, 0.08, "sawtooth", 0.04);
    return;
  }
  S.minerals -= def.cost;
  const maxHp = Math.round(def.hp * (1 + 0.3 * S.up.armor));
  S.structs.push({ type: def.id, x, y, hp: maxHp, maxHp, cd: 0, angle: -Math.PI / 2, radius: def.radius });
  spark(x, y, "#35f0d0", 12, 80);
  beep(660, 0.08, "square", 0.05);
  chord([440, 554], 0.12, "triangle", 0.04);
}

function selectBuild(id: BuildType): void {
  S.placing = S.placing === id ? null : id;
  for (const r of buildRefs) r.btn.classList.toggle("selected", r.def.id === S.placing);
  beep(600, 0.05, "square", 0.04);
}

function buyUpgrade(id: string): void {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return;
  const lvl = S.up[id];
  if (lvl >= u.max) { toast(`${u.name} already at max level`); return; }
  const cost = upgradeCost(u);
  if (S.minerals < cost) { beep(140, 0.08, "sawtooth", 0.04); return; }
  S.minerals -= cost;
  S.up[id] = lvl + 1;
  if (id === "scv") S.scvs.push(makeScv());
  if (id === "armor") {
    for (const s of S.structs) { s.maxHp = Math.round(s.maxHp * 1.3); s.hp = Math.min(s.maxHp, Math.round(s.hp * 1.3)); }
  }
  beep(660, 0.08, "square", 0.05);
  chord([523, 659, 784], 0.15, "triangle", 0.05);
  toast(`${u.icon} ${u.name} → level ${lvl + 1}`);
  updateHud();
}

const buildRefs: { def: BuildDef; btn: HTMLButtonElement; costEl: HTMLElement; countEl: HTMLElement }[] = [];
const upRefs: { def: UpgradeDef; btn: HTMLButtonElement; costEl: HTMLElement; lvlEl: HTMLElement }[] = [];

function makeBtn(def: { name: string; icon: string; desc: string; key: string }): { btn: HTMLButtonElement; costEl: HTMLElement; extraEl: HTMLElement } {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ls-btn";
  const icon = document.createElement("span");
  icon.className = "b-icon";
  icon.textContent = def.icon;
  const main = document.createElement("span");
  main.className = "b-main";
  const name = document.createElement("span");
  name.className = "b-name";
  name.textContent = def.name;
  const desc = document.createElement("span");
  desc.className = "b-desc";
  desc.textContent = def.desc;
  main.appendChild(name);
  main.appendChild(desc);
  const side = document.createElement("span");
  side.className = "b-side";
  const kbd = document.createElement("kbd");
  kbd.textContent = def.key;
  const extra = document.createElement("span");
  extra.className = "b-extra";
  const cost = document.createElement("span");
  cost.className = "b-cost";
  side.appendChild(kbd);
  side.appendChild(extra);
  side.appendChild(cost);
  btn.appendChild(icon);
  btn.appendChild(main);
  btn.appendChild(side);
  return { btn, costEl: cost, extraEl: extra };
}

function renderLists(): void {
  const bl = $("buildList");
  bl.innerHTML = "";
  for (const def of BUILDS) {
    const r = makeBtn(def);
    r.btn.addEventListener("click", () => selectBuild(def.id));
    bl.appendChild(r.btn);
    buildRefs.push({ def, btn: r.btn, costEl: r.costEl, countEl: r.extraEl });
  }
  const ul = $("upgradeList");
  ul.innerHTML = "";
  for (const def of UPGRADES) {
    const r = makeBtn(def);
    r.btn.addEventListener("click", () => buyUpgrade(def.id));
    ul.appendChild(r.btn);
    upRefs.push({ def, btn: r.btn, costEl: r.costEl, lvlEl: r.extraEl });
  }
}

function updateHud(): void {
  $("minerals").textContent = fmt(S.minerals);
  $("wave").textContent = S.wave === 0 ? "—" : String(S.wave);
  const c = cc();
  $("ccHp").textContent = `${Math.max(0, Math.ceil(c.hp))} / ${c.maxHp}`;
  ($("ccFill") as HTMLDivElement).style.width = `${clamp((c.hp / c.maxHp) * 100, 0, 100)}%`;
  $("foes").textContent = String(S.enemies.length + S.spawnQueue.length);
  $("kills").textContent = String(S.kills);
  $("best").textContent = String(best);
  $("stim").textContent = S.hero.stimCd > 0 ? `${S.hero.stimCd.toFixed(0)}s` : "READY";
  $("nade").textContent = S.hero.nadeCd > 0 ? `${S.hero.nadeCd.toFixed(0)}s` : "READY";
  for (const r of buildRefs) {
    const count = S.structs.filter((s) => s.type === r.def.id).length;
    r.countEl.textContent = count > 0 ? `x${count}` : "";
    r.costEl.textContent = `${r.def.cost} ◆`;
    r.btn.disabled = S.minerals < r.def.cost;
  }
  for (const r of upRefs) {
    const lvl = S.up[r.def.id];
    if (lvl >= r.def.max) {
      r.lvlEl.textContent = "MAX";
      r.costEl.textContent = "—";
      r.btn.disabled = true;
    } else {
      r.lvlEl.textContent = `Lv ${lvl}/${r.def.max}`;
      r.costEl.textContent = `${upgradeCost(r.def)} ◆`;
      r.btn.disabled = S.minerals < upgradeCost(r.def);
    }
  }
}

function canvasPos(e: MouseEvent): Vec {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
}

canvas.addEventListener("mousemove", (e) => { S.mouse = canvasPos(e); });
canvas.addEventListener("mousedown", (e) => {
  if (!S.started || S.phase === "over") return;
  const p = canvasPos(e);
  S.mouse = p;
  if (e.button === 2) {
    if (S.placing) { S.placing = null; for (const r of buildRefs) r.btn.classList.remove("selected"); }
    else S.hero.move = p;
    return;
  }
  if (e.button !== 0) return;
  if (S.placing) tryPlace(p.x, p.y);
  else S.hero.move = p;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  S.keys[e.code] = true;
  if (!S.started || S.phase === "over") return;
  if (e.code === "Escape") { S.placing = null; for (const r of buildRefs) r.btn.classList.remove("selected"); return; }
  if (e.code === "KeyP") { S.paused = !S.paused; return; }
  if (e.code === "Space") { heroStim(); return; }
  if (e.code === "KeyQ") { heroNade(); return; }
  const b = BUILDS.find((x) => `Digit${x.key}` === e.code);
  if (b) { selectBuild(b.id); return; }
  const u = UPGRADES.find((x) => `Digit${x.key}` === e.code);
  if (u) buyUpgrade(u.id);
});
window.addEventListener("keyup", (e) => { S.keys[e.code] = false; });

$("ovBtn").addEventListener("click", () => startGame());
$("pauseBtn").addEventListener("click", () => { if (S.started && S.phase !== "over") S.paused = !S.paused; });
$("restartBtn").addEventListener("click", () => startGame());
window.addEventListener("beforeunload", saveBest);

function drawBg(): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0a1024");
  g.addColorStop(0.6, "#070b16");
  g.addColorStop(1, "#0a0f1e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(53, 240, 208, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (const s of STARS) {
    ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(S.time * 2 + s.x));
    ctx.fillStyle = "#cfe6ff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawField(f: MineralField): void {
  const scale = 0.5 + 0.5 * (f.amount / f.max);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.fillStyle = "rgba(53, 240, 208, 0.12)";
  ctx.beginPath();
  ctx.ellipse(0, 4, 30, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "#35f0d0";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#4dd8e8";
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const h = (10 + (i % 3) * 5) * scale;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 12 - 4, 4);
    ctx.lineTo(Math.cos(a) * 12, 4 - h);
    ctx.lineTo(Math.cos(a) * 12 + 4, 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#9ff5ff";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(Math.ceil(f.amount)), 0, 22);
  ctx.restore();
}

function drawHpBar(x: number, y: number, w: number, ratio: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = ratio > 0.5 ? "#5df08a" : ratio > 0.25 ? "#ffd23c" : "#ff5347";
  ctx.fillRect(x - w / 2, y, w * clamp(ratio, 0, 1), 4);
}

function drawStruct(s: Struct): void {
  if (s.type === "cc") {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.shadowColor = "#3aa0ff";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#3d4c63";
    ctx.fillRect(-38, -26, 76, 52);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#2c3a4f";
    ctx.fillRect(-38, -26, 76, 14);
    ctx.fillStyle = "#5f7290";
    ctx.fillRect(-10, -40, 20, 16);
    ctx.fillStyle = Math.sin(S.time * 4) > 0 ? "#ff5347" : "#7a1f1a";
    ctx.beginPath();
    ctx.arc(0, -44, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9db4c8";
    ctx.fillRect(-30, -6, 18, 26);
    ctx.fillRect(12, -6, 18, 26);
    ctx.fillStyle = "#35f0d0";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CC", 0, 14);
    ctx.restore();
    drawHpBar(s.x, s.y - 56, 80, s.hp / s.maxHp);
    return;
  }
  ctx.save();
  ctx.translate(s.x, s.y);
  if (s.type === "turret") {
    ctx.fillStyle = "#5a6b7d";
    ctx.beginPath();
    ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8fa3b8";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#cfd8e3";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(s.angle) * (s.radius + 8), Math.sin(s.angle) * (s.radius + 8));
    ctx.stroke();
  } else if (s.type === "bunker") {
    ctx.fillStyle = "#6b7a5a";
    ctx.fillRect(-s.radius, -s.radius * 0.7, s.radius * 2, s.radius * 1.4);
    ctx.strokeStyle = "#93a37e";
    ctx.lineWidth = 2;
    ctx.strokeRect(-s.radius, -s.radius * 0.7, s.radius * 2, s.radius * 1.4);
    ctx.fillStyle = "#3c4634";
    ctx.fillRect(-s.radius + 4, -4, s.radius * 2 - 8, 8);
    ctx.strokeStyle = "#cfd8e3";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(Math.cos(s.angle) * (s.radius + 6), Math.sin(s.angle) * (s.radius + 6));
    ctx.stroke();
  } else {
    ctx.fillStyle = "#4f5d3a";
    ctx.fillRect(-s.radius, -s.radius * 0.55, s.radius * 2, s.radius * 1.1);
    ctx.strokeStyle = "#7a8a5f";
    ctx.lineWidth = 2;
    ctx.strokeRect(-s.radius, -s.radius * 0.55, s.radius * 2, s.radius * 1.1);
    ctx.fillStyle = "#2c3320";
    ctx.fillRect(-s.radius + 3, -s.radius * 0.55 + 3, 8, s.radius * 1.1 - 6);
    ctx.fillRect(s.radius - 11, -s.radius * 0.55 + 3, 8, s.radius * 1.1 - 6);
    ctx.strokeStyle = "#e8d9a0";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(s.angle) * 34, Math.sin(s.angle) * 34);
    ctx.stroke();
  }
  ctx.restore();
  if (s.hp < s.maxHp) drawHpBar(s.x, s.y - s.radius - 10, s.radius * 2, s.hp / s.maxHp);
}

function drawEnemy(e: Enemy): void {
  const def = ENEMY_DEFS[e.type];
  ctx.save();
  ctx.translate(e.x, e.y);
  if (e.flying) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 16, e.radius, e.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.rotate(e.face + Math.PI / 2);
  const flash = e.flash > 0;
  ctx.fillStyle = flash ? "#ffffff" : def.color;
  ctx.strokeStyle = flash ? "#ffffff" : "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1.5;
  if (e.type === "zergling") {
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius * 0.7, e.radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2, -e.radius); ctx.lineTo(-6, -e.radius - 6);
    ctx.moveTo(2, -e.radius); ctx.lineTo(6, -e.radius - 6);
    ctx.stroke();
  } else if (e.type === "hydralisk") {
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius, e.radius * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = flash ? "#ffffff" : "#5da838";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 5 - 2, e.radius * 0.4);
      ctx.lineTo(i * 5, e.radius * 0.4 + 7);
      ctx.lineTo(i * 5 + 2, e.radius * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  } else if (e.type === "baneling") {
    const pulse = 1 + 0.12 * Math.sin(e.wob * 2);
    ctx.beginPath();
    ctx.arc(0, 0, e.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(-e.radius * 0.3, -e.radius * 0.3, e.radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === "mutalisk") {
    const flap = Math.sin(e.wob * 3) * 0.5;
    ctx.fillStyle = flash ? "#ffffff" : "#8a4fc0";
    ctx.beginPath();
    ctx.moveTo(0, -e.radius);
    ctx.lineTo(-e.radius * 1.4, -e.radius * 0.2 - flap * 6);
    ctx.lineTo(0, e.radius * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -e.radius);
    ctx.lineTo(e.radius * 1.4, -e.radius * 0.2 + flap * 6);
    ctx.lineTo(0, e.radius * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flash ? "#ffffff" : def.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius * 0.55, e.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius, e.radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = flash ? "#ffffff" : "#f0e8d8";
    ctx.beginPath();
    ctx.moveTo(-6, -e.radius * 0.7); ctx.lineTo(-3, -e.radius - 10);
    ctx.lineTo(0, -e.radius * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, -e.radius * 0.7); ctx.lineTo(3, -e.radius - 10);
    ctx.lineTo(0, -e.radius * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flash ? "#ffffff" : "#7a2038";
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(i * 12 - 3, e.radius * 0.5, 6, 8);
    }
  }
  ctx.restore();
  if (e.hp < e.maxHp) drawHpBar(e.x, e.y - e.radius - 8, e.radius * 2, e.hp / e.maxHp);
}

function drawHero(): void {
  const h = S.hero;
  if (!h.alive) {
    ctx.fillStyle = "#ffd23c";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`MARINE RESPAWN IN ${Math.ceil(h.respawnT)}s`, cc().x, cc().y - 60);
    return;
  }
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (h.stimT > 0) {
    ctx.shadowColor = "#ffb14d";
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = "#aebfd2";
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#5f7290";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#35f0d0";
  ctx.fillRect(Math.cos(h.angle) * 6 - 3, Math.sin(h.angle) * 6 - 2, 6, 4);
  ctx.strokeStyle = "#2c3a4f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(Math.cos(h.angle) * 8, Math.sin(h.angle) * 8);
  ctx.lineTo(Math.cos(h.angle) * 18, Math.sin(h.angle) * 18);
  ctx.stroke();
  ctx.restore();
  drawHpBar(h.x, h.y - 22, 26, h.hp / h.maxHp);
}

function drawScv(s: SCV): void {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.fillStyle = "#f2a541";
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c97f22";
  ctx.fillRect(-4, -8, 8, 3);
  if (s.carry > 0) {
    ctx.shadowColor = "#35f0d0";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#6ee7ff";
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(4, -10);
    ctx.lineTo(0, -4);
    ctx.lineTo(-4, -10);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawProjs(): void {
  for (const p of S.projs) {
    if (p.kind === "bolt") {
      ctx.strokeStyle = "#7df9ff";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#7df9ff";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (p.kind === "shell") {
      ctx.fillStyle = "#ffb14d";
      ctx.shadowColor = "#ffb14d";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = "#c6ff4d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
    }
  }
}

function drawGhost(): void {
  if (!S.placing || !S.started || S.phase === "over") return;
  const def = BUILDS.find((b) => b.id === S.placing);
  if (!def) return;
  const ok = canPlace(S.mouse.x, S.mouse.y, def);
  const col = ok ? "53, 240, 208" : "255, 83, 71";
  ctx.save();
  ctx.strokeStyle = `rgba(${col}, 0.7)`;
  ctx.fillStyle = `rgba(${col}, 0.12)`;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(S.mouse.x, S.mouse.y, def.range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(S.mouse.x, S.mouse.y, def.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ok ? "#35f0d0" : "#ff5347";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${def.name} — ${def.cost} ◆`, S.mouse.x, S.mouse.y - def.range - 8);
  ctx.restore();
}

function draw(): void {
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  drawBg();
  for (const f of S.fields) if (f.amount > 0) drawField(f);
  for (const p of S.pickups) {
    const pulse = 1 + 0.2 * Math.sin(S.time * 6 + p.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = "#35f0d0";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#35f0d0";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 0);
    ctx.lineTo(0, 7);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (const s of S.structs) drawStruct(s);
  for (const s of S.scvs) drawScv(s);
  const ground = S.enemies.filter((e) => !e.flying).sort((a, b) => a.y - b.y);
  const air = S.enemies.filter((e) => e.flying);
  for (const e of ground) drawEnemy(e);
  drawHero();
  for (const e of air) drawEnemy(e);
  drawProjs();
  for (const p of S.parts) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  for (const f of S.floats) {
    ctx.globalAlpha = clamp(f.life / 0.7, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = `bold ${f.size}px monospace`;
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  drawGhost();
  ctx.restore();
  if (S.bannerT > 0) {
    ctx.globalAlpha = clamp(S.bannerT * 2, 0, 1);
    ctx.fillStyle = "#35f0d0";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 4;
    ctx.font = "bold 34px monospace";
    ctx.textAlign = "center";
    ctx.strokeText(S.banner, W / 2, H * 0.28);
    ctx.fillText(S.banner, W / 2, H * 0.28);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "center";
  ctx.font = "bold 16px monospace";
  if (S.started && S.phase === "prep") {
    ctx.fillStyle = "#ffd23c";
    ctx.fillText(`NEXT WAVE IN ${Math.ceil(S.phaseT)}s — build up! (1-3 build · 5-0 upgrades)`, W / 2, 30);
  } else if (S.started && S.phase === "fight") {
    ctx.fillStyle = "#ff8c7a";
    ctx.fillText(`WAVE ${S.wave} — ${S.enemies.length + S.spawnQueue.length} hostiles remaining`, W / 2, 30);
  }
  if (S.paused && S.started) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#35f0d0";
    ctx.font = "bold 30px monospace";
    ctx.fillText("PAUSED — press P", W / 2, H / 2);
  }
}

let last = performance.now();

function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (S.started && !S.paused && S.phase !== "over") update(dt);
  draw();
  S.hudT += dt;
  if (S.hudT > 0.1) {
    S.hudT = 0;
    updateHud();
  }
}

reset();
best = loadBest();
renderLists();
updateHud();
requestAnimationFrame(loop);
