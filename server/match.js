import { randomUUID } from 'node:crypto';
import { simulateFlight, launchVelocity, ARENA } from '../public/shared/physics.js';

const SHIP_X_MARGIN = 380;
const SHIP_Y = ARENA.height / 2;
const SHIP_MAX_HP = 100;
const DIRECT_HIT_DAMAGE = 40;
const MIN_PLANET_GAP = 180;

// Mass scales with the square of radius (denser planets are also bigger),
// so a "way larger" giant genuinely pulls harder -- gravity has to matter
// more, not just look bigger.
const MASS_PER_RADIUS_SQ = 0.06;

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// Weighted toward small so a match is a dense meteor-shower-like field --
// lots of small bodies to route a shot through -- with medium worlds and
// rare giants as the occasional big obstacle/opportunity.
function rollPlanetSize() {
  const roll = Math.random();
  if (roll < 0.55) return { radius: randRange(22, 90), category: 'small' };
  if (roll < 0.85) return { radius: randRange(110, 200), category: 'medium' };
  return { radius: randRange(220, 380), category: 'giant' };
}

function generatePlanets(count) {
  const planets = [];
  let attempts = 0;
  while (planets.length < count && attempts < 600) {
    attempts += 1;
    const { radius, category } = rollPlanetSize();
    const mass = MASS_PER_RADIUS_SQ * radius * radius;
    const x = randRange(SHIP_X_MARGIN + 500, ARENA.width - SHIP_X_MARGIN - 500);
    const y = randRange(radius + 80, ARENA.height - radius - 80);
    const tooClose = planets.some((p) => Math.hypot(p.x - x, p.y - y) < radius + p.radius + MIN_PLANET_GAP);
    if (tooClose) continue;
    planets.push({ id: randomUUID(), x, y, radius, mass, category, alive: true });
  }
  return planets;
}

export function createMatch({ mode, players }) {
  const planets = generatePlanets(7 + Math.floor(Math.random() * 6)); // 7..12, meteor-shower density
  const ships = [
    { id: players[0].playerId, x: SHIP_X_MARGIN, y: SHIP_Y, hp: SHIP_MAX_HP, alive: true, facing: 1 },
    { id: players[1].playerId, x: ARENA.width - SHIP_X_MARGIN, y: SHIP_Y, hp: SHIP_MAX_HP, alive: true, facing: -1 },
  ];

  return {
    id: randomUUID(),
    mode,
    players, // [{ playerId, socketId, name }]
    planets,
    ships,
    turn: Math.random() < 0.5 ? 0 : 1,
    arena: ARENA,
    finished: false,
    winnerPlayerId: null,
  };
}

// Resolves one fired shot against the match's authoritative state, mutating
// planets/ships in place and returning what happened for both clients to
// replay. angle is radians, power is 0..1.
export function resolveFire(match, shooterIndex, angle, power) {
  const shooter = match.ships[shooterIndex];
  const target = match.ships[1 - shooterIndex];
  const clampedPower = Math.max(0, Math.min(1, power));
  const { vx, vy } = launchVelocity(angle, clampedPower, shooter.facing);
  const launchOffset = 34 * shooter.facing;

  const { path, outcome } = simulateFlight({
    start: { x: shooter.x + launchOffset, y: shooter.y, vx, vy },
    planets: match.planets,
    ships: match.ships,
    bounds: { minX: -200, maxX: match.arena.width + 200, minY: -200, maxY: match.arena.height + 200 },
  });

  let destroyedPlanetId = null;
  let damagedShipId = null;

  if (outcome.type === 'planet') {
    const planet = match.planets.find((p) => p.id === outcome.planetId);
    if (planet) {
      planet.alive = false;
      destroyedPlanetId = planet.id;
    }
  } else if (outcome.type === 'ship') {
    const hitShip = match.ships.find((s) => s.id === outcome.shipId);
    if (hitShip) {
      hitShip.hp = Math.max(0, hitShip.hp - DIRECT_HIT_DAMAGE);
      damagedShipId = hitShip.id;
      if (hitShip.hp === 0) {
        hitShip.alive = false;
        match.finished = true;
        match.winnerPlayerId = hitShip.id === shooter.id ? target.id : shooter.id;
      }
    }
  }

  if (!match.finished) {
    match.turn = 1 - shooterIndex;
  }

  return { path, outcome, destroyedPlanetId, damagedShipId, finished: match.finished, winnerPlayerId: match.winnerPlayerId };
}

export function publicMatchState(match) {
  return {
    id: match.id,
    mode: match.mode,
    arena: match.arena,
    planets: match.planets,
    ships: match.ships,
    turn: match.turn,
    players: match.players.map((p) => ({ playerId: p.playerId, name: p.name })),
    finished: match.finished,
    winnerPlayerId: match.winnerPlayerId,
  };
}
