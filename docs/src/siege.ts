import { beep, chord } from "./sfx";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const canvas = $("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const W = canvas.width;
const H = canvas.height;
const COLS = 16;
const ROWS = 9;
const TILE = 60;
const SAVE_KEY = "rfp_siege_best_v1";
const CC_HP = 300;
const CAP_BASE = 400;
const CAP_DEPOT = 250;

interface Vec { x: number; y: number; }
interface Tile { x: number; y: number; }

const tkey = (t: Tile): string => `${t.x},${t.y}`;
const center = (t: Tile): Vec => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
const structCenter = (s: Struct): Vec => center({ x: s.tx, y: s.ty });
const barrelCenter = (b: Barrel): Vec => center({ x: b.tx, y: b.ty });

const CC_TILES = new Set(["7,3", "8,3", "7,4", "8,4"]);
const CC_POS: Vec = { x: W / 2, y: H / 2 - 30 };

const GATE_TILES: Tile[] = [
  { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 4 }, { x: 15, y: 4 },
];
const MINERAL_TILES: Tile[] = [
  { x: 2, y: 0 }, { x: 13, y: 0 }, { x: 2, y: 8 }, { x: 13, y: 8 },
];
const MINERAL_TILE_SET = new Set(MINERAL_TILES.map(tkey));

type GateOp = "+" | "-" | "×" | "÷";

interface EdgeGate { tile: Tile; op: GateOp; val: number; }

function rollGate(): EdgeGate {
  const tile = GATE_TILES[Math.floor(Math.random() * GATE_TILES.length)];
  const r = Math.random();
  let op: GateOp = "+";
  let val = 10;
  if (r < 0.3) { op = "+"; val = 5 + Math.floor(Math.random() * 6) * 5; }
  else if (r < 0.55) { op = "-"; val = 5 + Math.floor(Math.random() * 5) * 5; }
  else if (r < 0.8) { op = "×"; val = 2 + Math.floor(Math.random() * 2); }
  else { op = "÷"; val = 2 + Math.floor(Math.random() * 2); }
  return { tile, op, val };
}

function applyOp(count: number, op: GateOp, val: number): number {
  if (op === "+") return count + val;
  if (op === "-") return count - val;
  if (op === "×") return count * val;
  return Math.floor(count / val);
}

type BuildType = "wall" | "turret" | "bunker" | "depot" | "refinery" | "lab";
type StructType = "cc" | BuildType;

interface BuildDef {
  id: BuildType; name: string; icon: string; costM: number; costG: number; time: number;
  hp: number; range: number; dmg: number; rate: number; aoe: number;
  desc: string; key: string;
}

const BUILDS: BuildDef[] = [
  { id: "wall",     name: "Wall",           icon: "🧱", costM: 15,  costG: 0,  time: 4,  hp: 700, range: 0,   dmg: 0, rate: 0,    aoe: 0,  desc: "reinforce the perimeter",   key: "1" },
  { id: "turret",   name: "Missile Turret", icon: "🔫", costM: 50,  costG: 0,  time: 8,  hp: 220, range: 150, dmg: 3, rate: 2.0,  aoe: 0,  desc: "rapid fire at the horde",    key: "2" },
  { id: "bunker",   name: "Bunker",         icon: "🛡️", costM: 90,  costG: 15, time: 12, hp: 900, range: 125, dmg: 8, rate: 1.2,  aoe: 40, desc: "armored strongpoint, splash", key: "3" },
  { id: "depot",    name: "Supply Depot",   icon: "📦", costM: 30,  costG: 0,  time: 6,  hp: 150, range: 0,   dmg: 0, rate: 0,    aoe: 0,  desc: `+${CAP_DEPOT} resource storage`, key: "4" },
  { id: "refinery", name: "Refinery",       icon: "⛽", costM: 70,  costG: 0,  time: 10, hp: 200, range: 0,   dmg: 0, rate: 0,    aoe: 0,  desc: "+4 gas/s",                   key: "5" },
  { id: "lab",      name: "Lab",            icon: "🔬", costM: 120, costG: 20, time: 15, hp: 250, range: 0,   dmg: 0, rate: 0,    aoe: 0,  desc: "unlocks research",           key: "6" },
];
const MAX_LVL = 4;

interface ResearchDef { id: string; name: string; icon: string; desc: string; key: string; baseM: number; baseG: number; time: number; max: number; }

const RESEARCHES: ResearchDef[] = [
  { id: "weapons", name: "Weapons Bay",   icon: "⚔️", desc: "+35% turret/bunker damage per level", key: "Q", baseM: 80,  baseG: 10, time: 20, max: 5 },
  { id: "armor",   name: "Armor Plating", icon: "🔩", desc: "+30% structure hull per level",       key: "W", baseM: 80,  baseG: 10, time: 20, max: 5 },
  { id: "drills",  name: "Mining Drills", icon: "⛏️", desc: "+3 minerals/s per level",             key: "E", baseM: 60,  baseG: 0,  time: 15, max: 5 },
];

type PackType = "normal" | "runner" | "tank" | "boss";

interface PackDef { speed: number; countMul: number; radius: number; color: string; }

const PACKS: Record<PackType, PackDef> = {
  normal: { speed: 55, countMul: 1,   radius: 13, color: "#ff5347" },
  runner: { speed: 95, countMul: 0.6, radius: 10, color: "#ffb14d" },
  tank:   { speed: 32, countMul: 2.4, radius: 18, color: "#b06ae0" },
  boss:   { speed: 23, countMul: 1,   radius: 25, color: "#e0447c" },
};

interface Struct {
  type: StructType; tx: number; ty: number; hp: number; lvl: number; cd: number; angle: number;
  spentM: number; spentG: number; constructing: boolean; buildT: number; buildMax: number;
}
interface Pack {
  type: PackType; x: number; y: number; count: number; speed: number;
  r: number; color: string; flash: number; wob: number;
  target: Struct | null; retargetT: number; atkCd: number; dead: boolean; arrived: boolean;
}
interface Barrel { tx: number; ty: number; hp: number; maxHp: number; t: number; }
interface Proj {
  x: number; y: number; vx: number; vy: number; speed: number; dmg: number; aoe: number;
  targetP: Pack | null; targetB: Barrel | null; tx: number; ty: number;
  life: number; kind: "bolt" | "shell" | "shot";
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number; }
interface FloatT { x: number; y: number; txt: string; life: number; color: string; size: number; }
interface Hero { x: number; y: number; hp: number; alive: boolean; respawnT: number; atkCd: number; angle: number; }

interface State {
  minerals: number; gas: number;
  siege: number; phase: "build" | "siege" | "over";
  siegeT: number; queue: PackType[]; spawnT: number;
  gates: EdgeGate[];
  structs: Struct[]; packs: Pack[]; barrels: Barrel[]; projs: Proj[];
  parts: Particle[]; floats: FloatT[];
  kills: number; scrap: number; gunLvl: number;
  up: Record<string, number>;
  research: { id: string; t: number; max: number } | null;
  placing: BuildType | null; selected: Struct | null;
  mouse: Vec; mouseTile: Tile; keys: Record<string, boolean>; shotCd: number;
  barrelT: number;
  hero: Hero;
  shake: number; banner: string; bannerT: number;
  paused: boolean; started: boolean; time: number; hudT: number;
}

let S: State;
let best = 0;

function fmt(n: number): string {
  if (n < 1000) return Math.floor(n).toString();
  const units = ["k", "M", "B", "T"];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return n.toFixed(n < 100 ? 2 : 1) + units[u];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const cc = (): Struct => S.structs[0];
const buildDef = (s: Struct): BuildDef => BUILDS.find((b) => b.id === s.type) as BuildDef;
const gunMul = (): number => Math.pow(1.25, S.gunLvl);
const cap = (): number => CAP_BASE + CAP_DEPOT * S.structs.filter((s) => s.type === "depot" && !s.constructing).length;
const mineralRate = (): number => 2 * MINERAL_TILES.length + 3 * S.up.drills;
const gasRate = (): number => 4 * S.structs.filter((s) => s.type === "refinery" && !s.constructing).length;
const maxHpOf = (s: Struct): number => s.type === "cc" ? CC_HP : Math.round(buildDef(s).hp * Math.pow(1.4, s.lvl - 1) * (1 + 0.3 * S.up.armor));
const structDmg = (s: Struct): number => buildDef(s).dmg * Math.pow(1.5, s.lvl - 1) * (1 + 0.35 * S.up.weapons) * gunMul();
const structRange = (s: Struct): number => buildDef(s).range + 10 * (s.lvl - 1);
const structRate = (s: Struct): number => buildDef(s).rate * (1 + 0.1 * (s.lvl - 1));
const upgradeCostM = (s: Struct): number => Math.round(buildDef(s).costM * 0.7 * s.lvl);
const upgradeCostG = (s: Struct): number => Math.round(buildDef(s).costG * 0.7 * s.lvl);
const researchCostM = (r: ResearchDef): number => Math.round(r.baseM * Math.pow(2, S.up[r.id]));
const researchCostG = (r: ResearchDef): number => Math.round(r.baseG * Math.pow(2, S.up[r.id]));
const researchTime = (r: ResearchDef): number => r.time + 5 * S.up[r.id];
const labReady = (): boolean => S.structs.some((s) => s.type === "lab" && !s.constructing);
const structAt = (t: Tile): Struct | null => S.structs.find((s) => s.tx === t.x && s.ty === t.y) ?? null;
const barrelAt = (t: Tile): Barrel | null => S.barrels.find((b) => b.tx === t.x && b.ty === t.y) ?? null;
const isGateTile = (t: Tile): boolean => S.gates.some((g) => g.tile.x === t.x && g.tile.y === t.y);

function reset(): void {
  S = {
    minerals: 250, gas: 30,
    siege: 0, phase: "build",
    siegeT: 45, queue: [], spawnT: 0,
    gates: GATE_TILES.map((tile) => ({ tile, op: "+", val: 10 })),
    structs: [{ type: "cc", tx: 7, ty: 3, hp: CC_HP, lvl: 1, cd: 0, angle: -Math.PI / 2, spentM: 0, spentG: 0, constructing: false, buildT: 0, buildMax: 0 }],
    packs: [], barrels: [], projs: [],
    parts: [], floats: [],
    kills: 0, scrap: 0, gunLvl: 0,
    up: { weapons: 0, armor: 0, drills: 0 },
    research: null,
    placing: null, selected: null,
    mouse: { x: W / 2, y: H / 2 }, mouseTile: { x: 5, y: 5 }, keys: {}, shotCd: 0,
    barrelT: 2,
    hero: { x: CC_POS.x - 70, y: CC_POS.y + 24, hp: 200, alive: true, respawnT: 0, atkCd: 0, angle: -Math.PI / 2 },
    shake: 0, banner: "", bannerT: 0,
    paused: false, started: false, time: 0, hudT: 0,
  };
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
  S.bannerT = 2.4;
}

function siegeComp(n: number): PackType[] {
  const q: PackType[] = [];
  const add = (t: PackType, c: number): void => { for (let i = 0; i < c; i++) q.push(t); };
  add("normal", 3 + 2 * n);
  if (n >= 2) add("runner", n);
  if (n >= 3) add("tank", Math.ceil(n / 2));
  if (n % 3 === 0) add("boss", 1);
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = q[i]; q[i] = q[j]; q[j] = tmp;
  }
  return q;
}

function startSiege(n: number): void {
  S.siege = n;
  S.phase = "siege";
  S.queue = siegeComp(n);
  S.spawnT = 0.4;
  S.gates = GATE_TILES.map(() => rollGate());
  S.barrelT = 1;
  if (n % 3 === 0) { banner(`⚠ SIEGE ${n} — BOSS INBOUND ⚠`); beep(70, 0.8, "sawtooth", 0.1, -30); }
  else { banner(`⚔ SIEGE ${n} — HOLD THE SHELTER ⚔`); beep(220, 0.4, "sawtooth", 0.08, -80); chord([330, 415, 494], 0.3, "triangle", 0.05); }
}

function endSiege(): void {
  const m = 30 + 10 * S.siege;
  const g = 8 + 3 * S.siege;
  S.minerals = Math.min(cap(), S.minerals + m);
  S.gas = Math.min(cap(), S.gas + g);
  S.scrap += 2;
  toast(`Siege ${S.siege} repelled! +${m} ◆ +${g} ⛁ +2 scrap`);
  chord([523, 659, 784], 0.25, "triangle", 0.05);
  banner(`SIEGE ${S.siege} REPELLED`);
  S.phase = "build";
  S.siegeT = 70;
}

function spawnPack(type: PackType): void {
  const d = PACKS[type];
  const gate = S.gates[Math.floor(Math.random() * S.gates.length)];
  const gp = center(gate.tile);
  let x = gp.x, y = gp.y;
  if (gate.tile.x === 0) x = -14;
  else if (gate.tile.x === COLS - 1) x = W + 14;
  else if (gate.tile.y === 0) y = -14;
  else y = H + 14;
  const base = type === "boss" ? 50 + 25 * S.siege : (8 + 3 * S.siege) * d.countMul * (0.85 + Math.random() * 0.3);
  const before = Math.round(base);
  const after = Math.max(0, applyOp(before, gate.op, gate.val));
  S.packs.push({
    type, x, y, count: after, speed: d.speed * (1 + Math.min(0.25, 0.015 * S.siege)),
    r: d.radius, color: d.color, flash: 0, wob: Math.random() * 10,
    target: null, retargetT: Math.random() * 0.3, atkCd: 0, dead: false, arrived: false,
  });
  const good = after < before;
  S.floats.push({ x: clamp(gp.x, 70, W - 70), y: clamp(gp.y, 40, H - 40), txt: `${gate.op}${gate.val}: ${before} → ${after}`, life: 1.3, color: good ? "#5df08a" : "#ff5f6e", size: 14 });
  beep(good ? 880 : 220, 0.12, "square", 0.04, good ? 200 : -100);
  if (after <= 0) {
    const p = S.packs[S.packs.length - 1];
    p.dead = true;
    killPack(p);
    banner("GATE ATE A PACK");
  }
  if (type === "boss") S.shake = Math.max(S.shake, 8);
}

function spark(x: number, y: number, color: string, n: number, spd = 90): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = spd * (0.4 + Math.random());
    S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7, size: 1.5 + Math.random() * 2.5, color, grav: 50 });
  }
}

