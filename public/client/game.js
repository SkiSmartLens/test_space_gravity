import * as THREE from 'three';
import { simulateFlight, launchVelocity } from '../shared/physics.js';

const PLANET_COLORS = [0xd88a4c, 0x6fb1ff, 0xc770ff, 0x7ee08a, 0xffd166, 0xff8fa3];

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
    for (const mesh of this.planetMeshes.values()) this.scene.remove(mesh);
    for (const mesh of this.shipMeshes.values()) this.scene.remove(mesh.group);
    this.planetMeshes.clear();
    this.shipMeshes.clear();

    state.planets.forEach((planet, i) => {
      const color = PLANET_COLORS[i % PLANET_COLORS.length];
      const geo = new THREE.SphereGeometry(planet.radius, 32, 32);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(this.worldX(planet.x), this.worldY(planet.y), 0);
      this.scene.add(mesh);

      const ringGeo = new THREE.RingGeometry(planet.radius * 1.35, planet.radius * 1.5, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(mesh.position);
      this.scene.add(ring);

      this.planetMeshes.set(planet.id, { mesh, ring });
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
    this.scene.remove(entry.mesh);
    this.scene.remove(entry.ring);
    this.planetMeshes.delete(planetId);
    this._spawnBurst(entry.mesh.position.clone(), 0xffb454);
  }

  flashShip(shipId) {
    const entry = this.shipMeshes.get(shipId);
    if (!entry) return;
    const original = entry.baseColor;
    entry.body.material.color.setHex(0xffffff);
    setTimeout(() => entry.body.material.color.setHex(original), 160);
    this._spawnBurst(entry.group.position.clone(), 0xff5566, 60);
  }

  _spawnBurst(position, color, size = 90) {
    const geo = new THREE.SphereGeometry(1, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.effects.push({ mesh, start: performance.now(), duration: 500, maxSize: size });
  }

  _updateEffects(now) {
    this.effects = this.effects.filter((fx) => {
      const t = (now - fx.start) / fx.duration;
      if (t >= 1) {
        this.scene.remove(fx.mesh);
        return false;
      }
      const scale = 1 + t * fx.maxSize;
      fx.mesh.scale.setScalar(scale);
      fx.mesh.material.opacity = 0.85 * (1 - t);
      return true;
    });
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

      this.camera.position.set(this.camState.x, this.camState.y + this.camState.dist * 0.32, this.camState.dist);
      this.camera.lookAt(this.camState.x, this.camState.y, 0);

      this._updateEffects(now);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
