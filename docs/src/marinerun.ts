import { beep, chord } from "./sfx";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const canvas = $("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const W = canvas.width;
const H = canvas.height;
const GROUND = 470;
const PX = 170;
const SAVE_KEY = "rfp_marinerun_best_v1";

type GateOp = "+" | "-" | "×" | "÷";

interface Gate { wx: number; gy: number; op: GateOp; val: number; used: boolean; }
interface Enemy {
  wx: number; wy: number; count: number; maxCount: number; speed: number; r: number;
  color: string; type: "zergling" | "hydralisk" | "ultralisk";
  ranged: boolean; cd: number; wob: number; dead: boolean;
}
interface Bullet { wx: number; wy: number; }
interface Spine { wx: number; wy: number; vx: number; vy: number; }
interface Pickup { wx: number; amount: number; taken: boolean; }
interface Spike { wx: number; dmg: number; used: boolean; }
interface Turret { wx: number; hp: number; maxHp: number; cd: number; dead: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; }
interface FloatT { x: number; y: number; txt: string; life: number; color: string; size: number; }

interface State {
  worldX: number; speed: number; level: number; count: number;
  playerY: number; targetY: number; fireCd: number;
  gates: Gate[]; enemies: Enemy[]; bullets: Bullet[]; spines: Spine[];
  pickups: Pickup[]; spikes: Spike[]; turrets: Turret[];
  parts: Particle[]; floats: FloatT[];
  nextSpawnX: number; boss: Enemy | null;
  phase: "run" | "over";
  shake: number; banner: string; bannerT: number;
  paused: boolean; started: boolean; time: number; hudT: number;
  keys: Record<string, boolean>; mouseY: number;
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

function rollGateOp(): { op: GateOp; val: number } {
  const r = Math.random();
  if (r < 0.35) return { op: "+", val: 10 + Math.floor(Math.random() * 8) * 5 };
  if (r < 0.6) return { op: "-", val: 5 + Math.floor(Math.random() * 6) * 5 };
  if (r < 0.85) return { op: "×", val: 2 + Math.floor(Math.random() * 2) };
  return { op: "÷", val: 2 + Math.floor(Math.random() * 2) };
}

function reset(): void {
  S = {
    worldX: 0, speed: 200, level: 1, count: 20,
    playerY: 300, targetY: 300, fireCd: 0,
    gates: [], enemies: [], bullets: [], spines: [],
    pickups: [], spikes: [], turrets: [],
    parts: [], floats: [],
    nextSpawnX: 700, boss: null,
    phase: "run",
    shake: 0, banner: "", bannerT: 0,
    paused: false, started: false, time: 0, hudT: 0,
    keys: {}, mouseY: 300,
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

function spark(x: number, y: number, color: string, n: number, spd = 120): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = spd * (0.4 + Math.random());
    S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.3 + Math.random() * 0.4, max: 0.7, size: 1.5 + Math.random() * 2.5, color });
  }
}

function levelEnd(): number {
  return 3000 + S.level * 900;
}

function spawnGatePair(wx: number): void {
  const a = rollGateOp();
  const b = rollGateOp();
  S.gates.push({ wx, gy: 185, op: a.op, val: a.val, used: false });
  S.gates.push({ wx: wx + 90, gy: 370, op: b.op, val: b.val, used: false });
}

function spawnEnemy(wx: number): void {
  const r = Math.random();
  const lvl = S.level;
  if (r < 0.65) {
    S.enemies.push({
      wx, wy: GROUND - 22, count: Math.round(5 + Math.random() * 18 + lvl * 4), maxCount: 0,
      speed: 30 + Math.random() * 50 + lvl * 5, r: 24, color: "#ff5347", type: "zergling", ranged: false, cd: 0, wob: Math.random() * 10, dead: false,
    });
  } else {
    S.enemies.push({
      wx, wy: GROUND - 30, count: Math.round(12 + Math.random() * 20 + lvl * 6), maxCount: 0,
      speed: 12 + Math.random() * 20, r: 30, color: "#8ee04f", type: "hydralisk", ranged: true, cd: 1, wob: Math.random() * 10, dead: false,
    });
  }
  const e = S.enemies[S.enemies.length - 1];
  e.maxCount = e.count;
}