function killPack(p: Pack): void {
  if (p.dead && p.count <= 0) return;
  p.dead = true;
  p.count = 0;
  S.kills++;
  spark(p.x, p.y, p.color, p.type === "boss" ? 40 : 16, p.type === "boss" ? 170 : 110);
  S.floats.push({ x: p.x, y: p.y - p.r - 8, txt: "+5 ◆", life: 0.9, color: "#ffd23c", size: 13 });
  S.minerals = Math.min(cap(), S.minerals + 5);
  if (p.type === "boss") {
    S.shake = Math.max(S.shake, 14);
    banner("BOSS PACK DOWN");
    beep(60, 0.7, "sawtooth", 0.1, -25);
    chord([523, 659, 784, 1046], 0.3, "triangle", 0.05);
  } else {
    beep(200 + Math.random() * 120, 0.06, "square", 0.025, -120);
  }
}

function damagePack(p: Pack, dmg: number): void {
  if (p.dead || p.arrived) return;
  p.count -= dmg;
  p.flash = 0.08;
  S.floats.push({ x: p.x + (Math.random() * 10 - 5), y: p.y - p.r - 4, txt: `-${Math.round(dmg)}`, life: 0.6, color: "#eaf6ff", size: 11 });
  if (p.count <= 0) killPack(p);
}

