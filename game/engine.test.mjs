import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, startGame, legalActions, applyAction, advanceGame, chooseBotAction, EngineError } from './engine.mjs';

function lobby(maxPlayers = 2, seed = 0) {
  return createGame({ code: 'GROVE1', maxPlayers, host: { id: 'p0', name: 'Aster', isBot: false }, seed, now: 1000 });
}
function active(count = 2, seed = 0, bots = false) {
  let game = lobby(count, seed);
  if (!bots) for (let i = 1; i < count; i++) game = addPlayer(game, { id: 'p' + i, name: 'Player ' + i, isBot: false }, 1000);
  return startGame(game, { actorId: 'p0', fillBots: bots }, 1000);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function throwsCode(fn, code, status) {
  assert.throws(fn, error => error instanceof EngineError && error.code === code && (status === undefined || error.status === status));
}
function cell(game, x, y) { return game.board[y * 5 + x]; }

test('deterministic lobby has 25 immutable-value cells and five beacons', () => {
  const a = lobby(4, 8), b = lobby(4, 8);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'lobby'); assert.equal(a.board.length, 25); assert.equal(a.players.length, 1);
  assert.equal(a.board.filter(item => item.beaconId !== null).length, 5);
  assert.ok(a.board.every(item => item.owner === null && item.power === 0));
  assert.equal(a.signalIndex, 3); assert.equal(a.nextSignalIndex, 4); assert.equal(a.activePlayerId, null);
});

for (const options of [
  { code: 'bad' }, { code: 'lower1' }, { maxPlayers: 1 }, { maxPlayers: 5 }, { maxPlayers: 2.5 },
  { seed: -1 }, { seed: 2 ** 32 }, { seed: 1.2 }, { now: NaN }, { now: -1 },
  { host: { id: 'bad id', name: 'Valid' } }, { host: { id: 'p0', name: '' } },
  { host: { id: 'p0', name: 'x'.repeat(25) } }, { host: { id: 'p0', name: 'a\nb' } },
  { host: { id: 'p0', name: 'Bot', isBot: true } }
]) test('reject invalid lobby input ' + JSON.stringify(options), () => {
  assert.throws(() => createGame({ code: 'GROVE1', maxPlayers: 2, host: { id: 'p0', name: 'Aster' }, seed: 0, now: 1000, ...options }), EngineError);
});

test('joins are immutable, unique, bounded and lobby-only', () => {
  const first = freeze(lobby());
  const joined = addPlayer(first, { id: 'p1', name: '  Bluebell  ', isBot: false }, 1000);
  assert.equal(first.players.length, 1); assert.equal(joined.players.length, 2);
  assert.equal(joined.players[1].name, 'Bluebell'); assert.equal(joined.players[1].colorIndex, 1);
  throwsCode(() => addPlayer(joined, { id: 'p2', name: 'C' }, 1000), 'LOBBY_FULL', 409);
  throwsCode(() => addPlayer(active(), { id: 'p2', name: 'C' }, 1000), 'LOBBY_CLOSED', 409);
  const room = addPlayer(lobby(4), { id: 'p1', name: 'B' }, 1000);
  throwsCode(() => addPlayer(room, { id: 'p1', name: 'Again' }, 1000), 'PLAYER_EXISTS', 409);
  throwsCode(() => addPlayer(room, { id: 'p2', name: 'C' }, 999), 'STALE_TIME', 409);
});

test('host-only start and at least two players', () => {
  throwsCode(() => startGame(lobby(), { actorId: 'other', fillBots: true }, 1000), 'HOST_ONLY', 403);
  throwsCode(() => startGame(lobby(), { actorId: 'p0', fillBots: false }, 1000), 'NOT_ENOUGH_PLAYERS', 409);
  throwsCode(() => startGame(active(), { actorId: 'p0' }, 1000), 'LOBBY_CLOSED', 409);
});

