import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beep, chord, sfx, registerSample } from "./sfx";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const canvas = $("scene") as HTMLCanvasElement;
const W = canvas.width;
const H = canvas.height;
const SAVE_KEY = "rfp_marinerun_best_v1";
const LANES = [-2.4, 0, 2.4];
const PLAYER_Z = 0;

type GateOp = "+" | "-" | "×" | "÷";

interface GateInfo { lane: number; op: GateOp; val: number; }
interface GateWall { group: any; z: number; gates: GateInfo[]; resolved: boolean; }
interface Pack {
  group: any; z: number; lane: number; count: number; maxCount: number;
  own: number; r: number; ranged: boolean; cd: number; label: any; balls: any[];
  model: any; mixer: any; dying: number;
  type: "skitter" | "spitter" | "behemoth"; dead: boolean;
}
interface TargetT { group: any; z: number; lane: number; dead: boolean; }
interface GunCrate { group: any; z: number; lane: number; taken: boolean; }
interface SpikeRow { group: any; z: number; lane: number; dmg: number; used: boolean; }
interface Bullet { mesh: any; z: number; laneX: number; }
interface Spine { mesh: any; z: number; x: number; y: number; vz: number; }

interface State {
  worldZ: number; speed: number; level: number; count: number; gunLvl: number;
  lane: number; laneX: number; fireCd: number;
  walls: GateWall[]; packs: Pack[]; targets: TargetT[]; guns: GunCrate[]; spikes: SpikeRow[];
  bullets: Bullet[]; spines: Spine[];
  spawnCursor: number; boss: Pack | null;
  phase: "run" | "over";
  shake: number; banner: string; bannerT: number;
  paused: boolean; started: boolean; time: number; hudT: number; hitSndT: number;
  keys: Record<string, boolean>; mouseX: number; mouseActive: boolean;
}

let S: State;
let best = 0;

const fmt = (n: number): string => String(Math.floor(n));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function applyOp(count: number, op: GateOp, val: number): number {
  if (op === "+") return count + val;
  if (op === "-") return Math.max(0, count - val);
  if (op === "×") return count * val;
  return Math.max(1, Math.floor(count / val));
}

function rollGateOp(): GateInfo["op"] extends never ? never : { op: GateOp; val: number } {
  const r = Math.random();
  if (r < 0.35) return { op: "+", val: 10 + Math.floor(Math.random() * 8) * 5 };
  if (r < 0.6) return { op: "-", val: 5 + Math.floor(Math.random() * 6) * 5 };
  if (r < 0.85) return { op: "×", val: 2 + Math.floor(Math.random() * 2) };
  return { op: "÷", val: 2 + Math.floor(Math.random() * 2) };
}

