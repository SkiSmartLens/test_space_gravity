import * as THREE from 'three';
import { simulateFlight, launchVelocity } from '../shared/physics.js';

const PLANET_PALETTES = [
  { base: 0xc97b3f, blotch: 0x8f4f26, name: 'rocky' },
  { base: 0x6fb1ff, blotch: 0x2f5fa8, name: 'ice' },
  { base: 0xc770ff, blotch: 0x7a3fa8, name: 'crystal' },
  { base: 0x7ee08a, blotch: 0x3f9a52, name: 'verdant' },
  { base: 0xe0b23d, blotch: 0x9a6a1a, name: 'gas' },
  { base: 0xff8fa3, blotch: 0xa8425a, name: 'scorched' },
];

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

// Bakes a small procedural surface texture (blotchy terrain bands) so
// planets read as textured worlds instead of flat-shaded spheres, with no
// external image assets to load.
function makePlanetTexture(baseHex, blotchHex, seed) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);

  const base = new THREE.Color(baseHex);
  ctx.fillStyle = `rgb(${base.r * 255}, ${base.g * 255}, ${base.b * 255})`;
  ctx.fillRect(0, 0, size, size);

  const blotch = new THREE.Color(blotchHex);
  for (let i = 0; i < 46; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 10 + rand() * 46;
    const alpha = 0.15 + rand() * 0.35;
    ctx.fillStyle = `rgba(${blotch.r * 255}, ${blotch.g * 255}, ${blotch.b * 255}, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.35 + rand() * 0.65), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Faint horizontal banding for a gas-giant/terrain-strata feel.
  for (let band = 0; band < 10; band++) {
    const y = (band / 10) * size + rand() * 8;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.03 + rand() * 0.05})`;
    ctx.fillRect(0, y, size, 6 + rand() * 10);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Physics is a flat 2D plane; we render it with a tilted perspective camera
// so it reads as "2D gameplay, a bit 3D" rather than a flat top-down map,
// and we can dolly the camera way out to show the whole gravity field
// between the two ships while a missile is in flight.
export class Game {
  constructor(canvas, arena) {
    this.arena = arena;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060c);
    this.scene.fog = new THREE.FogExp2(0x05060c, 0.00022);

    this.camera = new THREE.PerspectiveCamera(55, 1, 10, 20000);
    this.camState = { x: 0, y: 0, dist: 1400 };
    this.camGoal = { x: 0, y: 0, dist: 1400 };
    this.shake = { magnitude: 0, until: 0 };

    this.planetMeshes = new Map();
    this.shipMeshes = new Map();
    this.ghostLine = null;
    this.missile = null;
    this.effects = [];

    this._buildLights();
    this._buildStars();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  worldX(px) { return px - this.arena.width / 2; }
  worldY(py) { return py - this.arena.height / 2; }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(600, 900, 1200);
    this.scene.add(sun);
  }

  _buildStars() {
    const count = 2400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 16000;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 9000;
      positions[i * 3 + 2] = -2000 - Math.random() * 6000;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: true });
    this.scene.add(new THREE.Points(geo, mat));
  }

  buildArena(state) {
    for (const entry of this.planetMeshes.values()) {
      this.scene.remove(entry.mesh, entry.ring, entry.atmosphere);
    }
    for (const mesh of this.shipMeshes.values()) this.scene.remove(mesh.group);
    this.planetMeshes.clear();
    this.shipMeshes.clear();

    state.planets.forEach((planet, i) => {
      const palette = PLANET_PALETTES[i % PLANET_PALETTES.length];
      const seed = hashStringToSeed(planet.id);
      const texture = makePlanetTexture(palette.base, palette.blotch, seed);

      const geo = new THREE.SphereGeometry(planet.radius, 40, 40);
      const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(this.worldX(planet.x), this.worldY(planet.y), 0);
      mesh.rotation.z = mulberry32(seed)() * Math.PI * 2;
      this.scene.add(mesh);

      // Thin additive rim glow, like a cheap atmospheric scattering effect.
      const atmoGeo = new THREE.SphereGeometry(planet.radius * 1.18, 32, 32);
      const atmoMat = new THREE.MeshBasicMaterial({
        color: palette.base,
        transparent: true,
        opacity: 0.22,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
      atmosphere.position.copy(mesh.position);
      this.scene.add(atmosphere);

      const ringGeo = new THREE.RingGeometry(planet.radius * 1.35, planet.radius * 1.5, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: palette.base, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(mesh.position);
      this.scene.add(ring);

      const spin = (mulberry32(seed + 1)() - 0.5) * 0.006;
      this.planetMeshes.set(planet.id, { mesh, ring, atmosphere, spin });
    });

    state.ships.forEach((ship, index) => {
      const group = new THREE.Group();
      const bodyColor = index === 0 ? 0x4fd1ff : 0xff6b8b;
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(20, 54, 10),
        new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.3 }),
      );
      body.rotation.z = ship.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(body);
      group.position.set(this.worldX(ship.x), this.worldY(ship.y), 0);
      this.scene.add(group);
      this.shipMeshes.set(ship.id, { group, body, baseColor: bodyColor });
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
    this.planetMeshes.delete(planetId);
    this._spawnExplosion(entry.mesh.position.clone(), entry.mesh.geometry.parameters.radius);
    this._triggerShake(26, 450);
  }

  flashShip(shipId) {
    const entry = this.shipMeshes.get(shipId);
    if (!entry) return;
    const original = entry.baseColor;
    entry.body.material.color.setHex(0xffffff);
    setTimeout(() => entry.body.material.color.setHex(original), 160);
    this._spawnExplosion(entry.group.position.clone(), 34, { small: true });
    this._triggerShake(14, 300);
  }

  _addEffect(mesh, duration, update) {
    this.scene.add(mesh);
    this.effects.push({ mesh, start: performance.now(), duration, update });
  }

  // Layered blast: a bright flash, an expanding fireball shell, a flat
  // shockwave ring, and flying debris chunks -- built entirely from
  // primitives so it needs no external sprite/particle assets.
  _spawnExplosion(position, radius, opts = {}) {
    const scale = opts.small ? 0.5 : 1;

    // 1. Flash -- a very short, very bright core.
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flash.position.copy(position);
    this._addEffect(flash, 180, (m, t) => {
      const s = 1 + t * 3.2 * scale;
      m.scale.setScalar(s);
      m.material.opacity = 1 - t;
    });

    // 2. Fireball -- two overlapping shells (hot core + cooler outer) that
    // expand and cool from yellow-white to red-orange to smoky grey.
    const fireballSpecs = [
      { color: 0xffb454, growth: 4.2, duration: 650 },
      { color: 0xff5a2e, growth: 6, duration: 850 },
    ];
    for (const spec of fireballSpecs) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.45, 20, 20),
        new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.85 }),
      );
      mesh.position.copy(position);
      this._addEffect(mesh, spec.duration, (m, t) => {
        m.scale.setScalar(1 + easeOutCubic(t) * spec.growth * scale);
        m.material.opacity = 0.85 * (1 - t) * (1 - t);
      });
    }

    // 3. Shockwave -- a flat expanding ring, additive so it glows.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.5, radius * 0.66, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.copy(position);
    this._addEffect(ring, 550, (m, t) => {
      m.scale.setScalar(1 + easeOutCubic(t) * 9 * scale);
      m.material.opacity = 0.8 * (1 - t);
    });

    // 4. Debris -- small shards flung outward, tumbling as they fade.
    const debrisCount = opts.small ? 7 : 16;
    for (let i = 0; i < debrisCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (40 + Math.random() * 160) * scale;
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), (Math.random() - 0.5) * 0.7);
      const size = 3 + Math.random() * 7;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9, emissive: 0x552200, emissiveIntensity: 0.4 }),
      );
      mesh.position.copy(position);
      const spinX = (Math.random() - 0.5) * 8;
      const spinY = (Math.random() - 0.5) * 8;
      const duration = 700 + Math.random() * 500;
      this._addEffect(mesh, duration, (m, t) => {
        m.position.copy(position).addScaledVector(dir, dist * easeOutCubic(t));
        m.rotation.x += spinX * 0.05;
        m.rotation.y += spinY * 0.05;
        const fade = Math.max(0, 1 - t * 1.3);
        m.scale.setScalar(fade);
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
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        return false;
      }
      return true;
    });

    for (const entry of this.planetMeshes.values()) {
      entry.mesh.rotation.y += entry.spin;
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
    this.setCameraGoal(0, 0, Math.min(this.arena.width * 0.95, 4600));

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
    this.camGoal = { x, y, dist };
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
      this.camState.x += (this.camGoal.x - this.camState.x) * 0.05;
      this.camState.y += (this.camGoal.y - this.camState.y) * 0.05;
      this.camState.dist += (this.camGoal.dist - this.camState.dist) * 0.05;

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
