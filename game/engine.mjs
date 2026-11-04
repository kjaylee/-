const SIZE = 5;
const MAX_ROUNDS = 8;
const TURN_MS = 15000;
const MATCH_MS = 540000;
const MAX_ENERGY = 6;
const SPAWNS = [[0, 0], [4, 4], [4, 0], [0, 4]];
const BEACONS = [[2, 2], [1, 2], [2, 1], [3, 2], [2, 3]];
const STYLES = new Set(['balanced', 'expansion', 'bloom', 'raider', 'fortify', 'random']);

export class EngineError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.status = status;
  }
}
function error(code, message, status = 400) { throw new EngineError(code, message, status); }
function time(now) {
  if (!Number.isSafeInteger(now) || now < 0) error('INVALID_TIME', 'Time must be a nonnegative integer timestamp.');
  return now;
}
function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id); }
function playerInput(input) {
  if (!input || !validId(input.id)) error('INVALID_PLAYER', 'Player ID must contain 1–64 letters, digits, underscores or hyphens.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 24 || /[\u0000-\u001f\u007f]/.test(input.name)) error('INVALID_NAME', 'Choose a player name of 1–24 characters without control characters.');
  if (input.isBot !== undefined && typeof input.isBot !== 'boolean') error('INVALID_PLAYER', 'isBot must be a boolean.');
  return { id: input.id, name: input.name.trim(), isBot: input.isBot === true };
}
function assertGame(game) {
  if (!game || !['lobby', 'active', 'finished'].includes(game.status) || !Array.isArray(game.players) || !Array.isArray(game.board) || game.board.length !== SIZE * SIZE) error('INVALID_GAME', 'Invalid game state.');
}
function copy(game) {
  return { ...game, players: game.players.map(player => ({ ...player })), board: game.board.map(cell => ({ ...cell })), winners: game.winners.slice(), log: game.log.map(entry => ({ ...entry })) };
}
function append(game, entry) {
  game.log.push({ id: 'event-' + (game.log.length + 1), round: game.round, turn: game.turnNumber, ...entry });
}
function previousTime(game) { return game.log.length ? game.log[game.log.length - 1].at : 0; }
function assertClock(game, now) {
  time(now);
  if (now < previousTime(game)) error('STALE_TIME', 'The supplied time is older than the current game.', 409);
}
function freshBoard() {
  return Array.from({ length: SIZE * SIZE }, (_, index) => {
    const x = index % SIZE, y = Math.floor(index / SIZE);
    const beacon = BEACONS.findIndex(([bx, by]) => bx === x && by === y);
    return { x, y, owner: null, power: 0, beaconId: beacon < 0 ? null : beacon };
  });
}
function signal(seed, round) { return ((seed % BEACONS.length) + round - 1) % BEACONS.length; }
function adjacent(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1; }
function home(game, cell) {
  const index = game.players.findIndex(player => player.id === cell.owner);
  return index >= 0 && cell.x === SPAWNS[index][0] && cell.y === SPAWNS[index][1];
}
export function createGame({ code, maxPlayers, host, seed = 0, now } = {}) {
  time(now);
  if (typeof code !== 'string' || !/^[A-Z0-9]{6}$/.test(code)) error('INVALID_CODE', 'Match codes contain six uppercase letters or digits.');
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 4) error('INVALID_CAPACITY', 'Choose two, three or four seats.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) error('INVALID_SEED', 'Seed must be an unsigned 32-bit integer.');
  const player = playerInput(host);
  if (player.isBot) error('INVALID_HOST', 'The host must be a human or HTTP-agent seat.');
  const game = {
    code, status: 'lobby', size: SIZE, maxPlayers, hostId: player.id,
    players: [{ ...player, colorIndex: 0, energy: 3, score: 0 }],
    board: freshBoard(), round: 1, maxRounds: MAX_ROUNDS, turnNumber: 1,
    activePlayerId: null, signalIndex: signal(seed, 1), nextSignalIndex: signal(seed, 2),
    turnDeadlineAt: null, startedAt: null, hardDeadlineAt: null, winners: [], log: [], seed
  };
  append(game, { kind: 'lobby', playerId: player.id, text: player.name + ' opened the grove.', at: now });
  return game;
}

export function addPlayer(game, input, now) {
  assertGame(game); assertClock(game, now);
  if (game.status !== 'lobby') error('LOBBY_CLOSED', 'This match has already started.', 409);
  if (game.players.length >= game.maxPlayers) error('LOBBY_FULL', 'There are no empty seats.', 409);
  const player = playerInput(input);
  if (game.players.some(existing => existing.id === player.id)) error('PLAYER_EXISTS', 'This player already has a seat.', 409);
  const next = copy(game);
  next.players.push({ ...player, colorIndex: next.players.length, energy: 3, score: 0 });
  append(next, { kind: 'join', playerId: player.id, text: player.name + ' joined the grove.', at: now });
  return next;
}

export function startGame(game, { actorId, fillBots = false } = {}, now) {
  assertGame(game); assertClock(game, now);
  if (game.status !== 'lobby') error('LOBBY_CLOSED', 'This match has already started.', 409);
  if (actorId !== game.hostId) error('HOST_ONLY', 'Only the host can start this match.', 403);
  if (typeof fillBots !== 'boolean') error('INVALID_START', 'fillBots must be a boolean.');
  const next = copy(game);
  if (fillBots) {
    while (next.players.length < next.maxPlayers) {
      const seat = next.players.length;
      let id = 'bot-' + game.code + '-' + (seat + 1), suffix = 1;
      while (next.players.some(player => player.id === id)) id = 'bot-' + game.code + '-' + (seat + 1) + '-' + suffix++;
      next.players.push({ id, name: ['Clover', 'Juniper', 'Willow', 'Moss'][seat] + ' Bot', colorIndex: seat, isBot: true, energy: 3, score: 0 });
    }
  }
  if (next.players.length < 2) error('NOT_ENOUGH_PLAYERS', 'Add another player or fill the empty seats with bots.', 409);
  next.players = next.players.map((player, index) => ({ ...player, colorIndex: index, energy: 3, score: 0 }));
  next.board = freshBoard();
  next.players.forEach((player, index) => {
    const [x, y] = SPAWNS[index];
    const cell = next.board[y * SIZE + x];
    cell.owner = player.id; cell.power = 1;
  });
  next.status = 'active';
  next.round = 1; next.turnNumber = 1; next.activePlayerId = next.players[0].id;
  next.signalIndex = signal(next.seed, 1); next.nextSignalIndex = signal(next.seed, 2);
  next.startedAt = now; next.hardDeadlineAt = now + MATCH_MS; next.turnDeadlineAt = now + TURN_MS; next.winners = [];
  append(next, { kind: 'start', text: 'The grove is open. Home corners are safe; the first signal is beacon ' + (next.signalIndex + 1) + '.', at: now });
  return next;
}

export function legalActions(game, playerId = game?.activePlayerId) {
  assertGame(game);
  if (game.status !== 'active' || playerId !== game.activePlayerId) return [];
  const player = game.players.find(item => item.id === playerId);
  if (!player) return [];
  const owned = game.board.filter(cell => cell.owner === playerId), actions = [];
  for (const cell of game.board) {
    if (cell.owner === playerId) {
      if (cell.power < 3 && player.energy >= 1) actions.push({ type: 'fortify', x: cell.x, y: cell.y, cost: 1, label: 'Fortify to power ' + (cell.power + 1) });
      if (cell.beaconId !== null && player.energy >= 2) actions.push({ type: 'bloom', x: cell.x, y: cell.y, cost: 2, label: 'Bloom for 2 points' });
    } else if (owned.some(source => adjacent(source, cell))) {
      if (cell.owner === null && player.energy >= 1) actions.push({ type: 'grow', x: cell.x, y: cell.y, cost: 1, label: 'Grow a new cell' });
      else if (cell.owner !== null && !home(game, cell) && player.energy >= cell.power + 1) actions.push({ type: 'raid', x: cell.x, y: cell.y, cost: cell.power + 1, label: 'Raid power ' + cell.power });
    }
  }
  if (player.energy < MAX_ENERGY) actions.push({ type: 'charge', cost: 0, label: 'Charge +' + Math.min(3, MAX_ENERGY - player.energy) + ' energy' });
  return actions;
}
function moveInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) error('INVALID_ACTION', 'Submit an action object.');
  if (Object.keys(input).some(key => !['type', 'x', 'y', 'cost', 'label'].includes(key))) error('INVALID_ACTION', 'Action contains unsupported fields.');
  if (!['grow', 'raid', 'fortify', 'bloom', 'charge'].includes(input.type)) error('INVALID_ACTION', 'Unknown action type.');
  if (input.type === 'charge') {
    if (input.x !== undefined || input.y !== undefined) error('INVALID_ACTION', 'Charge has no target coordinates.');
    return { type: 'charge' };
  }
  if (!Number.isInteger(input.x) || !Number.isInteger(input.y) || input.x < 0 || input.x >= SIZE || input.y < 0 || input.y >= SIZE) error('INVALID_ACTION', 'Target coordinates must be integers from zero to four.');
  return { type: input.type, x: input.x, y: input.y };
}
function scoreRound(game, now) {
  const awarded = new Map(game.players.map(player => [player.id, 0]));
  for (const cell of game.board) if (cell.owner !== null && cell.beaconId !== null) awarded.set(cell.owner, (awarded.get(cell.owner) || 0) + (cell.beaconId === game.signalIndex ? 3 : 1));
  for (const player of game.players) player.score += awarded.get(player.id) || 0;
  const text = game.players.map(player => player.name + ' +' + awarded.get(player.id)).join(' · ');
  append(game, { kind: 'round', text: 'Round ' + game.round + ' signal: ' + text, at: now });
}
function finish(game, now, reason) {
  const next = copy(game);
  const highScore = Math.max(...next.players.map(player => player.score));
  const scored = next.players.filter(player => player.score === highScore);
  const territories = new Map(next.players.map(player => [player.id, next.board.filter(cell => cell.owner === player.id).length]));
  const highTerritory = Math.max(...scored.map(player => territories.get(player.id)));
  next.winners = scored.filter(player => territories.get(player.id) === highTerritory).map(player => player.id);
  next.status = 'finished'; next.activePlayerId = null; next.turnDeadlineAt = null;
  append(next, { kind: 'finish', text: reason + ' ' + next.winners.map(id => next.players.find(player => player.id === id).name).join(' & ') + (next.winners.length > 1 ? ' share the win.' : ' wins the grove.'), at: now });
  return next;
}

