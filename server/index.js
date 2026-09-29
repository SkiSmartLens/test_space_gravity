import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import { joinQueue, leaveQueues } from './matchmaking.js';
import { createLobby, joinLobby, cancelLobbyForPlayer } from './lobby.js';
import { createMatch, resolveFire, publicMatchState } from './match.js';
import { getPlayer, saveRank } from './playerStore.js';
import { applyResult, rankLabel } from '../public/shared/ranks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const httpServer = createServer(app);
const io = new Server(httpServer);

// matchId -> match state (see server/match.js#createMatch)
const matches = new Map();
// socket.id -> { playerId, name, matchId | null }
const sockets = new Map();

function toClientPlayer(record) {
  return { name: record.name, rank: record.rank, rankLabel: rankLabel(record.rank), wins: record.wins, losses: record.losses };
}

function startMatch(mode, pair) {
  const match = createMatch({ mode, players: pair });
  matches.set(match.id, match);

  pair.forEach((p, index) => {
    const s = sockets.get(p.socketId);
    if (s) s.matchId = match.id;
    io.sockets.sockets.get(p.socketId)?.join(match.id);
    io.to(p.socketId).emit('match:found', { you: index, state: publicMatchState(match) });
  });
}

function endMatch(match, winnerPlayerId, reason) {
  match.finished = true;
  match.winnerPlayerId = winnerPlayerId;

  const rankUpdates = {};
  if (match.mode === 'ranked') {
    for (const p of match.players) {
      const record = getPlayer(p.playerId);
      const won = p.playerId === winnerPlayerId;
      const newRank = applyResult(record.rank, won);
      const saved = saveRank(p.playerId, newRank, won);
      rankUpdates[p.playerId] = { rank: saved.rank, rankLabel: rankLabel(saved.rank) };
    }
  }

  io.to(match.id).emit('match:end', { winnerPlayerId, reason, rankUpdates });
  matches.delete(match.id);
}

io.on('connection', (socket) => {
  socket.on('identify', ({ playerId, name }) => {
    if (!playerId) return;
    const record = getPlayer(playerId, name);
    sockets.set(socket.id, { playerId, name: record.name, matchId: null });
    socket.emit('identified', { player: toClientPlayer(record) });
  });

  socket.on('queue:join', ({ mode }) => {
    const entry = sockets.get(socket.id);
    if (!entry || (mode !== 'public' && mode !== 'ranked')) return;

    const pair = joinQueue(mode, { playerId: entry.playerId, socketId: socket.id, name: entry.name });
    if (!pair) {
      socket.emit('queue:searching', { mode });
      return;
    }

    startMatch(mode, pair);
  });

  socket.on('queue:leave', () => {
    const entry = sockets.get(socket.id);
    if (entry) leaveQueues(entry.playerId);
  });

  socket.on('lobby:create', () => {
    const entry = sockets.get(socket.id);
    if (!entry) return;
    const code = createLobby({ playerId: entry.playerId, socketId: socket.id, name: entry.name });
    socket.emit('lobby:created', { code });
  });

  socket.on('lobby:cancel', () => {
    const entry = sockets.get(socket.id);
    if (entry) cancelLobbyForPlayer(entry.playerId);
  });

  socket.on('lobby:join', ({ code }) => {
    const entry = sockets.get(socket.id);
    if (!entry) return;

    const pair = joinLobby(code, { playerId: entry.playerId, socketId: socket.id, name: entry.name });
    if (!pair) {
      socket.emit('lobby:error', { message: 'That code is not a lobby waiting for a player. Check it and try again.' });
      return;
    }

    startMatch('private', pair);
  });

  socket.on('fire', ({ matchId, angle, power }) => {
    const entry = sockets.get(socket.id);
    const match = matches.get(matchId);
    if (!entry || !match || match.finished) return;

    const shooterIndex = match.players.findIndex((p) => p.playerId === entry.playerId);
    if (shooterIndex === -1 || shooterIndex !== match.turn) return; // not your turn

    const result = resolveFire(match, shooterIndex, Number(angle) || 0, Number(power) || 0);
    io.to(match.id).emit('turn:resolved', { ...result, state: publicMatchState(match) });

    if (result.finished) {
      endMatch(match, result.winnerPlayerId, 'destroyed');
    }
  });

  socket.on('disconnect', () => {
    const entry = sockets.get(socket.id);
    if (!entry) return;
    leaveQueues(entry.playerId);
    cancelLobbyForPlayer(entry.playerId);

    if (entry.matchId) {
      const match = matches.get(entry.matchId);
      if (match && !match.finished) {
        const remaining = match.players.find((p) => p.playerId !== entry.playerId);
        if (remaining) endMatch(match, remaining.playerId, 'forfeit');
      }
    }
    sockets.delete(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`test_space_gravity server listening on http://localhost:${PORT}`);
});
