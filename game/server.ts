import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { matches } from "../db/schema";
import {
  addPlayer,
  advanceGame,
  applyAction,
  createGame,
  legalActions,
  startGame,
  type ActionInput,
  type GameState,
} from "./engine.mjs";

const MAX_BODY_BYTES = 4096;
const MATCH_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CAS_ATTEMPTS = 5;
const MAX_RECEIPTS = 64;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Database = ReturnType<typeof getDb>;
type MoveReceipt = { id: string; playerId: string; action: string; version: number };
type PrivatePayload = {
  game: GameState;
  auth: Record<string, string>;
  receipts: MoveReceipt[];
};
type StoredMatch = typeof matches.$inferSelect & { data: PrivatePayload };
type JsonObject = Record<string, unknown>;

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function respond(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    // Engine errors expose a deliberate public code/status. Database errors and
    // serialized request data must never be sent to a client or logged here.
    const problem = error as { message?: unknown; code?: unknown; status?: unknown };
    if (
      error instanceof Error &&
      typeof problem.code === "string" &&
      /^[A-Z][A-Z0-9_]{1,63}$/.test(problem.code) &&
      typeof problem.status === "number" &&
      Number.isInteger(problem.status) &&
      problem.status >= 400 &&
      problem.status < 500
    ) {
      return json({ error: error.message, code: problem.code }, problem.status);
    }
    return json(
      { error: "The match service is temporarily unavailable. Please try again.", code: "SERVICE_UNAVAILABLE" },
      503,
    );
  }
}

function object(value: unknown, code = "INVALID_BODY"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("Send a JSON object.", code, 400);
  }
  return value as JsonObject;
}

async function readBody(request: Request): Promise<JsonObject> {
  const mediaType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiError("Use Content-Type: application/json.", "JSON_REQUIRED", 415);
  }
  const length = request.headers.get("Content-Length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) {
    throw new ApiError("The request body is too large.", "BODY_TOO_LARGE", 413);
  }
  if (!request.body) throw new ApiError("Send a JSON object.", "INVALID_JSON", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError("The request body is too large.", "BODY_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("The request is not valid JSON.", "INVALID_JSON", 400);
  }
  return object(parsed);
}

function playerName(value: unknown) {
  if (typeof value !== "string") throw new ApiError("Enter a player name.", "INVALID_NAME", 400);
  const name = value.trim().normalize("NFC");
  if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ApiError("Use a name with 1–24 characters and no control characters.", "INVALID_NAME", 400);
  }
  return name;
}

function codeFrom(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new ApiError("Use the six-character match code.", "INVALID_CODE", 400);
  }
  return code;
}

function requestedVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ApiError("Supply the latest numeric match version.", "INVALID_VERSION", 400);
  }
  return value;
}

function seatCredentials(body: JsonObject) {
  if (typeof body.playerId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(body.playerId)) {
    throw new ApiError("A valid seat and token are required.", "SEAT_FORBIDDEN", 403);
  }
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) {
    throw new ApiError("A valid seat and token are required.", "SEAT_FORBIDDEN", 403);
  }
  return { playerId: body.playerId, token: body.token };
}

