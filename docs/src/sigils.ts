import { beep, chord } from "./sfx";

interface PieceDef {
  cells: [number, number][];
  hue: number;
}

interface Piece {
  cells: [number, number][];
  w: number;
  h: number;
  hue: number;
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

interface Clearing {
  cells: [number, number][];
  until: number;
}

const COLS = 10;
const ROWS = 10;
const SIZE = 480;
const CELL = SIZE / COLS;

const TETROS: Record<string, PieceDef> = {
  I: { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], hue: 187 },
  O: { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], hue: 45 },
  T: { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], hue: 280 },
  S: { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], hue: 120 },
  Z: { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], hue: 0 },
  J: { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], hue: 220 },
  L: { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], hue: 30 },
};
const PENTOS: Record<string, PieceDef> = {
  P: { cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], hue: 160 },
  X: { cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], hue: 320 },
  U: { cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [2, 2]], hue: 200 },
};

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const scoreEl = document.getElementById("score") as HTMLElement;
const linesEl = document.getElementById("lines") as HTMLElement;
const levelEl = document.getElementById("level") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const introEl = document.getElementById("intro") as HTMLElement;
const overEl = document.getElementById("over") as HTMLElement;
const finalScoreEl = document.getElementById("finalScore") as HTMLElement;
const finalLinesEl = document.getElementById("finalLines") as HTMLElement;
const startBtn = document.getElementById("start") as HTMLButtonElement;
const againBtn = document.getElementById("again") as HTMLButtonElement;
const nextEls = Array.from(document.querySelectorAll<HTMLCanvasElement>(".next-piece"));
const holdEl = document.getElementById("hold-piece") as HTMLCanvasElement;
const holdCtx = holdEl.getContext("2d") as CanvasRenderingContext2D;

let board: (number | null)[][] = [];
let queue: Piece[] = [];
let current: Piece | null = null;
let held: Piece | null = null;
let canHold = true;
let score = 0;
let lines = 0;
let level = 1;
let best = Number(localStorage.getItem("rfp_sigils_best") || 0);
let particles: Particle[] = [];
let texts: TextFx[] = [];
let clearing: Clearing | null = null;
let state: "intro" | "playing" | "over" = "intro";
let mouseCol = -1;
let mouseRow = -1;
let combo = 0;
let lastClearAt = 0;

function makePiece(def: PieceDef): Piece {
  const cells = def.cells.map((c) => c.slice() as [number, number]);
  let w = 0;
  let h = 0;
  for (const [x, y] of cells) {
    w = Math.max(w, x + 1);
    h = Math.max(h, y + 1);
  }
  return { cells, w, h, hue: def.hue };
}

function rotatePiece(p: Piece): Piece {
  const cells = p.cells.map(([x, y]): [number, number] => [p.h - 1 - y, x]);
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  return makePiece({ cells: cells.map(([x, y]) => [x - minX, y - minY] as [number, number]), hue: p.hue });
}

function poolForLevel(l: number): PieceDef[] {
  const defs = Object.values(TETROS);
  if (l >= 2) defs.push(PENTOS.P, PENTOS.X);
  if (l >= 4) defs.push(PENTOS.U);
  return defs;
}

function randomPiece(): Piece {
  const pool = poolForLevel(level);
  return makePiece(pool[(Math.random() * pool.length) | 0]);
}

function valid(p: Piece, px: number, py: number): boolean {
  for (const [x, y] of p.cells) {
    const nx = px + x;
    const ny = py + y;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || board[ny][nx]) return false;
  }
  return true;
}

function canPlaceAnywhere(p: Piece): boolean {
  let q = p;
  for (let r = 0; r < 4; r++) {
    for (let py = 0; py < ROWS; py++)
      for (let px = 0; px < COLS; px++) if (valid(q, px, py)) return true;
    q = rotatePiece(q);
  }
  return false;
}

function updateHud(): void {
  scoreEl.textContent = String(score);
  linesEl.textContent = String(lines);
  levelEl.textContent = String(level);
  bestEl.textContent = String(best);
}

function newGame(): void {
  board = Array.from({ length: ROWS }, () => Array<number | null>(COLS).fill(null));
  level = 1;
  score = 0;
  lines = 0;
  combo = 0;
  queue = [randomPiece(), randomPiece(), randomPiece()];
  current = queue.shift() ?? null;
  queue.push(randomPiece());
  held = null;
  canHold = true;
  particles = [];
  texts = [];
  clearing = null;
  state = "playing";
  updateHud();
  drawNext();
  drawHold();
}

function anchorFromMouse(): { px: number; py: number } | null {
  if (mouseCol < 0 || !current) return null;
  return { px: mouseCol - (current.w >> 1), py: mouseRow - (current.h >> 1) };
}

function findClears(): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let y = 0; y < ROWS; y++) if (board[y].every((c) => c)) rows.push(y);
  for (let x = 0; x < COLS; x++) {
    let full = true;
    for (let y = 0; y < ROWS; y++) if (!board[y][x]) { full = false; break; }
    if (full) cols.push(x);
  }
  return { rows, cols };
}

function spawnParticles(cx: number, cy: number, hue: number): void {
  const now = performance.now();
  for (let i = 0; i < 6; i++) {
    particles.push({
      x: cx * CELL + CELL / 2,
      y: cy * CELL + CELL / 2,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3 - 1,
      hue,
      until: now + 450 + Math.random() * 250,
    });
  }
}

function spawnText(txt: string, x: number, y: number, color: string): void {
  texts.push({ txt, x, y, color, until: performance.now() + 1100 });
}