for (const count of [2, 3, 4]) test('deterministic bots fill ' + count + ' seats with fixed homes', () => {
  const game = active(count, 19, true);
  assert.deepEqual(game, active(count, 19, true));
  assert.equal(game.players.length, count); assert.equal(game.players[0].isBot, false);
  assert.equal(game.players.filter(player => player.isBot).length, count - 1);
  assert.equal(new Set(game.players.map(player => player.id)).size, count);
  const spawns = [[0, 0], [4, 4], [4, 0], [0, 4]];
  game.players.forEach((player, i) => {
    assert.equal(cell(game, ...spawns[i]).owner, player.id);
    assert.equal(cell(game, ...spawns[i]).power, 1);
    assert.equal(player.energy, 3); assert.equal(player.score, 0);
  });
  assert.equal(game.turnDeadlineAt, 16000); assert.equal(game.hardDeadlineAt, 541000);
});

test('bot seat IDs avoid a deliberately colliding human ID', () => {
  const room = addPlayer(lobby(3), { id: 'bot-GROVE1-3', name: 'Human' }, 1000);
  const game = startGame(room, { actorId: 'p0', fillBots: true }, 1000);
  assert.equal(new Set(game.players.map(player => player.id)).size, 3);
  assert.equal(game.players[2].isBot, true);
});

test('only the active seat has legal actions', () => {
  const game = active();
  assert.ok(legalActions(game, 'p0').length >= 4);
  assert.deepEqual(legalActions(game, 'p1'), []);
  assert.deepEqual(legalActions(game, 'unknown'), []);
  assert.deepEqual(legalActions(lobby()), []);
  assert.deepEqual(legalActions(game).filter(action => action.type === 'grow').map(action => [action.x, action.y]), [[1, 0], [0, 1]]);
});

test('grow is adjacent, spends engine-computed cost and does not mutate input', () => {
  const game = freeze(active());
  const next = applyAction(game, 'p0', { type: 'grow', x: 1, y: 0, cost: -100, label: 'Free points' }, 1001);
  assert.equal(cell(game, 1, 0).owner, null);
  assert.equal(cell(next, 1, 0).owner, 'p0'); assert.equal(cell(next, 1, 0).power, 1);
  assert.equal(next.players[0].energy, 2); assert.equal(next.activePlayerId, 'p1');
  assert.equal(next.players[1].energy, 3); assert.equal(next.turnNumber, 2);
  assert.notEqual(next.players, game.players); assert.notEqual(next.board[0], game.board[0]);
});

for (const action of [
  { type: 'grow', x: 4, y: 3 }, { type: 'grow', x: 0, y: 0 },
  { type: 'raid', x: 1, y: 0 }, { type: 'fortify', x: 4, y: 4 }, { type: 'bloom', x: 0, y: 0 }
]) test('illegal board action ' + JSON.stringify(action), () => {
  throwsCode(() => applyAction(active(), 'p0', action, 1001), 'ILLEGAL_ACTION', 422);
});

for (const action of [
  null, [], {}, { type: 'win' }, { type: 'grow', x: 0.5, y: 0 }, { type: 'grow', x: -1, y: 0 },
  { type: 'grow', x: 5, y: 0 }, { type: 'grow', x: '1', y: 0 }, { type: 'grow', x: NaN, y: 0 },
  { type: 'charge', x: 0 }, { type: 'grow', x: 1, y: 0, power: 3 }, { type: 'charge', automatic: true }
]) test('reject malformed or rule-overriding action ' + JSON.stringify(action), () => {
  throwsCode(() => applyAction(active(), 'p0', action, 1001), 'INVALID_ACTION', 400);
});

test('wrong seat, unknown player, stale phase and clocks cannot act', () => {
  throwsCode(() => applyAction(active(), 'p1', { type: 'charge' }, 1001), 'WRONG_TURN', 409);
  throwsCode(() => applyAction(active(), 'none', { type: 'charge' }, 1001), 'UNKNOWN_PLAYER', 404);
  throwsCode(() => applyAction(lobby(), 'p0', { type: 'charge' }, 1001), 'GAME_NOT_ACTIVE', 409);
  throwsCode(() => applyAction(active(), 'p0', { type: 'charge' }, 999), 'STALE_TIME', 409);
  throwsCode(() => applyAction(active(), 'p0', { type: 'charge' }, 16000), 'TURN_EXPIRED', 409);
  throwsCode(() => applyAction(active(), 'p0', { type: 'charge' }, 541000), 'MATCH_EXPIRED', 409);
});