function reset(): void {
  S = {
    worldZ: 0, speed: 13, level: 1, count: 20, gunLvl: 0,
    lane: 1, laneX: LANES[1], fireCd: 0,
    walls: [], packs: [], targets: [], guns: [], spikes: [],
    bullets: [], spines: [],
    spawnCursor: 26, boss: null,
    phase: "run",
    shake: 0, banner: "", bannerT: 0,
    paused: false, started: false, time: 0, hudT: 0,
    keys: {}, mouseX: W / 2, mouseActive: false, hitSndT: 0,
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
  S.bannerT = 2.2;
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(W, H, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2b5e);
scene.fog = new THREE.Fog(0x1d2b5e, 34, 140);
const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 220);
camera.position.set(0, 4.6, 6.8);
camera.lookAt(0, 1.0, -12);

scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(3, 8, 5);
scene.add(sun);

const MODEL_FILES: Record<string, string> = {
  skitter: "assets/models/Orc_Skull.gltf",
  spitter: "assets/models/Demon.gltf",
  behemoth: "assets/models/Dragon_Evolved.gltf",
};
const MODEL_TARGET_H: Record<string, number> = { skitter: 1.0, spitter: 1.25, behemoth: 3.6 };
const MODEL_ANIM: Record<string, string> = { skitter: "Walk", spitter: "Walk", behemoth: "Flying_Idle" };
const MODELS: Record<string, { scene: any; scale: number; clip: any }> = {};
let assetsReady = false;
const gltfLoader = new GLTFLoader();
function loadModels(): void {
  const types = Object.keys(MODEL_FILES);
  let pending = types.length;
  const done = (): void => {
    if (--pending > 0) return;
    assetsReady = true;
    const b = $("ovBtn");
    if (b) b.textContent = "▶ START RUN";
  };
  for (const type of types) {
    gltfLoader.load(MODEL_FILES[type], (gltf: any) => {
      const sc = gltf.scene as any;
      sc.traverse((o: any) => { if (o.isMesh && o.material) o.material.fog = false; });
      const bb = new THREE.Box3().setFromObject(sc);
      const h = Math.max(0.001, bb.max.y - bb.min.y);
      sc.position.y = -bb.min.y;
      const anims = (gltf.animations as any[]) || [];
      const clip = anims.find((c: any) => c.name === MODEL_ANIM[type]) ?? anims[0] ?? null;
      MODELS[type] = { scene: sc, scale: MODEL_TARGET_H[type] / h, clip };
      done();
    }, undefined, () => done());
  }
}

const SFX_FILES: Record<string, string> = {
  fire: "assets/sfx/laser_small_000.ogg",
  gateGood: "assets/sfx/laser_retro_000.ogg",
  hit: "assets/sfx/impact_metal_000.ogg",
  wall: "assets/sfx/impact_metal_002.ogg",
  kill: "assets/sfx/explosion_crunch_000.ogg",
  clash: "assets/sfx/explosion_crunch_003.ogg",
  bossIn: "assets/sfx/force_field_000.ogg",
  gun: "assets/sfx/force_field_001.ogg",
  pickup: "assets/sfx/computer_noise_000.ogg",
  gateBad: "assets/sfx/slime_000.ogg",
  bossDown: "assets/sfx/low_frequency_explosion_000.ogg",
  over: "assets/sfx/low_frequency_explosion_001.ogg",
};
for (const [k, url] of Object.entries(SFX_FILES)) registerSample(k, url);

function box(w: number, h: number, d: number, color: number): any {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color, fog: false }));
}
function ball(r: number, color: number): any {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color, fog: false }));
}

function makeLabel(text: string, color: string): any {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 90;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const draw = (txt: string, col: string): void => {
    g.clearRect(0, 0, 320, 90);
    g.fillStyle = "rgba(8, 10, 28, 0.85)";
    g.beginPath();
    g.roundRect(6, 8, 308, 74, 16);
    g.fill();
    g.font = "bold 56px monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(0,0,0,0.95)";
    g.strokeText(txt, 160, 47);
    g.fillStyle = col;
    g.fillText(txt, 160, 47);
  };
  draw(text, color);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sp.scale.set(2.6, 0.73, 1);
  sp.userData = { canvas: c, tex, draw };
  return sp;
}

function setLabel(sp: any, text: string, color: string): void {
  if (!sp || !sp.userData) return;
  const key = text + "|" + color;
  if (sp.userData.last === key) return;
  sp.userData.last = key;
  sp.userData.draw(text, color);
  sp.userData.tex.needsUpdate = true;
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 220), new THREE.MeshBasicMaterial({ color: 0x2c2a5e }));
ground.material.fog = true;
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, 0, -80);
scene.add(ground);

const laneCols = [0x3a63c9, 0x8a4fd1, 0xd14f92];
for (let i = 0; i < 3; i++) {
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 220), new THREE.MeshBasicMaterial({ color: laneCols[i] }));
  strip.material.fog = true;
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(LANES[i], 0.012, -80);
  scene.add(strip);
}

const dashCols = [0x6ee7ff, 0xffd23c, 0xff7ad9, 0x5df08a];
const dashPool: any[] = [];
for (let i = 0; i < 14; i++) {
  const m = box(0.12, 0.035, 1.8, dashCols[i % dashCols.length]);
  m.material.fog = true;
  m.position.set(i % 2 === 0 ? -1.2 : 1.2, 0.02, -i * 9);
  scene.add(m);
  dashPool.push(m);
}
const ruinCols = [0x27406b, 0x4a3a75, 0x1f5a6e, 0x6e3a4a, 0x3a6e2f];
const ruinPool: any[] = [];
for (let i = 0; i < 16; i++) {
  const h = 2 + Math.random() * 6;
  const m = box(2.5 + Math.random() * 3, h, 2.5 + Math.random() * 3, ruinCols[i % ruinCols.length]);
  m.material.fog = true;
  m.position.set(i % 2 === 0 ? -5.6 : 5.6, h / 2, -i * 8 - Math.random() * 6);
  scene.add(m);
  ruinPool.push(m);
}

