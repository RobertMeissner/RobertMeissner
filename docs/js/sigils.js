"use strict";
(() => {
  // src/sfx.ts
  var ctx = null;
  function ensureAudio() {
    if (!ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) throw new Error("WebAudio not supported");
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function beep(freq = 440, dur = 0.08, type = "square", vol = 0.05, slide = 0) {
    try {
      const a = ensureAudio();
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(1e-4, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch (e) {
    }
  }
  function chord(freqs, dur = 0.25, type = "triangle", vol = 0.06) {
    freqs.forEach((f, i) => setTimeout(() => beep(f, dur, type, vol), i * 45));
  }

  // src/sigils.ts
  var COLS = 10;
  var ROWS = 10;
  var SIZE = 480;
  var CELL = SIZE / COLS;
  var TETROS = {
    I: { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], hue: 187 },
    O: { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], hue: 45 },
    T: { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], hue: 280 },
    S: { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], hue: 120 },
    Z: { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], hue: 0 },
    J: { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], hue: 220 },
    L: { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], hue: 30 }
  };
  var PENTOS = {
    P: { cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], hue: 160 },
    X: { cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], hue: 320 },
    U: { cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [2, 2]], hue: 200 }
  };
  var canvas = document.getElementById("board");
  var ctx2 = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var linesEl = document.getElementById("lines");
  var levelEl = document.getElementById("level");
  var bestEl = document.getElementById("best");
  var introEl = document.getElementById("intro");
  var overEl = document.getElementById("over");
  var finalScoreEl = document.getElementById("finalScore");
  var finalLinesEl = document.getElementById("finalLines");
  var startBtn = document.getElementById("start");
  var againBtn = document.getElementById("again");
  var nextEls = Array.from(document.querySelectorAll(".next-piece"));
  var holdEl = document.getElementById("hold-piece");
  var holdCtx = holdEl.getContext("2d");
  var board = [];
  var queue = [];
  var current = null;
  var held = null;
  var canHold = true;
  var score = 0;
  var lines = 0;
  var level = 1;
  var best = Number(localStorage.getItem("rfp_sigils_best") || 0);
  var particles = [];
  var texts = [];
  var clearing = null;
  var state = "intro";
  var mouseCol = -1;
  var mouseRow = -1;
  var combo = 0;
  var lastClearAt = 0;
  function makePiece(def) {
    const cells = def.cells.map((c) => c.slice());
    let w = 0;
    let h = 0;
    for (const [x, y] of cells) {
      w = Math.max(w, x + 1);
      h = Math.max(h, y + 1);
    }
    return { cells, w, h, hue: def.hue };
  }
  function rotatePiece(p) {
    const cells = p.cells.map(([x, y]) => [p.h - 1 - y, x]);
    let minX = Infinity;
    let minY = Infinity;
    for (const [x, y] of cells) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }
    return makePiece({ cells: cells.map(([x, y]) => [x - minX, y - minY]), hue: p.hue });
  }
  function poolForLevel(l) {
    const defs = Object.values(TETROS);
    if (l >= 2) defs.push(PENTOS.P, PENTOS.X);
    if (l >= 4) defs.push(PENTOS.U);
    return defs;
  }
  function randomPiece() {
    const pool = poolForLevel(level);
    return makePiece(pool[Math.random() * pool.length | 0]);
  }
  function valid(p, px, py) {
    for (const [x, y] of p.cells) {
      const nx = px + x;
      const ny = py + y;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || board[ny][nx]) return false;
    }
    return true;
  }
  function canPlaceAnywhere(p) {
    let q = p;
    for (let r = 0; r < 4; r++) {
      for (let py = 0; py < ROWS; py++)
        for (let px = 0; px < COLS; px++) if (valid(q, px, py)) return true;
      q = rotatePiece(q);
    }
    return false;
  }
  function updateHud() {
    scoreEl.textContent = String(score);
    linesEl.textContent = String(lines);
    levelEl.textContent = String(level);
    bestEl.textContent = String(best);
  }
  function newGame() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
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
  function anchorFromMouse() {
    if (mouseCol < 0 || !current) return null;
    return { px: mouseCol - (current.w >> 1), py: mouseRow - (current.h >> 1) };
  }
  function findClears() {
    const rows = [];
    const cols = [];
    for (let y = 0; y < ROWS; y++) if (board[y].every((c) => c)) rows.push(y);
    for (let x = 0; x < COLS; x++) {
      let full = true;
      for (let y = 0; y < ROWS; y++) if (!board[y][x]) {
        full = false;
        break;
      }
      if (full) cols.push(x);
    }
    return { rows, cols };
  }
  function spawnParticles(cx, cy, hue) {
    const now = performance.now();
    for (let i = 0; i < 6; i++) {
      particles.push({
        x: cx * CELL + CELL / 2,
        y: cy * CELL + CELL / 2,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 1,
        hue,
        until: now + 450 + Math.random() * 250
      });
    }
  }
  function spawnText(txt, x, y, color) {
    texts.push({ txt, x, y, color, until: performance.now() + 1100 });
  }
  function startClear(rows, cols) {
    const set = /* @__PURE__ */ new Set();
    for (const y of rows) for (let x = 0; x < COLS; x++) set.add(x + "," + y);
    for (const x of cols) for (let y = 0; y < ROWS; y++) set.add(x + "," + y);
    clearing = { cells: [...set].map((s) => s.split(",").map(Number)), until: performance.now() + 320 };
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
  function finalizeClear() {
    if (!clearing) return;
    for (const [x, y] of clearing.cells) board[y][x] = null;
    clearing = null;
  }
  function checkGameOver() {
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
  function advance() {
    current = queue.shift() ?? null;
    queue.push(randomPiece());
    canHold = true;
    drawNext();
    updateHud();
    checkGameOver();
  }
  function place() {
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
  function rotate() {
    if (state !== "playing" || !current) return;
    current = rotatePiece(current);
    beep(440, 0.04, "square", 0.04);
  }
  function hold() {
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
    const x = (e.clientX - r.left) * SIZE / r.width;
    const y = (e.clientY - r.top) * SIZE / r.height;
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
  function drawCell(g, px, py, hue, alpha, size) {
    const pad = Math.max(1, size * 0.06);
    g.globalAlpha = alpha;
    g.fillStyle = `hsl(${hue} 85% 50%)`;
    g.fillRect(px * size + pad, py * size + pad, size - pad * 2, size - pad * 2);
    g.fillStyle = `hsl(${hue} 90% 72%)`;
    g.fillRect(px * size + pad * 2, py * size + pad * 2, size - pad * 4, size - pad * 4);
    g.globalAlpha = 1;
  }
  function drawMini(g, piece, canvasSize) {
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
  function drawNext() {
    nextEls.forEach((c, i) => drawMini(c.getContext("2d"), queue[i] ?? null, 72));
  }
  function drawHold() {
    drawMini(holdCtx, held, 72);
  }
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    ctx2.clearRect(0, 0, SIZE, SIZE);
    ctx2.fillStyle = "rgba(4, 10, 9, 0.92)";
    ctx2.fillRect(0, 0, SIZE, SIZE);
    ctx2.strokeStyle = "rgba(53, 240, 208, 0.12)";
    ctx2.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx2.beginPath();
      ctx2.moveTo(i * CELL, 0);
      ctx2.lineTo(i * CELL, SIZE);
      ctx2.stroke();
    }
    for (let i = 1; i < ROWS; i++) {
      ctx2.beginPath();
      ctx2.moveTo(0, i * CELL);
      ctx2.lineTo(SIZE, i * CELL);
      ctx2.stroke();
    }
    if (board.length === 0) return;
    ctx2.shadowBlur = 8;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (board[y][x] !== null) {
          ctx2.shadowColor = `hsl(${board[y][x]} 85% 55%)`;
          drawCell(ctx2, x, y, board[y][x], 1, CELL);
        }
    ctx2.shadowBlur = 0;
    if (clearing) {
      const a = 0.4 + 0.4 * Math.sin(now / 40);
      ctx2.fillStyle = `rgba(255, 255, 255, ${a})`;
      for (const [x, y] of clearing.cells) ctx2.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      if (now >= clearing.until) finalizeClear();
    }
    if (state === "playing" && current && mouseCol >= 0) {
      const a = anchorFromMouse();
      if (a) {
        const ok = valid(current, a.px, a.py);
        for (const [x, y] of current.cells) drawCell(ctx2, a.px + x, a.py + y, current.hue, ok ? 0.35 : 0.1, CELL);
      }
    }
    particles = particles.filter((p) => now < p.until);
    for (const p of particles) {
      const t = (p.until - now) / 700;
      ctx2.globalAlpha = Math.max(0, t);
      ctx2.fillStyle = `hsl(${p.hue} 90% 65%)`;
      ctx2.fillRect(p.x + p.vx * (1 - t) * 30, p.y + p.vy * (1 - t) * 30, 4, 4);
    }
    ctx2.globalAlpha = 1;
    texts = texts.filter((t) => now < t.until);
    ctx2.textAlign = "center";
    for (const t of texts) {
      const k = (t.until - now) / 1100;
      ctx2.globalAlpha = Math.max(0, k);
      ctx2.fillStyle = t.color;
      ctx2.font = "bold 22px 'Courier New', monospace";
      ctx2.fillText(t.txt, t.x, t.y - (1 - k) * 30);
    }
    ctx2.globalAlpha = 1;
  }
  updateHud();
  loop();
})();
