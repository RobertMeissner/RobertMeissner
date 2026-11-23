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

  // docs/src/gaterush.ts
  var $ = (id) => document.getElementById(id);
  var canvas = $("scene");
  var ctx2 = canvas.getContext("2d");
  var W = canvas.width;
  var H = canvas.height;
  var COLS = 16;
  var ROWS = 9;
  var TILE = 60;
  var SAVE_KEY = "rfp_gaterush_best_v1";
  var BASE_MAX = 200;
  var tkey = (t) => `${t.x},${t.y}`;
  var center = (t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
  var structCenter = (s) => center({ x: s.tx, y: s.ty });
  var barrelCenter = (b) => center({ x: b.tx, y: b.ty });
  var CC_TILES = /* @__PURE__ */ new Set(["7,3", "8,3", "7,4", "8,4"]);
  var CC_POS = { x: W / 2, y: H / 2 - 30 };
  var GATE_TILES = [
    { x: 8, y: 0 },
    { x: 8, y: 8 },
    { x: 0, y: 4 },
    { x: 15, y: 4 }
  ];
  function rollGate() {
    const tile = GATE_TILES[Math.floor(Math.random() * GATE_TILES.length)];
    const r = Math.random();
    let op = "+";
    let val = 10;
    if (r < 0.3) {
      op = "+";
      val = 5 + Math.floor(Math.random() * 6) * 5;
    } else if (r < 0.55) {
      op = "-";
      val = 5 + Math.floor(Math.random() * 5) * 5;
    } else if (r < 0.8) {
      op = "\xD7";
      val = 2 + Math.floor(Math.random() * 2);
    } else {
      op = "\xF7";
      val = 2 + Math.floor(Math.random() * 2);
    }
    return { tile, op, val };
  }
  function applyOp(count, op, val) {
    if (op === "+") return count + val;
    if (op === "-") return count - val;
    if (op === "\xD7") return count * val;
    return Math.floor(count / val);
  }
  var BUILDS = [
    { id: "wall", name: "Wall", icon: "\u{1F9F1}", cost: 10, desc: "cheap blockade, tanks hits", key: "1", hp: 500, range: 0, dmg: 0, rate: 0, aoe: 0 },
    { id: "turret", name: "Laser Turret", icon: "\u{1F52B}", cost: 30, desc: "rapid shots at packs", key: "2", hp: 150, range: 150, dmg: 2, rate: 2, aoe: 0 },
    { id: "cannon", name: "Plasma Cannon", icon: "\u{1F4A5}", cost: 80, desc: "splash shells", key: "3", hp: 250, range: 170, dmg: 9, rate: 0.7, aoe: 46 }
  ];
  var MAX_LVL = 4;
  var PACKS = {
    normal: { speed: 55, countMul: 1, radius: 13, color: "#ff5347" },
    runner: { speed: 95, countMul: 0.6, radius: 10, color: "#ffb14d" },
    tank: { speed: 32, countMul: 2.4, radius: 18, color: "#b06ae0" },
    boss: { speed: 23, countMul: 1, radius: 25, color: "#e0447c" }
  };
  var S;
  var best = 0;
  function fmt(n) {
    if (n < 1e3) return Math.floor(n).toString();
    const units = ["k", "M", "B", "T"];
    let u = -1;
    while (n >= 1e3 && u < units.length - 1) {
      n /= 1e3;
      u++;
    }
    return n.toFixed(n < 100 ? 2 : 1) + units[u];
  }
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  var cc = () => S.structs[0];
  var buildDef = (s) => BUILDS.find((b) => b.id === s.type);
  var structDmg = (s) => buildDef(s).dmg * Math.pow(1.6, s.lvl - 1);
  var structRange = (s) => buildDef(s).range + 12 * (s.lvl - 1);
  var structRate = (s) => buildDef(s).rate * (1 + 0.12 * (s.lvl - 1));
  var structMaxHp = (s) => Math.round(buildDef(s).hp * Math.pow(1.5, s.lvl - 1));
  var upgradeCost = (s) => Math.round(buildDef(s).cost * 0.9 * s.lvl);
  var structAt = (t) => S.structs.find((s) => s.tx === t.x && s.ty === t.y) ?? null;
  var barrelAt = (t) => S.barrels.find((b) => b.tx === t.x && b.ty === t.y) ?? null;
  var barrelGold = () => 10 + 2 * S.wave;
  var isGateTile = (t) => S.gates.some((g) => g.tile.x === t.x && g.tile.y === t.y);
  function reset() {
    S = {
      gold: 100,
      earned: 0,
      wave: 0,
      phase: "prep",
      phaseT: 12,
      queue: [],
      spawnT: 0,
      gates: GATE_TILES.map((tile) => ({ tile, op: "+", val: 10 })),
      structs: [{ type: "cc", tx: 7, ty: 3, hp: BASE_MAX, maxHp: BASE_MAX, lvl: 1, cd: 0, angle: -Math.PI / 2, spent: 0 }],
      packs: [],
      barrels: [],
      projs: [],
      parts: [],
      floats: [],
      kills: 0,
      placing: null,
      selected: null,
      mouse: { x: W / 2, y: H / 2 },
      mouseTile: { x: 5, y: 5 },
      keys: {},
      shotCd: 0,
      barrelT: 3,
      shake: 0,
      banner: "",
      bannerT: 0,
      paused: false,
      started: false,
      time: 0,
      hudT: 0
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
  function waveComp(w) {
    const q = [];
    const add = (t, n) => {
      for (let i = 0; i < n; i++) q.push(t);
    };
    add("normal", 3 + w);
    if (w >= 3) add("runner", Math.floor(w / 2));
    if (w >= 5) add("tank", Math.floor(w / 3));
    if (w % 5 === 0) add("boss", 1);
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = q[i];
      q[i] = q[j];
      q[j] = tmp;
    }
    return q;
  }
  function startWave(w) {
    S.wave = w;
    S.phase = "fight";
    S.queue = waveComp(w);
    S.spawnT = 0.4;
    S.gates = GATE_TILES.map(() => rollGate());
    if (w % 5 === 0) {
      banner(`\u26A0 WAVE ${w} \u2014 BOSS PACK \u26A0`);
      beep(70, 0.8, "sawtooth", 0.1, -30);
    } else {
      banner(`WAVE ${w}`);
      chord([440, 554, 659], 0.25, "triangle", 0.05);
    }
  }
  function spawnPack(type) {
    const d = PACKS[type];
    const gate = S.gates[Math.floor(Math.random() * S.gates.length)];
    const gp = center(gate.tile);
    let x = gp.x, y = gp.y;
    if (gate.tile.x === 0) x = -14;
    else if (gate.tile.x === COLS - 1) x = W + 14;
    else if (gate.tile.y === 0) y = -14;
    else y = H + 14;
    const base = type === "boss" ? 40 + 20 * S.wave : (6 + 2 * S.wave) * d.countMul * (0.85 + Math.random() * 0.3);
    const before = Math.round(base);
    const after = Math.max(0, applyOp(before, gate.op, gate.val));
    S.packs.push({
      type,
      x,
      y,
      count: after,
      speed: d.speed * (1 + Math.min(0.25, 0.015 * S.wave)),
      r: d.radius,
      color: d.color,
      flash: 0,
      wob: Math.random() * 10,
      target: null,
      retargetT: Math.random() * 0.3,
      atkCd: 0,
      dead: false,
      arrived: false
    });
    const good = after < before;
    S.floats.push({ x: clamp(gp.x, 60, W - 60), y: clamp(gp.y, 40, H - 40), txt: `${gate.op}${gate.val}: ${before} \u2192 ${after}`, life: 1.3, color: good ? "#5df08a" : "#ff5f6e", size: 14 });
    beep(good ? 880 : 220, 0.12, "square", 0.04, good ? 200 : -100);
    if (after <= 0) {
      const p = S.packs[S.packs.length - 1];
      p.dead = true;
      killPack(p);
      banner("GATE ATE A PACK");
    }
    if (type === "boss") S.shake = Math.max(S.shake, 8);
  }
  function spark(x, y, color, n, spd = 90) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spd * (0.4 + Math.random());
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7, size: 1.5 + Math.random() * 2.5, color, grav: 50 });
    }
  }
  function killPack(p) {
    if (p.dead && p.count <= 0) return;
    p.dead = true;
    p.count = 0;
    S.kills++;
    S.gold += 2;
    S.earned += 2;
    spark(p.x, p.y, p.color, p.type === "boss" ? 40 : 16, p.type === "boss" ? 170 : 110);
    S.floats.push({ x: p.x, y: p.y - p.r - 8, txt: "+2 \u25C6", life: 0.9, color: "#ffd23c", size: 13 });
    if (p.type === "boss") {
      S.shake = Math.max(S.shake, 14);
      banner("BOSS PACK DOWN");
      beep(60, 0.7, "sawtooth", 0.1, -25);
      chord([523, 659, 784, 1046], 0.3, "triangle", 0.05);
    } else {
      beep(200 + Math.random() * 120, 0.06, "square", 0.025, -120);
    }
  }
  function damagePack(p, dmg) {
    if (p.dead || p.arrived) return;
    p.count -= dmg;
    p.flash = 0.08;
    S.floats.push({ x: p.x + (Math.random() * 10 - 5), y: p.y - p.r - 4, txt: `-${Math.round(dmg)}`, life: 0.6, color: "#eaf6ff", size: 11 });
    if (p.count <= 0) killPack(p);
  }
  function damageStruct(s, dmg) {
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
  function breakBarrel(b) {
    const g = barrelGold();
    S.gold += g;
    S.earned += g;
    const p = barrelCenter(b);
    spark(p.x, p.y, "#ffd23c", 16, 110);
    spark(p.x, p.y, "#c98a3d", 10, 80);
    S.floats.push({ x: p.x, y: p.y - 18, txt: `+${g} \u25C6`, life: 1, color: "#ffd23c", size: 14 });
    beep(1250, 0.06, "sine", 0.04, 200);
    S.barrels = S.barrels.filter((x) => x !== b);
  }
  function spawnBarrel() {
    for (let tries = 0; tries < 60; tries++) {
      const t = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (CC_TILES.has(tkey(t)) || isGateTile(t)) continue;
      if (structAt(t) || barrelAt(t)) continue;
      const hp = 4;
      S.barrels.push({ tx: t.x, ty: t.y, hp, maxHp: hp, t: 22 });
      const p = center(t);
      spark(p.x, p.y, "#c98a3d", 8, 60);
      return;
    }
  }
  function canPlaceTile(t) {
    if (t.x < 0 || t.x >= COLS || t.y < 0 || t.y >= ROWS) return false;
    if (CC_TILES.has(tkey(t)) || isGateTile(t)) return false;
    if (structAt(t) || barrelAt(t)) return false;
    return true;
  }
  function tryPlace(t) {
    if (!S.placing) return;
    const def = BUILDS.find((b) => b.id === S.placing);
    if (!def) return;
    if (S.gold < def.cost || !canPlaceTile(t)) {
      beep(140, 0.08, "sawtooth", 0.04);
      return;
    }
    S.gold -= def.cost;
    S.structs.push({ type: def.id, tx: t.x, ty: t.y, hp: def.hp, maxHp: def.hp, lvl: 1, cd: 0, angle: -Math.PI / 2, spent: def.cost });
    const p = center(t);
    spark(p.x, p.y, "#ffd23c", 12, 80);
    beep(660, 0.08, "square", 0.05);
    chord([440, 554], 0.12, "triangle", 0.04);
  }
  function selectPlacing(id) {
    S.placing = S.placing === id ? null : id;
    S.selected = null;
    for (const r of buildRefs) r.btn.classList.toggle("selected", r.def.id === S.placing);
    beep(600, 0.05, "square", 0.04);
  }
  function upgradeSelected() {
    const s = S.selected;
    if (!s || s.type === "cc" || s.lvl >= MAX_LVL) return;
    const cost = upgradeCost(s);
    if (S.gold < cost) {
      beep(140, 0.08, "sawtooth", 0.04);
      return;
    }
    S.gold -= cost;
    s.spent += cost;
    s.lvl++;
    s.maxHp = structMaxHp(s);
    s.hp = Math.min(s.maxHp, Math.round(s.hp * 1.5));
    const p = structCenter(s);
    spark(p.x, p.y, "#ffd23c", 16, 100);
    beep(660, 0.08, "square", 0.05);
    chord([523, 659, 784], 0.15, "triangle", 0.05);
    toast(`\u2B06 ${buildDef(s).name} \u2192 Lv ${s.lvl} \u2014 bigger gun!`);
    updateHud();
  }
  function sellSelected() {
    const s = S.selected;
    if (!s || s.type === "cc") return;
    const refund = Math.floor(s.spent * 0.6);
    S.gold += refund;
    S.structs = S.structs.filter((x) => x !== s);
    S.selected = null;
    const p = structCenter(s);
    spark(p.x, p.y, "#ffd23c", 10, 80);
    S.floats.push({ x: p.x, y: p.y - 16, txt: `+${refund} \u25C6`, life: 1, color: "#ffd23c", size: 13 });
    beep(500, 0.1, "square", 0.05, 150);
    updateHud();
  }
  function structPos(s) {
    if (s.type === "cc") return CC_POS;
    return structCenter(s);
  }
  function pickTarget(p) {
    const c = cc();
    let bestS = null;
    let bd = 80;
    for (const s of S.structs) {
      const sp = structPos(s);
      const d = Math.hypot(sp.x - p.x, sp.y - p.y);
      if (d < bd) {
        bd = d;
        bestS = s;
      }
    }
    return bestS ?? c;
  }
  function updatePacks(dt) {
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
          damageStruct(t, 6 + S.wave);
          beep(150, 0.05, "square", 0.03, -60);
          if (t.type === "cc" && cc().hp <= 0 && S.phase !== "over") gameOver();
        }
      } else {
        p.x += dx / d * p.speed * dt;
        p.y += dy / d * p.speed * dt;
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
          const push = (min - d) / 2 * 0.5;
          a.x -= dx / d * push;
          a.y -= dy / d * push;
          b.x += dx / d * push;
          b.y += dy / d * push;
        }
      }
    }
  }
  function fireProj(s, targetP, targetB) {
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
  function updateStructs(dt) {
    for (const s of S.structs) {
      if (s.type === "cc" || s.type === "wall") continue;
      const def = buildDef(s);
      const p = structPos(s);
      const range = structRange(s);
      s.cd -= dt;
      let bestP = null;
      let bd = Infinity;
      for (const pk of S.packs) {
        if (pk.dead || pk.arrived) continue;
        const d = Math.hypot(pk.x - p.x, pk.y - p.y) - pk.r;
        const toCC = Math.hypot(pk.x - CC_POS.x, pk.y - CC_POS.y);
        if (d < range && toCC < bd) {
          bd = toCC;
          bestP = pk;
        }
      }
      let targetB = null;
      if (!bestP) {
        let bd2 = range;
        for (const b of S.barrels) {
          const bp = barrelCenter(b);
          const d = Math.hypot(bp.x - p.x, bp.y - p.y);
          if (d < bd2) {
            bd2 = d;
            targetB = b;
          }
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
  function explodeShell(p) {
    p.life = 0;
    for (const pk of S.packs) {
      if (pk.dead || pk.arrived) continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d < p.aoe + pk.r) damagePack(pk, p.dmg * (1 - d / (p.aoe + pk.r) * 0.5));
    }
    spark(p.x, p.y, "#ffb14d", 16, 150);
    spark(p.x, p.y, "#ff5f3c", 8, 100);
    S.shake = Math.max(S.shake, 5);
    beep(120, 0.22, "sawtooth", 0.06, -70);
  }
  function updateProjs(dt) {
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
            spark(p.x, p.y, "#c98a3d", 4, 60);
            if (b.hp <= 0) breakBarrel(b);
          }
        }
        continue;
      }
      if (p.targetP && !p.targetP.dead && !p.targetP.arrived) {
        const dx = p.targetP.x - p.x, dy = p.targetP.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx = dx / d * p.speed;
        p.vy = dy / d * p.speed;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.targetP && !p.targetP.dead && !p.targetP.arrived && Math.hypot(p.targetP.x - p.x, p.targetP.y - p.y) < p.targetP.r + 4) {
        if (p.kind === "shell") explodeShell(p);
        else {
          damagePack(p.targetP, p.dmg);
          p.life = 0;
        }
        spark(p.x, p.y, "#7df9ff", 4, 60);
      } else if (p.targetB && Math.hypot(barrelCenter(p.targetB).x - p.x, barrelCenter(p.targetB).y - p.y) < 20) {
        p.targetB.hp -= p.dmg;
        spark(p.x, p.y, "#c98a3d", 4, 60);
        if (p.targetB.hp <= 0) breakBarrel(p.targetB);
        p.life = 0;
      } else if (p.kind === "shell" && Math.hypot(p.tx - p.x, p.ty - p.y) < 8) {
        explodeShell(p);
      }
    }
    S.projs = S.projs.filter((p) => p.life > 0 && p.x > -80 && p.x < W + 80 && p.y > -80 && p.y < H + 80);
  }
  function updateBarrels(dt) {
    S.barrelT -= dt;
    if (S.barrelT <= 0 && S.barrels.length < 4) {
      spawnBarrel();
      S.barrelT = 5 + Math.random() * 3;
    }
    for (const b of S.barrels) b.t -= dt;
    S.barrels = S.barrels.filter((b) => b.t > 0);
  }
  function updateParts(dt) {
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
  function update(dt) {
    S.time += dt;
    S.shotCd = Math.max(0, S.shotCd - dt);
    if (S.phase === "prep") {
      S.phaseT -= dt;
      if (S.phaseT <= 0) startWave(S.wave + 1);
    } else if (S.phase === "fight") {
      if (S.queue.length > 0) {
        S.spawnT -= dt;
        if (S.spawnT <= 0) {
          const t = S.queue.shift();
          if (t) spawnPack(t);
          S.spawnT = Math.max(0.35, 0.9 - S.wave * 0.04);
        }
      } else if (S.packs.length === 0) {
        const bonus = 12 + 3 * S.wave;
        S.gold += bonus;
        S.earned += bonus;
        toast(`Wave ${S.wave} cleared! +${bonus} \u25C6`);
        chord([523, 659, 784], 0.2, "triangle", 0.05);
        S.phase = "prep";
        S.phaseT = 9;
        banner(`WAVE ${S.wave} CLEARED`);
      }
    }
    updatePacks(dt);
    updateStructs(dt);
    updateProjs(dt);
    updateBarrels(dt);
    updateParts(dt);
    S.shake = Math.max(0, S.shake - dt * 30);
    S.bannerT = Math.max(0, S.bannerT - dt);
  }
  function gameOver() {
    S.phase = "over";
    S.placing = null;
    S.selected = null;
    best = Math.max(best, S.wave);
    saveBest();
    S.shake = 20;
    beep(90, 1, "sawtooth", 0.1, -50);
    chord([330, 262, 196, 131], 0.6, "triangle", 0.06);
    $("ovTitle").textContent = "\u{1F4A5} COMMAND CENTER OVERRUN";
    $("ovText").textContent = `A zerg pack broke through on wave ${S.wave}. ${S.kills} packs destroyed \xB7 ${fmt(S.earned)} \u25C6 earned \xB7 best: wave ${best}.`;
    $("ovBtn").textContent = "\u21BB REDEPLOY";
    $("overlay").classList.remove("hidden");
  }
  function startGame() {
    reset();
    S.started = true;
    $("overlay").classList.add("hidden");
    banner("HOLD THE BASE");
    chord([392, 523, 659], 0.3, "triangle", 0.06);
    updateHud();
  }
  function playerShoot(x, y) {
    if (S.shotCd > 0 || S.phase === "over" || !S.started) return;
    S.shotCd = 0.22;
    const ang = Math.atan2(y - CC_POS.y, x - CC_POS.x);
    S.projs.push({
      x: CC_POS.x + Math.cos(ang) * 40,
      y: CC_POS.y + Math.sin(ang) * 40,
      vx: Math.cos(ang) * 700,
      vy: Math.sin(ang) * 700,
      speed: 700,
      dmg: 3,
      aoe: 0,
      targetP: null,
      targetB: null,
      tx: x,
      ty: y,
      life: 0.35,
      kind: "shot"
    });
    beep(900 + Math.random() * 200, 0.03, "square", 0.025, -300);
  }
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
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
    if (S.placing) {
      tryPlace(t);
      return;
    }
    const b = barrelAt(t);
    if (b) {
      playerShoot(barrelCenter(b).x, barrelCenter(b).y);
      return;
    }
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
    if (e.code === "KeyP") {
      S.paused = !S.paused;
      return;
    }
    if (e.code === "KeyU") {
      upgradeSelected();
      return;
    }
    if (e.code === "KeyX") {
      sellSelected();
      return;
    }
    const b = BUILDS.find((x) => `Digit${x.key}` === e.code);
    if (b) selectPlacing(b.id);
  });
  window.addEventListener("keyup", (e) => {
    S.keys[e.code] = false;
  });
  $("ovBtn").addEventListener("click", () => startGame());
  $("pauseBtn").addEventListener("click", () => {
    if (S.started && S.phase !== "over") S.paused = !S.paused;
  });
  $("restartBtn").addEventListener("click", () => startGame());
  $("upBtn").addEventListener("click", () => upgradeSelected());
  $("sellBtn").addEventListener("click", () => sellSelected());
  window.addEventListener("beforeunload", saveBest);
  var buildRefs = [];
  function makeBtn(def) {
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
  function renderLists() {
    const bl = $("buildList");
    bl.innerHTML = "";
    for (const def of BUILDS) {
      const r = makeBtn(def);
      r.btn.addEventListener("click", () => selectPlacing(def.id));
      bl.appendChild(r.btn);
      buildRefs.push({ def, btn: r.btn, costEl: r.costEl, countEl: r.extraEl });
    }
  }
  function updateHud() {
    $("gold").textContent = fmt(S.gold);
    $("wave").textContent = S.wave === 0 ? "\u2014" : String(S.wave);
    const c = cc();
    $("baseHp").textContent = `${Math.max(0, Math.ceil(c.hp))} / ${c.maxHp}`;
    $("baseFill").style.width = `${clamp(c.hp / c.maxHp * 100, 0, 100)}%`;
    $("foes").textContent = String(S.packs.length + S.queue.length);
    $("kills").textContent = String(S.kills);
    $("best").textContent = String(best);
    for (const r of buildRefs) {
      const count = S.structs.filter((s2) => s2.type === r.def.id).length;
      r.countEl.textContent = count > 0 ? `x${count}` : "";
      r.costEl.textContent = `${r.def.cost} \u25C6`;
      r.btn.disabled = S.gold < r.def.cost;
    }
    const panel = $("towerPanel");
    const s = S.selected;
    if (s) {
      panel.classList.remove("hidden");
      if (s.type === "cc") {
        $("tpName").textContent = "\u{1F3E0} Command Center";
        $("tpStats").textContent = `hull ${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;
        $("upBtn").disabled = true;
        $("upBtn").textContent = "\u2B06 (bunker is maxed)";
        $("sellBtn").disabled = true;
        $("sellBtn").textContent = "SELL (nope)";
      } else {
        const def = buildDef(s);
        $("tpName").textContent = `${def.icon} ${def.name} \u2014 Lv ${s.lvl}/${MAX_LVL}`;
        $("tpStats").textContent = `hp ${Math.ceil(s.hp)}/${s.maxHp}` + (def.range > 0 ? ` \xB7 dmg ${structDmg(s).toFixed(1)} \xB7 range ${structRange(s).toFixed(0)}` : "");
        const up = $("upBtn");
        const sell = $("sellBtn");
        if (s.lvl >= MAX_LVL) {
          up.textContent = "\u2B06 MAX LEVEL";
          up.disabled = true;
        } else {
          up.textContent = `\u2B06 UPGRADE \u2014 ${upgradeCost(s)} \u25C6 (U)`;
          up.disabled = S.gold < upgradeCost(s);
        }
        sell.textContent = `SELL +${Math.floor(s.spent * 0.6)} \u25C6 (X)`;
        sell.disabled = false;
      }
    } else {
      panel.classList.add("hidden");
    }
  }
  var STARS = Array.from({ length: 70 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.4 + 0.3,
    a: Math.random() * 0.4 + 0.15
  }));
  function drawBg() {
    ctx2.fillStyle = "#0a0e18";
    ctx2.fillRect(0, 0, W, H);
    for (const s of STARS) {
      ctx2.globalAlpha = s.a;
      ctx2.fillStyle = "#cfe6ff";
      ctx2.beginPath();
      ctx2.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx2.fill();
    }
    ctx2.globalAlpha = 1;
    ctx2.strokeStyle = "rgba(255, 210, 60, 0.06)";
    ctx2.lineWidth = 1;
    for (let x = 0; x <= W; x += TILE) {
      ctx2.beginPath();
      ctx2.moveTo(x, 0);
      ctx2.lineTo(x, H);
      ctx2.stroke();
    }
    for (let y = 0; y <= H; y += TILE) {
      ctx2.beginPath();
      ctx2.moveTo(0, y);
      ctx2.lineTo(W, y);
      ctx2.stroke();
    }
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        if (CC_TILES.has(`${x},${y}`)) {
          ctx2.fillStyle = "#14243c";
          ctx2.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
  }
  function drawGates() {
    for (const g of S.gates) {
      const p = center(g.tile);
      const bad = g.op === "+" || g.op === "\xD7";
      const col = bad ? "#ff5f6e" : "#5df08a";
      const pulse = 1 + 0.1 * Math.sin(S.time * 3 + g.tile.x);
      ctx2.save();
      ctx2.translate(p.x, p.y);
      ctx2.scale(pulse, pulse);
      ctx2.shadowColor = col;
      ctx2.shadowBlur = 16;
      ctx2.fillStyle = "rgba(0,0,0,0.55)";
      ctx2.beginPath();
      ctx2.ellipse(0, 0, 26, 18, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.fillStyle = col;
      ctx2.beginPath();
      ctx2.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.shadowBlur = 0;
      ctx2.fillStyle = "#04060d";
      ctx2.font = "bold 15px monospace";
      ctx2.textAlign = "center";
      ctx2.fillText(`${g.op}${g.val}`, 0, 5);
      ctx2.restore();
      ctx2.fillStyle = "#7d92ad";
      ctx2.font = "9px monospace";
      ctx2.textAlign = "center";
      const off = g.tile.y === 0 ? 26 : g.tile.y === ROWS - 1 ? -26 : g.tile.x === 0 ? 0 : 0;
      ctx2.fillText("GATE", p.x, p.y + (g.tile.y === 0 ? 30 : g.tile.y === ROWS - 1 ? -30 : off + (g.tile.x === 0 ? -32 : 32)));
    }
  }
  function drawBase() {
    const p = CC_POS;
    ctx2.save();
    ctx2.translate(p.x, p.y);
    ctx2.shadowColor = "#3aa0ff";
    ctx2.shadowBlur = 20;
    ctx2.fillStyle = "#3d4c63";
    ctx2.fillRect(-62, -46, 124, 92);
    ctx2.shadowBlur = 0;
    ctx2.fillStyle = "#2c3a4f";
    ctx2.fillRect(-62, -46, 124, 20);
    ctx2.fillStyle = "#5f7290";
    ctx2.fillRect(-14, -62, 28, 18);
    ctx2.fillStyle = Math.sin(S.time * 4) > 0 ? "#ff5347" : "#7a1f1a";
    ctx2.beginPath();
    ctx2.arc(0, -66, 5, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#9db4c8";
    ctx2.fillRect(-46, -10, 30, 46);
    ctx2.fillRect(16, -10, 30, 46);
    ctx2.fillStyle = "#35f0d0";
    ctx2.font = "bold 13px monospace";
    ctx2.textAlign = "center";
    ctx2.fillText("CC", 0, 18);
    ctx2.restore();
    ctx2.fillStyle = "rgba(0,0,0,0.6)";
    ctx2.fillRect(p.x - 62, p.y - 82, 124, 6);
    const ratio = clamp(cc().hp / cc().maxHp, 0, 1);
    ctx2.fillStyle = ratio > 0.5 ? "#5df08a" : ratio > 0.25 ? "#ffd23c" : "#ff5347";
    ctx2.fillRect(p.x - 62, p.y - 82, 124 * ratio, 6);
  }
  function drawBarrel(b) {
    const p = barrelCenter(b);
    const pulse = 1 + 0.06 * Math.sin(S.time * 5 + b.tx);
    ctx2.save();
    ctx2.translate(p.x, p.y);
    ctx2.scale(pulse, pulse);
    ctx2.shadowColor = "#c98a3d";
    ctx2.shadowBlur = 8;
    ctx2.fillStyle = "#8a5a24";
    ctx2.fillRect(-16, -16, 32, 32);
    ctx2.shadowBlur = 0;
    ctx2.strokeStyle = "#c98a3d";
    ctx2.lineWidth = 3;
    ctx2.strokeRect(-16, -16, 32, 32);
    ctx2.beginPath();
    ctx2.moveTo(-16, -16);
    ctx2.lineTo(16, 16);
    ctx2.moveTo(16, -16);
    ctx2.lineTo(-16, 16);
    ctx2.stroke();
    ctx2.restore();
    ctx2.fillStyle = "rgba(0,0,0,0.6)";
    ctx2.fillRect(p.x - 14, p.y - 26, 28, 4);
    ctx2.fillStyle = "#ffd23c";
    ctx2.fillRect(p.x - 14, p.y - 26, 28 * clamp(b.hp / b.maxHp, 0, 1), 4);
  }
  function drawHpBar(x, y, w, ratio) {
    ctx2.fillStyle = "rgba(0,0,0,0.6)";
    ctx2.fillRect(x - w / 2, y, w, 4);
    ctx2.fillStyle = ratio > 0.5 ? "#5df08a" : ratio > 0.25 ? "#ffd23c" : "#ff5347";
    ctx2.fillRect(x - w / 2, y, w * clamp(ratio, 0, 1), 4);
  }
  function drawStruct(s) {
    if (s.type === "cc") return;
    const p = structCenter(s);
    const def = buildDef(s);
    ctx2.save();
    ctx2.translate(p.x, p.y);
    if (S.selected === s) {
      ctx2.strokeStyle = "rgba(255, 210, 60, 0.8)";
      ctx2.setLineDash([6, 6]);
      if (def.range > 0) {
        ctx2.beginPath();
        ctx2.arc(0, 0, structRange(s), 0, Math.PI * 2);
        ctx2.stroke();
      }
      ctx2.setLineDash([]);
    }
    if (s.type === "wall") {
      ctx2.fillStyle = "#6b5a4a";
      ctx2.fillRect(-24, -24, 48, 48);
      ctx2.strokeStyle = "#9a8266";
      ctx2.lineWidth = 2;
      ctx2.strokeRect(-24, -24, 48, 48);
      ctx2.beginPath();
      ctx2.moveTo(-24, -8);
      ctx2.lineTo(24, -8);
      ctx2.moveTo(-24, 8);
      ctx2.lineTo(24, 8);
      ctx2.moveTo(-8, -24);
      ctx2.lineTo(-8, 24);
      ctx2.moveTo(8, -24);
      ctx2.lineTo(8, 24);
      ctx2.stroke();
    } else if (s.type === "turret") {
      ctx2.fillStyle = "#5a6b7d";
      ctx2.beginPath();
      ctx2.arc(0, 0, 15, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.strokeStyle = "#8fa3b8";
      ctx2.lineWidth = 2;
      ctx2.stroke();
      ctx2.strokeStyle = "#7df9ff";
      ctx2.lineWidth = 4;
      ctx2.beginPath();
      ctx2.moveTo(0, 0);
      ctx2.lineTo(Math.cos(s.angle) * 24, Math.sin(s.angle) * 24);
      ctx2.stroke();
    } else {
      ctx2.fillStyle = "#6b5a3d";
      ctx2.fillRect(-16, -13, 32, 26);
      ctx2.strokeStyle = "#a08a5f";
      ctx2.lineWidth = 2;
      ctx2.strokeRect(-16, -13, 32, 26);
      ctx2.strokeStyle = "#ffb14d";
      ctx2.lineWidth = 6;
      ctx2.beginPath();
      ctx2.moveTo(0, 0);
      ctx2.lineTo(Math.cos(s.angle) * 28, Math.sin(s.angle) * 28);
      ctx2.stroke();
    }
    ctx2.restore();
    for (let i = 0; i < s.lvl; i++) {
      ctx2.fillStyle = "#ffd23c";
      ctx2.beginPath();
      ctx2.arc(p.x - (s.lvl - 1) * 4 + i * 8, p.y + 22, 2.5, 0, Math.PI * 2);
      ctx2.fill();
    }
    if (s.hp < s.maxHp) drawHpBar(p.x, p.y - 30, 44, s.hp / s.maxHp);
  }
  function drawPack(p) {
    ctx2.save();
    ctx2.translate(p.x, p.y);
    ctx2.fillStyle = "rgba(0,0,0,0.35)";
    ctx2.beginPath();
    ctx2.ellipse(0, p.r * 0.7, p.r, p.r * 0.45, 0, 0, Math.PI * 2);
    ctx2.fill();
    const flash = p.flash > 0;
    const n = Math.min(10, Math.max(3, Math.round(p.count / 5)));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + p.wob * 0.2;
      ctx2.fillStyle = flash ? "#ffffff" : p.color;
      ctx2.beginPath();
      ctx2.arc(Math.cos(a) * p.r * 0.55, Math.sin(a) * p.r * 0.38, p.r * 0.3, 0, Math.PI * 2);
      ctx2.fill();
    }
    ctx2.fillStyle = flash ? "#ffffff" : p.color;
    ctx2.beginPath();
    ctx2.arc(0, 0, p.r * 0.5, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.restore();
    ctx2.font = "bold 14px monospace";
    ctx2.textAlign = "center";
    ctx2.strokeStyle = "rgba(0,0,0,0.85)";
    ctx2.lineWidth = 3;
    ctx2.strokeText(String(Math.max(0, Math.ceil(p.count))), p.x, p.y - p.r - 8);
    ctx2.fillStyle = "#ffffff";
    ctx2.fillText(String(Math.max(0, Math.ceil(p.count))), p.x, p.y - p.r - 8);
  }
  function drawProjs() {
    for (const p of S.projs) {
      if (p.kind === "shot") {
        ctx2.strokeStyle = "#ffe08a";
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.moveTo(p.x, p.y);
        ctx2.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx2.stroke();
      } else if (p.kind === "bolt") {
        ctx2.strokeStyle = "#7df9ff";
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.moveTo(p.x, p.y);
        ctx2.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx2.stroke();
      } else {
        ctx2.fillStyle = "#ffb14d";
        ctx2.shadowColor = "#ffb14d";
        ctx2.shadowBlur = 10;
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.shadowBlur = 0;
      }
    }
  }
  function drawGhost() {
    if (!S.started || S.phase === "over") return;
    const t = S.mouseTile;
    if (S.placing) {
      const def = BUILDS.find((x) => x.id === S.placing);
      if (!def) return;
      const ok = canPlaceTile(t) && S.gold >= def.cost;
      const col = ok ? "255, 210, 60" : "255, 83, 71";
      const p = center(t);
      ctx2.save();
      ctx2.strokeStyle = `rgba(${col}, 0.8)`;
      ctx2.fillStyle = `rgba(${col}, 0.15)`;
      if (def.range > 0) {
        ctx2.setLineDash([6, 6]);
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, def.range, 0, Math.PI * 2);
        ctx2.stroke();
        ctx2.setLineDash([]);
      }
      ctx2.fillStyle = `rgba(${col}, 0.3)`;
      ctx2.fillRect(t.x * TILE + 4, t.y * TILE + 4, TILE - 8, TILE - 8);
      ctx2.strokeStyle = `rgba(${col}, 0.9)`;
      ctx2.strokeRect(t.x * TILE + 4, t.y * TILE + 4, TILE - 8, TILE - 8);
      ctx2.fillStyle = ok ? "#ffd23c" : "#ff5347";
      ctx2.font = "bold 11px monospace";
      ctx2.textAlign = "center";
      ctx2.fillText(`${def.name} ${def.cost} \u25C6`, p.x, t.y * TILE - 4);
      ctx2.restore();
    } else if (canPlaceTile(t) && !structAt(t) && !barrelAt(t)) {
      ctx2.fillStyle = "rgba(255, 210, 60, 0.06)";
      ctx2.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
    }
  }
  function draw() {
    ctx2.save();
    if (S.shake > 0) ctx2.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
    drawBg();
    drawGates();
    drawBase();
    for (const b of S.barrels) drawBarrel(b);
    for (const s of S.structs) drawStruct(s);
    const sorted = [...S.packs].sort((a, b) => a.y - b.y);
    for (const p of sorted) drawPack(p);
    drawProjs();
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
      ctx2.globalAlpha = clamp(f.life / 0.9, 0, 1);
      ctx2.fillStyle = f.color;
      ctx2.font = `bold ${f.size}px monospace`;
      ctx2.strokeStyle = "rgba(0,0,0,0.8)";
      ctx2.lineWidth = 3;
      ctx2.strokeText(f.txt, f.x, f.y);
      ctx2.fillText(f.txt, f.x, f.y);
    }
    ctx2.globalAlpha = 1;
    drawGhost();
    ctx2.restore();
    if (S.bannerT > 0) {
      ctx2.globalAlpha = clamp(S.bannerT * 2, 0, 1);
      ctx2.fillStyle = "#ffd23c";
      ctx2.strokeStyle = "rgba(0,0,0,0.8)";
      ctx2.lineWidth = 4;
      ctx2.font = "bold 32px monospace";
      ctx2.textAlign = "center";
      ctx2.strokeText(S.banner, W / 2, 40);
      ctx2.fillText(S.banner, W / 2, 40);
      ctx2.globalAlpha = 1;
    }
    ctx2.textAlign = "center";
    ctx2.font = "bold 15px monospace";
    if (S.started && S.phase === "prep") {
      ctx2.fillStyle = "#ffd23c";
      ctx2.fillText(`NEXT WAVE IN ${Math.ceil(S.phaseT)}s \u2014 build (1-3), shoot barrels for gold, click packs to shoot!`, W / 2, H - 14);
    } else if (S.started && S.phase === "fight") {
      ctx2.fillStyle = "#ff8c7a";
      ctx2.fillText(`WAVE ${S.wave} \u2014 ${S.packs.length + S.queue.length} packs inbound \xB7 gates reroll each wave!`, W / 2, H - 14);
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
  renderLists();
  updateHud();
  requestAnimationFrame(loop);
})();