const moteCols = [0x6ee7ff, 0xffd23c, 0xff7ad9, 0x5df08a, 0xb47aff];
const motePool: any[] = [];
function placeMote(m: any): void {
  const side = Math.random() < 0.5 ? -1 : 1;
  m.position.set(side * (3.6 + Math.random() * 6.5), 0.8 + Math.random() * 5, -Math.random() * 130);
}
for (let i = 0; i < 12; i++) {
  const m = ball(0.07 + Math.random() * 0.06, moteCols[i % moteCols.length]);
  placeMote(m);
  scene.add(m);
  motePool.push(m);
}

const playerGroup = new THREE.Group();
scene.add(playerGroup);
const marineBody = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.8, 10), new THREE.MeshBasicMaterial({ color: 0xc4d8ea }));
marineBody.position.y = 0.75;
playerGroup.add(marineBody);
const marineHead = box(0.34, 0.26, 0.34, 0xa8c4dd);
marineHead.position.y = 1.28;
playerGroup.add(marineHead);
const gun = box(0.12, 0.12, 0.9, 0x4a6a9e);
gun.position.set(0.25, 0.95, -0.4);
playerGroup.add(gun);
const squadDots: any[] = [];
for (let i = 0; i < 8; i++) {
  const d = ball(0.13, 0xa8c4dd);
  playerGroup.add(d);
  squadDots.push(d);
}
let countLabel: any = null;

function rebuildPlayer(): void {
  playerGroup.position.set(S.laneX, 0, PLAYER_Z);
  const n = Math.min(8, Math.max(1, Math.round(S.count / 4)));
  for (let i = 0; i < squadDots.length; i++) {
    const d = squadDots[i];
    if (i < n) {
      const a = (i / n) * Math.PI * 2 + S.time * 2;
      d.position.set(-0.55 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.3, 0.2);
      d.visible = true;
    } else {
      d.visible = false;
    }
  }
  if (!countLabel) {
    countLabel = makeLabel(fmt(S.count), "#ffd23c");
    countLabel.position.set(0, 2.1, 0);
    playerGroup.add(countLabel);
  }
  const col = S.count > 40 ? "#5df08a" : S.count > 15 ? "#ffd23c" : "#ff5347";
  setLabel(countLabel, fmt(S.count), col);
}

const SPAWN_Z = -85;

function bossAt(level: number): number {
  return 170 + (level - 1) * 150;
}

function spawnGateWall(z: number): void {
  const group = new THREE.Group();
  group.position.z = z;
  scene.add(group);
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const nGates = Math.random() < 0.45 ? 3 : 2;
  const gates: GateInfo[] = [];
  for (let i = 0; i < 3; i++) {
    const lane = order[i];
    const x = LANES[lane];
    if (i < nGates) {
      const g = rollGateOp();
      const good = g.op === "+" || g.op === "×";
      const col = good ? 0x2fe06e : 0xff4040;
      const postL = box(0.35, 3.4, 0.35, col);
      postL.position.set(x - 1.05, 1.7, 0);
      const postR = box(0.35, 3.4, 0.35, col);
      postR.position.set(x + 1.05, 1.7, 0);
      const beam = box(2.45, 0.5, 0.5, col);
      beam.position.set(x, 3.6, 0);
      group.add(postL); group.add(postR); group.add(beam);
      const lbl = makeLabel(g.op + g.val, good ? "#6bff9e" : "#ff6b78");
      lbl.position.set(x, 4.65, 0);
      lbl.scale.set(2.9, 0.82, 1);
      group.add(lbl);
      gates.push({ lane, op: g.op, val: g.val });
    } else {
      const block = box(2.2, 3.6, 0.6, 0x6e3050);
      block.position.set(x, 1.8, 0);
      group.add(block);
      const lbl = makeLabel("WALL", "#ff8a94");
      lbl.position.set(x, 4.3, 0);
      lbl.scale.set(2.2, 0.62, 1);
      group.add(lbl);
    }
  }
  S.walls.push({ group, z, gates, resolved: false });
}

