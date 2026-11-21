import { beep, chord } from "./sfx";

interface Building {
  id: string;
  name: string;
  icon: string;
  desc: string;
  baseCost: number;
}

interface Buildings {
  worker: number;
  chisel: number;
  overseer: number;
  quarry: number;
  architect: number;
  temple: number;
}

interface Scarab {
  x: number;
  y: number;
  until: number;
}

interface PyramidState {
  bricks: number;
  totalEarned: number;
  layer: number;
  buildings: Buildings;
  legacy: number;
  ach: Record<string, boolean>;
  frenzyUntil: number;
  scarab: Scarab | null;
  nextScarabAt: number;
  stats: { clicks: number; scarabs: number; prestiges: number };
  savedAt: number;
}

interface Achievement {
  id: string;
  name: string;
  check: () => boolean;
}

interface FloatFx {
  txt: string;
  x: number;
  y: number;
  until: number;
  color: string;
}

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const canvas = $("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const W = canvas.width;
const H = canvas.height;
const GROUND = H - 70;

const BUILDINGS: Building[] = [
  { id: "worker", name: "Worker", icon: "👷", desc: "+1 brick/s", baseCost: 15 },
  { id: "chisel", name: "Bronze Chisel", icon: "⛏️", desc: "+1 brick per click", baseCost: 100 },
  { id: "overseer", name: "Overseer", icon: "👁️", desc: "+5 bricks/s", baseCost: 750 },
  { id: "quarry", name: "Quarry", icon: "🪨", desc: "+25 bricks/s", baseCost: 5000 },
  { id: "architect", name: "Royal Architect", icon: "📐", desc: "+150 bricks/s", baseCost: 40000 },
  { id: "temple", name: "Temple of Ra", icon: "🏛️", desc: "+1000 bricks/s", baseCost: 500000 },
];

const AGES = ["Predynastic", "Old Kingdom", "First Intermediate", "Middle Kingdom", "New Kingdom", "Ptolemaic"];

const SAVE_KEY = "rfp_pyramids_v1";

function defaultState(): PyramidState {
  return {
    bricks: 0,
    totalEarned: 0,
    layer: 0,
    buildings: { worker: 0, chisel: 0, overseer: 0, quarry: 0, architect: 0, temple: 0 },
    legacy: 0,
    ach: {},
    frenzyUntil: 0,
    scarab: null,
    nextScarabAt: Date.now() + 30000,
    stats: { clicks: 0, scarabs: 0, prestiges: 0 },
    savedAt: Date.now(),
  };
}

function load(): PyramidState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw) as Partial<PyramidState>);
  } catch (e) {}
  return defaultState();
}

let S: PyramidState = load();

const ACH: Achievement[] = [
  { id: "first", name: "First brick carved", check: () => S.stats.clicks >= 1 },
  { id: "c100", name: "100 clicks", check: () => S.stats.clicks >= 100 },
  { id: "b1k", name: "1,000 bricks earned", check: () => S.totalEarned >= 1000 },
  { id: "b1m", name: "1,000,000 bricks earned", check: () => S.totalEarned >= 1e6 },
  { id: "w10", name: "10 workers hired", check: () => S.buildings.worker >= 10 },
  { id: "bps100", name: "100 bricks/s", check: () => bps() >= 100 },
  { id: "l1", name: "First layer laid", check: () => S.layer >= 1 },
  { id: "l10", name: "10 layers — a true monument", check: () => S.layer >= 10 },
  { id: "scarab", name: "Caught the golden scarab", check: () => S.stats.scarabs >= 1 },
  { id: "prestige", name: "New dynasty begun", check: () => S.stats.prestiges >= 1 },
];

function save(): void {
  S.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
  } catch (e) {}
}

const legacyMult = (): number => 1 + 0.5 * S.legacy;
const frenzyActive = (): boolean => Date.now() < S.frenzyUntil;
const bps = (): number =>
  (S.buildings.worker * 1 + S.buildings.overseer * 5 + S.buildings.quarry * 25 + S.buildings.architect * 150 + S.buildings.temple * 1000) *
  (frenzyActive() ? 2 : 1) *
  legacyMult();
const bpc = (): number => (1 + S.buildings.chisel) * legacyMult();
const layerCost = (): number => Math.ceil(50 * Math.pow(2.6, S.layer));
const buildingCost = (id: string): number => {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) return Infinity;
  return Math.ceil(b.baseCost * Math.pow(1.15, S.buildings[id as keyof Buildings]));
};
const prestigeGain = (): number => Math.floor(Math.sqrt(S.totalEarned / 10000));

function fmt(n: number): string {
  if (n < 1000) return Math.floor(n).toString();
  const units = ["k", "M", "B", "T", "Qa", "Qi"];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return n.toFixed(n < 100 ? 2 : 1) + units[u];
}

function toast(msg: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 400);
  }, 3500);
}