function damageStruct(s: Struct, dmg: number): void {
  s.hp -= dmg;
  const p = structCenter(s);
  spark(p.x + (Math.random() * 14 - 7), p.y + (Math.random() * 10 - 5), "#ffb14d", 4, 70);
  if (s.type !== "cc" && s.hp <= 0) {
    s.hp = -1;
    spark(p.x, p.y, "#ff8c42", 20, 130);
    S.shake = Math.max(S.shake, 6);
    beep(110, 0.3, "sawtooth", 0.08, -60);
    toast(`${s.type.toUpperCase()} destroyed!`);
  }
}

function explodeBarrel(b: Barrel): void {
  const p = barrelCenter(b);
  S.barrels = S.barrels.filter((x) => x !== b);
  S.scrap += 1;
  S.minerals = Math.min(cap(), S.minerals + 5 + S.siege);
  if (S.scrap >= 3) {
    S.scrap -= 3;
    S.gunLvl = Math.min(6, S.gunLvl + 1);
    banner(`🔥 BIGGER GUN — Lv ${S.gunLvl}`);
    chord([660, 880, 1100], 0.2, "square", 0.05);
  }
  for (const pk of S.packs) {
    if (pk.dead || pk.arrived) continue;
    const d = Math.hypot(pk.x - p.x, pk.y - p.y);
    if (d < 75 + pk.r) damagePack(pk, 25 * gunMul() * (1 - (d / (75 + pk.r)) * 0.5));
  }
  spark(p.x, p.y, "#ffb14d", 22, 170);
  spark(p.x, p.y, "#ff5f3c", 14, 120);
  spark(p.x, p.y, "#ffd23c", 8, 90);
  S.floats.push({ x: p.x, y: p.y - 20, txt: `+1 scrap · +${5 + S.siege} ◆`, life: 1, color: "#ffd23c", size: 13 });
  S.shake = Math.max(S.shake, 7);
  beep(120, 0.3, "sawtooth", 0.08, -70);
}

function spawnBarrel(): void {
  for (let tries = 0; tries < 60; tries++) {
    const t = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    if (CC_TILES.has(tkey(t)) || isGateTile(t) || MINERAL_TILE_SET.has(tkey(t))) continue;
    if (structAt(t) || barrelAt(t)) continue;
    const hp = 3;
    S.barrels.push({ tx: t.x, ty: t.y, hp, maxHp: hp, t: 20 });
    const p = center(t);
    spark(p.x, p.y, "#ff8c5a", 8, 60);
    return;
  }
}

function canPlaceTile(t: Tile): boolean {
  if (t.x < 0 || t.x >= COLS || t.y < 0 || t.y >= ROWS) return false;
  if (CC_TILES.has(tkey(t)) || isGateTile(t) || MINERAL_TILE_SET.has(tkey(t))) return false;
  if (structAt(t) || barrelAt(t)) return false;
  return true;
}

function tryPlace(t: Tile): void {
  if (!S.placing) return;
  const def = BUILDS.find((b) => b.id === S.placing);
  if (!def) return;
  if (S.minerals < def.costM || S.gas < def.costG || !canPlaceTile(t)) {
    beep(140, 0.08, "sawtooth", 0.04);
    return;
  }
  S.minerals -= def.costM;
  S.gas -= def.costG;
  S.structs.push({
    type: def.id, tx: t.x, ty: t.y, hp: def.hp, lvl: 1, cd: 0, angle: -Math.PI / 2,
    spentM: def.costM, spentG: def.costG, constructing: true, buildT: def.time, buildMax: def.time,
  });
  const p = center(t);
  spark(p.x, p.y, "#ffd23c", 10, 70);
  beep(660, 0.08, "square", 0.05);
  toast(`${def.icon} ${def.name} under construction (${def.time}s)`);
}

function selectPlacing(id: BuildType): void {
  S.placing = S.placing === id ? null : id;
  S.selected = null;
  for (const r of buildRefs) r.btn.classList.toggle("selected", r.def.id === S.placing);
  beep(600, 0.05, "square", 0.04);
}

function upgradeSelected(): void {
  const s = S.selected;
  if (!s || s.type === "cc" || s.constructing || s.lvl >= MAX_LVL) return;
  if (s.type !== "wall" && s.type !== "turret" && s.type !== "bunker") return;
  const cm = upgradeCostM(s);
  const cg = upgradeCostG(s);
  if (S.minerals < cm || S.gas < cg) { beep(140, 0.08, "sawtooth", 0.04); return; }
  S.minerals -= cm;
  S.gas -= cg;
  s.spentM += cm;
  s.spentG += cg;
  s.lvl++;
  s.hp = Math.min(maxHpOf(s), Math.round(s.hp * 1.4));
  const p = structCenter(s);
  spark(p.x, p.y, "#ffd23c", 16, 100);
  beep(660, 0.08, "square", 0.05);
  chord([523, 659, 784], 0.15, "triangle", 0.05);
  toast(`⬆ ${buildDef(s).name} → Lv ${s.lvl} — bigger gun!`);
  updateHud();
}

