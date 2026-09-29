# test_space_gravity

Turn-based space artillery. Two ships face off across an arena full of
planets, each pulling your missile off course. Aim through the gravity,
land a direct hit on the enemy ship to win — or blow up a planet in your
way and its gravity is gone for the rest of the match.

- **Real-time gravity**: missiles fly under n-body-style gravity from every
  living planet, so shots curve and you have to aim *through* the field,
  not just at the target.
- **Destroyable planets**: a direct hit on a planet destroys it and removes
  its gravitational pull for the rest of the match, permanently reshaping
  the field.
- **Server-authoritative multiplayer**: the server resolves every shot and
  streams the exact flight path to both clients, so there's no
  client-side desync or cheating on trajectory.
- **Public & Ranked matchmaking**, with an MTG Arena–style ladder:
  Bronze → Silver → Gold → Platinum → Diamond → Mythic, each with four
  divisions (Bronze/Silver never demote on a loss; Mythic uses a raw
  rating instead of divisions).
- **Private lobbies**: create one to get a short code, send it to a friend,
  they join with it and you're paired directly — no queue, no randomness.
  Doesn't affect rank, same as a public match.
- Rendered as a flat 2D physics plane viewed through a tilted, dolly-able
  3D camera — the "kind of 2D, kind of 3D" look — and the camera pulls
  way back during flight so you can see the whole gravity field between
  the ships.

## Running it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two browser tabs/windows (or two
different machines on the same network) to play a match against yourself,
or share the URL with a friend once it's deployed.

`npm run dev` runs the same server with `--watch` for auto-restart while
you edit.

## Tests

```bash
npm test
```

Runs three checks:
- `server/test/physics.test.js` — unit tests for the gravity simulation
  (planet hits, gravity disappearing once a planet is destroyed, curved
  trajectories) and the rank ladder math.
- `server/test/simulateMatch.test.js` — boots a real server and drives two
  `socket.io-client` connections through matchmaking, turn enforcement,
  a resolved shot, and a disconnect-forfeit with a ranked rank update.
- `server/test/lobby.test.js` — creates a private lobby, checks a wrong code
  is rejected and a right code pairs the two players, and that a private
  match doesn't touch rank.

## How it's built

- `public/shared/physics.js` — the gravity + missile flight simulation. A
  plain ES module imported directly by the server as the authoritative
  shot resolver.
- `public/shared/ranks.js` — the rank ladder, also shared so the client can
  render your badge without asking the server.
- `server/` — Express + Socket.IO. `matchmaking.js` is a simple FIFO queue
  per mode, `lobby.js` handles private-lobby codes (create/join/cancel),
  `match.js` generates the arena and resolves fire events, `playerStore.js`
  persists rank/win-loss to a JSON file (see note below).
- `public/client/` — vanilla JS + Three.js (loaded via CDN import map, no
  build step). `game.js` owns the 3D scene/camera/effects, `main.js` wires
  up the menu, Socket.IO events, and the drag-to-aim control pad.

## Known simplifications (prototype, not production)

- **Identity, not auth.** Each browser generates a random id on first
  visit (`localStorage`) and that's your rank record. There's no login,
  so clearing site data or switching browsers gets you a fresh Bronze
  account. Fine for testing with friends; replace with real auth before
  a public launch.
- **Rank persistence is a JSON file** (`server/data/players.json`), not a
  database. It'll get slow/unsafe under concurrent writes at real scale.
- **Ranked matchmaking is FIFO**, not skill-bucketed — it pairs whoever's
  been waiting longest in the ranked queue rather than finding someone
  near your rank.
- **No splash/near-miss damage** — only a direct hit on a ship deals
  damage; a close-but-not-touching shot currently does nothing.

## Deploying so a friend can actually play

This is a single Node process (Express serving the static client +
Socket.IO on the same port), which most Node hosts run out of the box:

- **Render.com**: New → Web Service → connect this repo. Build command
  `npm install`, start command `npm start`. Free tier works for testing.
- **Railway** / **Fly.io**: similar — connect the repo, it'll detect
  Node and run `npm start`.

Whichever you pick, no code changes should be needed — the server reads
`PORT` from the environment already.