function spawnBoss(wx: number): void {
  const e: Enemy = {
    wx, wy: GROUND - 46, count: 50 + 25 * S.level, maxCount: 50 + 25 * S.level,
    speed: 0, r: 46, color: "#e0447c", type: "ultralisk", ranged: false, cd: 0, wob: 0, dead: false,
  };
  S.boss = e;
  S.enemies.push(e);
  banner(`⚠ LEVEL ${S.level} BOSS — ULTRALISK (${e.count}) ⚠`);
  beep(70, 0.8, "sawtooth", 0.1, -30);
  S.shake = 12;
}

function spawnPattern(wx: number): void {
  const r = Math.random();
  if (r < 0.34) spawnGatePair(wx);
  else if (r < 0.62) spawnEnemy(wx);
  else if (r < 0.74) S.pickups.push({ wx: wx + 40, amount: 5 + Math.floor(Math.random() * 3) * 5 + S.level * 2, taken: false });
  else if (r < 0.86) S.spikes.push({ wx, dmg: 6 + S.level * 2, used: false });
  else if (r < 0.96) S.turrets.push({ wx, hp: 8 + S.level * 3, maxHp: 8 + S.level * 3, cd: 1, dead: false });
}

function floatAt(wx: number, y: number, txt: string, color: string, size = 16): void {
  S.floats.push({ x: wx - S.worldX + PX, y, txt, life: 1.1, color, size });
}

function gameOver(): void {
  S.phase = "over";
  best = Math.max(best, Math.floor(S.worldX / 50));
  saveBest();
  S.shake = 20;
  beep(90, 1, "sawtooth", 0.1, -50);
  chord([330, 262, 196, 131], 0.6, "triangle", 0.06);
  $("ovTitle").textContent = "💀 SQUAD WIPED OUT";
  $("ovText").textContent = `Your squad hit zero at ${fmt(S.worldX / 50)}m on level ${S.level}. Best distance: ${best}m.`;
  ($("ovBtn") as HTMLButtonElement).textContent = "↻ RUN AGAIN";
  $("overlay").classList.remove("hidden");
}

function startGame(): void {
  reset();
  S.started = true;
  $("overlay").classList.add("hidden");
  banner("RUN! GUNS HOT — PICK YOUR GATES");
  chord([392, 523, 659], 0.3, "triangle", 0.06);
  updateHud();
}

function levelCleared(): void {
  banner(`LEVEL ${S.level} CLEARED!`);
  chord([523, 659, 784, 1046], 0.35, "triangle", 0.06);
  toast(`Level ${S.level} cleared! +25 fighters, next level faster & meaner`);
  S.level++;
  S.count = Math.min(999, S.count + 25);
  S.speed += 14;
  S.boss = null;
  S.nextSpawnX = Math.max(S.nextSpawnX, S.worldX + 900);
}