export function applyAction(game, playerId, input, now, options = {}) {
  assertGame(game); assertClock(game, now);
  if (game.status !== 'active') error('GAME_NOT_ACTIVE', 'The match is not active.', 409);
  if (!game.players.some(player => player.id === playerId)) error('UNKNOWN_PLAYER', 'No player has that seat.', 404);
  if (playerId !== game.activePlayerId) error('WRONG_TURN', 'It is another player’s turn.', 409);
  if (now >= game.hardDeadlineAt) error('MATCH_EXPIRED', 'The match time limit has elapsed.', 409);
  if (!options || typeof options !== 'object' || (options.automatic !== undefined && typeof options.automatic !== 'boolean')) error('INVALID_OPTIONS', 'Invalid engine action options.');
  if (now >= game.turnDeadlineAt && !options.automatic) error('TURN_EXPIRED', 'This turn has expired; refresh the match.', 409);
  const requested = moveInput(input);
  const legal = legalActions(game, playerId).find(action => action.type === requested.type && action.x === requested.x && action.y === requested.y);
  if (!legal) error('ILLEGAL_ACTION', 'That action is not legal with this board and energy.', 422);
  const next = copy(game), playerIndex = next.players.findIndex(player => player.id === playerId), player = next.players[playerIndex];
  player.energy -= legal.cost;
  if (legal.type === 'charge') player.energy = Math.min(MAX_ENERGY, player.energy + 3);
  else {
    const cell = next.board[legal.y * SIZE + legal.x];
    if (legal.type === 'grow' || legal.type === 'raid') { cell.owner = playerId; cell.power = 1; }
    else if (legal.type === 'fortify') cell.power++;
    else if (legal.type === 'bloom') player.score += 2;
  }
  const automatic = options.automatic === true || player.isBot;
  const target = legal.type === 'charge' ? '' : ' at (' + legal.x + ', ' + legal.y + ')';
  append(next, { kind: 'action', playerId, type: legal.type, ...(legal.x !== undefined ? { x: legal.x, y: legal.y } : {}), automatic, text: player.name + ': ' + legal.label + target + (automatic ? ' [automatic]' : ''), at: now });
  const wrapped = playerIndex === next.players.length - 1;
  if (wrapped) {
    scoreRound(next, now);
    if (next.round >= MAX_ROUNDS) return finish(next, now, 'Eight rounds complete.');
    next.round++;
    next.signalIndex = signal(next.seed, next.round);
    next.nextSignalIndex = signal(next.seed, next.round + 1);
  }
  next.turnNumber++;
  const following = next.players[(playerIndex + 1) % next.players.length];
  if (next.round > 1) following.energy = Math.min(MAX_ENERGY, following.energy + 1);
  next.activePlayerId = following.id;
  next.turnDeadlineAt = Math.min(now + TURN_MS, next.hardDeadlineAt);
  return next;
}
function mix(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; return h >>> 0;
}
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function beaconValue(game, beaconId) {
  let value = 0;
  for (let round = game.round; round <= MAX_ROUNDS; round++) value += signal(game.seed, round) === beaconId ? 3 : 1;
  return value;
}
function botValue(game, player, action, style) {
  const own = game.board.filter(cell => cell.owner === player.id), remaining = MAX_ROUNDS - game.round + 1;
  const weights = {
    balanced: { grow: 1, raid: 1, bloom: 1, fortify: 1, charge: 1 },
    expansion: { grow: 1.65, raid: 1.1, bloom: 0.6, fortify: 0.45, charge: 0.9 },
    bloom: { grow: 0.9, raid: 0.8, bloom: 1.8, fortify: 0.5, charge: 1.15 },
    raider: { grow: 0.95, raid: 1.6, bloom: 0.7, fortify: 0.7, charge: 1 },
    fortify: { grow: 0.9, raid: 0.75, bloom: 1, fortify: 1.75, charge: 0.9 }
  }[style] || { grow: 1, raid: 1, bloom: 1, fortify: 1, charge: 1 };
  if (action.type === 'charge') {
    const need = game.board.some(cell => cell.owner === player.id && cell.beaconId !== null) ? 1.15 : 0.75;
    return (Math.min(3, MAX_ENERGY - player.energy) * need + (player.energy <= 1 ? 1.3 : -1.5)) * weights.charge - (remaining === 1 ? 3 : 0);
  }
  const cell = game.board[action.y * SIZE + action.x];
  let value = 0;
  if (action.type === 'bloom') value = 2.8 + (remaining <= 2 ? 0.8 : 0) - (player.energy === 2 && remaining > 2 ? 0.4 : 0);
  if (action.type === 'fortify') {
    const threatened = game.board.some(enemy => enemy.owner !== null && enemy.owner !== player.id && adjacent(cell, enemy));
    value = home(game, cell) ? -1 : threatened ? (cell.beaconId !== null ? 1.5 + beaconValue(game, cell.beaconId) * 0.35 : 0.6) : -0.2;
    if (remaining === 1) value -= 1;
  }
  if (action.type === 'grow' || action.type === 'raid') {
    value = action.type === 'grow' ? 0.5 : 0.7;
    for (const beacon of game.board.filter(item => item.beaconId !== null && item.owner !== player.id)) {
      const before = Math.min(...own.map(source => distance(source, beacon)));
      const after = Math.min(before, distance(cell, beacon));
      if (after < before) value += (beaconValue(game, beacon.beaconId) + 2) * (before - after) / (before + 1) * 0.40;
    }
    if (cell.beaconId !== null) value += 3 + beaconValue(game, cell.beaconId) * (action.type === 'raid' ? 1.05 : 0.70);
    if (action.type === 'raid') {
      const victim = game.players.find(item => item.id === cell.owner);
      if (victim && victim.score > player.score) value += 0.5;
      value -= Math.max(0, action.cost - 2) * 0.5;
    }
    if (remaining === 1 && cell.beaconId === null) value -= 1;
  }
  value -= action.cost * (player.energy <= 2 ? 0.35 : 0.10);
  return value * weights[action.type];
}

