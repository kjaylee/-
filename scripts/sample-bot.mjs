#!/usr/bin/env node
// Node 20+; no packages, account, API key or wallet needed.
//   node scripts/sample-bot.mjs https://YOUR-SITE create "Fern Bot" 2
//   node scripts/sample-bot.mjs https://YOUR-SITE join ABC234 "Fern Bot"
//   node scripts/sample-bot.mjs https://YOUR-SITE read ABC234
// Create starts a match with bot-filled empty seats. Join waits for the host.
// The seat token stays in memory and is never printed or put in a URL.

import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";

const [baseArgument, mode = "create", first, second] = process.argv.slice(2);

function usage() {
  throw new Error("Usage: node scripts/sample-bot.mjs https://YOUR-SITE create [name] [2-4] | join CODE [name] | read CODE");
}

if (!baseArgument || !["create", "join", "read"].includes(mode)) usage();
const base = new URL(baseArgument);
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
  throw new Error("Use an HTTP(S) site URL without credentials.");
}
base.search = "";
base.hash = "";

function matchCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) usage();
  return code;
}

async function api(path, body) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Do not print the request body, response body or credentials on failure.
    const error = new Error(`HTTP ${response.status} (${typeof data.code === "string" ? data.code.slice(0, 64) : "API_ERROR"})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function submitMove(path, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await api(path, body);
    } catch (error) {
      if ((error.status && error.status < 500) || attempt === 2) throw error;
      // Network/5xx retries retain the exact moveId, version and action.
      await pause(250 * (attempt + 1));
    }
  }
}

function chooseAction(snapshot, playerId) {
  const { game, legalActions } = snapshot;
  if (!Array.isArray(legalActions) || !legalActions.length) throw new Error("No legal action available.");
  const player = game.players.find((entry) => entry.id === playerId);
  const signal = game.board.find((cell) => cell.beaconId === game.signalIndex);
  const nextSignal = game.board.find((cell) => cell.beaconId === game.nextSignalIndex);
  const score = (action) => {
    if (action.type === "charge") return player.energy <= 2 ? 10 : -4;
    const cell = game.board[action.y * game.size + action.x];
    const isBeacon = cell.beaconId !== null;
    const active = cell.beaconId === game.signalIndex;
    const distance = signal ? Math.abs(cell.x - signal.x) + Math.abs(cell.y - signal.y) : 0;
    const nextDistance = nextSignal ? Math.abs(cell.x - nextSignal.x) + Math.abs(cell.y - nextSignal.y) : 0;
    if (action.type === "bloom") return game.round >= 6 ? 22 : 11;
    if (action.type === "raid") return (active ? 30 : isBeacon ? 23 : 8) - action.cost + (8 - distance) * 0.2;
    if (action.type === "grow") return (active ? 30 : isBeacon ? 24 : 16 - distance - nextDistance * 0.2);
    if (action.type === "fortify") return (active ? 14 : isBeacon ? 8 : 0) - cell.power;
    return -100;
  };
  const action = [...legalActions].sort((a, b) => score(b) - score(a))[0];
  return action.type === "charge" ? { type: action.type } : { type: action.type, x: action.x, y: action.y };
}

async function main() {
  if (mode === "read") {
    const state = await api(`/api/matches/${matchCode(first)}`);
    console.log(JSON.stringify({ code: state.code, version: state.version, game: state.game, legalActions: state.legalActions, serverTime: state.serverTime }, null, 2));
    return;
  }

  let initial;
  if (mode === "create") {
    const maxPlayers = Number(second || 2);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 4) usage();
    initial = await api("/api/matches", { name: first || "Fern Bot", maxPlayers });
  } else {
    initial = await api(`/api/matches/${matchCode(first)}/join`, { name: second || "Fern Bot" });
  }
  const { code, playerId, token } = initial;
  if (!code || !playerId || !token) throw new Error("The server did not return a usable seat.");
  console.log(`${mode === "create" ? "Created" : "Joined"} match ${code}. Seat credentials are kept in memory.`);

  if (mode === "create") {
    await api(`/api/matches/${code}/start`, { playerId, token, version: initial.version, fillBots: true });
  }
  const stopAt = Date.now() + 10 * 60 * 1000;
  let lastTurn = -1;
  while (Date.now() < stopAt) {
    let state;
    try {
      state = await api(`/api/matches/${code}`);
    } catch (error) {
      if (error.status !== 409) throw error;
      await pause(300);
      continue;
    }
    if (state.game.status === "finished") {
      console.log(JSON.stringify({ code, finished: true, winners: state.game.winners, scores: state.game.players.map((player) => ({ name: player.name, score: player.score })) }));
      return;
    }
    if (state.game.status === "active" && state.game.activePlayerId === playerId) {
      const action = chooseAction(state, playerId);
      const moveId = randomUUID();
      try {
        // A network retry of this exact payload must reuse moveId. On 409,
        // read current state and choose a new action with a new identifier.
        await submitMove(`/api/matches/${code}/moves`, { playerId, token, version: state.version, moveId, action });
        if (lastTurn !== state.game.turnNumber) {
          console.log(`Turn ${state.game.turnNumber}: ${action.type}${action.x === undefined ? "" : ` (${action.x},${action.y})`}`);
          lastTurn = state.game.turnNumber;
        }
      } catch (error) {
        if (error.status !== 409) throw error;
      }
      await pause(200);
    } else {
      await pause(1000);
    }
  }
  throw new Error("Stopped after ten minutes. Unattended seats will time out normally.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "The bot stopped.");
  process.exitCode = 1;
});