test('raid requires exact defender power plus one; captured cell resets to power one', () => {
  const game = active();
  Object.assign(cell(game, 1, 0), { owner: 'p1', power: 3 });
  assert.equal(legalActions(game).some(action => action.type === 'raid' && action.x === 1 && action.y === 0), false);
  game.players[0].energy = 4;
  const raid = legalActions(game).find(action => action.type === 'raid' && action.x === 1 && action.y === 0);
  assert.equal(raid.cost, 4);
  const next = applyAction(freeze(game), 'p0', { ...raid, cost: 0 }, 1001);
  assert.equal(next.players[0].energy, 0);
  assert.equal(cell(next, 1, 0).owner, 'p0'); assert.equal(cell(next, 1, 0).power, 1);
  assert.equal(cell(game, 1, 0).owner, 'p1');
});

test('original homes cannot be raided even by an adjacent player with maximum energy', () => {
  const game = active();
  Object.assign(cell(game, 4, 3), { owner: 'p0', power: 1 }); game.players[0].energy = 6;
  assert.equal(legalActions(game).some(action => action.type === 'raid' && action.x === 4 && action.y === 4), false);
  throwsCode(() => applyAction(game, 'p0', { type: 'raid', x: 4, y: 4 }, 1001), 'ILLEGAL_ACTION', 422);
});

test('a last nonhome beacon is not invincible; protection only applies to original corner', () => {
  const game = active();
  Object.assign(cell(game, 1, 2), { owner: 'p0', power: 1 });
  Object.assign(cell(game, 2, 2), { owner: 'p1', power: 1 });
  assert.ok(legalActions(game).some(action => action.type === 'raid' && action.x === 2 && action.y === 2));
});

test('no legal-action deadlock when every nonhome cell belongs to another player', () => {
  for (const energy of [0, 1, 2, 3, 4, 5, 6]) {
    const game = active();
    for (const square of game.board) if (square.x !== 0 || square.y !== 0) Object.assign(square, { owner: 'p1', power: 3 });
    game.players[0].energy = energy; cell(game, 0, 0).power = 3;
    assert.ok(legalActions(game).length > 0);
    const next = applyAction(game, 'p0', chooseBotAction(game), 1001);
    assert.equal(next.activePlayerId, 'p1');
  }
});

test('fortify caps at three and charge caps at six', () => {
  let game = active(); cell(game, 0, 0).power = 2;
  const next = applyAction(game, 'p0', { type: 'fortify', x: 0, y: 0 }, 1001);
  assert.equal(cell(next, 0, 0).power, 3);
  game = active(); cell(game, 0, 0).power = 3;
  assert.equal(legalActions(game).some(action => action.type === 'fortify' && action.x === 0 && action.y === 0), false);
  game.players[0].energy = 5;
  assert.equal(applyAction(game, 'p0', { type: 'charge' }, 1001).players[0].energy, 6);
  game.players[0].energy = 6;
  throwsCode(() => applyAction(game, 'p0', { type: 'charge' }, 1001), 'ILLEGAL_ACTION', 422);
});

test('bloom is immediate two points at an owned beacon only', () => {
  const game = active();
  Object.assign(cell(game, 2, 2), { owner: 'p0', power: 2 });
  const next = applyAction(game, 'p0', { type: 'bloom', x: 2, y: 2 }, 1001);
  assert.equal(next.players[0].score, 2); assert.equal(next.players[0].energy, 1);
  assert.equal(cell(next, 2, 2).power, 2);
});

