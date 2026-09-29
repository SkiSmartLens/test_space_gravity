import * as THREE from 'three';
import { simulateFlight, launchVelocity } from '../shared/physics.js';

const PLANET_PALETTES = [
  { base: 0xc97b3f, blotch: 0x8f4f26 },
  { base: 0x6fb1ff, blotch: 0x2f5fa8 },
  { base: 0xc770ff, blotch: 0x7a3fa8 },
  { base: 0x7ee08a, blotch: 0x3f9a52 },
  { base: 0xe0b23d, blotch: 0x9a6a1a },
  { base: 0xff8fa3, blotch: 0xa8425a },
];

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Bakes a procedural surface texture whose pattern depends on the planet's
// size class -- cratered for small moons, blotchy terrain for mid-size
// worlds, broad swirling bands for gas giants -- so "different sizes" also
// reads as genuinely different kinds of planet, with no external assets.
function makePlanetTexture(baseHex, blotchHex, seed, category) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);

  const base = new THREE.Color(baseHex);
  ctx.fillStyle = `rgb(${base.r * 255}, ${base.g * 255}, ${base.b * 255})`;
  ctx.fillRect(0, 0, size, size);

  const blotch = new THREE.Color(blotchHex);
  const blotchRGB = `${blotch.r * 255}, ${blotch.g * 255}, ${blotch.b * 255}`;

  if (category === 'giant') {
    // Wide horizontal storm bands, each a bit of hue/lightness drift.
    const bands = 9 + Math.floor(rand() * 5);
    for (let i = 0; i < bands; i++) {
      const y = (i / bands) * size;
      const h = size / bands;
      const lighten = (rand() - 0.5) * 0.3;
      const c = base.clone().offsetHSL(0, 0, lighten);
      ctx.fillStyle = `rgba(${c.r * 255}, ${c.g * 255}, ${c.b * 255}, ${0.5 + rand() * 0.3})`;
      ctx.fillRect(0, y, size, h + 2);
    }
    // A few swirling storm spots (like Jupiter's red spot).
    for (let i = 0; i < 4; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 30 + rand() * 70;
      ctx.fillStyle = `rgba(${blotchRGB}, ${0.25 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.5, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (category === 'small') {
    // Cratered moon/asteroid: dark craters with a lit rim highlight.
    const craterCount = 26;
    for (let i = 0; i < craterCount; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 6 + rand() * 26;
      ctx.fillStyle = `rgba(${blotchRGB}, ${0.35 + rand() * 0.25})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.08 + rand() * 0.1})`;
      ctx.lineWidth = Math.max(1, r * 0.15);
      ctx.beginPath();
      ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.9, Math.PI * 0.9, Math.PI * 1.6);
      ctx.stroke();
    }
  } else {
    // Terran/rocky blotch continents with faint strata banding.
    for (let i = 0; i < 46; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 16 + rand() * 90;
      const alpha = 0.15 + rand() * 0.35;
      ctx.fillStyle = `rgba(${blotchRGB}, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.35 + rand() * 0.65), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let band = 0; band < 10; band++) {
      const y = (band / 10) * size + rand() * 16;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.03 + rand() * 0.05})`;
      ctx.fillRect(0, y, size, 10 + rand() * 18);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// A tilted, textured Saturn-style ring, reserved for giant planets so the
// biggest bodies in the field are unmistakable at a glance.
function makeRingTexture(colorHex, seed) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);
  const color = new THREE.Color(colorHex);
  for (let x = 0; x < size; x++) {
    const band = Math.sin(x * 0.2) * 0.5 + 0.5;
    const alpha = 0.25 + band * 0.4 + rand() * 0.1;
    ctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, ${Math.min(1, alpha)})`;
    ctx.fillRect(x, 0, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function buildGiantRing(radius, colorHex, seed) {
  const inner = radius * 1.5;
  const outer = radius * 2.3;
  const geo = new THREE.RingGeometry(inner, outer, 64, 1);
  // Map radial UVs so the 1D ring gradient texture bands outward correctly.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const dist = (v3.length() - inner) / (outer - inner);
    uv.setXY(i, dist, 0.5);
  }
  const texture = makeRingTexture(colorHex, seed);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2.3;
  return mesh;
}