function checkAch(): void {
  for (const a of ACH) {
    if (!S.ach[a.id] && a.check()) {
      S.ach[a.id] = true;
      toast(`Achievement unlocked: ${a.name}`);
      beep(1046, 0.15, "triangle", 0.06);
    }
  }
  $("achCount").textContent = `${Object.keys(S.ach).length} / ${ACH.length}`;
}

function renderShop(): void {
  const shop = $("shop");
  shop.innerHTML = "";
  for (const b of BUILDINGS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "build-btn";
    btn.dataset.id = b.id;
    btn.innerHTML = `<span class="b-icon">${b.icon}</span><span class="b-main"><span class="b-name">${b.name} <em>x${S.buildings[b.id as keyof Buildings]}</em></span><span class="b-desc">${b.desc}</span></span><span class="b-cost">${fmt(buildingCost(b.id))} 🧱</span>`;
    btn.addEventListener("click", () => buy(b.id));
    shop.appendChild(btn);
  }
}

function buy(id: string): void {
  const c = buildingCost(id);
  if (S.bricks < c) {
    beep(140, 0.08, "sawtooth", 0.04);
    return;
  }
  S.bricks -= c;
  S.buildings[id as keyof Buildings]++;
  beep(660, 0.08, "square", 0.05);
  chord([440, 554], 0.12, "triangle", 0.04);
  renderShop();
  checkAch();
  updateHud();
}

function updateHud(): void {
  $("bricks").textContent = fmt(S.bricks);
  $("bps").textContent = fmt(bps()) + (frenzyActive() ? " 🔥" : "");
  $("bpc").textContent = fmt(bpc());
  $("layer").textContent = String(S.layer);
  $("age").textContent = AGES[Math.min(Math.floor(S.layer / 3), AGES.length - 1)];
  $("legacy").textContent = String(S.legacy);
  $("layerCost").textContent = fmt(layerCost());
  $("frenzy").textContent = frenzyActive() ? "FESTIVAL: 2x production!" : "";
  $("prestigeGain").textContent = String(prestigeGain());
  const pct = Math.min(100, (S.bricks / layerCost()) * 100);
  ($("layerFill") as HTMLDivElement).style.width = pct + "%";
  for (const btn of Array.from($("shop").children)) {
    const id = (btn as HTMLElement).dataset.id;
    (btn as HTMLButtonElement).disabled = !id || S.bricks < buildingCost(id);
  }
}

let floats: FloatFx[] = [];

$("carveBtn").addEventListener("click", () => {
  const n = Math.max(1, Math.round(bpc()));
  S.bricks += n;
  S.totalEarned += n;
  S.stats.clicks++;
  beep(300 + Math.random() * 120, 0.05, "square", 0.04);
  floats.push({ txt: `+${fmt(n)}`, x: W / 2 + (Math.random() * 80 - 40), y: GROUND - 120, until: performance.now() + 800, color: "#7a4d12" });
  checkAch();
  updateHud();
});

$("prestigeBtn").addEventListener("click", () => {
  const gain = prestigeGain();
  if (gain < 1) {
    beep(140, 0.1, "sawtooth", 0.05);
    toast("Earn at least 10,000 bricks total to found a new dynasty.");
    return;
  }
  if (!confirm(`Begin a new dynasty?\n\nReset bricks, buildings and layers, gain ${gain} Legacy (+${gain * 50}% permanent production).`)) return;
  S.legacy += gain;
  S.stats.prestiges++;
  S.bricks = 0;
  S.totalEarned = 0;
  S.layer = 0;
  S.frenzyUntil = 0;
  for (const id of Object.keys(S.buildings) as (keyof Buildings)[]) S.buildings[id] = 0;
  toast(`New dynasty! Legacy ${S.legacy} — all production x${legacyMult().toFixed(1)}`);
  chord([392, 523, 659, 784], 0.4, "triangle", 0.06);
  renderShop();
  checkAch();
  updateHud();
  save();
});

$("resetLink").addEventListener("click", (e) => {
  e.preventDefault();
  if (confirm("Erase the saved game and start from zero?")) {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
});

canvas.addEventListener("click", (e) => {
  if (!S.scarab) return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * W) / r.width;
  const y = ((e.clientY - r.top) * H) / r.height;
  const s = S.scarab;
  if (Math.hypot(x - s.x, y - s.y) < 28) {
    const bonus = Math.max(Math.round(bpc() * 100), Math.round(bps() * 120), 50);
    S.bricks += bonus;
    S.totalEarned += bonus;
    S.stats.scarabs++;
    toast(`Golden scarab! +${fmt(bonus)} bricks`);
    chord([880, 1108, 1318], 0.2, "triangle", 0.06);
    S.scarab = null;
    S.nextScarabAt = Date.now() + 45000 + Math.random() * 45000;
    checkAch();
    updateHud();
  }
});