function sellSelected(): void {
  const s = S.selected;
  if (!s || s.type === "cc") return;
  S.minerals = Math.min(cap(), S.minerals + Math.floor(s.spentM * 0.6));
  S.gas = Math.min(cap(), S.gas + Math.floor(s.spentG * 0.6));
  S.structs = S.structs.filter((x) => x !== s);
  S.selected = null;
  const p = structCenter(s);
  spark(p.x, p.y, "#ffd23c", 10, 80);
  beep(500, 0.1, "square", 0.05, 150);
  updateHud();
}

function buyResearch(id: string): void {
  const r = RESEARCHES.find((x) => x.id === id);
  if (!r) return;
  if (!labReady()) { toast("🔬 Build a Lab first!"); beep(140, 0.08, "sawtooth", 0.04); return; }
  if (S.research) { toast("Research already in progress"); return; }
  if (S.up[id] >= r.max) { toast(`${r.name} already at max level`); return; }
  const cm = researchCostM(r);
  const cg = researchCostG(r);
  if (S.minerals < cm || S.gas < cg) { beep(140, 0.08, "sawtooth", 0.04); return; }
  S.minerals -= cm;
  S.gas -= cg;
  S.research = { id, t: researchTime(r), max: researchTime(r) };
  toast(`🔬 Researching ${r.name} (${researchTime(r)}s)`);
  beep(660, 0.1, "square", 0.05);
  updateHud();
}

function structPos(s: Struct): Vec {
  if (s.type === "cc") return CC_POS;
  return structCenter(s);
}

function pickTarget(p: Pack): Struct {
  const c = cc();
  let bestS: Struct | null = null;
  let bd = 80;
  for (const s of S.structs) {
    const sp = structPos(s);
    const d = Math.hypot(sp.x - p.x, sp.y - p.y);
    if (d < bd) { bd = d; bestS = s; }
  }
  return bestS ?? c;
}

function updateHero(dt: number): void {
  const h = S.hero;
  if (!h.alive) {
    h.respawnT -= dt;
    if (h.respawnT <= 0) {
      h.alive = true;
      h.hp = 200;
      banner("MARINE REDEPLOYED");
      chord([660, 880], 0.15, "triangle", 0.05);
    }
    return;
  }
  h.hp = Math.min(200, h.hp + 6 * dt);
  h.atkCd -= dt;
  let t: Pack | null = null;
  let bd = 200;
  for (const pk of S.packs) {
    if (pk.dead || pk.arrived) continue;
    const d = Math.hypot(pk.x - h.x, pk.y - h.y) - pk.r;
    if (d < bd) { bd = d; t = pk; }
  }
  if (t) {
    h.angle = Math.atan2(t.y - h.y, t.x - h.x);
    if (h.atkCd <= 0) {
      h.atkCd = 0.3;
      S.projs.push({
        x: h.x + Math.cos(h.angle) * 16, y: h.y + Math.sin(h.angle) * 16,
        vx: Math.cos(h.angle) * 620, vy: Math.sin(h.angle) * 620, speed: 620,
        dmg: 6 * gunMul(), aoe: 0, targetP: t, targetB: null, tx: t.x, ty: t.y, life: 0.8, kind: "bolt",
      });
      beep(980 + Math.random() * 200, 0.03, "square", 0.02, -300);
    }
  }
}

function updatePacks(dt: number): void {
  for (const p of S.packs) {
    if (p.dead || p.arrived) continue;
    p.flash = Math.max(0, p.flash - dt);
    p.wob += dt * 6;
    p.retargetT -= dt;
    if (p.retargetT <= 0) {
      p.retargetT = 0.4;
      p.target = pickTarget(p);
    }
    const t = p.target ?? cc();
    const tp = structPos(t);
    const dx = tp.x - p.x, dy = tp.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = 26 + p.r + (t.type === "cc" ? 34 : 14);
    if (d <= reach) {
      p.atkCd -= dt;
      if (p.atkCd <= 0) {
        p.atkCd = 0.8;
        damageStruct(t, 6 + S.siege);
        beep(150, 0.05, "square", 0.03, -60);
        if (t.type === "cc" && cc().hp <= 0 && S.phase !== "over") gameOver();
      }
    } else {
      p.x += (dx / d) * p.speed * dt;
      p.y += (dy / d) * p.speed * dt;
    }
  }
  S.packs = S.packs.filter((p) => !p.dead && !p.arrived);
  for (let i = 0; i < S.packs.length; i++) {
    for (let j = i + 1; j < S.packs.length; j++) {
      const a = S.packs[i], b = S.packs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d > 0 && d < min) {
        const push = ((min - d) / 2) * 0.5;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
      }
    }
  }
}

function fireProj(s: Struct, targetP: Pack | null, targetB: Barrel | null): void {
  const def = buildDef(s);
  const p = structPos(s);
  const aimX = targetP ? targetP.x : targetB ? barrelCenter(targetB).x : p.x + Math.cos(s.angle) * 40;
  const aimY = targetP ? targetP.y : targetB ? barrelCenter(targetB).y : p.y + Math.sin(s.angle) * 40;
  const ang = Math.atan2(aimY - p.y, aimX - p.x);
  s.angle = ang;
  const dmg = structDmg(s);
  if (def.aoe > 0) {
    S.projs.push({ x: p.x, y: p.y, vx: Math.cos(ang) * 300, vy: Math.sin(ang) * 300, speed: 300, dmg, aoe: def.aoe, targetP, targetB, tx: aimX, ty: aimY, life: 1.5, kind: "shell" });
  } else {
    S.projs.push({ x: p.x, y: p.y, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560, speed: 560, dmg, aoe: 0, targetP, targetB, tx: aimX, ty: aimY, life: 1, kind: "bolt" });
  }
  S.parts.push({ x: p.x + Math.cos(ang) * 18, y: p.y + Math.sin(ang) * 18, vx: Math.cos(ang) * 30, vy: Math.sin(ang) * 30, life: 0.07, max: 0.07, size: 4, color: "#ffe08a", grav: 0 });
  if (Math.random() < 0.5) beep(def.aoe > 0 ? 180 : 760 + Math.random() * 120, 0.04, def.aoe > 0 ? "sawtooth" : "square", 0.02, def.aoe > 0 ? -80 : -200);
}

