export type GameStatus = 'lobby' | 'active' | 'finished';
export type ActionType = 'grow' | 'raid' | 'fortify' | 'bloom' | 'charge';
export type BotStyle = 'balanced' | 'expansion' | 'bloom' | 'raider' | 'fortify' | 'random';
export interface Player {
  id: string;
  name: string;
  colorIndex: number;
  isBot: boolean;
  energy: number;
  score: number;
}
export interface PlayerInput { id: string; name: string; isBot?: boolean; }
export interface Cell { x: number; y: number; owner: string | null; power: number; beaconId: number | null; }
export interface GameLogEntry {
  id: string;
  kind: 'lobby' | 'join' | 'start' | 'action' | 'round' | 'finish';
  round: number;
  turn: number;
  playerId?: string;
  type?: ActionType;
  x?: number;
  y?: number;
  automatic?: boolean;
  text: string;
  at: number;
}
export interface GameState {
  code: string;
  status: GameStatus;
  size: 5;
  maxPlayers: number;
  hostId: string;
  players: Player[];
  board: Cell[];
  round: number;
  maxRounds: 8;
  turnNumber: number;
  activePlayerId: string | null;
  signalIndex: number;
  nextSignalIndex: number;
  turnDeadlineAt: number | null;
  startedAt: number | null;
  hardDeadlineAt: number | null;
  winners: string[];
  log: GameLogEntry[];
  seed: number;
}
export interface ActionInput { type: ActionType; x?: number; y?: number; cost?: unknown; label?: unknown; }
export interface Action extends ActionInput { cost: number; label: string; }
export class EngineError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status?: number);
}
export function createGame(options: { code: string; maxPlayers: number; host: PlayerInput; seed?: number; now: number }): GameState;
export function addPlayer(game: GameState, player: PlayerInput, now: number): GameState;
export function startGame(game: GameState, options: { actorId: string; fillBots?: boolean }, now: number): GameState;
export function legalActions(game: GameState, playerId?: string | null): Action[];
export function applyAction(game: GameState, playerId: string, action: ActionInput, now: number, options?: { automatic?: boolean }): GameState;
export function advanceGame(game: GameState, now: number): GameState;
export function chooseBotAction(game: GameState, playerId?: string | null, style?: BotStyle): Action;