let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  const gain = bps() * dt;
  if (gain > 0) {
    S.bricks += gain;
    S.totalEarned += gain;
  }
  if (S.bricks >= layerCost()) {
    S.bricks -= layerCost();
    S.layer++;
    S.frenzyUntil = now + 20000;
    toast(`Layer ${S.layer} complete! Festival — 2x production for 20s`);
    chord([523, 659, 784], 0.25, "triangle", 0.06);
    checkAch();
  }
  if (!S.scarab && now >= S.nextScarabAt) {
    S.scarab = { x: 60 + Math.random() * (W - 120), y: 50 + Math.random() * (H * 0.35), until: now + 10000 };
  }
  if (S.scarab && now > S.scarab.until) {
    S.scarab = null;
    S.nextScarabAt = now + 45000 + Math.random() * 45000;
  }
  checkAch();
  updateHud();
}, 100);

setInterval(save, 5000);
window.addEventListener("beforeunload", save);

function drawPyramid(): void {
  const cell = 16;
  const levelH = 22;
  const levels = S.layer;
  const cx = W / 2;
  for (let i = 0; i < levels; i++) {
    const w = (2 * (levels - i) - 1) * cell;
    const y = GROUND - (i + 1) * levelH;
    ctx.fillStyle = i % 2 ? "#c9a86a" : "#d4b478";
    ctx.fillRect(cx - w / 2, y, w, levelH);
    ctx.strokeStyle = "rgba(122, 77, 18, 0.5)";
    ctx.strokeRect(cx - w / 2, y, w, levelH);
    ctx.beginPath();
    for (let bx = cx - w / 2 + cell; bx < cx + w / 2; bx += cell) {
      ctx.moveTo(bx, y);
      ctx.lineTo(bx, y + levelH);
    }
    ctx.stroke();
  }
  if (levels > 0) {
    const topY = GROUND - levels * levelH;
    ctx.fillStyle = "#e8c33a";
    ctx.beginPath();
    ctx.moveTo(cx - cell / 2, topY);
    ctx.lineTo(cx + cell / 2, topY);
    ctx.lineTo(cx, topY - 14);
    ctx.closePath();
    ctx.fill();
  }
  const nextW = (2 * (levels + 1) - 1) * cell;
  const progress = Math.min(1, S.bricks / layerCost());
  ctx.strokeStyle = "rgba(122, 77, 18, 0.6)";
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(cx - nextW / 2, GROUND - (levels + 1) * levelH, nextW, levelH);
  ctx.setLineDash([]);
  if (progress > 0) {
    ctx.fillStyle = "rgba(201, 168, 106, 0.55)";
    ctx.fillRect(cx - nextW / 2, GROUND - levels * levelH - levelH * progress, nextW, levelH * progress);
  }
}

function drawWorkers(now: number): void {
  const n = Math.min(24, S.buildings.worker + S.buildings.overseer * 2);
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1;
    const span = W - 120;
    const x = 60 + ((now / 40 + i * 97) % span);
    const wx = dir > 0 ? x : W - 60 - x;
    const wy = GROUND;
    ctx.fillStyle = "#5b3a1a";
    ctx.beginPath();
    ctx.arc(wx, wy - 16, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f5f0e0";
    ctx.fillRect(wx - 3, wy - 12, 6, 10);
    if (dir > 0) {
      ctx.fillStyle = "#a87c3f";
      ctx.fillRect(wx + 4, wy - 18, 6, 5);
    }
  }
}

function drawScarab(now: number): void {
  if (!S.scarab) return;
  const s = S.scarab;
  const pulse = 1 + 0.15 * Math.sin(now / 120);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = "#ffd700";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#ffd700";
  ctx.beginPath();
  ctx.ellipse(0, 0, 12, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#8a6d00";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-10, -2);
  ctx.lineTo(-20, -8);
  ctx.moveTo(10, -2);
  ctx.lineTo(20, -8);
  ctx.stroke();
  ctx.restore();
}

function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#f9e3b0");
  sky.addColorStop(0.7, "#eec987");
  sky.addColorStop(1, "#e0b273");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffdf6b";
  ctx.shadowColor = "#ffdf6b";
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(W - 80, 60, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d9b878";
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  ctx.quadraticCurveTo(W * 0.25, GROUND - 40, W * 0.5, GROUND - 10);
  ctx.quadraticCurveTo(W * 0.75, GROUND - 45, W, GROUND - 15);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c9a86a";
  ctx.fillRect(0, GROUND, W, H - GROUND);
  drawPyramid();
  drawWorkers(now);
  drawScarab(now);
  floats = floats.filter((f) => now < f.until);
  ctx.textAlign = "center";
  for (const f of floats) {
    const k = (f.until - now) / 800;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = f.color;
    ctx.font = "bold 16px Georgia, serif";
    ctx.fillText(f.txt, f.x, f.y - (1 - k) * 30);
  }
  ctx.globalAlpha = 1;
}

const away = (Date.now() - S.savedAt) / 1000;
if (away > 60) {
  const gain = Math.floor(bps() * 0.5 * Math.min(away, 8 * 3600));
  if (gain > 0) {
    S.bricks += gain;
    S.totalEarned += gain;
    toast(`While you were away, your workers produced ${fmt(gain)} bricks`);
  }
}

renderShop();
checkAch();
updateHud();
loop();
