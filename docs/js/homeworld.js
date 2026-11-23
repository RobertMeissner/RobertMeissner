import * as THREE from "three";

const app = document.getElementById("app");
const introEl = document.getElementById("intro");
const winEl = document.getElementById("win");
const winTitleEl = document.getElementById("winTitle");
const winStatsEl = document.getElementById("winStats");
const hudEl = document.getElementById("hud");
const scoreEl = document.getElementById("score");
const hudWaveEl = document.getElementById("hudWave");
const hudOrbsEl = document.getElementById("hudOrbs");
const hudLivesEl = document.getElementById("hudLives");
const startBtn = document.getElementById("start");
const restartBtn = document.getElementById("restart");

const MAX_LIVES = 3;
const BEST_KEY = "rfp_homeworld_best";

let audioCtx = null;
function beep(freq, dur = 0.08, type = "square", vol = 0.05) {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.Fog(0x050510, 40, 120);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 4, 16);

scene.add(new THREE.AmbientLight(0x8899bb, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(12, 10, 8);
scene.add(sun);

function makePlanetTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  const sea = g.createLinearGradient(0, 0, 0, 256);
  sea.addColorStop(0, "#274b8f");
  sea.addColorStop(0.5, "#1d6f8e");
  sea.addColorStop(1, "#123a6b");
  g.fillStyle = sea;
  g.fillRect(0, 0, 512, 256);
  const land = ["#3f7d4e", "#5d8f57", "#8a7f4d", "#4e6e8f"];
  for (let i = 0; i < 260; i++) {
    g.fillStyle = land[(Math.random() * land.length) | 0];
    g.globalAlpha = 0.25 + Math.random() * 0.4;
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    const r = 4 + Math.random() * 22;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(3, 48, 48),
  new THREE.MeshStandardMaterial({ map: makePlanetTexture(), roughness: 0.85, metalness: 0.05 })
);
scene.add(planet);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(3.3, 48, 48),
  new THREE.MeshBasicMaterial({
    color: 0x4aa3ff,
    transparent: true,
    opacity: 0.16,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  })
);
scene.add(atmosphere);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(4.4, 7.2, 72),
  new THREE.MeshBasicMaterial({ color: 0x9fc7ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
);
ring.rotation.x = Math.PI / 2 - 0.35;
scene.add(ring);

const starCount = 1600;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 60 + Math.random() * 80;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.cos(phi);
  starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
scene.add(
  new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, sizeAttenuation: true, transparent: true, opacity: 0.85 })
  )
);

const shipGeo = new THREE.ConeGeometry(0.35, 1.4, 16);
shipGeo.rotateX(Math.PI / 2);
const shipMat = new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0x664411, roughness: 0.4, metalness: 0.6 });
const ship = new THREE.Mesh(shipGeo, shipMat);
ship.position.set(0, -6, 0);
scene.add(ship);
const shipLight = new THREE.PointLight(0xffddaa, 8, 20);
ship.add(shipLight);

const orbGeo = new THREE.IcosahedronGeometry(0.45, 0);
const orbMat = new THREE.MeshStandardMaterial({
  color: 0x66ffcc,
  emissive: 0x22cc88,
  emissiveIntensity: 1.6,
  roughness: 0.3,
});

const astGeo = new THREE.DodecahedronGeometry(0.7, 0);
const astMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.95, metalness: 0.1, flatShading: true });

const orbs = [];
const asteroids = [];

const pointer = new THREE.Vector2(0, 0);
const keys = new THREE.Vector2(0, 0);
let boost = false;
let state = "intro";
let wave = 1;
let lives = MAX_LIVES;
let score = 0;
let orbsCollected = 0;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let invulnUntil = 0;
let waveFlash = "";
let waveFlashUntil = 0;

const orbCountFor = (w) => Math.min(6 + w * 2, 24);
const asteroidCountFor = (w) => Math.min(1 + w, 8);

