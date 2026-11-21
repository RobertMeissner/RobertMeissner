import { beep, chord } from "./sfx";

interface Piece {
  id: number;
  cells: [number, number][];
  w: number;
  h: number;
  hue: number;
  placed: boolean;
}

interface Placed {
  p: Piece;
  px: number;
  py: number;
}

interface Round {
  target: boolean[][];
  pieces: Piece[];
  moves: number;
  startedAt: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  until: number;
}

interface TextFx {
  txt: string;
  x: number;
  y: number;
  color: string;
  until: number;
}

const COLS = 10;
const ROWS = 10;
const SIZE = 480;
const CELL = SIZE / COLS;
const PALETTE = [187, 45, 280, 120, 0, 220, 30, 160, 320, 200];

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const roundEl = document.getElementById("round") as HTMLElement;
const movesEl = document.getElementById("moves") as HTMLElement;
const timeEl = document.getElementById("time") as HTMLElement;
const scoreEl = document.getElementById("score") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const starsEl = document.getElementById("stars") as HTMLElement;
const trayEl = document.getElementById("tray") as HTMLElement;
const undoBtn = document.getElementById("undoBtn") as HTMLButtonElement;
const skipBtn = document.getElementById("skipBtn") as HTMLButtonElement;
const introEl = document.getElementById("intro") as HTMLElement;
const bannerEl = document.getElementById("banner") as HTMLElement;
const bannerTitle = document.getElementById("bannerTitle") as HTMLElement;
const bannerStats = document.getElementById("bannerStats") as HTMLElement;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
const startBtn = document.getElementById("start") as HTMLButtonElement;

let board: (number | null)[][] = [];
let round: Round | null = null;
let current: Piece | null = null;
let placedStack: Placed[] = [];
let score = 0;
let totalStars = 0;
let level = 1;
let best = Number(localStorage.getItem("rfp_tessera_best") || 0);
let state: "intro" | "playing" | "banner" = "intro";
let mouseCol = -1;
let mouseRow = -1;
let particles: Particle[] = [];
let texts: TextFx[] = [];

function normalize(cells: [number, number][]): [number, number][] {
  let mx = Infinity;
  let my = Infinity;
  for (const [x, y] of cells) {
    mx = Math.min(mx, x);
    my = Math.min(my, y);
  }
  return cells.map(([x, y]) => [x - mx, y - my] as [number, number]);
}

function makePiece(cells: [number, number][], id: number, hue: number): Piece {
  const norm = normalize(cells);
  let w = 0;
  let h = 0;
  for (const [x, y] of norm) {
    w = Math.max(w, x + 1);
    h = Math.max(h, y + 1);
  }
  return { id, cells: norm, w, h, hue, placed: false };
}

function rotatePiece(p: Piece): Piece {
  const cells = normalize(p.cells.map(([x, y]) => [p.h - 1 - y, x] as [number, number]));
  let w = 0;
  let h = 0;
  for (const [x, y] of cells) {
    w = Math.max(w, x + 1);
    h = Math.max(h, y + 1);
  }
  return { id: p.id, cells, w, h, hue: p.hue, placed: p.placed };
}

function randomShapeCells(n: number): [number, number][] {
  const cells: [number, number][] = [[0, 0]];
  const set = new Set(["0,0"]);
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let guard = 0;
  while (cells.length < n && guard++ < 500) {
    const [cx, cy] = cells[(Math.random() * cells.length) | 0];
    const [dx, dy] = dirs[(Math.random() * 4) | 0];
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < -8 || nx > 8 || ny < -8 || ny > 8) continue;
    const k = nx + "," + ny;
    if (set.has(k)) continue;
    set.add(k);
    cells.push([nx, ny]);
  }
  return normalize(cells);
}

function genRound(lvl: number): void {
  const target = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const pieces: Piece[] = [];
  const count = Math.min(2 + lvl, 8);
  let guard = 0;
  while (pieces.length < count && guard++ < 800) {
    const size = lvl >= 3 && Math.random() < 0.35 ? 5 : Math.random() < 0.5 ? 4 : 3;
    let p = makePiece(randomShapeCells(size), pieces.length, PALETTE[pieces.length % PALETTE.length]);
    const rots = (Math.random() * 4) | 0;
    for (let i = 0; i < rots; i++) p = rotatePiece(p);
    const px = Math.floor(Math.random() * (COLS - p.w + 1));
    const py = Math.floor(Math.random() * (ROWS - p.h + 1));
    let ok = true;
    for (const [x, y] of p.cells) if (target[py + y][px + x]) { ok = false; break; }
    if (!ok) continue;
    for (const [x, y] of p.cells) target[py + y][px + x] = true;
    pieces.push(p);
  }
  board = Array.from({ length: ROWS }, () => Array<number | null>(COLS).fill(null));
  placedStack = [];
  round = { target, pieces, moves: 0, startedAt: performance.now() };
  current = pieces.find((p) => !p.placed) ?? null;
  renderTray();
  updateHud();
}