function spawnPack(z: number, lane: number, count: number, type: "skitter" | "spitter" | "behemoth"): Pack {
  const group = new THREE.Group();
  group.position.set(LANES[lane], 0, z);
  scene.add(group);
  const color = type === "skitter" ? 0xff5040 : type === "spitter" ? 0x6fe86a : 0xc07aff;
  const r = type === "behemoth" ? 1.1 : type === "spitter" ? 0.42 : 0.36;
  const balls: any[] = [];
  let model: any = null;
  let mixer: any = null;
  const m = MODELS[type];
  if (m) {
    model = m.scene.clone(true);
    model.scale.setScalar(m.scale);
    group.add(model);
    if (m.clip) {
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(m.clip).play();
    }
  } else {
    const n = Math.min(14, Math.max(4, Math.round(count / 3)));
    for (let i = 0; i < n; i++) {
      const b = ball(r, color);
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * (type === "behemoth" ? 2.2 : 0.9);
      b.position.set(Math.cos(a) * rr, r + Math.random() * (type === "behemoth" ? 2.2 : 0.8), Math.sin(a) * rr * 0.6);
      group.add(b);
      balls.push(b);
    }
  }
  const label = makeLabel(String(count), "#ff5f6e");
  label.position.y = type === "behemoth" ? 5.2 : 2.6;
  group.add(label);
  const pack: Pack = {
    group, z, lane, count, maxCount: count,
    own: type === "skitter" ? 3.5 : type === "behemoth" ? 0.6 : 0,
    r: type === "behemoth" ? 2.4 : 1.2,
    ranged: type !== "skitter",
    cd: 1 + Math.random(), label, balls, model, mixer, dying: 0, type, dead: false,
  };
  S.packs.push(pack);
  return pack;
}

function updatePackVisual(p: Pack): void {
  if (p.model) {
    const k = 0.75 + 0.5 * Math.sqrt(Math.max(0, p.count) / p.maxCount);
    p.model.scale.setScalar(MODELS[p.type].scale * k);
  } else {
    const n = Math.max(0, Math.ceil((p.count / p.maxCount) * p.balls.length));
    for (let i = 0; i < p.balls.length; i++) p.balls[i].visible = i < n;
  }
  const col = p.type === "skitter" ? "#ff7a6a" : p.type === "spitter" ? "#8affa0" : "#d9b3ff";
  setLabel(p.label, fmt(Math.max(0, p.count)), col);
}

function spawnTargets(z: number, lane: number): void {
  for (let i = 0; i < 3; i++) {
    const group = new THREE.Group();
    const zz = z - i * 7;
    group.position.set(LANES[lane], 0, zz);
    scene.add(group);
    const pole = box(0.1, 1.6, 0.1, 0x4a6a9e);
    pole.position.y = 0.8;
    const orb = ball(0.42, 0x6ee7ff);
    orb.position.y = 1.8;
    group.add(pole); group.add(orb);
    const lbl = makeLabel("+5", "#57d7ff");
    lbl.position.y = 2.6;
    lbl.scale.set(1.4, 0.4, 1);
    group.add(lbl);
    S.targets.push({ group, z: zz, lane, dead: false });
  }
}

function spawnGunCrate(z: number, lane: number): void {
  const group = new THREE.Group();
  group.position.set(LANES[lane], 0, z);
  scene.add(group);
  const crate = box(0.9, 0.9, 0.9, 0xff8a2a);
  crate.position.y = 0.75;
  group.add(crate);
  const lbl = makeLabel("GUN+", "#ffb14d");
  lbl.position.y = 2.0;
  group.add(lbl);
  S.guns.push({ group, z, lane, taken: false });
}

function spawnSpikes(z: number, lane: number): void {
  const group = new THREE.Group();
  group.position.set(LANES[lane], 0, z);
  scene.add(group);
  for (let i = 0; i < 5; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0xd5deee, fog: false }));
    cone.position.set((i - 2) * 0.45, 0.35, (i % 2) * 0.3 - 0.15);
    group.add(cone);
  }
  S.spikes.push({ group, z, lane, dmg: 6 + S.level * 2, used: false });
}

