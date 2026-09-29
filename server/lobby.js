// Private lobbies: one player creates a lobby and gets a short code back,
// a second player joins with that code, and the two are paired into a
// match directly -- no queue, no randomness, just the two of you.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I -- easy to read aloud

// code -> { playerId, socketId, name }
const lobbies = new Map();

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (lobbies.has(code));
  return code;
}

export function createLobby(entry) {
  cancelLobbyForPlayer(entry.playerId); // replace any lobby they already had open
  const code = generateCode();
  lobbies.set(code, entry);
  return code;
}

// Returns the [host, joiner] pair on success, or null if the code doesn't
// exist / belongs to the same player trying to join their own lobby.
export function joinLobby(rawCode, entry) {
  const code = String(rawCode || '').trim().toUpperCase();
  const host = lobbies.get(code);
  if (!host || host.playerId === entry.playerId) return null;
  lobbies.delete(code);
  return [host, entry];
}

export function cancelLobbyForPlayer(playerId) {
  for (const [code, entry] of lobbies) {
    if (entry.playerId === playerId) {
      lobbies.delete(code);
      return code;
    }
  }
  return null;
}
