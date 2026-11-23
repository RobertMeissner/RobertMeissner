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

  // docs/src/siege.ts
  var $ = (id) => document.getElementById(id);
  var canvas = $("scene");
  var ctx2 = canvas.getContext("2d");
  var W = canvas.width;
  var H = canvas.height;
  var COLS = 16;
  var ROWS = 9;
  var TILE = 60;
  var SAVE_KEY = "rfp_siege_best_v1";
  var CC_HP = 300;
  var CAP_BASE = 400;
  var CAP_DEPOT = 250;
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
  var MINERAL_TILES = [
    { x: 2, y: 0 },
    { x: 13, y: 0 },
    { x: 2, y: 8 },
    { x: 13, y: 8 }
  ];
  var MINERAL_TILE_SET = new Set(MINERAL_TILES.map(tkey));
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
    { id: "wall", name: "Wall", icon: "\u{1F9F1}", costM: 15, costG: 0, time: 4, hp: 700, range: 0, dmg: 0, rate: 0, aoe: 0, desc: "reinforce the perimeter", key: "1" },
    { id: "turret", name: "Missile Turret", icon: "\u{1F52B}", costM: 50, costG: 0, time: 8, hp: 220, range: 150, dmg: 3, rate: 2, aoe: 0, desc: "rapid fire at the horde", key: "2" },
    { id: "bunker", name: "Bunker", icon: "\u{1F6E1}\uFE0F", costM: 90, costG: 15, time: 12, hp: 900, range: 125, dmg: 8, rate: 1.2, aoe: 40, desc: "armored strongpoint, splash", key: "3" },
    { id: "depot", name: "Supply Depot", icon: "\u{1F4E6}", costM: 30, costG: 0, time: 6, hp: 150, range: 0, dmg: 0, rate: 0, aoe: 0, desc: `+${CAP_DEPOT} resource storage`, key: "4" },
    { id: "refinery", name: "Refinery", icon: "\u26FD", costM: 70, costG: 0, time: 10, hp: 200, range: 0, dmg: 0, rate: 0, aoe: 0, desc: "+4 gas/s", key: "5" },
    { id: "lab", name: "Lab", icon: "\u{1F52C}", costM: 120, costG: 20, time: 15, hp: 250, range: 0, dmg: 0, rate: 0, aoe: 0, desc: "unlocks research", key: "6" }
  ];
  var MAX_LVL = 4;
  var RESEARCHES = [
    { id: "weapons", name: "Weapons Bay", icon: "\u2694\uFE0F", desc: "+35% turret/bunker damage per level", key: "Q", baseM: 80, baseG: 10, time: 20, max: 5 },
    { id: "armor", name: "Armor Plating", icon: "\u{1F529}", desc: "+30% structure hull per level", key: "W", baseM: 80, baseG: 10, time: 20, max: 5 },
    { id: "drills", name: "Mining Drills", icon: "\u26CF\uFE0F", desc: "+3 minerals/s per level", key: "E", baseM: 60, baseG: 0, time: 15, max: 5 }
  ];
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
  var gunMul = () => Math.pow(1.25, S.gunLvl);
  var cap = () => CAP_BASE + CAP_DEPOT * S.structs.filter((s) => s.type === "depot" && !s.constructing).length;
  var mineralRate = () => 2 * MINERAL_TILES.length + 3 * S.up.drills;
  var gasRate = () => 4 * S.structs.filter((s) => s.type === "refinery" && !s.constructing).length;
  var maxHpOf = (s) => s.type === "cc" ? CC_HP : Math.round(buildDef(s).hp * Math.pow(1.4, s.lvl - 1) * (1 + 0.3 * S.up.armor));
  var structDmg = (s) => buildDef(s).dmg * Math.pow(1.5, s.lvl - 1) * (1 + 0.35 * S.up.weapons) * gunMul();
  var structRange = (s) => buildDef(s).range + 10 * (s.lvl - 1);
  var structRate = (s) => buildDef(s).rate * (1 + 0.1 * (s.lvl - 1));
  var upgradeCostM = (s) => Math.round(buildDef(s).costM * 0.7 * s.lvl);
  var upgradeCostG = (s) => Math.round(buildDef(s).costG * 0.7 * s.lvl);
  var researchCostM = (r) => Math.round(r.baseM * Math.pow(2, S.up[r.id]));
  var researchCostG = (r) => Math.round(r.baseG * Math.pow(2, S.up[r.id]));
  var researchTime = (r) => r.time + 5 * S.up[r.id];
  var labReady = () => S.structs.some((s) => s.type === "lab" && !s.constructing);
  var structAt = (t) => S.structs.find((s) => s.tx === t.x && s.ty === t.y) ?? null;
  var barrelAt = (t) => S.barrels.find((b) => b.tx === t.x && b.ty === t.y) ?? null;
  var isGateTile = (t) => S.gates.some((g) => g.tile.x === t.x && g.tile.y === t.y);
  function reset() {
    S = {
      minerals: 250,
      gas: 30,
      siege: 0,
      phase: "build",
      siegeT: 45,
      queue: [],
      spawnT: 0,
      gates: GATE_TILES.map((tile) => ({ tile, op: "+", val: 10 })),
      structs: [{ type: "cc", tx: 7, ty: 3, hp: CC_HP, lvl: 1, cd: 0, angle: -Math.PI / 2, spentM: 0, spentG: 0, constructing: false, buildT: 0, buildMax: 0 }],
      packs: [],
      barrels: [],
      projs: [],
      parts: [],
      floats: [],
      kills: 0,
      scrap: 0,
      gunLvl: 0,
      up: { weapons: 0, armor: 0, drills: 0 },
      research: null,
      placing: null,
      selected: null,
      mouse: { x: W / 2, y: H / 2 },
      mouseTile: { x: 5, y: 5 },
      keys: {},
      shotCd: 0,
      barrelT: 2,
      hero: { x: CC_POS.x - 70, y: CC_POS.y + 24, hp: 200, alive: true, respawnT: 0, atkCd: 0, angle: -Math.PI / 2 },
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
    S.bannerT = 2.4;
  }
  function siegeComp(n) {
    const q = [];
    const add = (t, c) => {
      for (let i = 0; i < c; i++) q.push(t);
    };
    add("normal", 3 + 2 * n);
    if (n >= 2) add("runner", n);
    if (n >= 3) add("tank", Math.ceil(n / 2));
    if (n % 3 === 0) add("boss", 1);
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = q[i];
      q[i] = q[j];
      q[j] = tmp;
    }
    return q;
  }
  function startSiege(n) {
    S.siege = n;
    S.phase = "siege";
    S.queue = siegeComp(n);
    S.spawnT = 0.4;
    S.gates = GATE_TILES.map(() => rollGate());
    S.barrelT = 1;
    if (n % 3 === 0) {
      banner(`\u26A0 SIEGE ${n} \u2014 BOSS INBOUND \u26A0`);
      beep(70, 0.8, "sawtooth", 0.1, -30);
    } else {
      banner(`\u2694 SIEGE ${n} \u2014 HOLD THE SHELTER \u2694`);
      beep(220, 0.4, "sawtooth", 0.08, -80);
      chord([330, 415, 494], 0.3, "triangle", 0.05);
    }
  }
  function endSiege() {
    const m = 30 + 10 * S.siege;
    const g = 8 + 3 * S.siege;
    S.minerals = Math.min(cap(), S.minerals + m);
    S.gas = Math.min(cap(), S.gas + g);
    S.scrap += 2;
    toast(`Siege ${S.siege} repelled! +${m} \u25C6 +${g} \u26C1 +2 scrap`);
    chord([523, 659, 784], 0.25, "triangle", 0.05);
    banner(`SIEGE ${S.siege} REPELLED`);
    S.phase = "build";
    S.siegeT = 70;
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
    const base = type === "boss" ? 50 + 25 * S.siege : (8 + 3 * S.siege) * d.countMul * (0.85 + Math.random() * 0.3);
    const before = Math.round(base);
    const after = Math.max(0, applyOp(before, gate.op, gate.val));
    S.packs.push({
      type,
      x,
      y,
      count: after,
      speed: d.speed * (1 + Math.min(0.25, 0.015 * S.siege)),
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
    S.floats.push({ x: clamp(gp.x, 70, W - 70), y: clamp(gp.y, 40, H - 40), txt: `${gate.op}${gate.val}: ${before} \u2192 ${after}`, life: 1.3, color: good ? "#5df08a" : "#ff5f6e", size: 14 });
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
    spark(p.x, p.y, p.color, p.type === "boss" ? 40 : 16, p.type === "boss" ? 170 : 110);
    S.floats.push({ x: p.x, y: p.y - p.r - 8, txt: "+5 \u25C6", life: 0.9, color: "#ffd23c", size: 13 });
    S.minerals = Math.min(cap(), S.minerals + 5);
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
  function explodeBarrel(b) {
    const p = barrelCenter(b);
    S.barrels = S.barrels.filter((x) => x !== b);
    S.scrap += 1;
    S.minerals = Math.min(cap(), S.minerals + 5 + S.siege);
    if (S.scrap >= 3) {
      S.scrap -= 3;
      S.gunLvl = Math.min(6, S.gunLvl + 1);
      banner(`\u{1F525} BIGGER GUN \u2014 Lv ${S.gunLvl}`);
      chord([660, 880, 1100], 0.2, "square", 0.05);
    }
    for (const pk of S.packs) {
      if (pk.dead || pk.arrived) continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d < 75 + pk.r) damagePack(pk, 25 * gunMul() * (1 - d / (75 + pk.r) * 0.5));
    }
    spark(p.x, p.y, "#ffb14d", 22, 170);
    spark(p.x, p.y, "#ff5f3c", 14, 120);
    spark(p.x, p.y, "#ffd23c", 8, 90);
    S.floats.push({ x: p.x, y: p.y - 20, txt: `+1 scrap \xB7 +${5 + S.siege} \u25C6`, life: 1, color: "#ffd23c", size: 13 });
    S.shake = Math.max(S.shake, 7);
    beep(120, 0.3, "sawtooth", 0.08, -70);
  }
  function spawnBarrel() {
    for (let tries = 0; tries < 60; tries++) {
      const t = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (CC_TILES.has(tkey(t)) || isGateTile(t) || MINERAL_TILE_SET.has(tkey(t))) continue;
      if (structAt(t) || barrelAt(t)) continue;
      const hp = 3;
      S.barrels.push({ tx: t.x, ty: t.y, hp, maxHp: hp, t: 20 });
      const p = center(t);
      spark(p.x, p.y, "#ff8c5a", 8, 60);
      return;
    }
  }
  function canPlaceTile(t) {
    if (t.x < 0 || t.x >= COLS || t.y < 0 || t.y >= ROWS) return false;
    if (CC_TILES.has(tkey(t)) || isGateTile(t) || MINERAL_TILE_SET.has(tkey(t))) return false;
    if (structAt(t) || barrelAt(t)) return false;
    return true;
  }
  function tryPlace(t) {
    if (!S.placing) return;
    const def = BUILDS.find((b) => b.id === S.placing);
    if (!def) return;
    if (S.minerals < def.costM || S.gas < def.costG || !canPlaceTile(t)) {
      beep(140, 0.08, "sawtooth", 0.04);
      return;
    }
    S.minerals -= def.costM;
    S.gas -= def.costG;
    S.structs.push({
      type: def.id,
      tx: t.x,
      ty: t.y,
      hp: def.hp,
      lvl: 1,
      cd: 0,
      angle: -Math.PI / 2,
      spentM: def.costM,
      spentG: def.costG,
      constructing: true,
      buildT: def.time,
      buildMax: def.time
    });
    const p = center(t);
    spark(p.x, p.y, "#ffd23c", 10, 70);
    beep(660, 0.08, "square", 0.05);
    toast(`${def.icon} ${def.name} under construction (${def.time}s)`);
  }
  function selectPlacing(id) {
    S.placing = S.placing === id ? null : id;
    S.selected = null;
    for (const r of buildRefs) r.btn.classList.toggle("selected", r.def.id === S.placing);
    beep(600, 0.05, "square", 0.04);
  }
  function upgradeSelected() {
    const s = S.selected;
    if (!s || s.type === "cc" || s.constructing || s.lvl >= MAX_LVL) return;
    if (s.type !== "wall" && s.type !== "turret" && s.type !== "bunker") return;
    const cm = upgradeCostM(s);
    const cg = upgradeCostG(s);
    if (S.minerals < cm || S.gas < cg) {
      beep(140, 0.08, "sawtooth", 0.04);
      return;
    }
    S.minerals -= cm;
    S.gas -= cg;
    s.spentM += cm;
    s.spentG += cg;
    s.lvl++;
    s.hp = Math.min(maxHpOf(s), Math.round(s.hp * 1.4));
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
    S.minerals = Math.min(cap(), S.minerals + Math.floor(s.spentM * 0.6));
    S.gas = Math.min(cap(), S.gas + Math.floor(s.spentG * 0.6));
    S.structs = S.structs.filter((x) => x !== s);
    S.selected = null;
    const p = structCenter(s);
    spark(p.x, p.y, "#ffd23c", 10, 80);
    beep(500, 0.1, "square", 0.05, 150);
    updateHud();
  }
  function buyResearch(id) {
    const r = RESEARCHES.find((x) => x.id === id);
    if (!r) return;
    if (!labReady()) {
      toast("\u{1F52C} Build a Lab first!");
      beep(140, 0.08, "sawtooth", 0.04);
      return;
    }
    if (S.research) {
      toast("Research already in progress");
      return;
    }
    if (S.up[id] >= r.max) {
      toast(`${r.name} already at max level`);
      return;
    }
    const cm = researchCostM(r);
    const cg = researchCostG(r);
    if (S.minerals < cm || S.gas < cg) {
      beep(140, 0.08, "sawtooth", 0.04);
      return;
    }
    S.minerals -= cm;
    S.gas -= cg;
    S.research = { id, t: researchTime(r), max: researchTime(r) };
    toast(`\u{1F52C} Researching ${r.name} (${researchTime(r)}s)`);
    beep(660, 0.1, "square", 0.05);
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
  function updateHero(dt) {
    const h = S.hero;
    if (!h.alive) {
      h.respawnT -= dt;
      if (h.respawnT <= 0) {
        h.alive = true;
        h.hp = 200;
        banner("MARINE REDEPLOYED");
        chord([660, 880], 0.15, "triangle", 0.05);
      }
      return;
    }
    h.hp = Math.min(200, h.hp + 6 * dt);
    h.atkCd -= dt;
    let t = null;
    let bd = 200;
    for (const pk of S.packs) {
      if (pk.dead || pk.arrived) continue;
      const d = Math.hypot(pk.x - h.x, pk.y - h.y) - pk.r;
      if (d < bd) {
        bd = d;
        t = pk;
      }
    }
    if (t) {
      h.angle = Math.atan2(t.y - h.y, t.x - h.x);
      if (h.atkCd <= 0) {
        h.atkCd = 0.3;
        S.projs.push({
          x: h.x + Math.cos(h.angle) * 16,
          y: h.y + Math.sin(h.angle) * 16,
          vx: Math.cos(h.angle) * 620,
          vy: Math.sin(h.angle) * 620,
          speed: 620,
          dmg: 6 * gunMul(),
          aoe: 0,
          targetP: t,
          targetB: null,
          tx: t.x,
          ty: t.y,
          life: 0.8,
          kind: "bolt"
        });
        beep(980 + Math.random() * 200, 0.03, "square", 0.02, -300);
      }
    }
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
          damageStruct(t, 6 + S.siege);
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
      if (s.constructing) {
        s.buildT -= dt;
        if (s.buildT <= 0) {
          s.constructing = false;
          const p2 = structCenter(s);
          spark(p2.x, p2.y, "#5df08a", 14, 90);
          toast(`\u2705 ${buildDef(s).name} complete!`);
          chord([523, 784], 0.15, "triangle", 0.05);
          updateHud();
        }
        continue;
      }
      if (s.type === "cc" || s.type === "wall" || s.type === "depot" || s.type === "refinery" || s.type === "lab") continue;
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
            spark(p.x, p.y, "#ff8c5a", 4, 60);
            if (b.hp <= 0) explodeBarrel(b);
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
        spark(p.x, p.y, "#ff8c5a", 4, 60);
        if (p.targetB.hp <= 0) explodeBarrel(p.targetB);
        p.life = 0;
      } else if (p.kind === "shell" && Math.hypot(p.tx - p.x, p.ty - p.y) < 8) {
        explodeShell(p);
      }
    }
    S.projs = S.projs.filter((p) => p.life > 0 && p.x > -80 && p.x < W + 80 && p.y > -80 && p.y < H + 80);
  }
  function updateBarrels(dt) {
    if (S.phase === "siege") {
      S.barrelT -= dt;
      if (S.barrelT <= 0 && S.barrels.length < 5) {
        spawnBarrel();
        S.barrelT = 2.5 + Math.random() * 2;
      }
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
    S.minerals = Math.min(cap(), S.minerals + mineralRate() * dt);
    S.gas = Math.min(cap(), S.gas + gasRate() * dt);
    if (S.research) {
      S.research.t -= dt;
      if (S.research.t <= 0) {
        const id = S.research.id;
        S.up[id]++;
        S.research = null;
        const r = RESEARCHES.find((x) => x.id === id);
        toast(`\u2705 Research complete: ${r?.name} Lv ${S.up[id]}`);
        chord([523, 659, 784, 1046], 0.3, "triangle", 0.05);
        for (const s of S.structs) s.hp = Math.min(maxHpOf(s), s.hp);
        updateHud();
      }
    }
    if (S.phase === "build") {
      S.siegeT -= dt;
      if (S.siegeT <= 0) startSiege(S.siege + 1);
    } else if (S.phase === "siege") {
      if (S.queue.length > 0) {
        S.spawnT -= dt;
        if (S.spawnT <= 0) {
          const t = S.queue.shift();
          if (t) spawnPack(t);
          S.spawnT = Math.max(0.35, 0.9 - S.siege * 0.04);
        }
      } else if (S.packs.length === 0) {
        endSiege();
      }
    }
    updateHero(dt);
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
    best = Math.max(best, S.siege);
    saveBest();
    S.shake = 20;
    beep(90, 1, "sawtooth", 0.1, -50);
    chord([330, 262, 196, 131], 0.6, "triangle", 0.06);
    $("ovTitle").textContent = "\u{1F4A5} SHELTER OVERRUN";
    $("ovText").textContent = `The horde broke through on siege ${S.siege}. ${S.kills} zerg slain \xB7 gun Lv ${S.gunLvl} \xB7 best: siege ${best}.`;
    $("ovBtn").textContent = "\u21BB REDEPLOY";
    $("overlay").classList.remove("hidden");
  }
  function startGame() {
    reset();
    S.started = true;
    $("overlay").classList.add("hidden");
    banner("BUILD YOUR SHELTER \u2014 SIEGE INCOMING");
    chord([392, 523, 659], 0.3, "triangle", 0.06);
    updateHud();
  }
  function playerShoot(x, y) {
    if (S.shotCd > 0 || S.phase === "over" || !S.started) return;
    S.shotCd = 0.2;
    const h = S.hero;
    const ox = h.alive ? h.x : CC_POS.x;
    const oy = h.alive ? h.y : CC_POS.y;
    const ang = Math.atan2(y - oy, x - ox);
    S.projs.push({
      x: ox + Math.cos(ang) * 18,
      y: oy + Math.sin(ang) * 18,
      vx: Math.cos(ang) * 750,
      vy: Math.sin(ang) * 750,
      speed: 750,
      dmg: 5 * gunMul(),
      aoe: 0,
      targetP: null,
      targetB: null,
      tx: x,
      ty: y,
      life: 0.4,
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
      for (const r2 of buildRefs) r2.btn.classList.remove("selected");
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
    const r = RESEARCHES.find((x) => `Key${x.key}` === e.code);
    if (r) {
      buyResearch(r.id);
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
  var researchRefs = [];
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
  function costText(m, g) {
    return (m > 0 ? `${m} \u25C6` : "") + (m > 0 && g > 0 ? " + " : "") + (g > 0 ? `${g} \u26C1` : "");
  }
  function renderLists() {
    const bl = $("buildList");
    bl.innerHTML = "";
    for (const def of BUILDS) {
      const r = makeBtn(def);
      r.btn.addEventListener("click", () => selectPlacing(def.id));
      bl.appendChild(r.btn);
      buildRefs.push({ def, btn: r.btn, costEl: r.costEl, extraEl: r.extraEl });
    }
    const rl = $("researchList");
    rl.innerHTML = "";
    for (const def of RESEARCHES) {
      const r = makeBtn(def);
      r.btn.addEventListener("click", () => buyResearch(def.id));
      rl.appendChild(r.btn);
      researchRefs.push({ def, btn: r.btn, costEl: r.costEl, lvlEl: r.extraEl });
    }
  }
  function updateHud() {
    $("minerals").textContent = fmt(S.minerals);
    $("gas").textContent = fmt(S.gas);
    $("store").textContent = `${fmt(S.minerals)}/${cap()}`;
    const c = cc();
    $("baseHp").textContent = `${Math.max(0, Math.ceil(c.hp))} / ${CC_HP}`;
    $("baseFill").style.width = `${clamp(c.hp / CC_HP * 100, 0, 100)}%`;
    $("siege").textContent = S.phase === "siege" ? `\u2694 ${S.siege}` : S.siege === 0 ? `in ${Math.ceil(S.siegeT)}s` : `${S.siege} \xB7 in ${Math.ceil(S.siegeT)}s`;
    $("gun").textContent = `Lv ${S.gunLvl}`;
    $("kills").textContent = String(S.kills);
    $("best").textContent = String(best);
    for (const r of buildRefs) {
      const count = S.structs.filter((s2) => s2.type === r.def.id).length;
      const building = S.structs.filter((s2) => s2.type === r.def.id && s2.constructing).length;
      r.extraEl.textContent = count > 0 ? `x${count}${building > 0 ? ` (+${building}\u2026)` : ""}` : "";
      r.costEl.textContent = `${costText(r.def.costM, r.def.costG)} \xB7 ${r.def.time}s`;
      r.btn.disabled = S.minerals < r.def.costM || S.gas < r.def.costG;
    }
    for (const r of researchRefs) {
      const lvl = S.up[r.def.id];
      if (lvl >= r.def.max) {
        r.lvlEl.textContent = "MAX";
        r.costEl.textContent = "\u2014";
        r.btn.disabled = true;
      } else {
        r.lvlEl.textContent = `Lv ${lvl}/${r.def.max}`;
        r.costEl.textContent = `${costText(researchCostM(r.def), researchCostG(r.def))} \xB7 ${researchTime(r.def)}s`;
        r.btn.disabled = !labReady() || S.research !== null || S.minerals < researchCostM(r.def) || S.gas < researchCostG(r.def);
      }
    }
    const rs = $("researchStatus");
    if (S.research) {
      const r = RESEARCHES.find((x) => x.id === S.research?.id);
      rs.textContent = `\u{1F52C} researching ${r?.name ?? ""} \u2014 ${Math.ceil(S.research.t)}s left`;
    } else if (labReady()) {
      rs.textContent = "\u{1F52C} lab online \u2014 research unlocked (Q/W/E)";
    } else {
      rs.textContent = "\u{1F52C} build a Lab (6) to unlock research";
    }
    const panel = $("selPanel");
    const s = S.selected;
    if (s) {
      panel.classList.remove("hidden");
      if (s.type === "cc") {
        $("tpName").textContent = "\u{1F3E0} Command Center (your shelter)";
        $("tpStats").textContent = `hull ${Math.max(0, Math.ceil(s.hp))} / ${CC_HP}`;
        $("upBtn").disabled = true;
        $("upBtn").textContent = "\u2B06 (shelter is maxed)";
        $("sellBtn").disabled = true;
        $("sellBtn").textContent = "SELL (nope)";
      } else {
        const def = buildDef(s);
        $("tpName").textContent = `${def.icon} ${def.name} \u2014 Lv ${s.lvl}/${MAX_LVL}${s.constructing ? " (building\u2026)" : ""}`;
        $("tpStats").textContent = `hp ${Math.ceil(s.hp)}/${maxHpOf(s)}` + (def.range > 0 ? ` \xB7 dmg ${structDmg(s).toFixed(1)} \xB7 range ${structRange(s).toFixed(0)}` : "");
        const up = $("upBtn");
        const sell = $("sellBtn");
        if (s.constructing) {
          up.disabled = true;
          up.textContent = `\u2B06 building\u2026 ${Math.ceil(s.buildT)}s`;
        } else if (s.lvl >= MAX_LVL || s.type !== "wall" && s.type !== "turret" && s.type !== "bunker") {
          up.disabled = true;
          up.textContent = "\u2B06 MAX / N/A";
        } else {
          up.textContent = `\u2B06 UPGRADE \u2014 ${costText(upgradeCostM(s), upgradeCostG(s))} (U)`;
          up.disabled = S.minerals < upgradeCostM(s) || S.gas < upgradeCostG(s);
        }
        sell.textContent = `SELL +${Math.floor(s.spentM * 0.6)} \u25C6 (X)`;
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
  function drawMinerals() {
    for (const t of MINERAL_TILES) {
      const p = center(t);
      ctx2.save();
      ctx2.translate(p.x, p.y);
      ctx2.shadowColor = "#35f0d0";
      ctx2.shadowBlur = 10;
      ctx2.fillStyle = "#4dd8e8";
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + 0.5;
        ctx2.beginPath();
        ctx2.moveTo(Math.cos(a) * 14 - 4, 8);
        ctx2.lineTo(Math.cos(a) * 14, 8 - (10 + i % 2 * 6));
        ctx2.lineTo(Math.cos(a) * 14 + 4, 8);
        ctx2.closePath();
        ctx2.fill();
      }
      ctx2.shadowBlur = 0;
      ctx2.fillStyle = "#9ff5ff";
      ctx2.font = "9px monospace";
      ctx2.textAlign = "center";
      ctx2.fillText("+2/s", 0, 24);
      ctx2.restore();
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
    const ratio = clamp(cc().hp / CC_HP, 0, 1);
    ctx2.fillStyle = ratio > 0.5 ? "#5df08a" : ratio > 0.25 ? "#ffd23c" : "#ff5347";
    ctx2.fillRect(p.x - 62, p.y - 82, 124 * ratio, 6);
  }
  function drawBarrel(b) {
    const p = barrelCenter(b);
    const pulse = 1 + 0.07 * Math.sin(S.time * 6 + b.tx);
    ctx2.save();
    ctx2.translate(p.x, p.y);
    ctx2.scale(pulse, pulse);
    ctx2.shadowColor = "#ff8c5a";
    ctx2.shadowBlur = 12;
    ctx2.fillStyle = "#8a3d24";
    ctx2.fillRect(-16, -16, 32, 32);
    ctx2.shadowBlur = 0;
    ctx2.strokeStyle = "#ff8c5a";
    ctx2.lineWidth = 3;
    ctx2.strokeRect(-16, -16, 32, 32);
    ctx2.fillStyle = "#ffd23c";
    ctx2.font = "bold 14px monospace";
    ctx2.textAlign = "center";
    ctx2.fillText("\u2622", 0, 5);
    ctx2.restore();
    ctx2.fillStyle = "rgba(0,0,0,0.6)";
    ctx2.fillRect(p.x - 14, p.y - 26, 28, 4);
    ctx2.fillStyle = "#ff8c5a";
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
    if (s.constructing) {
      ctx2.strokeStyle = "#ffd23c";
      ctx2.setLineDash([5, 5]);
      ctx2.lineWidth = 2;
      ctx2.strokeRect(-24, -24, 48, 48);
      ctx2.setLineDash([]);
      ctx2.fillStyle = "rgba(255, 210, 60, 0.15)";
      ctx2.fillRect(-24, -24, 48, 48);
      ctx2.restore();
      const prog = 1 - s.buildT / s.buildMax;
      ctx2.fillStyle = "rgba(0,0,0,0.6)";
      ctx2.fillRect(p.x - 22, p.y + 28, 44, 5);
      ctx2.fillStyle = "#ffd23c";
      ctx2.fillRect(p.x - 22, p.y + 28, 44 * clamp(prog, 0, 1), 5);
      return;
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
    } else if (s.type === "bunker") {
      ctx2.fillStyle = "#6b7a5a";
      ctx2.fillRect(-24, -18, 48, 36);
      ctx2.strokeStyle = "#93a37e";
      ctx2.lineWidth = 2;
      ctx2.strokeRect(-24, -18, 48, 36);
      ctx2.fillStyle = "#3c4634";
      ctx2.fillRect(-20, -6, 40, 12);
      ctx2.strokeStyle = "#ffb14d";
      ctx2.lineWidth = 5;
      ctx2.beginPath();
      ctx2.moveTo(0, -6);
      ctx2.lineTo(Math.cos(s.angle) * 26, Math.sin(s.angle) * 26);
      ctx2.stroke();
    } else if (s.type === "depot") {
      ctx2.fillStyle = "#5d4a2c";
      ctx2.fillRect(-20, -16, 40, 32);
      ctx2.strokeStyle = "#a08050";
      ctx2.lineWidth = 2;
      ctx2.strokeRect(-20, -16, 40, 32);
      ctx2.fillStyle = "#3d3220";
      ctx2.fillRect(-20, -4, 40, 8);
    } else if (s.type === "refinery") {
      ctx2.fillStyle = "#3d4c63";
      ctx2.fillRect(-18, -20, 36, 40);
      ctx2.strokeStyle = "#8fa3b8";
      ctx2.lineWidth = 2;
      ctx2.strokeRect(-18, -20, 36, 40);
      ctx2.fillStyle = "#7dffb0";
      ctx2.shadowColor = "#7dffb0";
      ctx2.shadowBlur = 10;
      ctx2.beginPath();
      ctx2.arc(0, -6, 7 + Math.sin(S.time * 5) * 2, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.shadowBlur = 0;
    } else {
      ctx2.fillStyle = "#4a3d6b";
      ctx2.fillRect(-20, -18, 40, 36);
      ctx2.strokeStyle = "#8a7ab0";
      ctx2.lineWidth = 2;
      ctx2.strokeRect(-20, -18, 40, 36);
      ctx2.fillStyle = "#c07bf2";
      ctx2.shadowColor = "#c07bf2";
      ctx2.shadowBlur = 10;
      ctx2.beginPath();
      ctx2.arc(0, 0, 8 + Math.sin(S.time * 4) * 1.5, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.shadowBlur = 0;
    }
    ctx2.restore();
    for (let i = 0; i < s.lvl; i++) {
      ctx2.fillStyle = "#ffd23c";
      ctx2.beginPath();
      ctx2.arc(p.x - (s.lvl - 1) * 4 + i * 8, p.y + 24, 2.5, 0, Math.PI * 2);
      ctx2.fill();
    }
    const mh = maxHpOf(s);
    if (s.hp < mh) drawHpBar(p.x, p.y - 30, 44, s.hp / mh);
  }
  function drawHero() {
    const h = S.hero;
    if (!h.alive) {
      ctx2.fillStyle = "#ffd23c";
      ctx2.font = "bold 11px monospace";
      ctx2.textAlign = "center";
      ctx2.fillText(`MARINE RESPAWN ${Math.ceil(h.respawnT)}s`, CC_POS.x - 70, CC_POS.y + 44);
      return;
    }
    ctx2.save();
    ctx2.translate(h.x, h.y);
    ctx2.fillStyle = "rgba(0,0,0,0.35)";
    ctx2.beginPath();
    ctx2.ellipse(0, 10, 11, 5, 0, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#aebfd2";
    ctx2.beginPath();
    ctx2.arc(0, 0, 11, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = "#5f7290";
    ctx2.lineWidth = 2;
    ctx2.stroke();
    ctx2.fillStyle = "#35f0d0";
    ctx2.fillRect(Math.cos(h.angle) * 6 - 3, Math.sin(h.angle) * 6 - 2, 6, 4);
    ctx2.strokeStyle = "#2c3a4f";
    ctx2.lineWidth = 4;
    ctx2.beginPath();
    ctx2.moveTo(Math.cos(h.angle) * 8, Math.sin(h.angle) * 8);
    ctx2.lineTo(Math.cos(h.angle) * 19, Math.sin(h.angle) * 19);
    ctx2.stroke();
    ctx2.restore();
    drawHpBar(h.x, h.y - 22, 26, h.hp / 200);
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
      const ok = canPlaceTile(t) && S.minerals >= def.costM && S.gas >= def.costG;
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
      ctx2.fillText(`${def.name} ${costText(def.costM, def.costG)} \xB7 ${def.time}s`, p.x, t.y * TILE - 4);
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
    drawMinerals();
    drawGates();
    drawBase();
    for (const b of S.barrels) drawBarrel(b);
    for (const s of S.structs) drawStruct(s);
    drawHero();
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
      ctx2.font = "bold 30px monospace";
      ctx2.textAlign = "center";
      ctx2.strokeText(S.banner, W / 2, 44);
      ctx2.fillText(S.banner, W / 2, 44);
      ctx2.globalAlpha = 1;
    }
    ctx2.textAlign = "center";
    ctx2.font = "bold 14px monospace";
    if (S.started && S.phase === "build") {
      ctx2.fillStyle = "#ffd23c";
      ctx2.fillText(`NEXT SIEGE IN ${Math.ceil(S.siegeT)}s \u2014 build (1-6), research (Q/W/E), click to shoot`, W / 2, H - 12);
    } else if (S.started && S.phase === "siege") {
      ctx2.fillStyle = "#ff8c7a";
      ctx2.fillText(`\u2694 SIEGE ${S.siege} \u2014 ${S.packs.length + S.queue.length} hostiles \xB7 shoot \u2622 barrels for bigger guns!`, W / 2, H - 12);
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