function updateHud() {
  hudWaveEl.textContent = waveFlash && performance.now() < waveFlashUntil ? waveFlash : `WAVE ${wave}`;
  hudOrbsEl.textContent = `Orbs ${orbsCollected} / ${orbs.length}`;
  hudLivesEl.textContent = "♥".repeat(Math.max(0, lives)) + "♡".repeat(Math.max(0, MAX_LIVES - lives));
  scoreEl.textContent = `SCORE ${score} · BEST ${Math.max(best, score)}`;
}

function placeOrb(orb) {
  let x = 0;
  let y = 0;
  let guard = 0;
  do {
    x = (Math.random() * 2 - 1) * 12;
    y = (Math.random() * 2 - 1) * 7;
  } while (Math.hypot(x - ship.position.x, y - ship.position.y) < 4 && guard++ < 50);
  orb.position.set(x, y, (Math.random() * 2 - 1) * 4);
  orb.userData.base.copy(orb.position);
}

function spawnWave(w) {
  for (const orb of orbs) scene.remove(orb);
  orbs.length = 0;
  for (let i = 0; i < orbCountFor(w); i++) {
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.userData.phase = Math.random() * Math.PI * 2;
    orb.userData.base = new THREE.Vector3();
    placeOrb(orb);
    scene.add(orb);
    orbs.push(orb);
  }
  for (const a of asteroids) scene.remove(a);
  asteroids.length = 0;
  const speed = 1.1 + w * 0.35;
  for (let i = 0; i < asteroidCountFor(w); i++) {
    const a = new THREE.Mesh(astGeo, astMat);
    a.position.set((Math.random() * 2 - 1) * 14, (Math.random() * 2 - 1) * 8, (Math.random() * 2 - 1) * 4);
    a.userData.vel = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 0.4 - 0.2)
      .normalize()
      .multiplyScalar(speed * (0.7 + Math.random() * 0.6));
    a.userData.spin = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    a.scale.setScalar(0.6 + Math.random() * 0.9);
    scene.add(a);
    asteroids.push(a);
  }
  orbsCollected = 0;
  updateHud();
}

function startGame() {
  state = "playing";
  wave = 1;
  lives = MAX_LIVES;
  score = 0;
  invulnUntil = performance.now() + 1500;
  waveFlash = "";
  ship.position.set(0, -6, 0);
  introEl.classList.add("hidden");
  winEl.classList.add("hidden");
  hudEl.classList.remove("hidden");
  spawnWave(wave);
}

function waveCleared() {
  const bonus = 100 * wave;
  score += bonus;
  waveFlash = wave % 5 === 0 ? `WAVE ${wave} CLEARED +${bonus} — MILESTONE!` : `WAVE ${wave} CLEARED +${bonus}`;
  waveFlashUntil = performance.now() + 2200;
  beep(660, 0.12, "triangle", 0.06);
  setTimeout(() => beep(880, 0.12, "triangle", 0.06), 120);
  setTimeout(() => beep(1100, 0.18, "triangle", 0.06), 240);
  wave++;
  invulnUntil = performance.now() + 1500;
  spawnWave(wave);
}

function gameOver() {
  state = "over";
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
  }
  hudEl.classList.add("hidden");
  winTitleEl.textContent = wave >= 10 ? "LEGENDARY PILOT" : "HOMEWORLD FALLEN";
  winStatsEl.textContent = `You reached wave ${wave} and scored ${score} points. Best: ${best}${score >= best && score > 0 ? " — new record!" : ""}.`;
  winEl.classList.remove("hidden");
  beep(160, 0.4, "sawtooth", 0.07);
  setTimeout(() => beep(110, 0.5, "sawtooth", 0.06), 250);
}

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);
introEl.addEventListener("click", (e) => {
  if (e.target === introEl) startGame();
});