function spawnSection(z: number): void {
  const roles: Array<"enemy" | "targets" | "gun"> = ["enemy", "targets", "gun"];
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = roles[i]; roles[i] = roles[j]; roles[j] = t;
  }
  if (Math.random() < 0.4) spawnGateWall(z - 6);
  for (let lane = 0; lane < 3; lane++) {
    const role = roles[lane];
    if (role === "enemy") {
      const type: "skitter" | "spitter" = Math.random() < 0.65 ? "skitter" : "spitter";
      const count = 8 + Math.floor(Math.random() * 14) + S.level * 4;
      spawnPack(z, lane, count, type);
      if (Math.random() < 0.5) {
        spawnPack(z - 16, lane, Math.max(4, Math.floor(count * 0.5)), Math.random() < 0.5 ? "skitter" : "spitter");
      }
    } else if (role === "targets") {
      spawnTargets(z, lane);
    } else {
      spawnGunCrate(z, lane);
    }
  }
  if (Math.random() < 0.25 && roles[2] !== "enemy") spawnSpikes(z - 10, 2);
}

function spawnBoss(): void {
  const count = 60 + 30 * S.level;
  const boss = spawnPack(-70, 1, count, "behemoth");
  boss.cd = 1.0;
  S.boss = boss;
  banner("⚠ BEHEMOTH INBOUND ⚠");
  toast("BEHEMOTH — blast it down before it reaches you!");
  if (!sfx("bossIn", 0.7)) chord([196, 147], 0.5);
}

function killPack(p: Pack): void {
  if (p.dead) return;
  p.dead = true;
  p.dying = 0.25;
  sfx(p.type === "behemoth" ? "bossDown" : "kill", p.type === "behemoth" ? 0.8 : 0.5);
  if (S.boss === p) {
    S.boss = null;
    S.level += 1;
    S.speed = Math.min(26, S.speed + 1.6);
    S.count += 25;
    S.spawnCursor = 20;
    banner("LEVEL " + S.level + " — BEHEMOTH DOWN! +25");
    toast("LEVEL UP! speed increased");
    chord([523, 659, 784], 0.3);
  }
}

function fireBullet(): void {
  const mesh = box(0.11, 0.11, 0.9, 0xfff06a);
  mesh.position.set(S.laneX + 0.25, 0.95, -0.6);
  scene.add(mesh);
  S.bullets.push({ mesh, z: -0.6, laneX: S.laneX + 0.25 });
  if (!sfx("fire", 0.12, 0.9 + Math.random() * 0.3)) beep(1200 + S.gunLvl * 120, 0.03, "square", 0.03);
}

function fireSpine(p: Pack): void {
  const x = p.type === "behemoth" ? S.laneX + (Math.random() - 0.5) * 0.6 : LANES[p.lane] + (Math.random() - 0.5) * 0.8;
  const y = 0.6 + Math.random() * 0.8;
  const mesh = ball(0.16, 0xff6fb5);
  mesh.position.set(x, y, p.z);
  scene.add(mesh);
  S.spines.push({ mesh, z: p.z, x, y, vz: 20 });
}

function takeGun(g: GunCrate): void {
  if (g.taken) return;
  g.taken = true;
  S.gunLvl += 1;
  toast("WEAPON UPGRADED — Lv" + S.gunLvl);
  if (!sfx("gun", 0.6)) beep(990, 0.1);
  chord([880, 1108], 0.15);
  scene.remove(g.group);
}

function clearEntities(): void {
  if (!S) return;
  for (const w of S.walls) scene.remove(w.group);
  for (const p of S.packs) scene.remove(p.group);
  for (const t of S.targets) scene.remove(t.group);
  for (const g of S.guns) scene.remove(g.group);
  for (const s of S.spikes) scene.remove(s.group);
  for (const b of S.bullets) scene.remove(b.mesh);
  for (const s of S.spines) scene.remove(s.mesh);
}