function startClear(rows: number[], cols: number[]): void {
  const set = new Set<string>();
  for (const y of rows) for (let x = 0; x < COLS; x++) set.add(x + "," + y);
  for (const x of cols) for (let y = 0; y < ROWS; y++) set.add(x + "," + y);
  clearing = { cells: [...set].map((s) => s.split(",").map(Number) as [number, number]), until: performance.now() + 320 };
  const n = rows.length + cols.length;
  const now = performance.now();
  combo = now - lastClearAt < 1200 ? combo + 1 : 1;
  lastClearAt = now;
  const pts = 100 * n * n * level * combo;
  score += pts;
  lines += n;
  if (clearing) for (const [x, y] of clearing.cells) spawnParticles(x, y, current?.hue ?? 0);
  spawnText(combo > 1 ? `COMBO x${combo}  +${pts}` : `+${pts}`, SIZE / 2, 70, combo > 1 ? "#ffb347" : "#66ffcc");
  if (n > 1 || combo > 1) chord([523, 659, 784, 1046], 0.2, "triangle", 0.05);
  else beep(880, 0.12, "triangle", 0.05, 220);
  const newLevel = 1 + Math.floor(lines / 5);
  if (newLevel > level) {
    level = newLevel;
    spawnText(`LEVEL ${level}`, SIZE / 2, SIZE / 2, "#9fc7ff");
    chord([392, 523, 659], 0.3, "square", 0.05);
  }
  updateHud();
}

function finalizeClear(): void {
  if (!clearing) return;
  for (const [x, y] of clearing.cells) board[y][x] = null;
  clearing = null;
}

function checkGameOver(): void {
  if (!current || canPlaceAnywhere(current)) return;
  state = "over";
  if (score > best) {
    best = score;
    localStorage.setItem("rfp_sigils_best", String(best));
  }
  updateHud();
  beep(160, 0.5, "sawtooth", 0.06, -100);
  setTimeout(() => {
    finalScoreEl.textContent = String(score);
    finalLinesEl.textContent = String(lines);
    overEl.classList.remove("hidden");
  }, 550);
}

function advance(): void {
  current = queue.shift() ?? null;
  queue.push(randomPiece());
  canHold = true;
  drawNext();
  updateHud();
  checkGameOver();
}

function place(): void {
  if (!current) return;
  const a = anchorFromMouse();
  if (!a || !valid(current, a.px, a.py)) {
    beep(120, 0.08, "sawtooth", 0.04);
    return;
  }
  for (const [x, y] of current.cells) board[a.py + y][a.px + x] = current.hue;
  score += 10;
  beep(520, 0.06, "square", 0.05);
  const { rows, cols } = findClears();
  if (rows.length || cols.length) startClear(rows, cols);
  advance();
}

function rotate(): void {
  if (state !== "playing" || !current) return;
  current = rotatePiece(current);
  beep(440, 0.04, "square", 0.04);
}

function hold(): void {
  if (state !== "playing" || !canHold || !current) return;
  beep(300, 0.05, "square", 0.04);
  if (!held) {
    held = current;
    current = queue.shift() ?? null;
    queue.push(randomPiece());
  } else {
    const t = held;
    held = current;
    current = t;
  }
  canHold = false;
  drawHold();
  drawNext();
  checkGameOver();
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
canvas.addEventListener("click", () => {
  if (state === "playing") place();
});
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  rotate();
});
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "r") rotate();
  if (k === "c") hold();
  if (k === "enter" && state !== "playing") startBtn.click();
});

startBtn.addEventListener("click", () => {
  introEl.classList.add("hidden");
  newGame();
});
againBtn.addEventListener("click", () => {
  overEl.classList.add("hidden");
  newGame();
});

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

function drawNext(): void {
  nextEls.forEach((c, i) => drawMini(c.getContext("2d") as CanvasRenderingContext2D, queue[i] ?? null, 72));
}

function drawHold(): void {
  drawMini(holdCtx, held, 72);
}

function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "rgba(4, 10, 9, 0.92)";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(53, 240, 208, 0.12)";
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
  if (board.length === 0) return;
  ctx.shadowBlur = 8;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (board[y][x] !== null) {
        ctx.shadowColor = `hsl(${board[y][x]} 85% 55%)`;
        drawCell(ctx, x, y, board[y][x] as number, 1, CELL);
      }
  ctx.shadowBlur = 0;
  if (clearing) {
    const a = 0.4 + 0.4 * Math.sin(now / 40);
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    for (const [x, y] of clearing.cells) ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    if (now >= clearing.until) finalizeClear();
  }
  if (state === "playing" && current && mouseCol >= 0) {
    const a = anchorFromMouse();
    if (a) {
      const ok = valid(current, a.px, a.py);
      for (const [x, y] of current.cells) drawCell(ctx, a.px + x, a.py + y, current.hue, ok ? 0.35 : 0.1, CELL);
    }
  }
  particles = particles.filter((p) => now < p.until);
  for (const p of particles) {
    const t = (p.until - now) / 700;
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = `hsl(${p.hue} 90% 65%)`;
    ctx.fillRect(p.x + p.vx * (1 - t) * 30, p.y + p.vy * (1 - t) * 30, 4, 4);
  }
  ctx.globalAlpha = 1;
  texts = texts.filter((t) => now < t.until);
  ctx.textAlign = "center";
  for (const t of texts) {
    const k = (t.until - now) / 1100;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = t.color;
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.fillText(t.txt, t.x, t.y - (1 - k) * 30);
  }
  ctx.globalAlpha = 1;
}

updateHud();
loop();
