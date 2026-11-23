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

  // docs/src/marinerun.ts
  var $ = (id) => document.getElementById(id);
  var canvas = $("scene");
  var ctx2 = canvas.getContext("2d");
  var W = canvas.width;
  var H = canvas.height;
  var GROUND = 470;
  var PX = 170;
  var SAVE_KEY = "rfp_marinerun_best_v1";
  var S;
  var best = 0;
  var fmt = (n) => String(Math.floor(n));
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function applyOp(count, op, val) {
    if (op === "+") return count + val;
    if (op === "-") return Math.max(0, count - val);
    if (op === "\xD7") return count * val;
    return Math.max(1, Math.floor(count / val));
  }
  function rollGateOp() {
    const r = Math.random();
    if (r < 0.35) return { op: "+", val: 10 + Math.floor(Math.random() * 8) * 5 };
    if (r < 0.6) return { op: "-", val: 5 + Math.floor(Math.random() * 6) * 5 };
    if (r < 0.85) return { op: "\xD7", val: 2 + Math.floor(Math.random() * 2) };
    return { op: "\xF7", val: 2 + Math.floor(Math.random() * 2) };
  }
  function reset() {
    S = {
      worldX: 0,
      speed: 200,
      level: 1,
      count: 20,
      playerY: 300,
      targetY: 300,
      fireCd: 0,
      gates: [],
      enemies: [],
      bullets: [],
      spines: [],
      pickups: [],
      spikes: [],
      turrets: [],
      parts: [],
      floats: [],
      nextSpawnX: 700,
      boss: null,
      phase: "run",
      shake: 0,
      banner: "",
      bannerT: 0,
      paused: false,
      started: false,
      time: 0,
      hudT: 0,
      keys: {},
      mouseY: 300
    };
  }
  function loadBest() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return JSON.parse(raw).best ?? 0;
    } catch (e) {
    }
    return 0;
  }
  function saveBest() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ best }));
    } catch (e) {
    }
  }
  function toast(msg) {
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
  function banner(txt) {
    S.banner = txt;
    S.bannerT = 2.2;
  }
  function spark(x, y, color, n, spd = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spd * (0.4 + Math.random());
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.3 + Math.random() * 0.4, max: 0.7, size: 1.5 + Math.random() * 2.5, color });
    }
  }
  function levelEnd() {
    return 3e3 + S.level * 900;
  }
  function spawnGatePair(wx) {
    const a = rollGateOp();
    const b = rollGateOp();
    S.gates.push({ wx, gy: 185, op: a.op, val: a.val, used: false });
    S.gates.push({ wx: wx + 90, gy: 370, op: b.op, val: b.val, used: false });
  }
  function spawnEnemy(wx) {
    const r = Math.random();
    const lvl = S.level;
    if (r < 0.65) {
      S.enemies.push({
        wx,
        wy: GROUND - 22,
        count: Math.round(5 + Math.random() * 18 + lvl * 4),
        maxCount: 0,
        speed: 30 + Math.random() * 50 + lvl * 5,
        r: 24,
        color: "#ff5347",
        type: "zergling",
        ranged: false,
        cd: 0,
        wob: Math.random() * 10,
        dead: false
      });
    } else {
      S.enemies.push({
        wx,
        wy: GROUND - 30,
        count: Math.round(12 + Math.random() * 20 + lvl * 6),
        maxCount: 0,
        speed: 12 + Math.random() * 20,
        r: 30,
        color: "#8ee04f",
        type: "hydralisk",
        ranged: true,
        cd: 1,
        wob: Math.random() * 10,
        dead: false
      });
    }
    const e = S.enemies[S.enemies.length - 1];
    e.maxCount = e.count;
  }
  function spawnBoss(wx) {
    const e = {
      wx,
      wy: GROUND - 46,
      count: 50 + 25 * S.level,
      maxCount: 50 + 25 * S.level,
      speed: 0,
      r: 46,
      color: "#e0447c",
      type: "ultralisk",
      ranged: false,
      cd: 0,
      wob: 0,
      dead: false
    };
    S.boss = e;
    S.enemies.push(e);
    banner(`\u26A0 LEVEL ${S.level} BOSS \u2014 ULTRALISK (${e.count}) \u26A0`);
    beep(70, 0.8, "sawtooth", 0.1, -30);
    S.shake = 12;
  }
  function spawnPattern(wx) {
    const r = Math.random();
    if (r < 0.34) spawnGatePair(wx);
    else if (r < 0.62) spawnEnemy(wx);
    else if (r < 0.74) S.pickups.push({ wx: wx + 40, amount: 5 + Math.floor(Math.random() * 3) * 5 + S.level * 2, taken: false });
    else if (r < 0.86) S.spikes.push({ wx, dmg: 6 + S.level * 2, used: false });
    else if (r < 0.96) S.turrets.push({ wx, hp: 8 + S.level * 3, maxHp: 8 + S.level * 3, cd: 1, dead: false });
  }
  function floatAt(wx, y, txt, color, size = 16) {
    S.floats.push({ x: wx - S.worldX + PX, y, txt, life: 1.1, color, size });
  }
  function gameOver() {
    S.phase = "over";
    best = Math.max(best, Math.floor(S.worldX / 50));
    saveBest();
    S.shake = 20;
    beep(90, 1, "sawtooth", 0.1, -50);
    chord([330, 262, 196, 131], 0.6, "triangle", 0.06);
    $("ovTitle").textContent = "\u{1F480} SQUAD WIPED OUT";
    $("ovText").textContent = `Your squad hit zero at ${fmt(S.worldX / 50)}m on level ${S.level}. Best distance: ${best}m.`;
    $("ovBtn").textContent = "\u21BB RUN AGAIN";
    $("overlay").classList.remove("hidden");
  }
  function startGame() {
    reset();
    S.started = true;
    $("overlay").classList.add("hidden");
    banner("RUN! GUNS HOT \u2014 PICK YOUR GATES");
    chord([392, 523, 659], 0.3, "triangle", 0.06);
    updateHud();
  }
  function levelCleared() {
    banner(`LEVEL ${S.level} CLEARED!`);
    chord([523, 659, 784, 1046], 0.35, "triangle", 0.06);
    toast(`Level ${S.level} cleared! +25 fighters, next level faster & meaner`);
    S.level++;
    S.count = Math.min(999, S.count + 25);
    S.speed += 14;
    S.boss = null;
    S.nextSpawnX = Math.max(S.nextSpawnX, S.worldX + 900);
  }
  function update(dt) {
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
          S.spines.push({ wx: e.wx, wy: e.wy, vx: dx / d * 430, vy: dy / d * 430 });
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
        floatAt(S.worldX, S.playerY - 46, `${g.op}${g.val}: ${before} \u2192 ${S.count}`, good ? "#5df08a" : "#ff5f6e", 18);
        beep(good ? 880 : 240, 0.14, "square", 0.05, good ? 220 : -120);
        if (S.count <= 0) {
          gameOver();
          return;
        }
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
        if (S.count <= 0) {
          gameOver();
          return;
        }
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
        S.spines.push({ wx: t.wx, wy: GROUND - 40, vx: dx / d * 460, vy: dy / d * 460 });
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
        if (S.count <= 0) {
          gameOver();
          return;
        }
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
  function killNote(e) {
    spark(e.wx - S.worldX + PX, e.wy, e.color, e.type === "ultralisk" ? 40 : 14, e.type === "ultralisk" ? 180 : 110);
    if (e.type === "ultralisk") {
      S.shake = Math.max(S.shake, 14);
      beep(60, 0.7, "sawtooth", 0.1, -25);
    } else {
      beep(200 + Math.random() * 120, 0.06, "square", 0.025, -120);
      if (Math.random() < 0.2) S.pickups.push({ wx: e.wx + 30, amount: 5 + Math.floor(Math.random() * 10), taken: false });
    }
  }
  function canvasY(e) {
    const r = canvas.getBoundingClientRect();
    return (e.clientY - r.top) * H / r.height;
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
  window.addEventListener("keyup", (e) => {
    S.keys[e.code] = false;
  });
  $("ovBtn").addEventListener("click", () => startGame());
  $("pauseBtn").addEventListener("click", () => {
    if (S.started && S.phase !== "over") S.paused = !S.paused;
  });
  $("restartBtn").addEventListener("click", () => startGame());
  window.addEventListener("beforeunload", saveBest);
  function updateHud() {
    const c = $("count");
    c.textContent = fmt(S.count);
    c.style.color = S.count > 40 ? "#5df08a" : S.count > 15 ? "#ffd23c" : "#ff5347";
    $("level").textContent = String(S.level);
    $("dist").textContent = `${fmt(S.worldX / 50)}m`;
    $("best").textContent = `${best}m`;
  }
  var RUINS = Array.from({ length: 40 }, (_, i) => ({
    w: 60 + Math.random() * 130,
    h: 60 + Math.random() * 190,
    gap: 200 + Math.random() * 260,
    x: i * 300
  }));
  var STARS2 = Array.from({ length: 80 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (GROUND - 160),
    r: Math.random() * 1.5 + 0.3,
    a: Math.random() * 0.5 + 0.2
  }));
  var sx = (wx) => wx - S.worldX + PX;
  function drawBg() {
    const g = ctx2.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a1024");
    g.addColorStop(0.65, "#131a30");
    g.addColorStop(1, "#1d1430");
    ctx2.fillStyle = g;
    ctx2.fillRect(0, 0, W, H);
    for (const s of STARS2) {
      ctx2.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(S.time * 2 + s.x));
      ctx2.fillStyle = "#cfe6ff";
      ctx2.beginPath();
      ctx2.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx2.fill();
    }
    ctx2.globalAlpha = 1;
    ctx2.fillStyle = "#101828";
    const off = S.worldX * 0.35 % 300;
    for (const r of RUINS) {
      const x = r.x - off - 150;
      if (x > W + 100 || x < -300) continue;
      ctx2.fillRect(x, GROUND - r.h, r.w, r.h);
      ctx2.fillStyle = "#0c1220";
      ctx2.fillRect(x + 10, GROUND - r.h + 12, r.w - 20, 8);
      ctx2.fillStyle = "#101828";
    }
    ctx2.fillStyle = "#1a1410";
    ctx2.fillRect(0, GROUND, W, H - GROUND);
    ctx2.fillStyle = "#2a2015";
    ctx2.fillRect(0, GROUND, W, 6);
    ctx2.strokeStyle = "rgba(255, 210, 60, 0.12)";
    ctx2.lineWidth = 2;
    const coff = S.worldX % 90;
    for (let x = -coff; x < W; x += 90) {
      ctx2.beginPath();
      ctx2.moveTo(x, GROUND + 6);
      ctx2.lineTo(x + 26, H);
      ctx2.stroke();
    }
    ctx2.fillStyle = "#ffd23c";
    ctx2.font = "bold 12px monospace";
    ctx2.textAlign = "left";
    const prog = clamp(S.worldX % levelEnd() / levelEnd(), 0, 1);
    ctx2.fillText(`LEVEL ${S.level} PROGRESS`, 20, H - 14);
    ctx2.fillStyle = "rgba(0,0,0,0.5)";
    ctx2.fillRect(160, H - 20, 200, 8);
    ctx2.fillStyle = "#ffd23c";
    ctx2.fillRect(160, H - 20, 200 * prog, 8);
  }
  function drawGate(g) {
    const x = sx(g.wx);
    if (x < -80 || x > W + 80) return;
    const good = g.op === "+" || g.op === "\xD7";
    const col = g.used ? "#3a4356" : good ? "#5df08a" : "#ff5f6e";
    ctx2.save();
    ctx2.translate(x, g.gy);
    if (!g.used) {
      ctx2.shadowColor = col;
      ctx2.shadowBlur = 14 + 4 * Math.sin(S.time * 4 + g.wx);
    }
    ctx2.strokeStyle = col;
    ctx2.lineWidth = 6;
    ctx2.beginPath();
    ctx2.moveTo(-34, 52);
    ctx2.lineTo(-34, -52);
    ctx2.lineTo(34, -52);
    ctx2.lineTo(34, 52);
    ctx2.stroke();
    ctx2.shadowBlur = 0;
    ctx2.fillStyle = col;
    ctx2.font = "bold 26px monospace";
    ctx2.textAlign = "center";
    ctx2.fillText(`${g.op}${g.val}`, 0, 9);
    ctx2.restore();
  }
  function drawEnemy(e) {
    const x = sx(e.wx);
    if (x < -80 || x > W + 80) return;
    ctx2.save();
    ctx2.translate(x, e.wy);
    ctx2.fillStyle = "rgba(0,0,0,0.35)";
    ctx2.beginPath();
    ctx2.ellipse(0, e.r * 0.75, e.r, e.r * 0.4, 0, 0, Math.PI * 2);
    ctx2.fill();
    const n = Math.min(9, Math.max(3, Math.round(e.count / (e.type === "ultralisk" ? 30 : 5))));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + e.wob * 0.15;
      ctx2.fillStyle = e.color;
      ctx2.beginPath();
      ctx2.arc(Math.cos(a) * e.r * 0.55, Math.sin(a) * e.r * 0.4, e.r * 0.3, 0, Math.PI * 2);
      ctx2.fill();
    }
    ctx2.fillStyle = e.color;
    ctx2.beginPath();
    ctx2.arc(0, 0, e.r * 0.5, 0, Math.PI * 2);
    ctx2.fill();
    if (e.type === "ultralisk") {
      ctx2.fillStyle = "#f0e8d8";
      ctx2.beginPath();
      ctx2.moveTo(-10, -e.r * 0.6);
      ctx2.lineTo(-5, -e.r - 12);
      ctx2.lineTo(0, -e.r * 0.6);
      ctx2.closePath();
      ctx2.fill();
      ctx2.beginPath();
      ctx2.moveTo(10, -e.r * 0.6);
      ctx2.lineTo(5, -e.r - 12);
      ctx2.lineTo(0, -e.r * 0.6);
      ctx2.closePath();
      ctx2.fill();
    }
    ctx2.restore();
    ctx2.font = "bold 15px monospace";
    ctx2.textAlign = "center";
    ctx2.strokeStyle = "rgba(0,0,0,0.85)";
    ctx2.lineWidth = 3;
    ctx2.strokeText(String(Math.ceil(e.count)), x, e.wy - e.r - 8);
    ctx2.fillStyle = "#ffffff";
    ctx2.fillText(String(Math.ceil(e.count)), x, e.wy - e.r - 8);
    if (e.count < e.maxCount) {
      ctx2.fillStyle = "rgba(0,0,0,0.6)";
      ctx2.fillRect(x - 22, e.wy - e.r - 16, 44, 4);
      ctx2.fillStyle = "#ffd23c";
      ctx2.fillRect(x - 22, e.wy - e.r - 16, 44 * clamp(e.count / e.maxCount, 0, 1), 4);
    }
  }
  function drawTurret(t) {
    const x = sx(t.wx);
    if (x < -60 || x > W + 60) return;
    const y = GROUND - 40;
    ctx2.save();
    ctx2.translate(x, y);
    ctx2.fillStyle = "#4a2a3a";
    ctx2.fillRect(-16, -18, 32, 36);
    ctx2.strokeStyle = "#8a4a6a";
    ctx2.lineWidth = 2;
    ctx2.strokeRect(-16, -18, 32, 36);
    ctx2.strokeStyle = "#c6ff4d";
    ctx2.lineWidth = 5;
    ctx2.beginPath();
    ctx2.moveTo(0, -18);
    ctx2.lineTo(-30, -30);
    ctx2.stroke();
    ctx2.restore();
    ctx2.fillStyle = "rgba(0,0,0,0.6)";
    ctx2.fillRect(x - 18, y - 30, 36, 4);
    ctx2.fillStyle = "#c6ff4d";
    ctx2.fillRect(x - 18, y - 30, 36 * clamp(t.hp / t.maxHp, 0, 1), 4);
  }
  function drawSpike(s) {
    const x = sx(s.wx);
    if (x < -60 || x > W + 60) return;
    ctx2.fillStyle = s.used ? "#3a3a44" : "#9aa4b5";
    for (let i = 0; i < 4; i++) {
      ctx2.beginPath();
      ctx2.moveTo(x - 34 + i * 17, GROUND);
      ctx2.lineTo(x - 26 + i * 17, GROUND - 26);
      ctx2.lineTo(x - 18 + i * 17, GROUND);
      ctx2.closePath();
      ctx2.fill();
    }
  }
  function drawPickup(p) {
    const x = sx(p.wx);
    if (x < -40 || x > W + 40) return;
    const y = GROUND - 34;
    const pulse = 1 + 0.1 * Math.sin(S.time * 5 + p.wx);
    ctx2.save();
    ctx2.translate(x, y);
    ctx2.scale(pulse, pulse);
    ctx2.shadowColor = "#5df08a";
    ctx2.shadowBlur = 12;
    ctx2.fillStyle = "#2a6a3a";
    ctx2.fillRect(-14, -12, 28, 24);
    ctx2.shadowBlur = 0;
    ctx2.strokeStyle = "#5df08a";
    ctx2.lineWidth = 2;
    ctx2.strokeRect(-14, -12, 28, 24);
    ctx2.fillStyle = "#b8ffd0";
    ctx2.font = "bold 13px monospace";
    ctx2.textAlign = "center";
    ctx2.fillText(`+${p.amount}`, 0, 4);
    ctx2.restore();
  }
  function drawPlayer() {
    const x = PX;
    const y = S.playerY;
    const n = Math.min(12, Math.max(1, Math.round(S.count / 4)));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + S.time * 2;
      ctx2.fillStyle = "#8fa3b8";
      ctx2.beginPath();
      ctx2.arc(x - 26 + Math.cos(a) * 16, y + Math.sin(a) * 10, 4, 0, Math.PI * 2);
      ctx2.fill();
    }
    ctx2.save();
    ctx2.translate(x, y);
    ctx2.fillStyle = "rgba(0,0,0,0.35)";
    ctx2.beginPath();
    ctx2.ellipse(0, 12, 13, 5, 0, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#aebfd2";
    ctx2.beginPath();
    ctx2.arc(0, 0, 12, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = "#5f7290";
    ctx2.lineWidth = 2;
    ctx2.stroke();
    ctx2.fillStyle = "#35f0d0";
    ctx2.fillRect(4, -3, 7, 5);
    ctx2.strokeStyle = "#2c3a4f";
    ctx2.lineWidth = 5;
    ctx2.beginPath();
    ctx2.moveTo(8, -4);
    ctx2.lineTo(24, -4);
    ctx2.stroke();
    ctx2.restore();
    ctx2.font = "bold 26px monospace";
    ctx2.textAlign = "center";
    ctx2.strokeStyle = "rgba(0,0,0,0.85)";
    ctx2.lineWidth = 4;
    ctx2.strokeText(fmt(S.count), x, y - 34);
    ctx2.fillStyle = S.count > 40 ? "#5df08a" : S.count > 15 ? "#ffd23c" : "#ff5347";
    ctx2.fillText(fmt(S.count), x, y - 34);
  }
  function draw() {
    ctx2.save();
    if (S.shake > 0) ctx2.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
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
      ctx2.strokeStyle = "#ffe08a";
      ctx2.lineWidth = 3;
      ctx2.shadowColor = "#ffe08a";
      ctx2.shadowBlur = 6;
      ctx2.beginPath();
      ctx2.moveTo(x, b.wy);
      ctx2.lineTo(x - 22, b.wy);
      ctx2.stroke();
      ctx2.shadowBlur = 0;
    }
    for (const sp of S.spines) {
      const x = sx(sp.wx);
      ctx2.strokeStyle = "#c6ff4d";
      ctx2.lineWidth = 3;
      ctx2.beginPath();
      ctx2.moveTo(x, sp.wy);
      ctx2.lineTo(x - sp.vx * 0.03, sp.wy - sp.vy * 0.03);
      ctx2.stroke();
    }
    for (const p of S.parts) {
      ctx2.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx2.fillStyle = p.color;
      ctx2.beginPath();
      ctx2.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx2.fill();
    }
    ctx2.globalAlpha = 1;
    ctx2.textAlign = "center";
    for (const f of S.floats) {
      ctx2.globalAlpha = clamp(f.life / 1.1, 0, 1);
      ctx2.fillStyle = f.color;
      ctx2.font = `bold ${f.size}px monospace`;
      ctx2.strokeStyle = "rgba(0,0,0,0.8)";
      ctx2.lineWidth = 3;
      ctx2.strokeText(f.txt, f.x, f.y);
      ctx2.fillText(f.txt, f.x, f.y);
    }
    ctx2.globalAlpha = 1;
    ctx2.restore();
    if (S.bannerT > 0) {
      ctx2.globalAlpha = clamp(S.bannerT * 2, 0, 1);
      ctx2.fillStyle = "#ffd23c";
      ctx2.strokeStyle = "rgba(0,0,0,0.8)";
      ctx2.lineWidth = 4;
      ctx2.font = "bold 28px monospace";
      ctx2.textAlign = "center";
      ctx2.strokeText(S.banner, W / 2, 90);
      ctx2.fillText(S.banner, W / 2, 90);
      ctx2.globalAlpha = 1;
    }
    ctx2.textAlign = "center";
    ctx2.font = "bold 14px monospace";
    if (S.started && S.phase === "run") {
      ctx2.fillStyle = "#ffd23c";
      ctx2.fillText("steer with mouse / W-S / arrows \u2014 pick the good gates (+ \xD7), dodge the bad ones (\u2212 \xF7)!", W / 2, 26);
    }
    if (S.paused && S.started) {
      ctx2.fillStyle = "rgba(0,0,0,0.55)";
      ctx2.fillRect(0, 0, W, H);
      ctx2.fillStyle = "#ffd23c";
      ctx2.font = "bold 30px monospace";
      ctx2.fillText("PAUSED \u2014 press P", W / 2, H / 2);
    }
  }
  var last = performance.now();
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = (now - last) / 1e3;
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
})();
