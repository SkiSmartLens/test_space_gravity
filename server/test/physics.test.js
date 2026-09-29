import assert from 'node:assert/strict';
import { simulateFlight, gravityAt } from '../../public/shared/physics.js';
import { applyResult, defaultRank, TIERS } from '../../public/shared/ranks.js';

// A missile fired dead-on at a planet directly ahead, with no vertical
// velocity, should fly a straight line (gravity pulls exactly along the
// line of travel) and register a "planet" hit -- this is the "blow up the
// moon" mechanic.
{
  const planet = { id: 'p1', x: 500, y: 0, radius: 40, mass: 900, alive: true };
  const { outcome } = simulateFlight({
    start: { x: 0, y: 0, vx: 400, vy: 0 },
    planets: [planet],
    ships: [],
    bounds: { minX: -100, maxX: 2000, minY: -500, maxY: 500 },
  });
  assert.equal(outcome.type, 'planet');
  assert.equal(outcome.planetId, 'p1');
  console.log('ok: a direct shot on a planet resolves as a planet hit');
}

// Once a planet is marked dead, it must stop contributing gravity, and a
// destroyed planet must never register a collision again.
{
  const deadPlanet = { id: 'p1', x: 500, y: 0, radius: 40, mass: 900, alive: false };
  const { ax, ay } = gravityAt(0, 0, [deadPlanet]);
  assert.equal(ax, 0);
  assert.equal(ay, 0);

  const { outcome } = simulateFlight({
    start: { x: 0, y: 0, vx: 400, vy: 0 },
    planets: [deadPlanet],
    ships: [],
    bounds: { minX: -100, maxX: 2000, minY: -500, maxY: 500 },
  });
  assert.equal(outcome.type, 'oob', 'a dead planet exerts no gravity and blocks nothing');
  console.log('ok: destroying a planet removes its gravity and its collision');
}

// A planet off to the side should curve a straight shot toward it (gravity
// actually bends the trajectory) without necessarily causing a hit.
{
  const sidePlanet = { id: 'side', x: 400, y: 260, radius: 30, mass: 1400, alive: true };
  const { path } = simulateFlight({
    start: { x: 0, y: 0, vx: 500, vy: 0 },
    planets: [sidePlanet],
    ships: [],
    bounds: { minX: -100, maxX: 2000, minY: -800, maxY: 800 },
    maxSteps: 200,
  });
  const midY = path[100].y;
  assert.ok(midY > 5, `expected the shot to curve toward the planet's side (y=${midY})`);
  console.log('ok: an off-axis planet curves the missile toward it');
}

// Rank ladder: 4 ranked wins in a row promote out of a division; Bronze
// never demotes on a loss (Arena-style floor protection).
{
  let rank = defaultRank();
  for (let i = 0; i < 4; i++) rank = applyResult(rank, true);
  assert.equal(rank.division, 3, 'four wins clears one division');

  const bronzeFloor = { tier: 0, division: 4, pips: 0, mythicRating: 1500 };
  const afterLoss = applyResult(bronzeFloor, false);
  assert.deepEqual(afterLoss, bronzeFloor, 'Bronze does not demote on a loss');
  console.log('ok: rank ladder promotes on wins and floor-protects Bronze on a loss');
}

console.log(`\nAll physics/rank unit checks passed. (Tiers: ${TIERS.join(' -> ')})`);