test('first-round energy is fair; regeneration starts on each next-round turn', () => {
  let game = active(3);
  game = applyAction(game, 'p0', { type: 'grow', x: 1, y: 0 }, 1001);
  assert.equal(game.players[1].energy, 3);
  game = applyAction(game, 'p1', { type: 'grow', x: 3, y: 4 }, 1002);
  assert.equal(game.players[2].energy, 3);
  game = applyAction(game, 'p2', { type: 'grow', x: 3, y: 0 }, 1003);
  assert.equal(game.round, 2); assert.equal(game.players[0].energy, 3);
  assert.equal(game.players[1].energy, 2);
  game = applyAction(game, 'p0', { type: 'fortify', x: 0, y: 0 }, 1004);
  assert.equal(game.players[1].energy, 3);
});

test('round scoring awards active beacon three and other beacons one, once per round', () => {
  let game = active(2, 0);
  Object.assign(cell(game, 2, 2), { owner: 'p0', power: 1 });
  Object.assign(cell(game, 1, 2), { owner: 'p0', power: 1 });
  Object.assign(cell(game, 2, 1), { owner: 'p1', power: 1 });
  game = applyAction(game, 'p0', { type: 'fortify', x: 0, y: 0 }, 1001);
  assert.equal(game.players[0].score, 0);
  game = applyAction(game, 'p1', { type: 'fortify', x: 4, y: 4 }, 1002);
  assert.equal(game.players[0].score, 4); assert.equal(game.players[1].score, 1);
  assert.equal(game.round, 2); assert.equal(game.signalIndex, 1); assert.equal(game.nextSignalIndex, 2);
  assert.equal(game.log.filter(entry => entry.kind === 'round').length, 1);
});

test('advance is reference-stable when no progress is due', () => {
  const game = freeze(active());
  assert.equal(advanceGame(game, 1001), game);
  const room = freeze(lobby()); assert.equal(advanceGame(room, 999999), room);
});

test('expired humans use ordinary bot policy and logical deadline time', () => {
  const game = freeze(active());
  const expected = applyAction(game, 'p0', chooseBotAction(game), 16000, { automatic: true });
  const next = advanceGame(game, 16000);
  assert.deepEqual(next, expected);
  assert.equal(next.activePlayerId, 'p1'); assert.equal(next.turnDeadlineAt, 31000);
  assert.equal(next.log.findLast(entry => entry.kind === 'action').automatic, true);
  assert.equal(next.log.findLast(entry => entry.kind === 'action').at, 16000);
});

test('bots advance immediately to next human turn without waiting their deadline', () => {
  let game = active(4, 10, true);
  game = applyAction(game, 'p0', { type: 'grow', x: 1, y: 0 }, 1001);
  const next = advanceGame(freeze(game), 1001);
  assert.equal(next.status, 'active'); assert.equal(next.round, 2); assert.equal(next.activePlayerId, 'p0');
  assert.equal(next.turnNumber, 5);
  assert.equal(next.log.filter(entry => entry.kind === 'action' && entry.automatic).length, 3);
  assert.equal(next.turnDeadlineAt, 16001);
});

test('multiple missed human turns catch up with monotonic timestamps', () => {
  const next = advanceGame(active(4), 46000);
  assert.equal(next.turnNumber, 4); assert.equal(next.activePlayerId, 'p3'); assert.equal(next.turnDeadlineAt, 61000);
  const actions = next.log.filter(entry => entry.kind === 'action');
  assert.deepEqual(actions.map(entry => entry.at), [16000, 31000, 46000]);
});

for (const count of [2, 3, 4]) test('all human timeouts finish eight rounds within nine minutes for ' + count, () => {
  let game = active(count, 17), guard = 0;
  while (game.status === 'active') {
    game = advanceGame(game, game.turnDeadlineAt);
    assert.ok(++guard <= 32);
  }
  assert.equal(game.log.filter(entry => entry.kind === 'action').length, count * 8);
  assert.equal(game.log.filter(entry => entry.kind === 'round').length, 8);
  assert.equal(game.round, 8); assert.equal(game.activePlayerId, null);
  assert.equal(game.turnDeadlineAt, null); assert.ok(game.winners.length >= 1);
  assert.ok(game.log.at(-1).at - game.startedAt < 540000);
  assert.equal(advanceGame(game, game.hardDeadlineAt + 1), game);
  throwsCode(() => applyAction(game, 'p0', { type: 'charge' }, game.log.at(-1).at), 'GAME_NOT_ACTIVE', 409);
});

