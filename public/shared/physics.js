// Shared gravity + missile flight simulation. A plain ES module so the
// server can import it directly as the authoritative shot resolver.

export const G = 6500;
export const DT = 1 / 60;
export const MAX_FLIGHT_STEPS = 1100; // ~18s of flight before we give up
export const SHIP_HIT_RADIUS = 40; // matches the larger ship model's silhouette
export const ARENA = { width: 5000, height: 2400 };

// Acceleration on a point at (x, y) from every living planet.
export function gravityAt(x, y, planets) {
  let ax = 0;
  let ay = 0;
  for (const p of planets) {
    if (!p.alive) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq) || 1;
    // Soften right at the surface so the missile doesn't get flung to
    // infinity if a step lands it almost exactly on a planet's center.
    const softened = Math.max(distSq, (p.radius * 0.6) ** 2);
    const accel = (G * p.mass) / softened;
    ax += (dx / dist) * accel;
    ay += (dy / dist) * accel;
  }
  return { ax, ay };
}

// Advances one missile state by dt using semi-implicit (symplectic) Euler,
// which stays stable for orbit-like curves far better than plain Euler.
export function stepMissile(state, planets, dt = DT) {
  const { ax, ay } = gravityAt(state.x, state.y, planets);
  state.vx += ax * dt;
  state.vy += ay * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  return state;
}

// Runs a full flight from launch to resolution (hit planet / hit ship /
// left the arena / timed out). Used by the server as the authoritative
// outcome, and by the client (with a shorter maxSteps) as a preview ghost.
export function simulateFlight({ start, planets, ships, bounds, maxSteps = MAX_FLIGHT_STEPS, dt = DT }) {
  const state = { x: start.x, y: start.y, vx: start.vx, vy: start.vy };
  const path = [{ x: state.x, y: state.y }];

  for (let step = 0; step < maxSteps; step++) {
    stepMissile(state, planets, dt);
    path.push({ x: state.x, y: state.y });

    for (const p of planets) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - state.x, p.y - state.y) <= p.radius) {
        return { path, outcome: { type: 'planet', planetId: p.id } };
      }
    }

    for (const s of ships ?? []) {
      if (!s.alive) continue;
      if (Math.hypot(s.x - state.x, s.y - state.y) <= SHIP_HIT_RADIUS) {
        return { path, outcome: { type: 'ship', shipId: s.id } };
      }
    }

    if (bounds && (state.x < bounds.minX || state.x > bounds.maxX || state.y < bounds.minY || state.y > bounds.maxY)) {
      return { path, outcome: { type: 'oob' } };
    }
  }

  return { path, outcome: { type: 'timeout' } };
}

// Converts an aim (angle in radians, 0 = straight right, power 0..1) fired
// from a ship into an initial missile velocity. Each ship "faces" the
// opponent, so ship 0 fires with a rightward bias and ship 1 leftward.
export function launchVelocity(angle, power, facing) {
  const speed = 260 + power * 620; // clamp power to [0,1] before calling
  return {
    vx: Math.cos(angle) * speed * facing,
    vy: Math.sin(angle) * speed,
  };
}
