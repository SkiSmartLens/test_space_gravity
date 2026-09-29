// Ad-hoc integration test (no framework, just node:assert): boots the real
// server as a child process and drives it with two socket.io-client
// connections to prove matchmaking, turn enforcement, shot resolution and
// forfeit-driven rank updates all work end to end.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = 3999;
const URL = `http://localhost:${PORT}`;

function waitFor(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitForNoEvent(socket, event, timeoutMs = 800) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, timeoutMs);
    socket.once(event, () => {
      clearTimeout(timer);
      reject(new Error(`unexpectedly received "${event}"`));
    });
  });
}

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) resolve();
    });
    server.stderr.on('data', (chunk) => console.error('[server]', chunk.toString()));
    server.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });

  try {
    const alice = ioClient(URL, { transports: ['websocket'] });
    const bob = ioClient(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(alice, 'connect'), waitFor(bob, 'connect')]);

    const aliceId = randomUUID();
    const bobId = randomUUID();
    alice.emit('identify', { playerId: aliceId, name: 'Alice' });
    bob.emit('identify', { playerId: bobId, name: 'Bob' });
    const aliceIdentified = await waitFor(alice, 'identified');
    assert.equal(aliceIdentified.player.rank.tier, 0, 'new players start at Bronze');
    console.log('ok: identify assigns starting Bronze rank');

    alice.emit('queue:join', { mode: 'ranked' });
    bob.emit('queue:join', { mode: 'ranked' });
    const [aliceFound, bobFound] = await Promise.all([
      waitFor(alice, 'match:found'),
      waitFor(bob, 'match:found'),
    ]);
    assert.equal(aliceFound.state.id, bobFound.state.id, 'both players land in the same match');
    assert.notEqual(aliceFound.you, bobFound.you, 'players get distinct seats');
    console.log('ok: ranked queue pairs two waiting players into one match');

    const matchId = aliceFound.state.id;
    const firstTurn = aliceFound.state.turn; // 0 or 1
    const [firstSocket, firstName, secondSocket] = firstTurn === aliceFound.you
      ? [alice, 'Alice', bob]
      : [bob, 'Bob', alice];

    // Out-of-turn fire must be silently rejected.
    secondSocket.emit('fire', { matchId, angle: 0, power: 1 });
    await waitForNoEvent(secondSocket, 'turn:resolved');
    console.log('ok: firing out of turn produces no resolution');

    // The player whose turn it is CAN fire, and both sockets see the result.
    firstSocket.emit('fire', { matchId, angle: 0.15, power: 0.8 });
    const [resolvedA, resolvedB] = await Promise.all([
      waitFor(alice, 'turn:resolved'),
      waitFor(bob, 'turn:resolved'),
    ]);
    assert.ok(Array.isArray(resolvedA.path) && resolvedA.path.length > 0, 'resolution includes a flight path');
    assert.equal(resolvedA.state.turn, 1 - firstTurn, 'turn passes to the other player after a non-finishing shot');
    assert.deepEqual(resolvedA.state.turn, resolvedB.state.turn, 'both clients agree on whose turn is next');
    console.log(`ok: ${firstName}'s shot resolved identically for both clients and the turn advanced`);

    // Disconnecting mid-match should forfeit the win to the remaining player.
    const remaining = firstSocket === alice ? bob : alice;
    const remainingId = firstSocket === alice ? bobId : aliceId;
    const endPromise = waitFor(remaining, 'match:end');
    firstSocket.close();
    const endPayload = await endPromise;
    assert.equal(endPayload.winnerPlayerId, remainingId, 'disconnecting player forfeits the match');
    assert.equal(endPayload.reason, 'forfeit');
    const rankAfter = endPayload.rankUpdates[remainingId];
    assert.ok(rankAfter, 'ranked match end includes a rank update for the winner');
    assert.ok(
      rankAfter.rank.pips > 0 || rankAfter.rank.tier > 0,
      'winner gained rank progress from the forfeit win',
    );
    console.log('ok: disconnect forfeits the match and updates ranked pips for the winner');

    remaining.close();
    console.log('\nAll integration checks passed.');
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
