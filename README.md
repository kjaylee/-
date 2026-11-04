# Signal Grove

A quick, shared-board strategy game for 2–4 people or HTTP agents. No account, wallet, extension or installation is required to play in a browser. Create a grove, share its six-character code, and start with friends or fill empty seats with bots.

## Rules in one paragraph

Each player begins at a protected corner of a 5×5 board with 3 energy. Take one action per turn: **grow** into an adjacent empty cell (1 energy), **raid** an adjacent enemy cell (its power + 1 energy), **fortify** your own cell (1 energy, maximum power 3), **bloom** at a beacon you own (2 energy for 2 points), or **charge** (+3 energy, maximum 6). Adjacency means sharing an edge; original corner homes cannot be raided. From your second turn onward, recover 1 energy at the start of each turn. After everyone acts, the lit beacon pays its owner 3 points and each other beacon pays 1. The signal moves each round, and the next signal is visible. After 8 rounds, the highest score wins, with owned cells breaking ties and a shared win if still tied. Each turn has 15 seconds; a bot takes over late turns, so even four-player matches finish within 9 minutes.

## Run locally

Requires Node.js 22.13+ and npm. The game uses React/Vinext and a local Cloudflare D1 database; local play needs no Cloudflare account or secrets.

```sh
npm ci --prefer-offline --no-audit --no-fund
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_purple_silverclaw.sql
npm run dev -- --host 127.0.0.1 --port 5173
```

Apply the migration once per fresh local database. Open `http://127.0.0.1:5173`. For a built Worker preview, use `npm start` and its printed loopback URL. Match records expire after 24 hours; this is a small game, not an account or chat service. Use a nickname, and treat a match code as public spectator access.

## HTTP/JSON API

All endpoints are same-origin under `/api/matches`. Send `Content-Type: application/json` for POSTs. Coordinates are zero-based: `(0,0)` is the upper-left corner. No account/API key is required. Creating or joining a match issues a private random **seat token**, which authorizes that seat only. Keep it out of URLs and logs.

| Method | Path | JSON request |
| --- | --- | --- |
| POST | `/api/matches` | `{ "name": "Fern", "maxPlayers": 2 }` |
| POST | `/api/matches/ABC234/join` | `{ "name": "Moss" }` |
| POST | `/api/matches/ABC234/start` | `{ "playerId": "…", "token": "…", "version": 1, "fillBots": true }` |
| GET | `/api/matches/ABC234` | None |
| POST | `/api/matches/ABC234/moves` | `{ "playerId": "…", "token": "…", "version": 2, "moveId": "unique-id", "action": { "type": "grow", "x": 1, "y": 0 } }` |

Create/join return a public snapshot plus `playerId` and `token`. Only the host can start. The latest snapshot's `version` must be supplied for start and moves. Set `fillBots: true` to fill remaining seats; `false` starts with the currently joined players and requires at least two.

A snapshot has this shape:

```json
{
  "code": "ABC234",
  "version": 2,
  "game": {
    "status": "active",
    "players": [],
    "board": [],
    "round": 1,
    "maxRounds": 8,
    "activePlayerId": "seat-id",
    "signalIndex": 0,
    "nextSignalIndex": 1,
    "turnDeadlineAt": 1790000015000,
    "winners": [],
    "log": []
  },
  "legalActions": [
    { "type": "grow", "x": 1, "y": 0, "cost": 1, "label": "Grow" }
  ],
  "serverTime": 1790000000000
}
```

The abbreviated `game` above omits fields for readability. Actual snapshots contain every player's energy/score, all 25 cells (`x`, `y`, `owner`, `power`, `beaconId`), public deadlines and the complete event log. `legalActions` belongs to the active player. Choose from that list, sending only `type`, `x`, `y`; charge needs only `type`. The server computes costs and verifies every move. Reads also advance bot turns and overdue human turns.

Errors return `{ "error": "Readable explanation", "code": "VERSION_CONFLICT" }` with an appropriate HTTP status. A stale version returns **409**: read the new snapshot and choose again. A wrong token/seat returns **403**; an illegal move returns **4xx**; an expired match returns **410**; a body over 4 KB returns **413**. Use a distinct `moveId` per intended action. If a network response is lost, retry the identical payload with the **same** ID; it will not execute twice. Reusing an ID for a different action is a **409**.

### Sample bot

The dependency-free Node bot creates a match and plays against the built-in bot:

```sh
node scripts/sample-bot.mjs http://127.0.0.1:5173 create "Fern Bot" 2
node scripts/sample-bot.mjs http://127.0.0.1:5173 join ABC234 "Moss Bot"
node scripts/sample-bot.mjs http://127.0.0.1:5173 read ABC234
```

Replace the origin with the deployed game URL to play remotely. The bot keeps its seat token in memory and prints only public match information. Its source is a complete example of reading state, handling stale versions and submitting moves.

## Checks and implementation

```sh
node --test game/engine.test.mjs
node game/balance-check.mjs
npx tsc --noEmit
npm run build
```

The engine is pure, deterministic and shared by UI types and server transitions. A D1 compare-and-swap version protects simultaneous moves and duplicate submissions. The strategy simulation compares a few fixed heuristics; it is a smoke test, not proof of perfect game balance. Spectators can read a match log, and the final board and standings remain available until expiry.

Original game code is MIT licensed. Third-party packages and retained template files keep their respective licenses and notices.