function valid(p: Piece, px: number, py: number): boolean {
  if (!round) return false;
  for (const [x, y] of p.cells) {
    const nx = px + x;
    const ny = py + y;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return false;
    if (!round.target[ny][nx]) return false;
    if (board[ny][nx] !== null) return false;
  }
  return true;
}

function anchorFromMouse(): { px: number; py: number } | null {
  if (mouseCol < 0 || !current) return null;
  return { px: mouseCol - (current.w >> 1), py: mouseRow - (current.h >> 1) };
}

function updateHud(): void {
  roundEl.textContent = String(level);
  movesEl.textContent = round ? String(round.moves) : "0";
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  starsEl.textContent = `${totalStars} ★`;
}

function place(): void {
  if (!current || current.placed || !round || state !== "playing") return;
  const a = anchorFromMouse();
  if (!a || !valid(current, a.px, a.py)) {
    beep(120, 0.08, "sawtooth", 0.04);
    return;
  }
  for (const [x, y] of current.cells) board[a.py + y][a.px + x] = current.hue;
  current.placed = true;
  placedStack.push({ p: current, px: a.px, py: a.py });
  round.moves++;
  beep(520, 0.06, "square", 0.05);
  current = round.pieces.find((p) => !p.placed) ?? null;
  renderTray();
  updateHud();
  if (round.pieces.every((p) => p.placed)) completeRound();
}

function undo(): void {
  if (state !== "playing" || !round) return;
  const last = placedStack.pop();
  if (!last) {
    beep(140, 0.06, "sawtooth", 0.03);
    return;
  }
  for (const [x, y] of last.p.cells) board[last.py + y][last.px + x] = null;
  last.p.placed = false;
  current = last.p;
  beep(330, 0.05, "square", 0.04);
  renderTray();
  updateHud();
}

function rotate(): void {
  if (state !== "playing" || !current || current.placed) return;
  current = rotatePiece(current);
  beep(440, 0.04, "square", 0.04);
}

function completeRound(): void {
  if (!round) return;
  state = "banner";
  const timeSec = (performance.now() - round.startedAt) / 1000;
  const n = round.pieces.length;
  const stars = round.moves <= n ? 3 : round.moves <= n + 2 ? 2 : 1;
  const pts = 100 * level + stars * 50 + Math.max(0, Math.floor(60 - timeSec)) * 2;
  score += pts;
  totalStars += stars;
  if (score > best) {
    best = score;
    localStorage.setItem("rfp_tessera_best", String(best));
  }
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (round.target[y][x]) spawnParticles(x, y, board[y][x] ?? 187);
  spawnText(`+${pts}`, SIZE / 2, SIZE / 2, "#ffb347");
  chord([523, 659, 784, 1046], 0.3, "triangle", 0.06);
  bannerTitle.textContent = "RELIC COMPLETE " + "★".repeat(stars) + "☆".repeat(3 - stars);
  bannerStats.textContent = `round ${level} · ${round.moves} moves · ${timeSec.toFixed(1)}s · +${pts} pts · score ${score}`;
  bannerEl.classList.remove("hidden");
  updateHud();
}

function nextRound(): void {
  bannerEl.classList.add("hidden");
  level++;
  state = "playing";
  genRound(level);
}

function newGame(): void {
  score = 0;
  totalStars = 0;
  level = 1;
  state = "playing";
  introEl.classList.add("hidden");
  genRound(level);
}

function spawnParticles(cx: number, cy: number, hue: number): void {
  const now = performance.now();
  for (let i = 0; i < 5; i++) {
    particles.push({
      x: cx * CELL + CELL / 2,
      y: cy * CELL + CELL / 2,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3 - 1,
      hue,
      until: now + 500 + Math.random() * 300,
    });
  }
}

function spawnText(txt: string, x: number, y: number, color: string): void {
  texts.push({ txt, x, y, color, until: performance.now() + 1200 });
}

function drawCell(g: CanvasRenderingContext2D, px: number, py: number, hue: number, alpha: number, size: number): void {
  const pad = Math.max(1, size * 0.06);
  g.globalAlpha = alpha;
  g.fillStyle = `hsl(${hue} 85% 50%)`;
  g.fillRect(px * size + pad, py * size + pad, size - pad * 2, size - pad * 2);
  g.fillStyle = `hsl(${hue} 90% 72%)`;
  g.fillRect(px * size + pad * 2, py * size + pad * 2, size - pad * 4, size - pad * 4);
  g.globalAlpha = 1;
}