function update(dt: number): void {
  S.time += dt;
  const prevX = S.worldX;
  S.worldX += S.speed * dt;
  while (S.nextSpawnX < S.worldX + 1300) {
    spawnPattern(S.nextSpawnX);
    S.nextSpawnX += 480 + Math.random() * 520;
  }
  if (!S.boss && S.worldX > levelEnd() - 600) spawnBoss(levelEnd());

  if (S.keys["KeyW"] || S.keys["ArrowUp"]) S.targetY -= 300 * dt;
  if (S.keys["KeyS"] || S.keys["ArrowDown"]) S.targetY += 300 * dt;
  S.targetY = clamp(S.targetY, 130, GROUND - 26);
  S.playerY += (S.targetY - S.playerY) * Math.min(1, 12 * dt);

  S.fireCd -= dt;
  if (S.fireCd <= 0) {
    S.fireCd = 0.12;
    S.bullets.push({ wx: S.worldX + 26, wy: S.playerY - 8 });
    S.parts.push({ x: S.worldX + 30 - S.worldX + PX, y: S.playerY - 8, vx: 60, vy: 0, life: 0.06, max: 0.06, size: 4, color: "#ffe08a" });
    beep(880 + Math.random() * 160, 0.025, "square", 0.016, -250);
  }

  for (const b of S.bullets) b.wx += 780 * dt;
  S.bullets = S.bullets.filter((b) => b.wx < S.worldX + W);
  for (const b of S.bullets) {
    for (const e of S.enemies) {
      if (e.dead) continue;
      if (Math.abs(b.wx - e.wx) < e.r + 4 && Math.abs(b.wy - e.wy) < e.r + 8) {
        e.count--;
        spark(b.wx - S.worldX + PX, b.wy, e.color, 3, 90);
        b.wx = Infinity;
        if (e.count <= 0) {
          e.dead = true;
          killNote(e);
        }
        break;
      }
    }
    for (const t of S.turrets) {
      if (t.dead || b.wx === Infinity) continue;
      if (Math.abs(b.wx - t.wx) < 18 && Math.abs(b.wy - (GROUND - 40)) < 26) {
        t.hp--;
        spark(b.wx - S.worldX + PX, b.wy, "#ff8c42", 4, 90);
        b.wx = Infinity;
        if (t.hp <= 0) {
          t.dead = true;
          spark(t.wx - S.worldX + PX, GROUND - 40, "#ff8c42", 18, 150);
          beep(120, 0.25, "sawtooth", 0.06, -70);
        }
        break;
      }
    }
  }
  S.bullets = S.bullets.filter((b) => b.wx !== Infinity);

  for (const e of S.enemies) {
    if (e.dead) continue;
    e.wob += dt * 6;
    if (e.type !== "ultralisk") e.wx -= e.speed * dt;
    if (e.ranged) {
      e.cd -= dt;
      if (e.cd <= 0 && Math.abs(e.wx - S.worldX) < 340 && e.wx > S.worldX) {
        e.cd = 1.3;
        const dx = S.worldX - e.wx, dy = S.playerY - 10 - e.wy;
        const d = Math.hypot(dx, dy) || 1;
        S.spines.push({ wx: e.wx, wy: e.wy, vx: (dx / d) * 430, vy: (dy / d) * 430 });
        beep(320, 0.05, "sawtooth", 0.02, 60);
      }
    }
    if (Math.abs(e.wx - S.worldX) < e.r + 22 && Math.abs(e.wy - S.playerY) < e.r + 18) {
      if (S.count > e.count) {
        S.count -= e.count;
        e.dead = true;
        killNote(e);
        floatAt(S.worldX, S.playerY - 40, `-${e.count}`, "#ffd23c", 18);
        S.shake = Math.max(S.shake, 6);
        beep(160, 0.15, "sawtooth", 0.06, -60);
      } else {
        S.count = 0;
        e.dead = true;
        spark(PX, S.playerY, "#aebfd2", 30, 180);
        gameOver();
        return;
      }
    }
  }
  S.enemies = S.enemies.filter((e) => !e.dead && e.wx > S.worldX - 160);
  if (S.boss && S.boss.dead) {
    levelCleared();
  }

  for (const g of S.gates) {
    if (g.used) continue;
    if (prevX < g.wx && S.worldX >= g.wx && Math.abs(S.playerY - g.gy) < 58) {
      g.used = true;
      const before = S.count;
      S.count = Math.min(999, applyOp(S.count, g.op, g.val));
      const good = S.count >= before;
      floatAt(S.worldX, S.playerY - 46, `${g.op}${g.val}: ${before} → ${S.count}`, good ? "#5df08a" : "#ff5f6e", 18);
      beep(good ? 880 : 240, 0.14, "square", 0.05, good ? 220 : -120);
      if (S.count <= 0) { gameOver(); return; }
    }
  }
  S.gates = S.gates.filter((g) => g.wx > S.worldX - 120);

  for (const p of S.pickups) {
    if (p.taken) continue;
    if (Math.abs(p.wx - S.worldX) < 26 && Math.abs(GROUND - 34 - S.playerY) < 40) {
      p.taken = true;
      S.count = Math.min(999, S.count + p.amount);
      floatAt(S.worldX, S.playerY - 40, `+${p.amount}`, "#5df08a", 18);
      beep(1250, 0.06, "sine", 0.04, 200);
    }
  }
  S.pickups = S.pickups.filter((p) => !p.taken && p.wx > S.worldX - 120);

  for (const s of S.spikes) {
    if (s.used) continue;
    if (prevX < s.wx && S.worldX >= s.wx && S.playerY > GROUND - 46) {
      s.used = true;
      S.count = Math.max(0, S.count - s.dmg);
      floatAt(S.worldX, S.playerY - 40, `-${s.dmg} spikes!`, "#ff5f6e", 16);
      S.shake = Math.max(S.shake, 7);
      beep(140, 0.2, "sawtooth", 0.07, -60);
      if (S.count <= 0) { gameOver(); return; }
    }
  }
  S.spikes = S.spikes.filter((s) => s.wx > S.worldX - 120);

  for (const t of S.turrets) {
    if (t.dead) continue;
    t.cd -= dt;
    if (t.cd <= 0 && Math.abs(t.wx - S.worldX) < 360 && t.wx > S.worldX) {
      t.cd = 1.15;
      const dx = S.worldX - t.wx, dy = S.playerY - 12 - (GROUND - 40);
      const d = Math.hypot(dx, dy) || 1;
      S.spines.push({ wx: t.wx, wy: GROUND - 40, vx: (dx / d) * 460, vy: (dy / d) * 460 });
      beep(300, 0.05, "sawtooth", 0.02, 60);
    }
  }
  S.turrets = S.turrets.filter((t) => !t.dead && t.wx > S.worldX - 160);

  for (const sp of S.spines) {
    sp.wx += sp.vx * dt;
    sp.wy += sp.vy * dt;
    if (Math.abs(sp.wx - S.worldX) < 15 && Math.abs(sp.wy - (S.playerY - 8)) < 15) {
      sp.wx = -Infinity;
      S.count = Math.max(0, S.count - 1);
      floatAt(S.worldX, S.playerY - 40, "-1", "#c6ff4d", 13);
      if (S.count <= 0) { gameOver(); return; }
    }
  }
  S.spines = S.spines.filter((sp) => sp.wx > S.worldX - 60 && sp.wx !== -Infinity);

  for (const p of S.parts) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt;
  }
  S.parts = S.parts.filter((p) => p.life > 0);
  for (const f of S.floats) {
    f.life -= dt;
    f.y -= 30 * dt;
  }
  S.floats = S.floats.filter((f) => f.life > 0);

  S.shake = Math.max(0, S.shake - dt * 30);
  S.bannerT = Math.max(0, S.bannerT - dt);
}