function sameToken(expected: string | undefined, supplied: string) {
  if (!expected || expected.length !== supplied.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) {
    difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return difference === 0;
}

function authenticate(record: StoredMatch, seat: { playerId: string; token: string }) {
  if (!sameToken(record.data.auth[seat.playerId], seat.token)) {
    throw new ApiError("This token does not authorize that player seat.", "SEAT_FORBIDDEN", 403);
  }
}

function moveAction(value: unknown): ActionInput {
  const action = object(value, "INVALID_ACTION");
  if (typeof action.type !== "string" || !["grow", "raid", "fortify", "bloom", "charge"].includes(action.type)) {
    throw new ApiError("Choose grow, raid, fortify, bloom or charge.", "INVALID_ACTION", 400);
  }
  // Cost and display labels from a legalActions response are never trusted.
  // Only canonical engine input fields cross the validation boundary.
  if (action.type === "charge") return { type: "charge" };
  if (
    typeof action.x !== "number" || !Number.isInteger(action.x) || action.x < 0 || action.x > 4 ||
    typeof action.y !== "number" || !Number.isInteger(action.y) || action.y < 0 || action.y > 4
  ) {
    throw new ApiError("Choose a board cell with x and y from 0 to 4.", "INVALID_ACTION", 400);
  }
  return { type: action.type as ActionInput["type"], x: action.x, y: action.y };
}

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function encode(data: PrivatePayload) {
  const payload = JSON.stringify(data);
  if (new TextEncoder().encode(payload).byteLength > 96 * 1024) {
    throw new Error("The engine produced an oversized match record.");
  }
  return payload;
}

async function loadMatch(db: Database, code: string, now: number): Promise<StoredMatch> {
  const [row] = await db.select().from(matches).where(eq(matches.code, code)).limit(1);
  if (!row) throw new ApiError("No match has that code.", "MATCH_NOT_FOUND", 404);
  if (row.expiresAt <= now) throw new ApiError("This match has expired. Create a new match.", "MATCH_EXPIRED", 410);
  const data = JSON.parse(row.payload) as PrivatePayload;
  if (!data.game || data.game.code !== code || !data.auth || !Array.isArray(data.receipts)) {
    throw new Error("Invalid stored match.");
  }
  return { ...row, data };
}

async function compareAndSwap(db: Database, previous: StoredMatch, data: PrivatePayload, now: number) {
  const version = previous.version + 1;
  const payload = encode(data);
  const changed = await db.update(matches)
    .set({ payload, version, updatedAt: now })
    .where(and(eq(matches.code, previous.code), eq(matches.version, previous.version), gt(matches.expiresAt, now)))
    .returning({ code: matches.code });
  return changed.length ? { ...previous, payload, data, version, updatedAt: now } : null;
}

function conflict(): never {
  throw new ApiError("The match changed. Refresh its state before trying again.", "VERSION_CONFLICT", 409);
}

async function progressedMatch(db: Database, code: string, now: number): Promise<StoredMatch> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    const record = await loadMatch(db, code, now);
    const game = advanceGame(record.data.game, now);
    if (game === record.data.game) return record;
    const saved = await compareAndSwap(db, record, { ...record.data, game }, now);
    if (saved) return saved;
  }
  return conflict();
}

function snapshot(record: StoredMatch, now = Date.now()) {
  const game = record.data.game;
  // Do not spread the private payload: neither auth nor receipts is public.
  return {
    code: record.code,
    version: record.version,
    game,
    legalActions: game.status === "active" && game.activePlayerId ? legalActions(game, game.activePlayerId) : [],
    serverTime: now,
  };
}

function receiptMatches(record: StoredMatch, moveId: string, playerId: string, action: string) {
  const receipt = record.data.receipts.find((entry) => entry.id === moveId);
  if (!receipt) return false;
  if (receipt.playerId !== playerId || receipt.action !== action) {
    throw new ApiError("That moveId was already used for a different move.", "MOVE_ID_REUSED", 409);
  }
  return true;
}

export function createMatch(request: Request) {
  return respond(async () => {
    const body = await readBody(request);
    const name = playerName(body.name);
    if (typeof body.maxPlayers !== "number" || !Number.isInteger(body.maxPlayers) || body.maxPlayers < 2 || body.maxPlayers > 4) {
      throw new ApiError("Choose 2, 3 or 4 player seats.", "INVALID_PLAYER_COUNT", 400);
    }
    const maxPlayers = body.maxPlayers;
    const db = getDb();
    const now = Date.now();
    const playerId = `p_${randomHex(12)}`;
    const token = randomHex(32);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomCode();
      const game = createGame({ code, maxPlayers, host: { id: playerId, name, isBot: false }, seed, now });
      const data: PrivatePayload = { game, auth: { [playerId]: token }, receipts: [] };
      const payload = encode(data);
      const row = { code, version: 1, payload, createdAt: now, updatedAt: now, expiresAt: now + MATCH_LIFETIME_MS };
      const inserted = await db.insert(matches).values(row).onConflictDoNothing().returning({ code: matches.code });
      if (inserted.length) return json({ ...snapshot({ ...row, data }), playerId, token }, 201);
    }
    throw new Error("Could not reserve a match code.");
  });
}

