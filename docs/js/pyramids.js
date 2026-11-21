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

  // src/pyramids.ts
  var $ = (id) => document.getElementById(id);
  var canvas = $("scene");
  var ctx2 = canvas.getContext("2d");
  var W = canvas.width;
  var H = canvas.height;
  var GROUND = H - 70;
  var BUILDINGS = [
    { id: "worker", name: "Worker", icon: "\u{1F477}", desc: "+1 brick/s", baseCost: 15 },
    { id: "chisel", name: "Bronze Chisel", icon: "\u26CF\uFE0F", desc: "+1 brick per click", baseCost: 100 },
    { id: "overseer", name: "Overseer", icon: "\u{1F441}\uFE0F", desc: "+5 bricks/s", baseCost: 750 },
    { id: "quarry", name: "Quarry", icon: "\u{1FAA8}", desc: "+25 bricks/s", baseCost: 5e3 },
    { id: "architect", name: "Royal Architect", icon: "\u{1F4D0}", desc: "+150 bricks/s", baseCost: 4e4 },
    { id: "temple", name: "Temple of Ra", icon: "\u{1F3DB}\uFE0F", desc: "+1000 bricks/s", baseCost: 5e5 }
  ];
  var AGES = ["Predynastic", "Old Kingdom", "First Intermediate", "Middle Kingdom", "New Kingdom", "Ptolemaic"];
  var SAVE_KEY = "rfp_pyramids_v1";
  function defaultState() {
    return {
      bricks: 0,
      totalEarned: 0,
      layer: 0,
      buildings: { worker: 0, chisel: 0, overseer: 0, quarry: 0, architect: 0, temple: 0 },
      legacy: 0,
      ach: {},
      frenzyUntil: 0,
      scarab: null,
      nextScarabAt: Date.now() + 3e4,
      stats: { clicks: 0, scarabs: 0, prestiges: 0 },
      savedAt: Date.now()
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {
    }
    return defaultState();
  }
  var S = load();
  var ACH = [
    { id: "first", name: "First brick carved", check: () => S.stats.clicks >= 1 },
    { id: "c100", name: "100 clicks", check: () => S.stats.clicks >= 100 },
    { id: "b1k", name: "1,000 bricks earned", check: () => S.totalEarned >= 1e3 },
    { id: "b1m", name: "1,000,000 bricks earned", check: () => S.totalEarned >= 1e6 },
    { id: "w10", name: "10 workers hired", check: () => S.buildings.worker >= 10 },
    { id: "bps100", name: "100 bricks/s", check: () => bps() >= 100 },
    { id: "l1", name: "First layer laid", check: () => S.layer >= 1 },
    { id: "l10", name: "10 layers \u2014 a true monument", check: () => S.layer >= 10 },
    { id: "scarab", name: "Caught the golden scarab", check: () => S.stats.scarabs >= 1 },
    { id: "prestige", name: "New dynasty begun", check: () => S.stats.prestiges >= 1 }
  ];
  function save() {
    S.savedAt = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    } catch (e) {
    }
  }
  var legacyMult = () => 1 + 0.5 * S.legacy;
  var frenzyActive = () => Date.now() < S.frenzyUntil;
  var bps = () => (S.buildings.worker * 1 + S.buildings.overseer * 5 + S.buildings.quarry * 25 + S.buildings.architect * 150 + S.buildings.temple * 1e3) * (frenzyActive() ? 2 : 1) * legacyMult();
  var bpc = () => (1 + S.buildings.chisel) * legacyMult();
  var layerCost = () => Math.ceil(50 * Math.pow(2.6, S.layer));
  var buildingCost = (id) => {
    const b = BUILDINGS.find((x) => x.id === id);
    if (!b) return Infinity;
    return Math.ceil(b.baseCost * Math.pow(1.15, S.buildings[id]));
  };
  var prestigeGain = () => Math.floor(Math.sqrt(S.totalEarned / 1e4));
  function fmt(n) {
    if (n < 1e3) return Math.floor(n).toString();
    const units = ["k", "M", "B", "T", "Qa", "Qi"];
    let u = -1;
    while (n >= 1e3 && u < units.length - 1) {
      n /= 1e3;
      u++;
    }
    return n.toFixed(n < 100 ? 2 : 1) + units[u];
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
  function checkAch() {
    for (const a of ACH) {
      if (!S.ach[a.id] && a.check()) {
        S.ach[a.id] = true;
        toast(`Achievement unlocked: ${a.name}`);
        beep(1046, 0.15, "triangle", 0.06);
      }
    }
    $("achCount").textContent = `${Object.keys(S.ach).length} / ${ACH.length}`;
  }
  function renderShop() {
    const shop = $("shop");
    shop.innerHTML = "";
    for (const b of BUILDINGS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "build-btn";
      btn.dataset.id = b.id;
      btn.innerHTML = `<span class="b-icon">${b.icon}</span><span class="b-main"><span class="b-name">${b.name} <em>x${S.buildings[b.id]}</em></span><span class="b-desc">${b.desc}</span></span><span class="b-cost">${fmt(buildingCost(b.id))} \u{1F9F1}</span>`;
      btn.addEventListener("click", () => buy(b.id));
      shop.appendChild(btn);
    }
  }
  function buy(id) {
    const c = buildingCost(id);
    if (S.bricks < c) {
      beep(140, 0.08, "sawtooth", 0.04);
      return;
    }
    S.bricks -= c;
    S.buildings[id]++;
    beep(660, 0.08, "square", 0.05);
    chord([440, 554], 0.12, "triangle", 0.04);
    renderShop();
    checkAch();
    updateHud();
  }
  function updateHud() {
    $("bricks").textContent = fmt(S.bricks);
    $("bps").textContent = fmt(bps()) + (frenzyActive() ? " \u{1F525}" : "");
    $("bpc").textContent = fmt(bpc());
    $("layer").textContent = String(S.layer);
    $("age").textContent = AGES[Math.min(Math.floor(S.layer / 3), AGES.length - 1)];
    $("legacy").textContent = String(S.legacy);
    $("layerCost").textContent = fmt(layerCost());
    $("frenzy").textContent = frenzyActive() ? "FESTIVAL: 2x production!" : "";
    $("prestigeGain").textContent = String(prestigeGain());
    const pct = Math.min(100, S.bricks / layerCost() * 100);
    $("layerFill").style.width = pct + "%";
    for (const btn of Array.from($("shop").children)) {
      const id = btn.dataset.id;
      btn.disabled = !id || S.bricks < buildingCost(id);
    }
  }
  var floats = [];
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
    if (!confirm(`Begin a new dynasty?

Reset bricks, buildings and layers, gain ${gain} Legacy (+${gain * 50}% permanent production).`)) return;
    S.legacy += gain;
    S.stats.prestiges++;
    S.bricks = 0;
    S.totalEarned = 0;
    S.layer = 0;
    S.frenzyUntil = 0;
    for (const id of Object.keys(S.buildings)) S.buildings[id] = 0;
    toast(`New dynasty! Legacy ${S.legacy} \u2014 all production x${legacyMult().toFixed(1)}`);
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
    const x = (e.clientX - r.left) * W / r.width;
    const y = (e.clientY - r.top) * H / r.height;
    const s = S.scarab;
    if (Math.hypot(x - s.x, y - s.y) < 28) {
      const bonus = Math.max(Math.round(bpc() * 100), Math.round(bps() * 120), 50);
      S.bricks += bonus;
      S.totalEarned += bonus;
      S.stats.scarabs++;
      toast(`Golden scarab! +${fmt(bonus)} bricks`);
      chord([880, 1108, 1318], 0.2, "triangle", 0.06);
      S.scarab = null;
      S.nextScarabAt = Date.now() + 45e3 + Math.random() * 45e3;
      checkAch();
      updateHud();
    }
  });
  var lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1e3;
    lastTick = now;
    const gain = bps() * dt;
    if (gain > 0) {
      S.bricks += gain;
      S.totalEarned += gain;
    }
    if (S.bricks >= layerCost()) {
      S.bricks -= layerCost();
      S.layer++;
      S.frenzyUntil = now + 2e4;
      toast(`Layer ${S.layer} complete! Festival \u2014 2x production for 20s`);
      chord([523, 659, 784], 0.25, "triangle", 0.06);
      checkAch();
    }
    if (!S.scarab && now >= S.nextScarabAt) {
      S.scarab = { x: 60 + Math.random() * (W - 120), y: 50 + Math.random() * (H * 0.35), until: now + 1e4 };
    }
    if (S.scarab && now > S.scarab.until) {
      S.scarab = null;
      S.nextScarabAt = now + 45e3 + Math.random() * 45e3;
    }
    checkAch();
    updateHud();
  }, 100);
  setInterval(save, 5e3);
  window.addEventListener("beforeunload", save);
  function drawPyramid() {
    const cell = 16;
    const levelH = 22;
    const levels = S.layer;
    const cx = W / 2;
    for (let i = 0; i < levels; i++) {
      const w = (2 * (levels - i) - 1) * cell;
      const y = GROUND - (i + 1) * levelH;
      ctx2.fillStyle = i % 2 ? "#c9a86a" : "#d4b478";
      ctx2.fillRect(cx - w / 2, y, w, levelH);
      ctx2.strokeStyle = "rgba(122, 77, 18, 0.5)";
      ctx2.strokeRect(cx - w / 2, y, w, levelH);
      ctx2.beginPath();
      for (let bx = cx - w / 2 + cell; bx < cx + w / 2; bx += cell) {
        ctx2.moveTo(bx, y);
        ctx2.lineTo(bx, y + levelH);
      }
      ctx2.stroke();
    }
    if (levels > 0) {
      const topY = GROUND - levels * levelH;
      ctx2.fillStyle = "#e8c33a";
      ctx2.beginPath();
      ctx2.moveTo(cx - cell / 2, topY);
      ctx2.lineTo(cx + cell / 2, topY);
      ctx2.lineTo(cx, topY - 14);
      ctx2.closePath();
      ctx2.fill();
    }
    const nextW = (2 * (levels + 1) - 1) * cell;
    const progress = Math.min(1, S.bricks / layerCost());
    ctx2.strokeStyle = "rgba(122, 77, 18, 0.6)";
    ctx2.setLineDash([4, 4]);
    ctx2.strokeRect(cx - nextW / 2, GROUND - (levels + 1) * levelH, nextW, levelH);
    ctx2.setLineDash([]);
    if (progress > 0) {
      ctx2.fillStyle = "rgba(201, 168, 106, 0.55)";
      ctx2.fillRect(cx - nextW / 2, GROUND - levels * levelH - levelH * progress, nextW, levelH * progress);
    }
  }
  function drawWorkers(now) {
    const n = Math.min(24, S.buildings.worker + S.buildings.overseer * 2);
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      const span = W - 120;
      const x = 60 + (now / 40 + i * 97) % span;
      const wx = dir > 0 ? x : W - 60 - x;
      const wy = GROUND;
      ctx2.fillStyle = "#5b3a1a";
      ctx2.beginPath();
      ctx2.arc(wx, wy - 16, 4, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.fillStyle = "#f5f0e0";
      ctx2.fillRect(wx - 3, wy - 12, 6, 10);
      if (dir > 0) {
        ctx2.fillStyle = "#a87c3f";
        ctx2.fillRect(wx + 4, wy - 18, 6, 5);
      }
    }
  }
  function drawScarab(now) {
    if (!S.scarab) return;
    const s = S.scarab;
    const pulse = 1 + 0.15 * Math.sin(now / 120);
    ctx2.save();
    ctx2.translate(s.x, s.y);
    ctx2.scale(pulse, pulse);
    ctx2.shadowColor = "#ffd700";
    ctx2.shadowBlur = 18;
    ctx2.fillStyle = "#ffd700";
    ctx2.beginPath();
    ctx2.ellipse(0, 0, 12, 9, 0, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.shadowBlur = 0;
    ctx2.strokeStyle = "#8a6d00";
    ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    ctx2.moveTo(-10, -2);
    ctx2.lineTo(-20, -8);
    ctx2.moveTo(10, -2);
    ctx2.lineTo(20, -8);
    ctx2.stroke();
    ctx2.restore();
  }
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const sky = ctx2.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#f9e3b0");
    sky.addColorStop(0.7, "#eec987");
    sky.addColorStop(1, "#e0b273");
    ctx2.fillStyle = sky;
    ctx2.fillRect(0, 0, W, H);
    ctx2.fillStyle = "#ffdf6b";
    ctx2.shadowColor = "#ffdf6b";
    ctx2.shadowBlur = 30;
    ctx2.beginPath();
    ctx2.arc(W - 80, 60, 24, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.shadowBlur = 0;
    ctx2.fillStyle = "#d9b878";
    ctx2.beginPath();
    ctx2.moveTo(0, GROUND);
    ctx2.quadraticCurveTo(W * 0.25, GROUND - 40, W * 0.5, GROUND - 10);
    ctx2.quadraticCurveTo(W * 0.75, GROUND - 45, W, GROUND - 15);
    ctx2.lineTo(W, H);
    ctx2.lineTo(0, H);
    ctx2.closePath();
    ctx2.fill();
    ctx2.fillStyle = "#c9a86a";
    ctx2.fillRect(0, GROUND, W, H - GROUND);
    drawPyramid();
    drawWorkers(now);
    drawScarab(now);
    floats = floats.filter((f) => now < f.until);
    ctx2.textAlign = "center";
    for (const f of floats) {
      const k = (f.until - now) / 800;
      ctx2.globalAlpha = Math.max(0, k);
      ctx2.fillStyle = f.color;
      ctx2.font = "bold 16px Georgia, serif";
      ctx2.fillText(f.txt, f.x, f.y - (1 - k) * 30);
    }
    ctx2.globalAlpha = 1;
  }
  var away = (Date.now() - S.savedAt) / 1e3;
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
})();
