import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defaultRank } from '../public/shared/ranks.js';

// Lightweight file-backed store keyed by an anonymous player id the client
// generates and keeps in localStorage. This is deliberately not a real
// auth system -- good enough to let rank persist across sessions for a
// prototype, but swap for a real database + login before any public launch.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');

function load() {
  if (!existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function persist(state) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

const state = load();

export function getPlayer(playerId, name) {
  if (!state[playerId]) {
    state[playerId] = { name: name || 'Pilot', rank: defaultRank(), wins: 0, losses: 0 };
    persist(state);
  } else if (name && state[playerId].name !== name) {
    state[playerId].name = name;
    persist(state);
  }
  return state[playerId];
}

export function saveRank(playerId, rank, won) {
  const player = getPlayer(playerId);
  player.rank = rank;
  if (won) player.wins += 1;
  else player.losses += 1;
  persist(state);
  return player;
}