function gameOver(reason: string): void {
  if (S.phase !== "run") return;
  S.phase = "over";
  S.started = false;
  const dist = Math.floor(S.worldZ);
  if (dist > best) {
    best = dist;
    saveBest();
  }
  $("ovTitle").textContent = "☠ WIPED OUT";
  $("ovText").innerHTML = reason + "<br><br>Level <b>" + S.level + "</b> · distance <b>" + dist + "m</b> · best <b>" + best + "m</b>";
  $("ovBtn").textContent = "↻ RUN AGAIN";
  $("overlay").classList.remove("hidden");
  if (!sfx("over", 0.8)) chord([220, 165, 110], 0.9);
}

function startGame(): void {
  if (!assetsReady) {
    toast("assets still loading…");
    return;
  }
  clearEntities();
  reset();
  best = loadBest();
  $("overlay").classList.add("hidden");
  $("pauseBtn").textContent = "⏸️ PAUSE (P)";
  rebuildPlayer();
  updateHud();
  banner("LEVEL " + S.level + " — GO!");
  chord([440, 554], 0.25);
  S.started = true;
}

function togglePause(): void {
  if (!S.started || S.phase !== "run") return;
  S.paused = !S.paused;
  $("pauseBtn").textContent = S.paused ? "▶ RESUME (P)" : "⏸️ PAUSE (P)";
}

