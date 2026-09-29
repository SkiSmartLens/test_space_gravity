import { ARENA } from '../shared/physics.js';
import { TIER_COLORS, TIERS } from '../shared/ranks.js';
import { Game } from './game.js';

const STORAGE_ID_KEY = 'tsg_playerId';
const STORAGE_NAME_KEY = 'tsg_name';

function getOrCreateIdentity() {
  let playerId = localStorage.getItem(STORAGE_ID_KEY);
  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem(STORAGE_ID_KEY, playerId);
  }
  const name = localStorage.getItem(STORAGE_NAME_KEY) || `Pilot-${playerId.slice(0, 4)}`;
  return { playerId, name };
}

const identity = getOrCreateIdentity();

const el = (id) => document.getElementById(id);
const menu = el('menu');
const hud = el('hud');
const resultOverlay = el('result');
const nameInput = el('name-input');
const rankBadge = el('rank-badge');
const rankSwatch = el('rank-swatch');
const rankText = el('rank-text');
const rankRecord = el('rank-record');
const menuStatus = el('menu-status');
const btnPublic = el('btn-public');
const btnRanked = el('btn-ranked');
const btnAgain = el('btn-again');
const turnIndicator = el('turn-indicator');
const hpFillYou = el('hp-fill-you');
const hpFillOpp = el('hp-fill-opp');
const aimPad = el('aim-pad');
const aimStick = el('aim-stick');
const resultTitle = el('result-title');
const resultRank = el('result-rank');

nameInput.value = identity.name;
nameInput.addEventListener('change', () => {
  const clean = nameInput.value.trim().slice(0, 16) || identity.name;
  identity.name = clean;
  localStorage.setItem(STORAGE_NAME_KEY, clean);
});

const canvas = el('scene');
const game = new Game(canvas, ARENA);
game.start();

const socket = io();
let match = null; // { id, mode, you, state }

socket.on('connect', () => {
  socket.emit('identify', { playerId: identity.playerId, name: identity.name });
});

socket.on('identified', ({ player }) => {
  renderRankBadge(player.rank, player.wins, player.losses);
});

socket.on('queue:searching', ({ mode }) => {
  menuStatus.textContent = `Searching for a ${mode} opponent...`;
});

socket.on('match:found', ({ you, state }) => {
  match = { id: state.id, mode: state.mode, you, state };
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  resultOverlay.classList.add('hidden');
  game.buildArena(state);
  focusForTurn();
  updateHud();
});

socket.on('turn:resolved', (payload) => {
  if (!match) return;
  match.state = payload.state;

  game.playShot(payload.path, () => {
    if (payload.destroyedPlanetId) game.destroyPlanet(payload.destroyedPlanetId);
    if (payload.damagedShipId) game.flashShip(payload.damagedShipId);
    updateHud();
    if (!payload.finished) focusForTurn();
  });
});

socket.on('match:end', ({ winnerPlayerId, rankUpdates }) => {
  if (!match) return;
  const youWon = winnerPlayerId === identity.playerId;
  resultTitle.textContent = youWon ? 'Victory' : 'Defeat';

  const mine = rankUpdates?.[identity.playerId];
  if (mine) {
    resultRank.textContent = `New rank: ${mine.rankLabel}`;
    renderRankBadge(mine.rank);
  } else {
    resultRank.textContent = match.mode === 'ranked' ? '' : 'Public match — rank unaffected.';
  }

  setTimeout(() => resultOverlay.classList.remove('hidden'), 600);
});

btnPublic.addEventListener('click', () => joinQueue('public'));
btnRanked.addEventListener('click', () => joinQueue('ranked'));

function joinQueue(mode) {
  btnPublic.disabled = true;
  btnRanked.disabled = true;
  menuStatus.textContent = 'Connecting...';
  socket.emit('queue:join', { mode });
}

btnAgain.addEventListener('click', () => {
  match = null;
  hud.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  menu.classList.remove('hidden');
  menuStatus.textContent = '';
  btnPublic.disabled = false;
  btnRanked.disabled = false;
});

function renderRankBadge(rank, wins, losses) {
  rankBadge.classList.remove('hidden');
  const tierName = TIERS[rank.tier];
  const color = TIER_COLORS[tierName];
  rankSwatch.style.color = color;
  rankText.textContent = tierName === 'Mythic' ? `Mythic ${Math.round(rank.mythicRating)}` : `${tierName} ${rank.division}`;
  if (wins !== undefined) rankRecord.textContent = `${wins}W - ${losses}L`;
}

function myShip() {
  return match.state.ships[match.you];
}
function oppShip() {
  return match.state.ships[1 - match.you];
}

function updateHud() {
  hpFillYou.style.width = `${myShip().hp}%`;
  hpFillOpp.style.width = `${oppShip().hp}%`;
  const yourTurn = match.state.turn === match.you;
  turnIndicator.textContent = yourTurn ? 'Your Turn' : "Opponent's Turn";
  aimPad.style.visibility = yourTurn && !match.state.finished ? 'visible' : 'hidden';
}

function focusForTurn() {
  const activeShip = match.state.ships[match.state.turn];
  game.setCameraGoal(game.worldX(activeShip.x), game.worldY(activeShip.y), 900);
  updateHud();
}

// --- Aim pad: press-drag-release, angry-birds style, mapped into the
// shooting ship's local forward/up frame so it works from either side. ---
let dragging = false;
const MAX_DRAG = 70;

function padVectorFromEvent(evt) {
  const rect = aimPad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return { dx: evt.clientX - cx, dy: evt.clientY - cy };
}

function currentAimFromVector(dx, dy) {
  const dist = Math.min(MAX_DRAG, Math.hypot(dx, dy));
  const power = Math.max(0.12, dist / MAX_DRAG);
  const ship = myShip();
  const localForward = dx * ship.facing;
  const localUp = -dy;
  const angle = Math.atan2(localUp, localForward);
  return { angle, power };
}

function onPointerMove(evt) {
  if (!dragging || !match) return;
  const { dx, dy } = padVectorFromEvent(evt);
  const clampedDx = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
  const clampedDy = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dy));
  aimStick.style.transform = `translate(${clampedDx}px, ${clampedDy}px)`;

  const { angle, power } = currentAimFromVector(dx, dy);
  game.previewShot(myShip(), angle, power, match.state.planets, match.state.ships);
}

function onPointerUp(evt) {
  if (!dragging || !match) return;
  dragging = false;
  aimStick.style.transform = 'translate(0px, 0px)';
  game.clearGhost();

  if (match.state.turn !== match.you || match.state.finished) return;
  const { dx, dy } = padVectorFromEvent(evt);
  if (Math.hypot(dx, dy) < 8) return; // treat as a cancelled tap, not a shot
  const { angle, power } = currentAimFromVector(dx, dy);
  socket.emit('fire', { matchId: match.id, angle, power });
  aimPad.style.visibility = 'hidden';
}

aimPad.addEventListener('pointerdown', (evt) => {
  if (!match || match.state.turn !== match.you || match.state.finished) return;
  dragging = true;
  aimPad.setPointerCapture(evt.pointerId);
});
aimPad.addEventListener('pointermove', onPointerMove);
aimPad.addEventListener('pointerup', onPointerUp);
aimPad.addEventListener('pointercancel', onPointerUp);