function updateStructs(dt: number): void {
  for (const s of S.structs) {
    if (s.constructing) {
      s.buildT -= dt;
      if (s.buildT <= 0) {
        s.constructing = false;
        const p = structCenter(s);
        spark(p.x, p.y, "#5df08a", 14, 90);
        toast(`✅ ${buildDef(s).name} complete!`);
        chord([523, 784], 0.15, "triangle", 0.05);
        updateHud();
      }
      continue;
    }
    if (s.type === "cc" || s.type === "wall" || s.type === "depot" || s.type === "refinery" || s.type === "lab") continue;
    const def = buildDef(s);
    const p = structPos(s);
    const range = structRange(s);
    s.cd -= dt;
    let bestP: Pack | null = null;
    let bd = Infinity;
    for (const pk of S.packs) {
      if (pk.dead || pk.arrived) continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y) - pk.r;
      const toCC = Math.hypot(pk.x - CC_POS.x, pk.y - CC_POS.y);
      if (d < range && toCC < bd) { bd = toCC; bestP = pk; }
    }
    let targetB: Barrel | null = null;
    if (!bestP) {
      let bd2 = range;
      for (const b of S.barrels) {
        const bp = barrelCenter(b);
        const d = Math.hypot(bp.x - p.x, bp.y - p.y);
        if (d < bd2) { bd2 = d; targetB = b; }
      }
    }
    if (bestP || targetB) {
      if (s.cd <= 0) {
        s.cd = 1 / structRate(s);
        fireProj(s, bestP, targetB);
      }
    }
  }
  S.structs = S.structs.filter((s) => s.type === "cc" || s.hp > 0);
}

function explodeShell(p: Proj): void {
  p.life = 0;
  for (const pk of S.packs) {
    if (pk.dead || pk.arrived) continue;
    const d = Math.hypot(pk.x - p.x, pk.y - p.y);
    if (d < p.aoe + pk.r) damagePack(pk, p.dmg * (1 - (d / (p.aoe + pk.r)) * 0.5));
  }
  spark(p.x, p.y, "#ffb14d", 16, 150);
  spark(p.x, p.y, "#ff5f3c", 8, 100);
  S.shake = Math.max(S.shake, 5);
  beep(120, 0.22, "sawtooth", 0.06, -70);
}

function updateProjs(dt: number): void {
  for (const p of S.projs) {
    p.life -= dt;
    if (p.kind === "shot") {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) {
        for (const pk of S.packs) {
          if (!pk.dead && !pk.arrived && Math.hypot(pk.x - p.x, pk.y - p.y) < pk.r + 5) {
            damagePack(pk, p.dmg);
            spark(p.x, p.y, "#7df9ff", 4, 60);
            break;
          }
        }
        const t = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
        const b = barrelAt(t);
        if (b) {
          b.hp -= p.dmg;
          spark(p.x, p.y, "#ff8c5a", 4, 60);
          if (b.hp <= 0) explodeBarrel(b);
        }
      }
      continue;
    }
    if (p.targetP && !p.targetP.dead && !p.targetP.arrived) {
      const dx = p.targetP.x - p.x, dy = p.targetP.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.vx = (dx / d) * p.speed;
      p.vy = (dy / d) * p.speed;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.targetP && !p.targetP.dead && !p.targetP.arrived && Math.hypot(p.targetP.x - p.x, p.targetP.y - p.y) < p.targetP.r + 4) {
      if (p.kind === "shell") explodeShell(p);
      else { damagePack(p.targetP, p.dmg); p.life = 0; }
      spark(p.x, p.y, "#7df9ff", 4, 60);
    } else if (p.targetB && Math.hypot(barrelCenter(p.targetB).x - p.x, barrelCenter(p.targetB).y - p.y) < 20) {
      p.targetB.hp -= p.dmg;
      spark(p.x, p.y, "#ff8c5a", 4, 60);
      if (p.targetB.hp <= 0) explodeBarrel(p.targetB);
      p.life = 0;
    } else if (p.kind === "shell" && Math.hypot(p.tx - p.x, p.ty - p.y) < 8) {
      explodeShell(p);
    }
  }
  S.projs = S.projs.filter((p) => p.life > 0 && p.x > -80 && p.x < W + 80 && p.y > -80 && p.y < H + 80);
}

function updateBarrels(dt: number): void {
  if (S.phase === "siege") {
    S.barrelT -= dt;
    if (S.barrelT <= 0 && S.barrels.length < 5) {
      spawnBarrel();
      S.barrelT = 2.5 + Math.random() * 2;
    }
  }
  for (const b of S.barrels) b.t -= dt;
  S.barrels = S.barrels.filter((b) => b.t > 0);
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
    f.y -= 26 * dt;
  }
  S.floats = S.floats.filter((f) => f.life > 0);
}

function update(dt: number): void {
  S.time += dt;
  S.shotCd = Math.max(0, S.shotCd - dt);
  S.minerals = Math.min(cap(), S.minerals + mineralRate() * dt);
  S.gas = Math.min(cap(), S.gas + gasRate() * dt);
  if (S.research) {
    S.research.t -= dt;
    if (S.research.t <= 0) {
      const id = S.research.id;
      S.up[id]++;
      S.research = null;
      const r = RESEARCHES.find((x) => x.id === id);
      toast(`✅ Research complete: ${r?.name} Lv ${S.up[id]}`);
      chord([523, 659, 784, 1046], 0.3, "triangle", 0.05);
      for (const s of S.structs) s.hp = Math.min(maxHpOf(s), s.hp);
      updateHud();
    }
  }
  if (S.phase === "build") {
    S.siegeT -= dt;
    if (S.siegeT <= 0) startSiege(S.siege + 1);
  } else if (S.phase === "siege") {
    if (S.queue.length > 0) {
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        const t = S.queue.shift();
        if (t) spawnPack(t);
        S.spawnT = Math.max(0.35, 0.9 - S.siege * 0.04);
      }
    } else if (S.packs.length === 0) {
      endSiege();
    }
  }
  updateHero(dt);
  updatePacks(dt);
  updateStructs(dt);
  updateProjs(dt);
  updateBarrels(dt);
  updateParts(dt);
  S.shake = Math.max(0, S.shake - dt * 30);
  S.bannerT = Math.max(0, S.bannerT - dt);
}

function gameOver(): void {
  S.phase = "over";
  S.placing = null;
  S.selected = null;
  best = Math.max(best, S.siege);
  saveBest();
  S.shake = 20;
  beep(90, 1, "sawtooth", 0.1, -50);
  chord([330, 262, 196, 131], 0.6, "triangle", 0.06);
  $("ovTitle").textContent = "💥 SHELTER OVERRUN";
  $("ovText").textContent = `The horde broke through on siege ${S.siege}. ${S.kills} zerg slain · gun Lv ${S.gunLvl} · best: siege ${best}.`;
  ($("ovBtn") as HTMLButtonElement).textContent = "↻ REDEPLOY";
  $("overlay").classList.remove("hidden");
}

function startGame(): void {
  reset();
  S.started = true;
  $("overlay").classList.add("hidden");
  banner("BUILD YOUR SHELTER — SIEGE INCOMING");
  chord([392, 523, 659], 0.3, "triangle", 0.06);
  updateHud();
}

