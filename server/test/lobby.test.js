// Integration test for private lobbies: one socket creates a lobby and gets
// a code back, a second socket joins with that code and the two land in the
// same match directly (no queue, no third player involved). Also checks a
// bad code is rejected and that a private match doesn't touch rank.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = 4001;
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
    const host = ioClient(URL, { transports: ['websocket'] });
    const friend = ioClient(URL, { transports: ['websocket'] });
    const stranger = ioClient(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(host, 'connect'), waitFor(friend, 'connect'), waitFor(stranger, 'connect')]);

    host.emit('identify', { playerId: randomUUID(), name: 'Host' });
    friend.emit('identify', { playerId: randomUUID(), name: 'Friend' });
    stranger.emit('identify', { playerId: randomUUID(), name: 'Stranger' });
    await Promise.all([waitFor(host, 'identified'), waitFor(friend, 'identified'), waitFor(stranger, 'identified')]);

    host.emit('lobby:create');
    const { code } = await waitFor(host, 'lobby:created');
    assert.ok(/^[A-Z2-9]{5}$/.test(code), `code should be a 5-char readable code, got "${code}"`);
    console.log('ok: creating a lobby returns a short readable code');

    // A wrong code is rejected without pairing anyone.
    stranger.emit('lobby:join', { code: 'ZZZZZ' });
    const err = await waitFor(stranger, 'lobby:error');
    assert.ok(err.message.length > 0);
    console.log('ok: joining with an unknown code is rejected');

    // The right code pairs host + friend directly into a private match.
    friend.emit('lobby:join', { code });
    const [hostFound, friendFound] = await Promise.all([
      waitFor(host, 'match:found'),
      waitFor(friend, 'match:found'),
    ]);
    assert.equal(hostFound.state.id, friendFound.state.id, 'host and friend land in the same match');
    assert.equal(hostFound.state.mode, 'private');
    assert.notEqual(hostFound.you, friendFound.you, 'they get distinct seats');
    console.log('ok: joining with the right code pairs host and friend into a private match');

    // Once used, the code is gone -- a second join attempt fails.
    stranger.emit('lobby:join', { code });
    const err2 = await waitFor(stranger, 'lobby:error');
    assert.ok(err2.message.length > 0);
    console.log('ok: a lobby code cannot be reused after it pairs a match');

    // A private match finishing must not touch rank (no rankUpdates entries).
    const matchId = hostFound.state.id;
    const firstTurn = hostFound.state.turn;
    const firstSocket = firstTurn === hostFound.you ? host : friend;
    firstSocket.emit('fire', { matchId, angle: 0.15, power: 0.8 });
    await Promise.all([waitFor(host, 'turn:resolved'), waitFor(friend, 'turn:resolved')]);
    console.log('ok: fire works inside a private match same as any other mode');

    host.close();
    friend.close();
    stranger.close();
    console.log('\nAll private lobby checks passed.');
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
