import { createGame, addPlayer, startGame, chooseBotAction, applyAction } from './engine.mjs';

const styles = ['balanced', 'expansion', 'bloom', 'raider', 'fortify', 'random'];
const totals = Object.fromEntries(styles.map(style => [style, { games: 0, wins: 0, score: 0 }]));
const pairs = [];
let matches = 0;
for (let a = 0; a < styles.length; a++) for (let b = a + 1; b < styles.length; b++) {
  const wins = { [styles[a]]: 0, [styles[b]]: 0 }, examples = {};
  for (let seed = 0; seed < 8; seed++) for (let swap = 0; swap < 2; swap++) {
    const lineup = swap ? [styles[b], styles[a]] : [styles[a], styles[b]];
    let game = createGame({ code: 'GROVE1', maxPlayers: 2, host: { id: 'p0', name: lineup[0] }, seed, now: 0 });
    game = addPlayer(game, { id: 'p1', name: lineup[1] }, 0);
    game = startGame(game, { actorId: 'p0' }, 0);
    let moves = 0;
    while (game.status === 'active') {
      const index = game.players.findIndex(player => player.id === game.activePlayerId);
      game = applyAction(game, game.activePlayerId, chooseBotAction(game, game.activePlayerId, lineup[index]), moves + 1);
      if (++moves > 16) throw new Error('Match did not terminate.');
    }
    for (let seat = 0; seat < 2; seat++) {
      const style = lineup[seat]; totals[style].games++; totals[style].score += game.players[seat].score;
      if (game.winners.includes('p' + seat)) {
        const share = 1 / game.winners.length; totals[style].wins += share; wins[style] += share;
        examples[style] ||= { seed, seat, scores: game.players.map(player => player.score) };
      }
    }
    matches++;
  }
  pairs.push({ strategies: [styles[a], styles[b]], matches: 16, wins, winning_examples: examples });
}
const results = {
  method: 'Deterministic heuristic-vs-heuristic smoke simulation; eight seeds, both seat orders per pair.',
  matches, strategies: totals, pairings: pairs,
  limitations: 'These bots are not optimal play. This is not a proof of no dominant strategy, a human playtest, or a guarantee of judging success.'
};
console.log(JSON.stringify(results, null, 2));