function playerShoot(x: number, y: number): void {
  if (S.shotCd > 0 || S.phase === "over" || !S.started) return;
  S.shotCd = 0.2;
  const h = S.hero;
  const ox = h.alive ? h.x : CC_POS.x;
  const oy = h.alive ? h.y : CC_POS.y;
  const ang = Math.atan2(y - oy, x - ox);
  S.projs.push({
    x: ox + Math.cos(ang) * 18, y: oy + Math.sin(ang) * 18,
    vx: Math.cos(ang) * 750, vy: Math.sin(ang) * 750, speed: 750, dmg: 5 * gunMul(), aoe: 0,
    targetP: null, targetB: null, tx: x, ty: y, life: 0.4, kind: "shot",
  });
  beep(900 + Math.random() * 200, 0.03, "square", 0.025, -300);
}

function canvasPos(e: MouseEvent): Vec {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
}

canvas.addEventListener("mousemove", (e) => {
  S.mouse = canvasPos(e);
  S.mouseTile = { x: Math.floor(S.mouse.x / TILE), y: Math.floor(S.mouse.y / TILE) };
});
canvas.addEventListener("mousedown", (e) => {
  if (!S.started || S.phase === "over") return;
  const p = canvasPos(e);
  S.mouse = p;
  const t = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
  S.mouseTile = t;
  if (e.button === 2) {
    S.placing = null;
    S.selected = null;
    for (const r of buildRefs) r.btn.classList.remove("selected");
    return;
  }
  if (e.button !== 0) return;
  if (S.placing) { tryPlace(t); return; }
  const b = barrelAt(t);
  if (b) { playerShoot(barrelCenter(b).x, barrelCenter(b).y); return; }
  const s = structAt(t);
  if (s) {
    S.selected = s;
    beep(600, 0.05, "square", 0.04);
    updateHud();
    return;
  }
  S.selected = null;
  playerShoot(p.x, p.y);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  S.keys[e.code] = true;
  if (!S.started || S.phase === "over") return;
  if (e.code === "Escape") {
    S.placing = null;
    S.selected = null;
    for (const r of buildRefs) r.btn.classList.remove("selected");
    return;
  }
  if (e.code === "KeyP") { S.paused = !S.paused; return; }
  if (e.code === "KeyU") { upgradeSelected(); return; }
  if (e.code === "KeyX") { sellSelected(); return; }
  const r = RESEARCHES.find((x) => `Key${x.key}` === e.code);
  if (r) { buyResearch(r.id); return; }
  const b = BUILDS.find((x) => `Digit${x.key}` === e.code);
  if (b) selectPlacing(b.id);
});
window.addEventListener("keyup", (e) => { S.keys[e.code] = false; });

$("ovBtn").addEventListener("click", () => startGame());
$("pauseBtn").addEventListener("click", () => { if (S.started && S.phase !== "over") S.paused = !S.paused; });
$("restartBtn").addEventListener("click", () => startGame());
$("upBtn").addEventListener("click", () => upgradeSelected());
$("sellBtn").addEventListener("click", () => sellSelected());
window.addEventListener("beforeunload", saveBest);

const buildRefs: { def: BuildDef; btn: HTMLButtonElement; costEl: HTMLElement; extraEl: HTMLElement }[] = [];
const researchRefs: { def: ResearchDef; btn: HTMLButtonElement; costEl: HTMLElement; lvlEl: HTMLElement }[] = [];

function makeBtn(def: { name: string; icon: string; desc: string; key: string }): { btn: HTMLButtonElement; costEl: HTMLElement; extraEl: HTMLElement } {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gr-btn";
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

function costText(m: number, g: number): string {
  return (m > 0 ? `${m} ◆` : "") + (m > 0 && g > 0 ? " + " : "") + (g > 0 ? `${g} ⛁` : "");
}

function renderLists(): void {
  const bl = $("buildList");
  bl.innerHTML = "";
  for (const def of BUILDS) {
    const r = makeBtn(def);
    r.btn.addEventListener("click", () => selectPlacing(def.id));
    bl.appendChild(r.btn);
    buildRefs.push({ def, btn: r.btn, costEl: r.costEl, extraEl: r.extraEl });
  }
  const rl = $("researchList");
  rl.innerHTML = "";
  for (const def of RESEARCHES) {
    const r = makeBtn(def);
    r.btn.addEventListener("click", () => buyResearch(def.id));
    rl.appendChild(r.btn);
    researchRefs.push({ def, btn: r.btn, costEl: r.costEl, lvlEl: r.extraEl });
  }
}

function updateHud(): void {
  $("minerals").textContent = fmt(S.minerals);
  $("gas").textContent = fmt(S.gas);
  $("store").textContent = `${fmt(S.minerals)}/${cap()}`;
  const c = cc();
  $("baseHp").textContent = `${Math.max(0, Math.ceil(c.hp))} / ${CC_HP}`;
  ($("baseFill") as HTMLDivElement).style.width = `${clamp((c.hp / CC_HP) * 100, 0, 100)}%`;
  $("siege").textContent = S.phase === "siege" ? `⚔ ${S.siege}` : S.siege === 0 ? `in ${Math.ceil(S.siegeT)}s` : `${S.siege} · in ${Math.ceil(S.siegeT)}s`;
  $("gun").textContent = `Lv ${S.gunLvl}`;
  $("kills").textContent = String(S.kills);
  $("best").textContent = String(best);
  for (const r of buildRefs) {
    const count = S.structs.filter((s) => s.type === r.def.id).length;
    const building = S.structs.filter((s) => s.type === r.def.id && s.constructing).length;
    r.extraEl.textContent = count > 0 ? `x${count}${building > 0 ? ` (+${building}…)` : ""}` : "";
    r.costEl.textContent = `${costText(r.def.costM, r.def.costG)} · ${r.def.time}s`;
    r.btn.disabled = S.minerals < r.def.costM || S.gas < r.def.costG;
  }
  for (const r of researchRefs) {
    const lvl = S.up[r.def.id];
    if (lvl >= r.def.max) {
      r.lvlEl.textContent = "MAX";
      r.costEl.textContent = "—";
      r.btn.disabled = true;
    } else {
      r.lvlEl.textContent = `Lv ${lvl}/${r.def.max}`;
      r.costEl.textContent = `${costText(researchCostM(r.def), researchCostG(r.def))} · ${researchTime(r.def)}s`;
      r.btn.disabled = !labReady() || S.research !== null || S.minerals < researchCostM(r.def) || S.gas < researchCostG(r.def);
    }
  }
  const rs = $("researchStatus");
  if (S.research) {
    const r = RESEARCHES.find((x) => x.id === S.research?.id);
    rs.textContent = `🔬 researching ${r?.name ?? ""} — ${Math.ceil(S.research.t)}s left`;
  } else if (labReady()) {
    rs.textContent = "🔬 lab online — research unlocked (Q/W/E)";
  } else {
    rs.textContent = "🔬 build a Lab (6) to unlock research";
  }
  const panel = $("selPanel");
  const s = S.selected;
  if (s) {
    panel.classList.remove("hidden");
    if (s.type === "cc") {
      $("tpName").textContent = "🏠 Command Center (your shelter)";
      $("tpStats").textContent = `hull ${Math.max(0, Math.ceil(s.hp))} / ${CC_HP}`;
      ($("upBtn") as HTMLButtonElement).disabled = true;
      ($("upBtn") as HTMLButtonElement).textContent = "⬆ (shelter is maxed)";
      ($("sellBtn") as HTMLButtonElement).disabled = true;
      ($("sellBtn") as HTMLButtonElement).textContent = "SELL (nope)";
    } else {
      const def = buildDef(s);
      $("tpName").textContent = `${def.icon} ${def.name} — Lv ${s.lvl}/${MAX_LVL}${s.constructing ? " (building…)" : ""}`;
      $("tpStats").textContent = `hp ${Math.ceil(s.hp)}/${maxHpOf(s)}` + (def.range > 0 ? ` · dmg ${structDmg(s).toFixed(1)} · range ${structRange(s).toFixed(0)}` : "");
      const up = $("upBtn") as HTMLButtonElement;
      const sell = $("sellBtn") as HTMLButtonElement;
      if (s.constructing) {
        up.disabled = true;
        up.textContent = `⬆ building… ${Math.ceil(s.buildT)}s`;
      } else if (s.lvl >= MAX_LVL || (s.type !== "wall" && s.type !== "turret" && s.type !== "bunker")) {
        up.disabled = true;
        up.textContent = "⬆ MAX / N/A";
      } else {
        up.textContent = `⬆ UPGRADE — ${costText(upgradeCostM(s), upgradeCostG(s))} (U)`;
        up.disabled = S.minerals < upgradeCostM(s) || S.gas < upgradeCostG(s);
      }
      sell.textContent = `SELL +${Math.floor(s.spentM * 0.6)} ◆ (X)`;
      sell.disabled = false;
    }
  } else {
    panel.classList.add("hidden");
  }
}

const STARS = Array.from({ length: 70 }, () => ({
  x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, a: Math.random() * 0.4 + 0.15,
}));

function drawBg(): void {
  ctx.fillStyle = "#0a0e18";
  ctx.fillRect(0, 0, W, H);
  for (const s of STARS) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = "#cfe6ff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255, 210, 60, 0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += TILE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (CC_TILES.has(`${x},${y}`)) {
        ctx.fillStyle = "#14243c";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }
}

