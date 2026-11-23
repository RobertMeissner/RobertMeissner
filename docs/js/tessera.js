"use strict";
(() => {
  // docs/src/sfx.ts
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

  // docs/src/tessera.ts
  var COLS = 10;
  var ROWS = 10;
  var SIZE = 480;
  var CELL = SIZE / COLS;
  var PALETTE = [187, 45, 280, 120, 0, 220, 30, 160, 320, 200];
  var canvas = document.getElementById("board");
  var ctx2 = canvas.getContext("2d");
  var roundEl = document.getElementById("round");
  var movesEl = document.getElementById("moves");
  var timeEl = document.getElementById("time");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var starsEl = document.getElementById("stars");
  var relicsEl = document.getElementById("relics");
  var streakEl = document.getElementById("streak");
  var trayEl = document.getElementById("tray");
  var undoBtn = document.getElementById("undoBtn");
  var skipBtn = document.getElementById("skipBtn");
  var introEl = document.getElementById("intro");
  var bannerEl = document.getElementById("banner");
  var bannerTitle = document.getElementById("bannerTitle");
  var bannerStats = document.getElementById("bannerStats");
  var nextBtn = document.getElementById("nextBtn");
  var startBtn = document.getElementById("start");
  var board = [];
  var round = null;
  var current = null;
  var placedStack = [];
  var score = 0;
  var totalStars = 0;
  var level = 1;
  var best = Number(localStorage.getItem("rfp_tessera_best") || 0);
  var relics = Number(localStorage.getItem("rfp_tessera_relics") || 0);
  var streak = 0;
  var state = "intro";
  var mouseCol = -1;
  var mouseRow = -1;
  var particles = [];
  var texts = [];
  function normalize(cells) {
    let mx = Infinity;
    let my = Infinity;
    for (const [x, y] of cells) {
      mx = Math.min(mx, x);
      my = Math.min(my, y);
    }
    return cells.map(([x, y]) => [x - mx, y - my]);
  }
  function makePiece(cells, id, hue) {
    const norm = normalize(cells);
    let w = 0;
    let h = 0;
    for (const [x, y] of norm) {
      w = Math.max(w, x + 1);
      h = Math.max(h, y + 1);
    }
    return { id, cells: norm, w, h, hue, placed: false };
  }
  function rotatePiece(p) {
    const cells = normalize(p.cells.map(([x, y]) => [p.h - 1 - y, x]));
    let w = 0;
    let h = 0;
    for (const [x, y] of cells) {
      w = Math.max(w, x + 1);
      h = Math.max(h, y + 1);
    }
    return { id: p.id, cells, w, h, hue: p.hue, placed: p.placed };
  }
  var DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  function pickConnected(pool, total) {
    const cells = Array.from(pool);
    const start = cells[Math.random() * cells.length | 0];
    const out = /* @__PURE__ */ new Set([start]);
    const queue = [start];
    while (queue.length > 0 && out.size < total) {
      const cur = queue.shift();
      const [cx, cy] = cur.split(",").map(Number);
      const dirs = [...DIRS].sort(() => Math.random() - 0.5);
      for (const [dx, dy] of dirs) {
        const k = cx + dx + "," + (cy + dy);
        if (pool.has(k) && !out.has(k)) {
          out.add(k);
          queue.push(k);
          if (out.size >= total) break;
        }
      }
    }
    return out;
  }
  function largestComponent(cells) {
    const seen = /* @__PURE__ */ new Set();
    let best2 = /* @__PURE__ */ new Set();
    for (const start of cells) {
      if (seen.has(start)) continue;
      const comp = /* @__PURE__ */ new Set([start]);
      seen.add(start);
      const stack = [start];
      while (stack.length > 0) {
        const cur = stack.pop();
        const [cx, cy] = cur.split(",").map(Number);
        for (const [dx, dy] of DIRS) {
          const k = cx + dx + "," + (cy + dy);
          if (cells.has(k) && !comp.has(k)) {
            comp.add(k);
            seen.add(k);
            stack.push(k);
          }
        }
      }
      if (comp.size > best2.size) best2 = comp;
    }
    return best2;
  }
  function carvePiece(remaining, size) {
    const comp = largestComponent(remaining);
    const want = Math.min(size, comp.size);
    const keys = Array.from(pickConnected(comp, want));
    for (const k of keys) remaining.delete(k);
    return keys.map((k) => k.split(",").map(Number));
  }
  function genRound(lvl) {
    const count = Math.min(3 + Math.ceil(lvl / 2), 10);
    const maxSize = lvl < 3 ? 4 : lvl < 6 ? 5 : 6;
    const sizes = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const s = 3 + (Math.random() * (maxSize - 2) | 0);
      sizes.push(s);
      total += s;
    }
    while (total > 70) {
      const i = sizes.findIndex((s) => s > 3);
      if (i < 0) break;
      sizes[i]--;
      total--;
    }
    const all = /* @__PURE__ */ new Set();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) all.add(x + "," + y);
    const blob = pickConnected(all, total);
    const target = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    for (const k of blob) {
      const [x, y] = k.split(",").map(Number);
      target[y][x] = true;
    }
    const remaining = new Set(blob);
    const pieces = [];
    let sizeIdx = 0;
    while (remaining.size > 0) {
      const s = sizeIdx < sizes.length ? sizes[sizeIdx++] : Math.min(6, Math.max(3, remaining.size));
      let p = makePiece(carvePiece(remaining, s), pieces.length, PALETTE[pieces.length % PALETTE.length]);
      const rots = Math.random() * 4 | 0;
      for (let i = 0; i < rots; i++) p = rotatePiece(p);
      pieces.push(p);
    }
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    placedStack = [];
    round = { target, pieces, moves: 0, startedAt: performance.now() };
    current = pieces.find((p) => !p.placed) ?? null;
    renderTray();
    updateHud();
  }
  function valid(p, px, py) {
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
  function anchorFromMouse() {
    if (mouseCol < 0 || !current) return null;
    return { px: mouseCol - (current.w >> 1), py: mouseRow - (current.h >> 1) };
  }
  function updateHud() {
    roundEl.textContent = String(level);
    movesEl.textContent = round ? String(round.moves) : "0";
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    starsEl.textContent = `${totalStars} \u2605`;
    relicsEl.textContent = String(relics);
    streakEl.textContent = String(streak);
  }
  function place() {
    if (!current || current.placed || !round || state !== "playing") return;
    const a = anchorFromMouse();
    if (!a || !valid(current, a.px, a.py)) {
      beep(120, 0.08, "sawtooth", 0.04);
      return;
    }
    for (const [x, y] of current.cells) {
      board[a.py + y][a.px + x] = current.hue;
      spawnParticles(a.px + x, a.py + y, current.hue);
    }
    current.placed = true;
    placedStack.push({ p: current, px: a.px, py: a.py });
    round.moves++;
    const left = round.pieces.filter((p) => !p.placed).length;
    beep(520 + (round.pieces.length - left) * 60, 0.06, "square", 0.05);
    if (left > 0) spawnText(`${left} TO GO`, SIZE / 2, SIZE / 2 - 40, "#35f0d0");
    current = round.pieces.find((p) => !p.placed) ?? null;
    renderTray();
    updateHud();
    if (round.pieces.every((p) => p.placed)) completeRound();
  }
  function undo() {
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
  function rotate() {
    if (state !== "playing" || !current || current.placed) return;
    const r = rotatePiece(current);
    current.cells = r.cells;
    current.w = r.w;
    current.h = r.h;
    beep(440, 0.04, "square", 0.04);
  }
  function completeRound() {
    if (!round) return;
    state = "banner";
    const timeSec = (performance.now() - round.startedAt) / 1e3;
    const n = round.pieces.length;
    const stars = round.moves <= n ? 3 : round.moves <= n + 2 ? 2 : 1;
    streak = stars === 3 ? streak + 1 : 0;
    const streakBonus = stars === 3 ? streak * 25 : 0;
    const pts = 100 * level + stars * 50 + Math.max(0, Math.floor(60 - timeSec)) * 2 + streakBonus;
    score += pts;
    totalStars += stars;
    relics++;
    localStorage.setItem("rfp_tessera_relics", String(relics));
    if (score > best) {
      best = score;
      localStorage.setItem("rfp_tessera_best", String(best));
    }
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (round.target[y][x]) spawnParticles(x, y, board[y][x] ?? 187);
    spawnText(`+${pts}`, SIZE / 2, SIZE / 2, "#ffb347");
    chord([523, 659, 784, 1046], 0.3, "triangle", 0.06);
    bannerTitle.textContent = "RELIC COMPLETE " + "\u2605".repeat(stars) + "\u2606".repeat(3 - stars);
    bannerStats.textContent = `round ${level} \xB7 ${round.moves} moves \xB7 ${timeSec.toFixed(1)}s \xB7 +${pts} pts${streakBonus ? ` (streak x${streak} +${streakBonus})` : ""} \xB7 score ${score}`;
    bannerEl.classList.remove("hidden");
    updateHud();
  }
  function nextRound() {
    bannerEl.classList.add("hidden");
    level++;
    state = "playing";
    genRound(level);
  }
  function newGame() {
    score = 0;
    totalStars = 0;
    level = 1;
    streak = 0;
    state = "playing";
    introEl.classList.add("hidden");
    genRound(level);
  }
  function spawnParticles(cx, cy, hue) {
    const now = performance.now();
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: cx * CELL + CELL / 2,
        y: cy * CELL + CELL / 2,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 1,
        hue,
        until: now + 500 + Math.random() * 300
      });
    }
  }
  function spawnText(txt, x, y, color) {
    texts.push({ txt, x, y, color, until: performance.now() + 1200 });
  }
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
  function renderTray() {
    if (!round) return;
    trayEl.innerHTML = "";
    const ordered = [...round.pieces.filter((p) => !p.placed), ...round.pieces.filter((p) => p.placed)];
    for (const p of ordered) {
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
      drawMini(c.getContext("2d"), p, 72);
    }
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
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    ctx2.clearRect(0, 0, SIZE, SIZE);
    ctx2.fillStyle = "rgba(4, 10, 9, 0.92)";
    ctx2.fillRect(0, 0, SIZE, SIZE);
    ctx2.strokeStyle = "rgba(53, 240, 208, 0.1)";
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
    if (round) {
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
          if (round.target[y][x]) {
            ctx2.fillStyle = "rgba(53, 240, 208, 0.07)";
            ctx2.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
            ctx2.strokeStyle = "rgba(53, 240, 208, 0.3)";
            ctx2.strokeRect(x * CELL + 1.5, y * CELL + 1.5, CELL - 3, CELL - 3);
          }
    }
    if (board.length > 0) {
      ctx2.shadowBlur = 8;
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
          if (board[y][x] !== null) {
            ctx2.shadowColor = `hsl(${board[y][x]} 85% 55%)`;
            drawCell(ctx2, x, y, board[y][x], 1, CELL);
          }
      ctx2.shadowBlur = 0;
    }
    if (state === "playing" && current && !current.placed && mouseCol >= 0) {
      const a = anchorFromMouse();
      if (a) {
        const ok = valid(current, a.px, a.py);
        for (const [x, y] of current.cells) drawCell(ctx2, a.px + x, a.py + y, current.hue, ok ? 0.35 : 0.1, CELL);
      }
    }
    particles = particles.filter((p) => now < p.until);
    for (const p of particles) {
      const t = (p.until - now) / 800;
      ctx2.globalAlpha = Math.max(0, t);
      ctx2.fillStyle = `hsl(${p.hue} 90% 65%)`;
      ctx2.fillRect(p.x + p.vx * (1 - t) * 30, p.y + p.vy * (1 - t) * 30, 4, 4);
    }
    ctx2.globalAlpha = 1;
    texts = texts.filter((t) => now < t.until);
    ctx2.textAlign = "center";
    for (const t of texts) {
      const k = (t.until - now) / 1200;
      ctx2.globalAlpha = Math.max(0, k);
      ctx2.fillStyle = t.color;
      ctx2.font = "bold 24px 'Courier New', monospace";
      ctx2.fillText(t.txt, t.x, t.y - (1 - k) * 30);
    }
    ctx2.globalAlpha = 1;
    if (round && state === "playing") timeEl.textContent = ((now - round.startedAt) / 1e3).toFixed(1) + "s";
  }
  updateHud();
  loop();
})();