// A chunky 2.5D fighter silhouette -- extruded from a flat side-profile
// shape rather than a bare cone, so it actually reads as a ship from the
// game's near-face-on camera, with a canopy and a pulsing engine glow.
function buildShipShape() {
  const s = new THREE.Shape();
  s.moveTo(38, 0);
  s.lineTo(20, 9);
  s.lineTo(2, 16);
  s.lineTo(-14, 15);
  s.lineTo(-24, 9);
  s.lineTo(-24, 20);
  s.lineTo(-34, 20);
  s.lineTo(-34, 6);
  s.lineTo(-40, 4);
  s.lineTo(-40, -4);
  s.lineTo(-24, -8);
  s.lineTo(-6, -12);
  s.lineTo(14, -9);
  s.lineTo(38, 0);
  return s;
}

function buildShip(bodyColor) {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.6 });

  const geo = new THREE.ExtrudeGeometry(buildShipShape(), {
    depth: 18,
    bevelEnabled: true,
    bevelThickness: 2,
    bevelSize: 1.5,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -9);
  geo.scale(0.75, 0.75, 0.75);
  const hull = new THREE.Mesh(geo, hullMat);
  group.add(hull);

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(6, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x9fe3ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.75, emissive: 0x2255aa, emissiveIntensity: 0.3 }),
  );
  canopy.scale.set(1.1, 0.8, 0.7);
  canopy.position.set(3, 9, 0);
  group.add(canopy);

  const engineGlow = new THREE.Mesh(
    new THREE.SphereGeometry(4, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  engineGlow.position.set(-31, 0, 0);
  group.add(engineGlow);

  return { group, hull, engineGlow };
}

// Physics is a flat 2D plane; we render it with a tilted perspective camera
// so it reads as "2D gameplay, a bit 3D" rather than a flat top-down map,
// and we can dolly the camera way out to show the whole gravity field
// between the two ships while a missile is in flight. A user-controlled
// zoom multiplier layers on top of that automatic framing.
export class Game {
  constructor(canvas, arena) {
    this.arena = arena;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060c);
    this.scene.fog = new THREE.FogExp2(0x05060c, 0.00018);

    this.camera = new THREE.PerspectiveCamera(55, 1, 10, 24000);
    this.camState = { x: 0, y: 0, dist: 1400 };
    this.camTarget = { x: 0, y: 0, dist: 1400 };
    this.zoomMultiplier = 1;
    this.shake = { magnitude: 0, until: 0, start: 0, duration: 1 };

    this.planetMeshes = new Map();
    this.shipMeshes = new Map();
    this.ghostLine = null;
    this.missile = null;
    this.effects = [];
    this.lights = [];

    this._buildLights();
    this._buildStars();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  worldX(px) { return px - this.arena.width / 2; }
  worldY(py) { return py - this.arena.height / 2; }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(600, 900, 1200);
    this.scene.add(sun);
  }

  _buildStars() {
    const count = 3000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 18000;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 10000;
      positions[i * 3 + 2] = -2000 - Math.random() * 7000;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: true });
    this.scene.add(new THREE.Points(geo, mat));
  }

  buildArena(state) {
    for (const entry of this.planetMeshes.values()) {
      this.scene.remove(entry.mesh, entry.ring, entry.atmosphere);
      if (entry.saturnRing) this.scene.remove(entry.saturnRing);
    }
    for (const entry of this.shipMeshes.values()) this.scene.remove(entry.group);
    this.planetMeshes.clear();
    this.shipMeshes.clear();

    state.planets.forEach((planet, i) => {
      const palette = PLANET_PALETTES[i % PLANET_PALETTES.length];
      const seed = hashStringToSeed(planet.id);
      const category = planet.category || 'medium';
      const texture = makePlanetTexture(palette.base, palette.blotch, seed, category);

      const segs = category === 'giant' ? 56 : 40;
      const geo = new THREE.SphereGeometry(planet.radius, segs, segs);
      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        bumpMap: texture,
        bumpScale: category === 'small' ? 3.5 : 1.5,
        roughness: category === 'giant' ? 0.55 : 0.85,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(this.worldX(planet.x), this.worldY(planet.y), 0);
      mesh.rotation.z = mulberry32(seed)() * Math.PI * 2;
      this.scene.add(mesh);

      const atmoGeo = new THREE.SphereGeometry(planet.radius * 1.16, 32, 32);
      const atmoMat = new THREE.MeshBasicMaterial({
        color: palette.base,
        transparent: true,
        opacity: category === 'giant' ? 0.3 : 0.2,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
      atmosphere.position.copy(mesh.position);
      this.scene.add(atmosphere);

      const ringGeo = new THREE.RingGeometry(planet.radius * 1.32, planet.radius * 1.46, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: palette.base, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(mesh.position);
      this.scene.add(ring);

      let saturnRing = null;
      if (category === 'giant') {
        saturnRing = buildGiantRing(planet.radius, palette.blotch, seed + 7);
        saturnRing.position.copy(mesh.position);
        this.scene.add(saturnRing);
      }

      const spin = (mulberry32(seed + 1)() - 0.5) * (category === 'giant' ? 0.003 : 0.007);
      this.planetMeshes.set(planet.id, { mesh, ring, atmosphere, saturnRing, spin });
    });

    state.ships.forEach((ship) => {
      const bodyColor = ship.id === 0 || ship.facing > 0 ? 0x4fd1ff : 0xff6b8b;
      const { group, hull, engineGlow } = buildShip(bodyColor);
      group.rotation.y = ship.facing > 0 ? 0 : Math.PI;
      group.position.set(this.worldX(ship.x), this.worldY(ship.y), 0);
      this.scene.add(group);
      this.shipMeshes.set(ship.id, { group, body: hull, engineGlow, baseColor: bodyColor });
    });

    this.missile = new THREE.Mesh(
      new THREE.SphereGeometry(9, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa55, emissiveIntensity: 1.2 }),
    );
    this.missile.visible = false;
    this.scene.add(this.missile);
  }

  destroyPlanet(planetId) {
    const entry = this.planetMeshes.get(planetId);
    if (!entry) return;
    this.scene.remove(entry.mesh, entry.ring, entry.atmosphere);
    if (entry.saturnRing) this.scene.remove(entry.saturnRing);
    this.planetMeshes.delete(planetId);
    const radius = entry.mesh.geometry.parameters.radius;
    this._spawnExplosion(entry.mesh.position.clone(), radius);
    this._triggerShake(30, 500);
  }

  flashShip(shipId) {
    const entry = this.shipMeshes.get(shipId);
    if (!entry) return;
    const original = entry.baseColor;
    entry.body.material.color.setHex(0xffffff);
    setTimeout(() => entry.body.material.color.setHex(original), 160);
    this._spawnExplosion(entry.group.position.clone(), 34, { small: true });
    this._triggerShake(16, 320);
  }

  _addEffect(mesh, duration, update) {
    this.scene.add(mesh);
    this.effects.push({ mesh, start: performance.now(), duration, update });
  }

  // Layered blast: a bright flash lighting up nearby objects, a
  // cooling fireball, a shockwave ring, drifting smoke, fast sparks, and
  // tumbling debris -- all procedural primitives, no sprite assets.
  //
  // Fireball/ring/flash sizes are driven by `sizeBasis`, a SOFTLY CAPPED
  // version of the planet's real radius (full-size up to 120, then
  // sqrt-diminishing beyond). Growth is multiplicative on top of that, so
  // without the cap a giant planet's (radius up to 380) blast would balloon
  // to several arena-widths across and visually engulf the camera -- capping
  // keeps "bigger planet = bigger explosion" true without it swallowing the
  // screen. Debris/smoke/spark counts still scale with the real radius so
  // giants still throw a noticeably bigger debris field.
  _spawnExplosion(position, radius, opts = {}) {
    const sizeBasis = Math.min(radius, 120) + Math.sqrt(Math.max(0, radius - 120)) * 5;

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(sizeBasis * 0.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flash.position.copy(position);
    this._addEffect(flash, 180, (m, t) => {
      m.scale.setScalar(1 + t * 3.4);
      m.material.opacity = 1 - t;
    });

    // A real point light so the blast actually illuminates nearby planets
    // and ships for a moment, instead of only affecting its own meshes.
    const light = new THREE.PointLight(0xffcf8a, 8, sizeBasis * 24, 2);
    light.position.copy(position);
    this.scene.add(light);
    this.effects.push({
      mesh: light,
      start: performance.now(),
      duration: 400,
      update: (l, t) => {
        l.intensity = 8 * (1 - t);
      },
    });

    const fireballSpecs = [
      { color: 0xfff2c0, growth: 2.6, duration: 380 },
      { color: 0xffb454, growth: 4.6, duration: 700 },
      { color: 0xff5a2e, growth: 6.4, duration: 900 },
    ];
    for (const spec of fireballSpecs) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(sizeBasis * 0.42, 20, 20),
        new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.85 }),
      );
      mesh.position.copy(position);
      this._addEffect(mesh, spec.duration, (m, t) => {
        m.scale.setScalar(1 + easeOutCubic(t) * spec.growth);
        m.material.opacity = 0.85 * (1 - t) * (1 - t);
      });
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(sizeBasis * 0.5, sizeBasis * 0.68, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.copy(position);
    this._addEffect(ring, 600, (m, t) => {
      m.scale.setScalar(1 + easeOutCubic(t) * 7);
      m.material.opacity = 0.8 * (1 - t);
    });

    // Smoke: soft dark puffs that drift outward slowly and linger. Count
    // (not size) scales with the real radius, so giants throw more puffs
    // across a wider spread rather than each puff ballooning individually.
    const smokeCount = opts.small ? 4 : Math.round(7 + Math.min(radius, 300) / 40);
    const spread = opts.small ? 1 : 1 + Math.min(radius, 300) / 200;
    for (let i = 0; i < smokeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (20 + Math.random() * 90) * spread;
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle) * 0.6 + 0.3, (Math.random() - 0.5));
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(sizeBasis * (0.25 + Math.random() * 0.2), 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 }),
      );
      mesh.position.copy(position);
      const duration = 1100 + Math.random() * 700;
      this._addEffect(mesh, duration, (m, t) => {
        m.position.copy(position).addScaledVector(dir, dist * easeOutCubic(t));
        m.scale.setScalar(1 + t * 2.4);
        m.material.opacity = 0.5 * (1 - t);
      });
    }

    // Sparks: thin, fast, short-lived streaks.
    const sparkCount = opts.small ? 6 : 14;
    const sparkSpread = opts.small ? 1 : 1 + Math.min(radius, 300) / 250;
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (90 + Math.random() * 220) * sparkSpread;
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), (Math.random() - 0.5) * 0.4);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(6, 1.2, 1.2),
        new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.position.copy(position);
      mesh.lookAt(position.clone().add(dir));
      const duration = 260 + Math.random() * 200;
      this._addEffect(mesh, duration, (m, t) => {
        m.position.copy(position).addScaledVector(dir, dist * easeOutCubic(t));
        m.material.opacity = 1 - t;
      });
    }

    // Debris: tumbling rock/hull chunks flung outward. More chunks across a
    // wider spread for a bigger planet, without any single chunk ballooning.
    const debrisCount = opts.small ? 8 : Math.round(14 + Math.min(radius, 300) / 25);
    const debrisSpread = opts.small ? 1 : 1 + Math.min(radius, 300) / 200;
    for (let i = 0; i < debrisCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (40 + Math.random() * 170) * debrisSpread;
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), (Math.random() - 0.5) * 0.7);
      const size = 3 + Math.random() * 9;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9, emissive: 0x552200, emissiveIntensity: 0.4 }),
      );
      mesh.position.copy(position);
      const spinX = (Math.random() - 0.5) * 8;
      const spinY = (Math.random() - 0.5) * 8;
      const duration = 750 + Math.random() * 550;
      this._addEffect(mesh, duration, (m, t) => {
        m.position.copy(position).addScaledVector(dir, dist * easeOutCubic(t));
        m.rotation.x += spinX * 0.05;
        m.rotation.y += spinY * 0.05;
        m.scale.setScalar(Math.max(0, 1 - t * 1.25));
      });
    }
  }

  _triggerShake(magnitude, durationMs) {
    this.shake = { magnitude, until: performance.now() + durationMs, start: performance.now(), duration: durationMs };
  }

  _updateEffects(now) {
    this.effects = this.effects.filter((fx) => {
      const t = Math.min(1, (now - fx.start) / fx.duration);
      fx.update(fx.mesh, t);
      if (t >= 1) {
        this.scene.remove(fx.mesh);
        if (fx.mesh.geometry) fx.mesh.geometry.dispose();
        if (fx.mesh.material) fx.mesh.material.dispose();
        return false;
      }
      return true;
    });

    for (const entry of this.planetMeshes.values()) {
      entry.mesh.rotation.y += entry.spin;
      if (entry.saturnRing) entry.saturnRing.rotation.z += entry.spin * 0.4;
    }

    for (const entry of this.shipMeshes.values()) {
      const pulse = 0.7 + Math.sin(now * 0.006) * 0.3;
      entry.engineGlow.material.opacity = pulse;
      entry.engineGlow.scale.setScalar(0.85 + pulse * 0.3);
    }
  }

  // Local ghost preview while the player is dragging the aim pad. Uses the
  // exact same simulateFlight() the server will use to resolve the real shot.
  previewShot(shooter, angle, power, planets, ships) {
    const { vx, vy } = launchVelocity(angle, power, shooter.facing);
    const launchOffset = 34 * shooter.facing;
    const { path } = simulateFlight({
      start: { x: shooter.x + launchOffset, y: shooter.y, vx, vy },
      planets,
      ships,
      bounds: { minX: -200, maxX: this.arena.width + 200, minY: -200, maxY: this.arena.height + 200 },
      maxSteps: 420,
    });
    const points = path.map((p) => new THREE.Vector3(this.worldX(p.x), this.worldY(p.y), 0));

    if (this.ghostLine) this.scene.remove(this.ghostLine);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({ color: 0x9db6ff, dashSize: 14, gapSize: 10, transparent: true, opacity: 0.8 });
    this.ghostLine = new THREE.Line(geo, mat);
    this.ghostLine.computeLineDistances();
    this.scene.add(this.ghostLine);
  }

  clearGhost() {
    if (this.ghostLine) {
      this.scene.remove(this.ghostLine);
      this.ghostLine = null;
    }
  }

  // Plays back the server-resolved flight path, dollying the camera out so
  // the whole gravity field between the ships is visible, then calls onDone.
  playShot(path, onDone) {
    this.clearGhost();
    const points = path.map((p) => new THREE.Vector3(this.worldX(p.x), this.worldY(p.y), 0));
    this.missile.visible = true;
    this.setCameraGoal(0, 0, Math.min(this.arena.width, 5600));

    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({ color: 0xffcf8a, transparent: true, opacity: 0.7 });
    const trail = new THREE.Line(trailGeo, trailMat);
    this.scene.add(trail);

    const totalFrames = Math.min(260, Math.max(60, points.length / 3));
    const stepPerFrame = Math.max(1, Math.ceil(points.length / totalFrames));
    let i = 0;
    const trailWindow = [];

    const tick = () => {
      if (i >= points.length) {
        this.missile.visible = false;
        this.scene.remove(trail);
        onDone();
        return;
      }
      const p = points[i];
      this.missile.position.copy(p);
      trailWindow.push(p.clone());
      if (trailWindow.length > 50) trailWindow.shift();
      trail.geometry.setFromPoints(trailWindow);
      i += stepPerFrame;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  setCameraGoal(x, y, dist) {
    this.camTarget = { x, y, dist };
  }

  // User-driven zoom (scroll wheel or on-screen +/- buttons) layered on top
  // of whatever the automatic camera framing is currently targeting.
  adjustZoom(factor) {
    this.zoomMultiplier = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoomMultiplier * factor));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    const loop = () => {
      const now = performance.now();
      const goalDist = this.camTarget.dist * this.zoomMultiplier;
      this.camState.x += (this.camTarget.x - this.camState.x) * 0.05;
      this.camState.y += (this.camTarget.y - this.camState.y) * 0.05;
      this.camState.dist += (goalDist - this.camState.dist) * 0.08;

      let shakeX = 0;
      let shakeY = 0;
      if (now < this.shake.until) {
        const remaining = (this.shake.until - now) / this.shake.duration;
        const power = this.shake.magnitude * remaining;
        shakeX = (Math.random() - 0.5) * power;
        shakeY = (Math.random() - 0.5) * power;
      }

      this.camera.position.set(
        this.camState.x + shakeX,
        this.camState.y + this.camState.dist * 0.32 + shakeY,
        this.camState.dist,
      );
      this.camera.lookAt(this.camState.x, this.camState.y, 0);

      this._updateEffects(now);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