export function readMatch(codeValue: string) {
  return respond(async () => {
    const code = codeFrom(codeValue);
    const record = await progressedMatch(getDb(), code, Date.now());
    return json(snapshot(record));
  });
}

export function joinMatch(request: Request, codeValue: string) {
  return respond(async () => {
    const code = codeFrom(codeValue);
    const body = await readBody(request);
    const name = playerName(body.name);
    const playerId = `p_${randomHex(12)}`;
    const token = randomHex(32);
    const db = getDb();
    const now = Date.now();
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const record = await loadMatch(db, code, now);
      const game = addPlayer(record.data.game, { id: playerId, name, isBot: false }, now);
      const data: PrivatePayload = { ...record.data, game, auth: { ...record.data.auth, [playerId]: token } };
      const saved = await compareAndSwap(db, record, data, now);
      if (saved) return json({ ...snapshot(saved), playerId, token }, 201);
    }
    return conflict();
  });
}

export function beginMatch(request: Request, codeValue: string) {
  return respond(async () => {
    const code = codeFrom(codeValue);
    const body = await readBody(request);
    const seat = seatCredentials(body);
    const version = requestedVersion(body.version);
    if (typeof body.fillBots !== "boolean") {
      throw new ApiError("Choose whether to fill empty seats with bots.", "INVALID_BOT_SETTING", 400);
    }
    const db = getDb();
    const now = Date.now();
    const record = await progressedMatch(db, code, now);
    authenticate(record, seat);
    if (record.data.game.hostId !== seat.playerId) {
      throw new ApiError("Only the host can start this match.", "HOST_ONLY", 403);
    }
    if (record.version !== version) return conflict();
    const started = startGame(record.data.game, { actorId: seat.playerId, fillBots: body.fillBots }, now);
    const game = advanceGame(started, now);
    const saved = await compareAndSwap(db, record, { ...record.data, game }, now);
    if (!saved) return conflict();
    return json(snapshot(saved));
  });
}

export function moveMatch(request: Request, codeValue: string) {
  return respond(async () => {
    const code = codeFrom(codeValue);
    const body = await readBody(request);
    const seat = seatCredentials(body);
    const version = requestedVersion(body.version);
    if (typeof body.moveId !== "string" || !/^[A-Za-z0-9_.:-]{1,96}$/.test(body.moveId)) {
      throw new ApiError("Supply a unique moveId with 1–96 letters, numbers or . _ : -.", "INVALID_MOVE_ID", 400);
    }
    const moveId = body.moveId;
    const action = moveAction(body.action);
    const fingerprint = JSON.stringify(action);
    const db = getDb();
    const now = Date.now();
    const record = await progressedMatch(db, code, now);
    authenticate(record, seat);
    // A retry of a committed action succeeds even with its old version.
    if (receiptMatches(record, moveId, seat.playerId, fingerprint)) return json(snapshot(record));
    if (record.version !== version) return conflict();
    const moved = applyAction(record.data.game, seat.playerId, action, now);
    const game = advanceGame(moved, now);
    const receipts = [...record.data.receipts, { id: moveId, playerId: seat.playerId, action: fingerprint, version: record.version + 1 }].slice(-MAX_RECEIPTS);
    const saved = await compareAndSwap(db, record, { ...record.data, game, receipts }, now);
    if (saved) return json(snapshot(saved));
    // Concurrent copies of the same request are also idempotent; a different
    // move winning the CAS returns 409 instead of silently applying this move.
    const latest = await progressedMatch(db, code, now);
    authenticate(latest, seat);
    if (receiptMatches(latest, moveId, seat.playerId, fingerprint)) return json(snapshot(latest));
    return conflict();
  });
}
