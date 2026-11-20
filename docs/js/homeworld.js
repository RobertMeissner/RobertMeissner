import * as THREE from "three";

const app = document.getElementById("app");
const introEl = document.getElementById("intro");
const winEl = document.getElementById("win");
const hudEl = document.getElementById("hud");
const scoreEl = document.getElementById("score");
const startBtn = document.getElementById("start");
const restartBtn = document.getElementById("restart");

const ORB_COUNT = 10;

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
const ship = new THREE.Mesh(
  shipGeo,
  new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0x664411, roughness: 0.4, metalness: 0.6 })
);
ship.position.set(0, -6, 0);
scene.add(ship);
const shipLight = new THREE.PointLight(0xffddaa, 8, 20);
ship.add(shipLight);

const orbs = [];
const orbGeo = new THREE.IcosahedronGeometry(0.45, 0);
const orbMat = new THREE.MeshStandardMaterial({
  color: 0x66ffcc,
  emissive: 0x22cc88,
  emissiveIntensity: 1.6,
  roughness: 0.3,
});

function placeOrb(orb) {
  orb.position.set((Math.random() * 2 - 1) * 12, (Math.random() * 2 - 1) * 7, (Math.random() * 2 - 1) * 4);
  orb.userData.base.copy(orb.position);
}

for (let i = 0; i < ORB_COUNT; i++) {
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.userData.phase = Math.random() * Math.PI * 2;
  orb.userData.base = new THREE.Vector3();
  placeOrb(orb);
  scene.add(orb);
  orbs.push(orb);
}

const pointer = new THREE.Vector2(0, 0);
const keys = new THREE.Vector2(0, 0);
let state = "intro";
let score = 0;

function setScore() {
  scoreEl.textContent = `Orbs ${score} / ${ORB_COUNT}`;
}
setScore();

function startGame() {
  state = "playing";
  introEl.classList.add("hidden");
  winEl.classList.add("hidden");
  hudEl.classList.remove("hidden");
}

function resetGame() {
  score = 0;
  for (const orb of orbs) {
    orb.visible = true;
    placeOrb(orb);
  }
  setScore();
  startGame();
}

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", resetGame);
introEl.addEventListener("click", (e) => {
  if (e.target === introEl) startGame();
});

window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
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
  const t = clock.getElapsedTime();

  planet.rotation.y = t * 0.05;
  ring.rotation.z = t * 0.02;

  for (const orb of orbs) {
    if (!orb.visible) continue;
    orb.rotation.x = t * 1.5 + orb.userData.phase;
    orb.rotation.y = t * 2 + orb.userData.phase;
    orb.position.y = orb.userData.base.y + Math.sin(t * 2 + orb.userData.phase) * 0.4;
  }

  if (state === "playing") {
    const target = new THREE.Vector3(pointer.x * 11, pointer.y * 7, 0);
    target.x += keys.x * 5;
    target.y += keys.y * 4;
    if (target.length() > 14) target.setLength(14);
    const prev = ship.position.clone();
    ship.position.lerp(target, 0.07);
    const vel = ship.position.clone().sub(prev);
    if (vel.lengthSq() > 1e-6) ship.lookAt(ship.position.clone().add(vel));

    for (const orb of orbs) {
      if (!orb.visible) continue;
      if (ship.position.distanceTo(orb.position) < 1.6) {
        orb.visible = false;
        score++;
        setScore();
        if (score >= ORB_COUNT) {
          state = "won";
          hudEl.classList.add("hidden");
          winEl.classList.remove("hidden");
        }
      }
    }
  } else {
    ship.position.x = Math.sin(t * 0.6) * 3;
    ship.position.y = -6 + Math.cos(t * 0.8) * 0.5;
    ship.lookAt(planet.position);
  }

  camera.position.x = Math.sin(t * 0.1) * 1.5 + pointer.x * 0.8;
  camera.position.y = 4 + Math.cos(t * 0.13) * 0.8 + pointer.y * 0.5;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

animate();