function killNote(e: Enemy): void {
  spark(e.wx - S.worldX + PX, e.wy, e.color, e.type === "ultralisk" ? 40 : 14, e.type === "ultralisk" ? 180 : 110);
  if (e.type === "ultralisk") {
    S.shake = Math.max(S.shake, 14);
    beep(60, 0.7, "sawtooth", 0.1, -25);
  } else {
    beep(200 + Math.random() * 120, 0.06, "square", 0.025, -120);
    if (Math.random() < 0.2) S.pickups.push({ wx: e.wx + 30, amount: 5 + Math.floor(Math.random() * 10), taken: false });
  }
}

function canvasY(e: MouseEvent): number {
  const r = canvas.getBoundingClientRect();
  return ((e.clientY - r.top) * H) / r.height;
}

canvas.addEventListener("mousemove", (e) => {
  S.mouseY = canvasY(e);
  if (S.started && S.phase !== "over") S.targetY = clamp(S.mouseY, 130, GROUND - 26);
});
canvas.addEventListener("mousedown", () => {
  if (S.started && S.phase !== "over") S.targetY = clamp(S.mouseY, 130, GROUND - 26);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  S.keys[e.code] = true;
  if (!S.started || S.phase === "over") return;
  if (e.code === "KeyP") S.paused = !S.paused;
});
window.addEventListener("keyup", (e) => { S.keys[e.code] = false; });

$("ovBtn").addEventListener("click", () => startGame());
$("pauseBtn").addEventListener("click", () => { if (S.started && S.phase !== "over") S.paused = !S.paused; });
$("restartBtn").addEventListener("click", () => startGame());
window.addEventListener("beforeunload", saveBest);

function updateHud(): void {
  const c = $("count");
  c.textContent = fmt(S.count);
  c.style.color = S.count > 40 ? "#5df08a" : S.count > 15 ? "#ffd23c" : "#ff5347";
  $("level").textContent = String(S.level);
  $("dist").textContent = `${fmt(S.worldX / 50)}m`;
  $("best").textContent = `${best}m`;
}