function drawMini(g: CanvasRenderingContext2D, piece: Piece | null, canvasSize: number): void {
  g.clearRect(0, 0, canvasSize, canvasSize);
  if (!piece) return;
  const s = Math.min((canvasSize - 12) / piece.w, (canvasSize - 12) / piece.h);
  const ox = (canvasSize - piece.w * s) / 2;
  const oy = (canvasSize - piece.h * s) / 2;
  for (const [x, y] of piece.cells) {
    g.globalAlpha = 0.9;
    g.fillStyle = `hsl(${piece.hue} 85% 55%)`;
    g.fillRect(ox + x * s + 1, oy + y * s + 1, s - 2, s - 2);
  }
  g.globalAlpha = 1;
}

function renderTray(): void {
  if (!round) return;
  trayEl.innerHTML = "";
  for (const p of round.pieces) {
    const c = document.createElement("canvas");
    c.width = 72;
    c.height = 72;
    c.className = "tray-piece" + (p.placed ? " placed" : "") + (current === p ? " selected" : "");
    c.addEventListener("click", () => {
      if (state === "playing" && !p.placed) {
        current = p;
        beep(600, 0.04, "square", 0.03);
        renderTray();
      }
    });
    trayEl.appendChild(c);
    drawMini(c.getContext("2d") as CanvasRenderingContext2D, p, 72);
  }
}

canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * SIZE) / r.width;
  const y = ((e.clientY - r.top) * SIZE) / r.height;
  mouseCol = Math.floor(x / CELL);
  mouseRow = Math.floor(y / CELL);
});
canvas.addEventListener("mouseleave", () => {
  mouseCol = -1;
  mouseRow = -1;
});
canvas.addEventListener("click", place);
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  rotate();
});
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "r") rotate();
  if (k === "u") undo();
  if (k === "enter") {
    if (state === "intro") startBtn.click();
    else if (state === "banner") nextBtn.click();
  }
});

startBtn.addEventListener("click", newGame);
nextBtn.addEventListener("click", nextRound);
undoBtn.addEventListener("click", undo);
skipBtn.addEventListener("click", () => {
  if (state !== "playing") return;
  beep(240, 0.06, "square", 0.04);
  genRound(level);
});

function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "rgba(4, 10, 9, 0.92)";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(53, 240, 208, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 1; i < COLS; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, SIZE);
    ctx.stroke();
  }
  for (let i = 1; i < ROWS; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(SIZE, i * CELL);
    ctx.stroke();
  }
  if (round) {
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (round.target[y][x]) {
          ctx.fillStyle = "rgba(53, 240, 208, 0.07)";
          ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
          ctx.strokeStyle = "rgba(53, 240, 208, 0.3)";
          ctx.strokeRect(x * CELL + 1.5, y * CELL + 1.5, CELL - 3, CELL - 3);
        }
  }
  if (board.length > 0) {
    ctx.shadowBlur = 8;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (board[y][x] !== null) {
          ctx.shadowColor = `hsl(${board[y][x]} 85% 55%)`;
          drawCell(ctx, x, y, board[y][x] as number, 1, CELL);
        }
    ctx.shadowBlur = 0;
  }
  if (state === "playing" && current && !current.placed && mouseCol >= 0) {
    const a = anchorFromMouse();
    if (a) {
      const ok = valid(current, a.px, a.py);
      for (const [x, y] of current.cells) drawCell(ctx, a.px + x, a.py + y, current.hue, ok ? 0.35 : 0.1, CELL);
    }
  }
  particles = particles.filter((p) => now < p.until);
  for (const p of particles) {
    const t = (p.until - now) / 800;
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = `hsl(${p.hue} 90% 65%)`;
    ctx.fillRect(p.x + p.vx * (1 - t) * 30, p.y + p.vy * (1 - t) * 30, 4, 4);
  }
  ctx.globalAlpha = 1;
  texts = texts.filter((t) => now < t.until);
  ctx.textAlign = "center";
  for (const t of texts) {
    const k = (t.until - now) / 1200;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = t.color;
    ctx.font = "bold 24px 'Courier New', monospace";
    ctx.fillText(t.txt, t.x, t.y - (1 - k) * 30);
  }
  ctx.globalAlpha = 1;
  if (round && state === "playing") timeEl.textContent = ((now - round.startedAt) / 1000).toFixed(1) + "s";
}

updateHud();
loop();