function drawMinerals(): void {
  for (const t of MINERAL_TILES) {
    const p = center(t);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowColor = "#35f0d0";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#4dd8e8";
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 14 - 4, 8);
      ctx.lineTo(Math.cos(a) * 14, 8 - (10 + (i % 2) * 6));
      ctx.lineTo(Math.cos(a) * 14 + 4, 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#9ff5ff";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("+2/s", 0, 24);
    ctx.restore();
  }
}

function drawGates(): void {
  for (const g of S.gates) {
    const p = center(g.tile);
    const bad = g.op === "+" || g.op === "×";
    const col = bad ? "#ff5f6e" : "#5df08a";
    const pulse = 1 + 0.1 * Math.sin(S.time * 3 + g.tile.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#04060d";
    ctx.font = "bold 15px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${g.op}${g.val}`, 0, 5);
    ctx.restore();
  }
}

function drawBase(): void {
  const p = CC_POS;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.shadowColor = "#3aa0ff";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#3d4c63";
  ctx.fillRect(-62, -46, 124, 92);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#2c3a4f";
  ctx.fillRect(-62, -46, 124, 20);
  ctx.fillStyle = "#5f7290";
  ctx.fillRect(-14, -62, 28, 18);
  ctx.fillStyle = Math.sin(S.time * 4) > 0 ? "#ff5347" : "#7a1f1a";
  ctx.beginPath();
  ctx.arc(0, -66, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#9db4c8";
  ctx.fillRect(-46, -10, 30, 46);
  ctx.fillRect(16, -10, 30, 46);
  ctx.fillStyle = "#35f0d0";
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  ctx.fillText("CC", 0, 18);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(p.x - 62, p.y - 82, 124, 6);
  const ratio = clamp(cc().hp / CC_HP, 0, 1);
  ctx.fillStyle = ratio > 0.5 ? "#5df08a" : ratio > 0.25 ? "#ffd23c" : "#ff5347";
  ctx.fillRect(p.x - 62, p.y - 82, 124 * ratio, 6);
}

function drawBarrel(b: Barrel): void {
  const p = barrelCenter(b);
  const pulse = 1 + 0.07 * Math.sin(S.time * 6 + b.tx);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = "#ff8c5a";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#8a3d24";
  ctx.fillRect(-16, -16, 32, 32);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ff8c5a";
  ctx.lineWidth = 3;
  ctx.strokeRect(-16, -16, 32, 32);
  ctx.fillStyle = "#ffd23c";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.fillText("☢", 0, 5);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(p.x - 14, p.y - 26, 28, 4);
  ctx.fillStyle = "#ff8c5a";
  ctx.fillRect(p.x - 14, p.y - 26, 28 * clamp(b.hp / b.maxHp, 0, 1), 4);
}

function drawHpBar(x: number, y: number, w: number, ratio: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = ratio > 0.5 ? "#5df08a" : ratio > 0.25 ? "#ffd23c" : "#ff5347";
  ctx.fillRect(x - w / 2, y, w * clamp(ratio, 0, 1), 4);
}

function drawStruct(s: Struct): void {
  if (s.type === "cc") return;
  const p = structCenter(s);
  const def = buildDef(s);
  ctx.save();
  ctx.translate(p.x, p.y);
  if (S.selected === s) {
    ctx.strokeStyle = "rgba(255, 210, 60, 0.8)";
    ctx.setLineDash([6, 6]);
    if (def.range > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, structRange(s), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (s.constructing) {
    ctx.strokeStyle = "#ffd23c";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.strokeRect(-24, -24, 48, 48);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 210, 60, 0.15)";
    ctx.fillRect(-24, -24, 48, 48);
    ctx.restore();
    const prog = 1 - s.buildT / s.buildMax;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(p.x - 22, p.y + 28, 44, 5);
    ctx.fillStyle = "#ffd23c";
    ctx.fillRect(p.x - 22, p.y + 28, 44 * clamp(prog, 0, 1), 5);
    return;
  }
  if (s.type === "wall") {
    ctx.fillStyle = "#6b5a4a";
    ctx.fillRect(-24, -24, 48, 48);
    ctx.strokeStyle = "#9a8266";
    ctx.lineWidth = 2;
    ctx.strokeRect(-24, -24, 48, 48);
    ctx.beginPath();
    ctx.moveTo(-24, -8); ctx.lineTo(24, -8);
    ctx.moveTo(-24, 8); ctx.lineTo(24, 8);
    ctx.moveTo(-8, -24); ctx.lineTo(-8, 24);
    ctx.moveTo(8, -24); ctx.lineTo(8, 24);
    ctx.stroke();
  } else if (s.type === "turret") {
    ctx.fillStyle = "#5a6b7d";
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#8fa3b8"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "#7df9ff"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(s.angle) * 24, Math.sin(s.angle) * 24); ctx.stroke();
  } else if (s.type === "bunker") {
    ctx.fillStyle = "#6b7a5a";
    ctx.fillRect(-24, -18, 48, 36);
    ctx.strokeStyle = "#93a37e"; ctx.lineWidth = 2;
    ctx.strokeRect(-24, -18, 48, 36);
    ctx.fillStyle = "#3c4634";
    ctx.fillRect(-20, -6, 40, 12);
    ctx.strokeStyle = "#ffb14d"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(Math.cos(s.angle) * 26, Math.sin(s.angle) * 26); ctx.stroke();
  } else if (s.type === "depot") {
    ctx.fillStyle = "#5d4a2c";
    ctx.fillRect(-20, -16, 40, 32);
    ctx.strokeStyle = "#a08050"; ctx.lineWidth = 2;
    ctx.strokeRect(-20, -16, 40, 32);
    ctx.fillStyle = "#3d3220";
    ctx.fillRect(-20, -4, 40, 8);
  } else if (s.type === "refinery") {
    ctx.fillStyle = "#3d4c63";
    ctx.fillRect(-18, -20, 36, 40);
    ctx.strokeStyle = "#8fa3b8"; ctx.lineWidth = 2;
    ctx.strokeRect(-18, -20, 36, 40);
    ctx.fillStyle = "#7dffb0";
    ctx.shadowColor = "#7dffb0";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, -6, 7 + Math.sin(S.time * 5) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = "#4a3d6b";
    ctx.fillRect(-20, -18, 40, 36);
    ctx.strokeStyle = "#8a7ab0"; ctx.lineWidth = 2;
    ctx.strokeRect(-20, -18, 40, 36);
    ctx.fillStyle = "#c07bf2";
    ctx.shadowColor = "#c07bf2";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, 8 + Math.sin(S.time * 4) * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  for (let i = 0; i < s.lvl; i++) {
    ctx.fillStyle = "#ffd23c";
    ctx.beginPath();
    ctx.arc(p.x - (s.lvl - 1) * 4 + i * 8, p.y + 24, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const mh = maxHpOf(s);
  if (s.hp < mh) drawHpBar(p.x, p.y - 30, 44, s.hp / mh);
}

function drawHero(): void {
  const h = S.hero;
  if (!h.alive) {
    ctx.fillStyle = "#ffd23c";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`MARINE RESPAWN ${Math.ceil(h.respawnT)}s`, CC_POS.x - 70, CC_POS.y + 44);
    return;
  }
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#aebfd2";
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5f7290";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#35f0d0";
  ctx.fillRect(Math.cos(h.angle) * 6 - 3, Math.sin(h.angle) * 6 - 2, 6, 4);
  ctx.strokeStyle = "#2c3a4f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(Math.cos(h.angle) * 8, Math.sin(h.angle) * 8);
  ctx.lineTo(Math.cos(h.angle) * 19, Math.sin(h.angle) * 19);
  ctx.stroke();
  ctx.restore();
  drawHpBar(h.x, h.y - 22, 26, h.hp / 200);
}

function drawPack(p: Pack): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, p.r * 0.7, p.r, p.r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  const flash = p.flash > 0;
  const n = Math.min(10, Math.max(3, Math.round(p.count / 5)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + p.wob * 0.2;
    ctx.fillStyle = flash ? "#ffffff" : p.color;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * p.r * 0.55, Math.sin(a) * p.r * 0.38, p.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = flash ? "#ffffff" : p.color;
  ctx.beginPath();
  ctx.arc(0, 0, p.r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 3;
  ctx.strokeText(String(Math.max(0, Math.ceil(p.count))), p.x, p.y - p.r - 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(Math.max(0, Math.ceil(p.count))), p.x, p.y - p.r - 8);
}

function drawProjs(): void {
  for (const p of S.projs) {
    if (p.kind === "shot") {
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      ctx.stroke();
    } else if (p.kind === "bolt") {
      ctx.strokeStyle = "#7df9ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#ffb14d";
      ctx.shadowColor = "#ffb14d";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

function drawGhost(): void {
  if (!S.started || S.phase === "over") return;
  const t = S.mouseTile;
  if (S.placing) {
    const def = BUILDS.find((x) => x.id === S.placing);
    if (!def) return;
    const ok = canPlaceTile(t) && S.minerals >= def.costM && S.gas >= def.costG;
    const col = ok ? "255, 210, 60" : "255, 83, 71";
    const p = center(t);
    ctx.save();
    ctx.strokeStyle = `rgba(${col}, 0.8)`;
    ctx.fillStyle = `rgba(${col}, 0.15)`;
    if (def.range > 0) {
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, def.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = `rgba(${col}, 0.3)`;
    ctx.fillRect(t.x * TILE + 4, t.y * TILE + 4, TILE - 8, TILE - 8);
    ctx.strokeStyle = `rgba(${col}, 0.9)`;
    ctx.strokeRect(t.x * TILE + 4, t.y * TILE + 4, TILE - 8, TILE - 8);
    ctx.fillStyle = ok ? "#ffd23c" : "#ff5347";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${def.name} ${costText(def.costM, def.costG)} · ${def.time}s`, p.x, t.y * TILE - 4);
    ctx.restore();
  } else if (canPlaceTile(t) && !structAt(t) && !barrelAt(t)) {
    ctx.fillStyle = "rgba(255, 210, 60, 0.06)";
    ctx.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
  }
}

function draw(): void {
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  drawBg();
  drawMinerals();
  drawGates();
  drawBase();
  for (const b of S.barrels) drawBarrel(b);
  for (const s of S.structs) drawStruct(s);
  drawHero();
  const sorted = [...S.packs].sort((a, b) => a.y - b.y);
  for (const p of sorted) drawPack(p);
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
    ctx.globalAlpha = clamp(f.life / 0.9, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = `bold ${f.size}px monospace`;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.txt, f.x, f.y);
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  drawGhost();
  ctx.restore();
  if (S.bannerT > 0) {
    ctx.globalAlpha = clamp(S.bannerT * 2, 0, 1);
    ctx.fillStyle = "#ffd23c";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 4;
    ctx.font = "bold 30px monospace";
    ctx.textAlign = "center";
    ctx.strokeText(S.banner, W / 2, 44);
    ctx.fillText(S.banner, W / 2, 44);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "center";
  ctx.font = "bold 14px monospace";
  if (S.started && S.phase === "build") {
    ctx.fillStyle = "#ffd23c";
    ctx.fillText(`NEXT SIEGE IN ${Math.ceil(S.siegeT)}s — build (1-6), research (Q/W/E), click to shoot`, W / 2, H - 12);
  } else if (S.started && S.phase === "siege") {
    ctx.fillStyle = "#ff8c7a";
    ctx.fillText(`⚔ SIEGE ${S.siege} — ${S.packs.length + S.queue.length} hostiles · shoot ☢ barrels for bigger guns!`, W / 2, H - 12);
  }
  if (S.paused && S.started) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffd23c";
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