export function chooseBotAction(game, playerId = game?.activePlayerId, style = 'balanced') {
  assertGame(game);
  if (!STYLES.has(style)) error('INVALID_STYLE', 'Unknown bot style.');
  const actions = legalActions(game, playerId);
  if (!actions.length) error('NO_LEGAL_ACTION', 'There is no legal action for that seat now.', 409);
  const player = game.players.find(item => item.id === playerId);
  let best = actions[0], bestValue = -Infinity;
  for (const action of actions) {
    const tie = mix([game.seed, game.turnNumber, playerId, action.type, action.x, action.y].join(':')) / 0xffffffff;
    const value = style === 'random' ? tie : botValue(game, player, action, style) + tie * 0.001;
    if (value > bestValue) { bestValue = value; best = action; }
  }
  return { ...best };
}

export function advanceGame(game, now) {
  assertGame(game); time(now);
  if (game.status !== 'active') return game;
  if (now >= game.hardDeadlineAt) return finish(game, game.hardDeadlineAt, 'The nine-minute safety limit was reached.');
  let next = game, guard = 0;
  while (next.status === 'active') {
    const player = next.players.find(item => item.id === next.activePlayerId);
    if (!player) error('INVALID_GAME', 'The active seat is missing.');
    const expired = now >= next.turnDeadlineAt;
    if (!player.isBot && !expired) break;
    if (++guard > MAX_ROUNDS * 4 + 1) error('INVALID_GAME', 'Automatic progress exceeded the legal turn count.');
    const at = player.isBot ? previousTime(next) : next.turnDeadlineAt;
    if (at >= next.hardDeadlineAt) return finish(next, next.hardDeadlineAt, 'The nine-minute safety limit was reached.');
    next = applyAction(next, player.id, chooseBotAction(next, player.id), at, { automatic: true });
  }
  return next;
}

