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
const menuActions = el('menu-actions');
const btnPublic = el('btn-public');
const btnRanked = el('btn-ranked');
const btnPrivate = el('btn-private');
const btnAgain = el('btn-again');
const privatePanel = el('private-panel');
const btnCreateLobby = el('btn-create-lobby');
const joinCodeInput = el('join-code-input');
const btnJoinLobby = el('btn-join-lobby');
const privateError = el('private-error');
const btnPrivateBack = el('btn-private-back');
const lobbyWaiting = el('lobby-waiting');
const lobbyCodeEl = el('lobby-code');
const btnCopyCode = el('btn-copy-code');
const btnCancelLobby = el('btn-cancel-lobby');
const turnIndicator = el('turn-indicator');
const hpFillYou = el('hp-fill-you');
const hpFillOpp = el('hp-fill-opp');
const aimPad = el('aim-pad');
const aimStick = el('aim-stick');
const resultTitle = el('result-title');
const resultRank = el('result-rank');
const zoomInBtn = el('zoom-in');
const zoomOutBtn = el('zoom-out');

nameInput.value = identity.name;
nameInput.addEventListener('change', () => {
  const clean = nameInput.value.trim().slice(0, 16) || identity.name;
  identity.name = clean;
  localStorage.setItem(STORAGE_NAME_KEY, clean);
});

const canvas = el('scene');
const game = new Game(canvas, ARENA);
game.start();
window.__game = game; // debug hook for manual/automated visual testing

// Manual zoom: scroll/pinch on the canvas, or the +/- buttons in the corner,
// layer on top of whatever the automatic camera framing is doing.
canvas.addEventListener(
  'wheel',
  (evt) => {
    evt.preventDefault();
    const factor = Math.exp(evt.deltaY * 0.0015);
    game.adjustZoom(factor);
  },
  { passive: false },
);
zoomInBtn.addEventListener('click', () => game.adjustZoom(1 / 1.25));
zoomOutBtn.addEventListener('click', () => game.adjustZoom(1.25));

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

socket.on('lobby:created', ({ code }) => {
  showLobbyWaiting(code);
});

socket.on('lobby:error', ({ message }) => {
  btnJoinLobby.disabled = false;
  privateError.textContent = message;
});

socket.on('match:found', ({ you, state }) => {
  match = { id: state.id, mode: state.mode, you, state };
  showDefaultMenu();
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
    resultRank.textContent = match.mode === 'ranked' ? '' : 'Rank unaffected.';
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
  showDefaultMenu();
});

// --- Private lobby: create a code and wait, or join a friend's code. ---
function showDefaultMenu() {
  menuActions.classList.remove('hidden');
  privatePanel.classList.add('hidden');
  lobbyWaiting.classList.add('hidden');
  privateError.textContent = '';
  joinCodeInput.value = '';
  btnJoinLobby.disabled = false;
}

function showPrivatePanel() {
  menuActions.classList.add('hidden');
  privatePanel.classList.remove('hidden');
  lobbyWaiting.classList.add('hidden');
  privateError.textContent = '';
}

function showLobbyWaiting(code) {
  menuActions.classList.add('hidden');
  privatePanel.classList.add('hidden');
  lobbyWaiting.classList.remove('hidden');
  lobbyCodeEl.textContent = code;
}

btnPrivate.addEventListener('click', showPrivatePanel);
btnPrivateBack.addEventListener('click', showDefaultMenu);

btnCreateLobby.addEventListener('click', () => {
  socket.emit('lobby:create');
});

btnCancelLobby.addEventListener('click', () => {
  socket.emit('lobby:cancel');
  showDefaultMenu();
});

btnCopyCode.addEventListener('click', async () => {
  const code = lobbyCodeEl.textContent;
  try {
    await navigator.clipboard.writeText(code);
    const original = btnCopyCode.textContent;
    btnCopyCode.textContent = 'Copied!';
    setTimeout(() => { btnCopyCode.textContent = original; }, 1500);
  } catch {
    // Clipboard API unavailable (e.g. insecure context) -- the code is
    // already big and visible on screen for a manual copy.
  }
});

function submitJoinCode() {
  const code = joinCodeInput.value.trim();
  if (!code) return;
  btnJoinLobby.disabled = true;
  privateError.textContent = '';
  socket.emit('lobby:join', { code });
}

btnJoinLobby.addEventListener('click', submitJoinCode);
joinCodeInput.addEventListener('keydown', (evt) => {
  if (evt.key === 'Enter') submitJoinCode();
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
  // Deliberately no predicted-trajectory preview here -- you judge the shot
  // yourself, same as the original Angry Birds slingshot.
}

function onPointerUp(evt) {
  if (!dragging || !match) return;
  dragging = false;
  aimStick.style.transform = 'translate(0px, 0px)';

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