test('hard match deadline finishes with current score and territory tiebreak', () => {
  const game = active();
  game.players[0].score = 5; game.players[1].score = 5;
  Object.assign(cell(game, 1, 0), { owner: 'p0', power: 1 });
  const next = advanceGame(freeze(game), 999999);
  assert.equal(next.status, 'finished'); assert.deepEqual(next.winners, ['p0']);
  assert.equal(next.players[0].score, 5); assert.equal(next.players[1].score, 5);
  assert.equal(next.log.at(-1).at, 541000); assert.equal(game.status, 'active');
});

test('equal score and territory give a shared win', () => {
  const next = advanceGame(active(), 541000);
  assert.deepEqual(next.winners, ['p0', 'p1']);
});

test('final round counts bloom and last signal before choosing a winner', () => {
  let game = active(); game.round = 8; game.turnNumber = 15; game.signalIndex = 2; game.nextSignalIndex = 3;
  for (const square of game.board) if (square.beaconId !== null) Object.assign(square, { owner: 'p0', power: 1 });
  game.players[0].energy = 6;
  game = applyAction(game, 'p0', { type: 'bloom', x: 2, y: 2 }, 1001);
  game = applyAction(game, 'p1', { type: 'fortify', x: 4, y: 4 }, 1002);
  assert.equal(game.status, 'finished'); assert.equal(game.players[0].score, 9);
  assert.deepEqual(game.winners, ['p0']);
  assert.equal(game.log.filter(entry => entry.kind === 'round').length, 1);
});

test('public state contains no authentication or private receipts', () => {
  const game = active(4, 9, true);
  assert.equal('auth' in game, false); assert.equal('receipts' in game, false);
  assert.ok(!JSON.stringify(game).includes('token'));
});

test('bot choices are deterministic, legal and do not mutate input', () => {
  const game = freeze(active(4, 32));
  for (const style of ['balanced', 'expansion', 'bloom', 'raider', 'fortify', 'random']) {
    const first = chooseBotAction(game, 'p0', style);
    assert.deepEqual(first, chooseBotAction(game, 'p0', style));
    assert.ok(legalActions(game).some(action => JSON.stringify(action) === JSON.stringify(first)));
  }
  throwsCode(() => chooseBotAction(game, 'p0', 'always-win'), 'INVALID_STYLE', 400);
});

test('small mixed-strategy matches preserve resources, homes, finite scores and termination', () => {
  const styles = ['balanced', 'expansion', 'bloom', 'raider', 'fortify', 'random'];
  for (const count of [2, 3, 4]) for (let seed = 0; seed < 12; seed++) {
    let game = active(count, seed), guard = 0;
    while (game.status === 'active') {
      const index = game.players.findIndex(player => player.id === game.activePlayerId);
      const before = JSON.stringify(game);
      const action = chooseBotAction(game, game.activePlayerId, styles[(seed + index) % styles.length]);
      const next = applyAction(game, game.activePlayerId, action, 1001 + guard);
      assert.equal(JSON.stringify(game), before);
      game = next; assert.ok(++guard <= count * 8);
      assert.ok(game.players.every(player => player.energy >= 0 && player.energy <= 6 && Number.isFinite(player.score) && player.score >= 0));
      assert.ok(game.board.every(square => square.power >= 0 && square.power <= 3 && ((square.owner === null && square.power === 0) || square.owner !== null)));
      [[0, 0], [4, 4], [4, 0], [0, 4]].slice(0, count).forEach(([x, y], i) => assert.equal(cell(game, x, y).owner, game.players[i].id));
    }
    assert.equal(game.log.filter(entry => entry.kind === 'action').length, count * 8);
    assert.equal(game.log.filter(entry => entry.kind === 'round').length, 8);
    assert.ok(game.winners.every(id => game.players.some(player => player.id === id)));
  }
});