const RUINS = Array.from({ length: 40 }, (_, i) => ({
  w: 60 + Math.random() * 130,
  h: 60 + Math.random() * 190,
  gap: 200 + Math.random() * 260,
  x: i * 300,
}));
const STARS2 = Array.from({ length: 80 }, () => ({
  x: Math.random() * W, y: Math.random() * (GROUND - 160), r: Math.random() * 1.5 + 0.3, a: Math.random() * 0.5 + 0.2,
}));

const sx = (wx: number): number => wx - S.worldX + PX;

function drawBg(): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0a1024");
  g.addColorStop(0.65, "#131a30");
  g.addColorStop(1, "#1d1430");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const s of STARS2) {
    ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(S.time * 2 + s.x));
    ctx.fillStyle = "#cfe6ff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#101828";
  const off = (S.worldX * 0.35) % 300;
  for (const r of RUINS) {
    const x = r.x - off - 150;
    if (x > W + 100 || x < -300) continue;
    ctx.fillRect(x, GROUND - r.h, r.w, r.h);
    ctx.fillStyle = "#0c1220";
    ctx.fillRect(x + 10, GROUND - r.h + 12, r.w - 20, 8);
    ctx.fillStyle = "#101828";
  }
  ctx.fillStyle = "#1a1410";
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = "#2a2015";
  ctx.fillRect(0, GROUND, W, 6);
  ctx.strokeStyle = "rgba(255, 210, 60, 0.12)";
  ctx.lineWidth = 2;
  const coff = S.worldX % 90;
  for (let x = -coff; x < W; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND + 6);
    ctx.lineTo(x + 26, H);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffd23c";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "left";
  const prog = clamp((S.worldX % levelEnd()) / levelEnd(), 0, 1);
  ctx.fillText(`LEVEL ${S.level} PROGRESS`, 20, H - 14);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(160, H - 20, 200, 8);
  ctx.fillStyle = "#ffd23c";
  ctx.fillRect(160, H - 20, 200 * prog, 8);
}