function update(dt: number): void {
  S.time += dt;
  S.hitSndT = Math.max(0, S.hitSndT - dt);
  S.worldZ += S.speed * dt;
  S.shake = Math.max(0, S.shake - dt * 3);
  if (S.bannerT > 0) S.bannerT -= dt;

  if (S.mouseActive) {
    S.lane = S.mouseX < W / 3 ? 0 : S.mouseX < (2 * W) / 3 ? 1 : 2;
  }
  const targetX = LANES[S.lane];
  S.laneX += (targetX - S.laneX) * Math.min(1, dt * 12);
  playerGroup.position.set(S.laneX, 0, PLAYER_Z);
  playerGroup.rotation.z = (targetX - S.laneX) * 0.12;

  if (!S.boss) {
    if (S.worldZ < bossAt(S.level)) {
      S.spawnCursor -= S.speed * dt;
      if (S.spawnCursor <= 0) {
        spawnSection(SPAWN_Z);
        S.spawnCursor = 13 + Math.random() * 9;
      }
    } else {
      spawnBoss();
    }
  }

  S.fireCd -= dt;
  if (S.fireCd <= 0) {
    S.fireCd = Math.max(0.07, 0.13 - S.gunLvl * 0.008);
    fireBullet();
  }

  const dmg = 1 + S.gunLvl;
  for (let i = S.bullets.length - 1; i >= 0; i--) {
    const b = S.bullets[i];
    b.z -= 55 * dt;
    b.mesh.position.set(b.laneX, 0.95, b.z);
    let hit = false;
    if (b.z > -88) {
      for (const p of S.packs) {
        if (p.dead) continue;
        if (Math.abs(b.z - p.z) < p.r + 0.4 && Math.abs(b.laneX - LANES[p.lane]) < 0.9) {
          p.count -= dmg;
          hit = true;
          if (S.hitSndT <= 0) {
            S.hitSndT = 0.09;
            sfx("hit", 0.18, 1 + Math.random() * 0.2);
          }
          if (p.count <= 0) killPack(p);
          else updatePackVisual(p);
          break;
        }
      }
      if (!hit) {
        for (const t of S.targets) {
          if (t.dead) continue;
          if (Math.abs(b.z - t.z) < 0.9 && Math.abs(b.laneX - LANES[t.lane]) < 0.9) {
            t.dead = true;
            scene.remove(t.group);
            S.count += 5;
            toast("+5 FIGHTERS");
            if (!sfx("pickup", 0.5)) beep(880, 0.08);
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        for (const g of S.guns) {
          if (g.taken) continue;
          if (Math.abs(b.z - g.z) < 0.9 && Math.abs(b.laneX - LANES[g.lane]) < 0.9) {
            takeGun(g);
            hit = true;
            break;
          }
        }
      }
    }
    if (hit || b.z < -88) {
      scene.remove(b.mesh);
      S.bullets.splice(i, 1);
    }
  }

  for (let i = S.packs.length - 1; i >= 0; i--) {
    const p = S.packs[i];
    if (p.dead) {
      p.dying -= dt;
      p.z += S.speed * dt;
      p.group.position.z = p.z;
      const k = Math.max(0.001, p.dying / 0.25);
      if (p.model) p.model.scale.setScalar(MODELS[p.type].scale * k);
      else for (const b of p.balls) b.scale.setScalar(k);
      if (p.dying <= 0) {
        scene.remove(p.group);
        S.packs.splice(i, 1);
      }
      continue;
    }
    p.z += (S.speed + p.own) * dt;
    if (p.type === "behemoth") p.z = Math.min(p.z, PLAYER_Z - 0.5);
    p.group.position.z = p.z;
    p.group.position.x = LANES[p.lane] + Math.sin(S.time * 3 + p.z) * 0.15;
    if (p.mixer) p.mixer.update(dt);
    if (p.ranged) {
      p.cd -= dt;
      if (p.cd <= 0 && p.z < -8) {
        p.cd = p.type === "behemoth" ? 0.9 : 1.5;
        const n = p.type === "behemoth" ? 3 : 1;
        for (let k = 0; k < n; k++) fireSpine(p);
      }
    }
    if (p.z >= PLAYER_Z - 0.5 && Math.abs(LANES[p.lane] - S.laneX) < 0.9) {
      if (p.type === "behemoth") {
        gameOver("The behemoth crushed your squad of " + fmt(S.count) + ".");
        return;
      }
      if (S.count > p.count) {
        const lost = Math.ceil(p.count);
        S.count -= lost;
        toast("clash won −" + lost);
        if (!sfx("clash", 0.5)) beep(220, 0.15);
        S.shake = Math.max(S.shake, 0.4);
        killPack(p);
      } else {
        gameOver("Your squad of " + fmt(S.count) + " charged into a swarm pack of " + fmt(p.count) + " — the swarm wins.");
        return;
      }
    }
    if (p.z > 12) {
      scene.remove(p.group);
      S.packs.splice(i, 1);
      if (S.boss === p) S.boss = null;
    }
  }

  for (let i = S.walls.length - 1; i >= 0; i--) {
    const w = S.walls[i];
    w.z += S.speed * dt;
    w.group.position.z = w.z;
    if (!w.resolved && w.z >= PLAYER_Z) {
      w.resolved = true;
      const gate = w.gates.find((g) => g.lane === S.lane);
      if (gate) {
        const before = S.count;
        S.count = applyOp(S.count, gate.op, gate.val);
        toast(gate.op + gate.val + " → " + fmt(S.count) + " fighters");
        const good = gate.op === "+" || gate.op === "×";
        if (!sfx(good ? "gateGood" : "gateBad", 0.5)) beep(good ? 660 : 330, 0.12);
        S.shake = Math.max(S.shake, 0.25);
        if (S.count >= before) chord([523, 659], 0.12);
        if (S.count <= 0) {
          gameOver("The gate math zeroed your squad out.");
          return;
        }
      } else {
        S.count -= 12;
        toast("WALL! −12");
        S.shake = 0.7;
        if (!sfx("wall", 0.6)) beep(160, 0.2);
        if (S.count <= 0) {
          gameOver("Bonked into a solid wall at full speed.");
          return;
        }
      }
    }
    if (w.z > 12) {
      scene.remove(w.group);
      S.walls.splice(i, 1);
    }
  }

  for (let i = S.guns.length - 1; i >= 0; i--) {
    const g = S.guns[i];
    g.z += S.speed * dt;
    g.group.position.z = g.z;
    if (!g.taken && g.z >= PLAYER_Z - 0.5 && g.lane === S.lane) takeGun(g);
    if (g.z > 12 || g.taken) {
      S.guns.splice(i, 1);
    }
  }

  for (let i = S.targets.length - 1; i >= 0; i--) {
    const t = S.targets[i];
    if (t.dead) {
      S.targets.splice(i, 1);
      continue;
    }
    t.z += S.speed * dt;
    t.group.position.z = t.z;
    if (t.z > 12) {
      scene.remove(t.group);
      S.targets.splice(i, 1);
    }
  }

  for (let i = S.spikes.length - 1; i >= 0; i--) {
    const s = S.spikes[i];
    s.z += S.speed * dt;
    s.group.position.z = s.z;
    if (!s.used && s.z >= PLAYER_Z && s.lane === S.lane) {
      s.used = true;
      S.count -= s.dmg;
      toast("SPIKES −" + s.dmg);
      S.shake = 0.6;
      if (!sfx("hit", 0.45)) beep(180, 0.2);
      if (S.count <= 0) {
        gameOver("Shredded on the spike strip.");
        return;
      }
    }
    if (s.z > 12) {
      scene.remove(s.group);
      S.spikes.splice(i, 1);
    }
  }

  for (let i = S.spines.length - 1; i >= 0; i--) {
    const s = S.spines[i];
    s.z += (S.speed + s.vz) * dt;
    s.mesh.position.set(s.x, s.y, s.z);
    if (s.z >= PLAYER_Z - 0.4) {
      scene.remove(s.mesh);
      S.spines.splice(i, 1);
      if (Math.abs(s.x - S.laneX) < 0.8) {
        S.count -= 1;
        S.shake = Math.max(S.shake, 0.15);
        if (S.count <= 0) {
          gameOver("Peppered by spitter spines.");
          return;
        }
      }
    }
  }

  for (const d of dashPool) {
    d.position.z += S.speed * dt;
    if (d.position.z > 8) d.position.z -= 14 * 9;
  }
  for (const r of ruinPool) {
    r.position.z += S.speed * dt;
    if (r.position.z > 14) r.position.z -= 16 * 8;
  }
  for (const m of motePool) {
    m.position.z += S.speed * dt * 0.6;
    if (m.position.z > 3) placeMote(m);
  }

  rebuildPlayer();
  S.hudT -= dt;
  if (S.hudT <= 0) {
    S.hudT = 0.1;
    updateHud();
  }
}

function updateHud(): void {
  $("count").textContent = fmt(S.count);
  $("level").textContent = String(S.level);
  $("dist").textContent = Math.floor(S.worldZ) + "m";
  $("gun").textContent = "Lv" + S.gunLvl;
  $("best").textContent = Math.max(best, Math.floor(S.worldZ)) + "m";
}

const bannerEl = document.createElement("div");
bannerEl.className = "mr-banner";
canvas.parentElement?.appendChild(bannerEl);

function render(): void {
  if (S.paused) {
    bannerEl.textContent = "⏸ PAUSED — press P";
    bannerEl.classList.add("show");
  } else if (S.bannerT > 0) {
    bannerEl.textContent = S.banner;
    bannerEl.classList.add("show");
  } else {
    bannerEl.classList.remove("show");
  }
  const sh = S.shake;
  camera.position.x = (Math.random() - 0.5) * sh;
  camera.position.y = 4.6 + (Math.random() - 0.5) * sh * 0.6;
  renderer.render(scene, camera);
}

function setMouseFromClient(clientX: number): void {
  const rect = canvas.getBoundingClientRect();
  S.mouseX = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
  S.mouseActive = true;
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  S.keys[k] = true;
  if (k === "arrowleft" || k === "a") {
    S.lane = clamp(S.lane - 1, 0, 2);
    S.mouseActive = false;
    e.preventDefault();
  } else if (k === "arrowright" || k === "d") {
    S.lane = clamp(S.lane + 1, 0, 2);
    S.mouseActive = false;
    e.preventDefault();
  } else if (k === "p") {
    togglePause();
  } else if (k === "r") {
    startGame();
  } else if ((k === " " || k === "enter") && S.phase === "over") {
    startGame();
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  S.keys[e.key.toLowerCase()] = false;
});
window.addEventListener("mousemove", (e) => setMouseFromClient(e.clientX));
canvas.addEventListener("touchstart", (e) => {
  setMouseFromClient(e.touches[0].clientX);
  e.preventDefault();
}, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  setMouseFromClient(e.touches[0].clientX);
  e.preventDefault();
}, { passive: false });

$("ovBtn").addEventListener("click", () => startGame());
$("pauseBtn").addEventListener("click", () => togglePause());
$("restartBtn").addEventListener("click", () => startGame());

let last = performance.now();
function loop(now: number): void {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  if (S.started && !S.paused && S.phase === "run") update(dt);
  render();
  requestAnimationFrame(loop);
}

reset();
best = loadBest();
rebuildPlayer();
updateHud();
$("ovBtn").textContent = "⏳ LOADING ASSETS…";
loadModels();
requestAnimationFrame(loop);