window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  if (e.key === "Shift") boost = true;
  if (state !== "playing") return;
  switch (e.key.toLowerCase()) {
    case "w":
    case "arrowup":
      keys.y = 1;
      break;
    case "s":
    case "arrowdown":
      keys.y = -1;
      break;
    case "a":
    case "arrowleft":
      keys.x = -1;
      break;
    case "d":
    case "arrowright":
      keys.x = 1;
      break;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") boost = false;
  switch (e.key.toLowerCase()) {
    case "w":
    case "arrowup":
      if (keys.y === 1) keys.y = 0;
      break;
    case "s":
    case "arrowdown":
      if (keys.y === -1) keys.y = 0;
      break;
    case "a":
    case "arrowleft":
      if (keys.x === -1) keys.x = 0;
      break;
    case "d":
    case "arrowright":
      if (keys.x === 1) keys.x = 0;
      break;
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = performance.now();

  planet.rotation.y = t * 0.05;
  ring.rotation.z = t * 0.02;

  for (const orb of orbs) {
    if (!orb.visible) continue;
    orb.rotation.x = t * 1.5 + orb.userData.phase;
    orb.rotation.y = t * 2 + orb.userData.phase;
    orb.position.y = orb.userData.base.y + Math.sin(t * 2 + orb.userData.phase) * 0.4;
    const pulse = 1 + 0.12 * Math.sin(t * 4 + orb.userData.phase);
    orb.scale.setScalar(pulse);
  }

  for (const a of asteroids) {
    a.position.addScaledVector(a.userData.vel, dt);
    a.rotation.x += a.userData.spin.x * dt;
    a.rotation.y += a.userData.spin.y * dt;
    a.rotation.z += a.userData.spin.z * dt;
    if (a.position.x > 15) a.position.x = -15;
    if (a.position.x < -15) a.position.x = 15;
    if (a.position.y > 9) a.position.y = -9;
    if (a.position.y < -9) a.position.y = 9;
    if (a.position.z > 6) a.position.z = -6;
    if (a.position.z < -6) a.position.z = 6;
  }

  if (state === "playing") {
    const target = new THREE.Vector3(pointer.x * 11, pointer.y * 7, 0);
    target.x += keys.x * 5;
    target.y += keys.y * 4;
    const maxR = boost ? 16 : 14;
    if (target.length() > maxR) target.setLength(maxR);
    const prev = ship.position.clone();
    ship.position.lerp(target, boost ? 0.12 : 0.07);
    const vel = ship.position.clone().sub(prev);
    if (vel.lengthSq() > 1e-6) ship.lookAt(ship.position.clone().add(vel));

    for (const orb of orbs) {
      if (!orb.visible) continue;
      if (ship.position.distanceTo(orb.position) < 1.6) {
        orb.visible = false;
        orbsCollected++;
        const pts = 50 + 10 * wave;
        score += pts;
        beep(520 + wave * 40 + orbsCollected * 30, 0.08, "square", 0.05);
        updateHud();
        if (orbsCollected >= orbs.length) waveCleared();
      }
    }

    if (now > invulnUntil) {
      for (const a of asteroids) {
        if (ship.position.distanceTo(a.position) < 1.1 * a.scale.x + 0.5) {
          lives--;
          invulnUntil = now + 2000;
          ship.position.addScaledVector(a.userData.vel, -2.5);
          beep(140, 0.25, "sawtooth", 0.08);
          updateHud();
          if (lives <= 0) {
            gameOver();
            break;
          }
        }
      }
    }
    ship.visible = now > invulnUntil || Math.floor(now / 120) % 2 === 0;
    shipMat.emissive.setHex(now > invulnUntil ? 0x664411 : 0xff2222);
  } else {
    ship.visible = true;
    shipMat.emissive.setHex(0x664411);
    ship.position.x = Math.sin(t * 0.6) * 3;
    ship.position.y = -6 + Math.cos(t * 0.8) * 0.5;
    ship.lookAt(planet.position);
  }

  camera.position.x = Math.sin(t * 0.1) * 1.5 + pointer.x * 0.8;
  camera.position.y = 4 + Math.cos(t * 0.13) * 0.8 + pointer.y * 0.5;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

updateHud();
animate();