function drawGate(g: Gate): void {
  const x = sx(g.wx);
  if (x < -80 || x > W + 80) return;
  const good = g.op === "+" || g.op === "×";
  const col = g.used ? "#3a4356" : good ? "#5df08a" : "#ff5f6e";
  ctx.save();
  ctx.translate(x, g.gy);
  if (!g.used) {
    ctx.shadowColor = col;
    ctx.shadowBlur = 14 + 4 * Math.sin(S.time * 4 + g.wx);
  }
  ctx.strokeStyle = col;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-34, 52);
  ctx.lineTo(-34, -52);
  ctx.lineTo(34, -52);
  ctx.lineTo(34, 52);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = col;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${g.op}${g.val}`, 0, 9);
  ctx.restore();
}

function drawEnemy(e: Enemy): void {
  const x = sx(e.wx);
  if (x < -80 || x > W + 80) return;
  ctx.save();
  ctx.translate(x, e.wy);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, e.r * 0.75, e.r, e.r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  const n = Math.min(9, Math.max(3, Math.round(e.count / (e.type === "ultralisk" ? 30 : 5))));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + e.wob * 0.15;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * e.r * 0.55, Math.sin(a) * e.r * 0.4, e.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = e.color;
  ctx.beginPath();
  ctx.arc(0, 0, e.r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  if (e.type === "ultralisk") {
    ctx.fillStyle = "#f0e8d8";
    ctx.beginPath();
    ctx.moveTo(-10, -e.r * 0.6); ctx.lineTo(-5, -e.r - 12); ctx.lineTo(0, -e.r * 0.6); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(10, -e.r * 0.6); ctx.lineTo(5, -e.r - 12); ctx.lineTo(0, -e.r * 0.6); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.font = "bold 15px monospace";
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 3;
  ctx.strokeText(String(Math.ceil(e.count)), x, e.wy - e.r - 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(Math.ceil(e.count)), x, e.wy - e.r - 8);
  if (e.count < e.maxCount) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 22, e.wy - e.r - 16, 44, 4);
    ctx.fillStyle = "#ffd23c";
    ctx.fillRect(x - 22, e.wy - e.r - 16, 44 * clamp(e.count / e.maxCount, 0, 1), 4);
  }
}

function drawTurret(t: Turret): void {
  const x = sx(t.wx);
  if (x < -60 || x > W + 60) return;
  const y = GROUND - 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#4a2a3a";
  ctx.fillRect(-16, -18, 32, 36);
  ctx.strokeStyle = "#8a4a6a";
  ctx.lineWidth = 2;
  ctx.strokeRect(-16, -18, 32, 36);
  ctx.strokeStyle = "#c6ff4d";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(-30, -30);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 18, y - 30, 36, 4);
  ctx.fillStyle = "#c6ff4d";
  ctx.fillRect(x - 18, y - 30, 36 * clamp(t.hp / t.maxHp, 0, 1), 4);
}

function drawSpike(s: Spike): void {
  const x = sx(s.wx);
  if (x < -60 || x > W + 60) return;
  ctx.fillStyle = s.used ? "#3a3a44" : "#9aa4b5";
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 34 + i * 17, GROUND);
    ctx.lineTo(x - 26 + i * 17, GROUND - 26);
    ctx.lineTo(x - 18 + i * 17, GROUND);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPickup(p: Pickup): void {
  const x = sx(p.wx);
  if (x < -40 || x > W + 40) return;
  const y = GROUND - 34;
  const pulse = 1 + 0.1 * Math.sin(S.time * 5 + p.wx);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = "#5df08a";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#2a6a3a";
  ctx.fillRect(-14, -12, 28, 24);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#5df08a";
  ctx.lineWidth = 2;
  ctx.strokeRect(-14, -12, 28, 24);
  ctx.fillStyle = "#b8ffd0";
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`+${p.amount}`, 0, 4);
  ctx.restore();
}

function drawPlayer(): void {
  const x = PX;
  const y = S.playerY;
  const n = Math.min(12, Math.max(1, Math.round(S.count / 4)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + S.time * 2;
    ctx.fillStyle = "#8fa3b8";
    ctx.beginPath();
    ctx.arc(x - 26 + Math.cos(a) * 16, y + Math.sin(a) * 10, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#aebfd2";
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5f7290";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#35f0d0";
  ctx.fillRect(4, -3, 7, 5);
  ctx.strokeStyle = "#2c3a4f";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, -4);
  ctx.lineTo(24, -4);
  ctx.stroke();
  ctx.restore();
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 4;
  ctx.strokeText(fmt(S.count), x, y - 34);
  ctx.fillStyle = S.count > 40 ? "#5df08a" : S.count > 15 ? "#ffd23c" : "#ff5347";
  ctx.fillText(fmt(S.count), x, y - 34);
}

function draw(): void {
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  drawBg();
  for (const p of S.pickups) drawPickup(p);
  for (const s of S.spikes) drawSpike(s);
  for (const t of S.turrets) drawTurret(t);
  for (const g of S.gates) drawGate(g);
  const sorted = [...S.enemies].sort((a, b) => a.wy - b.wy);
  for (const e of sorted) drawEnemy(e);
  drawPlayer();
  for (const b of S.bullets) {
    const x = sx(b.wx);
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ffe08a";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x, b.wy);
    ctx.lineTo(x - 22, b.wy);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  for (const sp of S.spines) {
    const x = sx(sp.wx);
    ctx.strokeStyle = "#c6ff4d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, sp.wy);
    ctx.lineTo(x - sp.vx * 0.03, sp.wy - sp.vy * 0.03);
    ctx.stroke();
  }
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
    ctx.globalAlpha = clamp(f.life / 1.1, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = `bold ${f.size}px monospace`;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.txt, f.x, f.y);
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (S.bannerT > 0) {
    ctx.globalAlpha = clamp(S.bannerT * 2, 0, 1);
    ctx.fillStyle = "#ffd23c";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 4;
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.strokeText(S.banner, W / 2, 90);
    ctx.fillText(S.banner, W / 2, 90);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "center";
  ctx.font = "bold 14px monospace";
  if (S.started && S.phase === "run") {
    ctx.fillStyle = "#ffd23c";
    ctx.fillText("steer with mouse / W-S / arrows — pick the good gates (+ ×), dodge the bad ones (− ÷)!", W / 2, 26);
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
updateHud();
requestAnimationFrame(loop);
