// Rank ladder modeled on MTG Arena's tiers: Bronze -> Silver -> Gold ->
// Platinum -> Diamond -> Mythic. Bronze/Silver never demote on a loss
// (matches Arena's floor protection); Platinum+ can drop a division.
// Mythic drops divisions entirely in favor of a raw rating number.

export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Mythic'];
export const MYTHIC_INDEX = TIERS.length - 1;
export const PIPS_PER_DIVISION = 4;
export const STARTING_MYTHIC_RATING = 1500;

export const TIER_COLORS = {
  Bronze: '#a9693f',
  Silver: '#b9c0c9',
  Gold: '#e0b23d',
  Platinum: '#5fd0c6',
  Diamond: '#7fa8ff',
  Mythic: '#ff5fb0',
};

export function defaultRank() {
  return { tier: 0, division: 4, pips: 0, mythicRating: STARTING_MYTHIC_RATING };
}

export function rankLabel(rank) {
  const tierName = TIERS[rank.tier];
  if (tierName === 'Mythic') return `Mythic (${Math.round(rank.mythicRating)})`;
  return `${tierName} ${rank.division}`;
}

// Pure function: given a rank and a match result, returns the new rank.
// Kept side-effect free so it's easy to unit test from server/test/.
export function applyResult(rank, won) {
  const r = { ...rank };

  if (TIERS[r.tier] === 'Mythic') {
    r.mythicRating += won ? 28 : -22;
    r.mythicRating = Math.max(1200, r.mythicRating);
    return r;
  }

  if (won) {
    r.pips += 1;
    if (r.pips >= PIPS_PER_DIVISION) {
      r.pips = 0;
      r.division -= 1;
      if (r.division === 0) {
        r.tier += 1;
        r.division = TIERS[r.tier] === 'Mythic' ? 0 : 4;
        if (TIERS[r.tier] === 'Mythic') r.mythicRating = STARTING_MYTHIC_RATING;
      }
    }
    return r;
  }

  // Loss.
  const floorProtected = TIERS[r.tier] === 'Bronze' || TIERS[r.tier] === 'Silver';
  if (floorProtected) return r;

  r.pips -= 1;
  if (r.pips < 0) {
    if (r.division < 4) {
      r.division += 1;
      r.pips = PIPS_PER_DIVISION - 1;
    } else if (r.tier > 0) {
      r.tier -= 1;
      r.division = 1;
      r.pips = PIPS_PER_DIVISION - 1;
    } else {
      r.pips = 0;
    }
  }
  return r;
}
