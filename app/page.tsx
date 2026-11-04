"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

type MoveType = "grow" | "raid" | "fortify" | "bloom" | "charge";
type Action = { type: MoveType; x?: number; y?: number; cost?: number; label?: string };
type Player = { id: string; name: string; colorIndex: number; isBot: boolean; energy: number; score: number };
type Cell = { x: number; y: number; owner: string | null; power: number; beaconId: number | null };
type Game = {
  code: string; status: "lobby" | "active" | "finished"; size: number; maxPlayers: number; hostId: string;
  players: Player[]; board: Cell[]; round: number; maxRounds: number; turnNumber: number;
  activePlayerId: string | null; signalIndex: number; nextSignalIndex: number;
  turnDeadlineAt: number | null; hardDeadlineAt: number | null; winners: string[];
  log: { id: string; text: string; kind: string; playerId?: string; at: number }[];
};
type Snapshot = { code: string; version: number; game: Game; legalActions: Action[]; serverTime: number };
type Joined = Snapshot & { playerId: string; token: string };
type Seat = { playerId: string; token: string };
type ToneStyle = CSSProperties & { "--player"?: string; "--wash"?: string; "--action-color"?: string; "--action-wash"?: string; "--clock"?: string };
type IconName = "arrow" | "copy" | "bolt" | "grow" | "raid" | "fortify" | "bloom" | "bot" | "leaf" | "home" | "close" | "code" | "crown";

const COLORS = [
  { name: "Lagoon", ink: "#149caf", wash: "#ddf1ed" },
  { name: "Coral", ink: "#d96550", wash: "#fae4d9" },
  { name: "Marigold", ink: "#a98110", wash: "#f7edc3" },
  { name: "Lilac", ink: "#8a68ba", wash: "#ece3f5" },
];
const HOMES = [[0, 0], [4, 4], [4, 0], [0, 4]];
const BEACONS = [[2, 2], [1, 2], [2, 1], [3, 2], [2, 3]];
const MODES: { type: Exclude<MoveType, "charge">; name: string; cost: string; key: string; hint: string }[] = [
  { type: "grow", name: "Grow", cost: "1", key: "G", hint: "Claim a neighboring empty tile." },
  { type: "raid", name: "Raid", cost: "2–4", key: "R", hint: "Take a neighbor. Stronger roots cost more." },
  { type: "fortify", name: "Fortify", cost: "1", key: "F", hint: "Strengthen your roots, up to three." },
  { type: "bloom", name: "Bloom", cost: "2", key: "B", hint: "Turn an owned beacon into 2 points." },
];
const PREVIEW: Cell[] = Array.from({ length: 25 }, (_, i) => {
  const x = i % 5, y = Math.floor(i / 5), beacon = BEACONS.findIndex(([bx, by]) => bx === x && by === y);
  return { x, y, owner: null, power: 0, beaconId: beacon < 0 ? null : beacon };
});
const tone = (i: number): ToneStyle => ({ "--player": COLORS[((i % 4) + 4) % 4].ink, "--wash": COLORS[((i % 4) + 4) % 4].wash });
const coord = (x: number, y: number) => String.fromCharCode(65 + x) + (y + 1);
const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
const seatKey = (code: string) => "signal-grove:seat:" + code;

function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V4H4v11h4" /></>,
    bolt: <path d="m13 2-8 12h6l-1 8 9-13h-6l1-7Z" />,
    grow: <><path d="M12 21V10M12 14C4 14 3 9 4 5c6-1 9 3 8 9ZM12 10c0-6 4-8 8-7 1 5-2 8-8 7Z" /></>,
    raid: <><path d="m5 19 14-14M10 5h9v9M4 12v8h8" /><path d="m3 6 3-3M18 21l3-3" /></>,
    fortify: <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" /><path d="M12 7v9M8 11.5h8" /></>,
    bloom: <><path d="m12 2 2.5 6 6.5.5-5 4.5 1.5 7-5.5-3.5L6.5 20 8 13 3 8.5 6.5 8 12 2Z" /></>,
    bot: <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M9 16h6M1 12h3m16 0h3" /><circle cx="8.5" cy="12" r=".8" /><circle cx="15.5" cy="12" r=".8" /></>,
    leaf: <><path d="M5 20c0-9 4-16 15-16 0 11-6 16-15 16ZM5 20 15 10" /></>,
    home: <><path d="m3 10 9-7 9 7M6 9v11h12V9M10 20v-7h4v7" /></>,
    close: <><path d="m6 6 12 12M6 18 18 6" /></>,
    code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16" /></>,
    crown: <><path d="m3 6 5 5 4-7 4 7 5-5-2 13H5L3 6ZM6 22h12" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>;
}

function Sprout({ power = 1 }: { power?: number }) {
  return <svg className="sprout" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <ellipse cx="50" cy="83" rx="22" ry="5" fill="currentColor" opacity=".13" />
    <path d="M50 80V43" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    <path d="M50 58C27 60 23 44 25 31c18-2 30 8 25 27Z" fill="currentColor" />
    <path d="M50 48C48 29 62 17 78 21c1 18-10 30-28 27Z" fill="currentColor" opacity=".83" />
    <path d="m30 37 19 17m23-26L52 44" stroke="var(--wash)" strokeWidth="2" strokeLinecap="round" opacity=".65" />
    {power > 1 && <path d="M51 70C67 74 77 63 75 52c-15-2-25 5-24 18Z" fill="currentColor" />}
    {power > 2 && <path d="M49 78C33 81 21 70 23 59c16-2 27 7 26 19Z" fill="currentColor" opacity=".8" />}
  </svg>;
}

function Beacon({ active = false }: { active?: boolean }) {
  return <svg className={"beacon-mark" + (active ? " beacon-active" : "")} viewBox="0 0 64 64" aria-hidden="true">
    {active && <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 5" />}
    <path d="m32 10 5.7 15.3L54 32l-16.3 6.7L32 54l-5.7-15.3L10 32l16.3-6.7L32 10Z" fill="currentColor" opacity={active ? ".32" : ".2"} />
    <path d="m32 21 3.2 7.8L43 32l-7.8 3.2L32 43l-3.2-7.8L21 32l7.8-3.2L32 21Z" fill="currentColor" />
  </svg>;
}

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code = "") { super("The request could not be completed."); this.status = status; this.code = code; }
}
async function request<T extends Snapshot>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null) as { code?: unknown; game?: { board?: unknown; players?: unknown } } | null;
  if (!response.ok) throw new ApiError(response.status, typeof result?.code === "string" ? result.code : "");
  if (!result?.game || !Array.isArray(result.game.board) || !Array.isArray(result.game.players)) throw new ApiError(502);
  return result as unknown as T;
}
function friendly(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "The grove moved on. Refreshing the board — choose your next move again.";
    if (error.status === 404) return "That grove could not be found. Check the six-character code, or create a new one.";
    if (error.status === 403) return "This seat cannot make that move. The board is refreshing; check whose turn it is.";
    if (error.status === 429) return "A little too quick! Give the grove a moment, then try again.";
    if (error.status >= 500) return "The grove is taking a breather. Please try again in a moment.";
    if (error.code === "LOBBY_FULL") return "Every corner is taken. You can watch this grove or create your own.";
    if (error.code === "MATCH_STARTED") return "This match has already begun. You can still watch it unfold.";
    return "That action could not be completed. Check the current board and try again.";
  }
  return "The connection slipped. Check your network and try again.";
}
function readSeat(code: string): Seat | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(seatKey(code)) || "null");
    return typeof value?.playerId === "string" && typeof value?.token === "string" ? { playerId: value.playerId, token: value.token } : null;
  } catch { return null; }
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [matchCode, setMatchCode] = useState("");
  const [seat, setSeat] = useState<Seat | null>(null);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [fillBots, setFillBots] = useState(true);
  const [mode, setMode] = useState<MoveType>("grow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(true);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [agentOpen, setAgentOpen] = useState(false);
  const currentCode = useRef("");
  const latest = useRef<Snapshot | null>(null);
  const clockOffset = useRef(0);
  const mutationBusy = useRef(false);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  const accept = useCallback((next: Snapshot) => {
    if (currentCode.current !== next.code || (latest.current && next.version < latest.current.version)) return;
    latest.current = next;
    clockOffset.current = next.serverTime - Date.now();
    setSnapshot(next);
    setNow(Date.now());
    setConnected(true);
  }, []);
  const openMatch = useCallback((code: string, joined?: Joined) => {
    currentCode.current = code;
    latest.current = null;
    setSnapshot(null);
    setMatchCode(code);
    setError("");
    setNotice("");
    setConnected(true);
    const credentials = joined ? { playerId: joined.playerId, token: joined.token } : readSeat(code);
    setSeat(credentials);
    try {
      sessionStorage.setItem("signal-grove:last", code);
      if (credentials) sessionStorage.setItem(seatKey(code), JSON.stringify(credentials));
    } catch { /* The current seat still works until this page closes. */ }
    const url = new URL(window.location.href);
    url.searchParams.set("match", code);
    window.history.replaceState({}, "", url);
    if (joined) accept(joined);
  }, [accept]);
  const refresh = useCallback(async () => {
    const code = currentCode.current;
    if (!code) return;
    try { accept(await request("/api/matches/" + code)); }
    catch (err) { setConnected(false); if (!latest.current) setError(friendly(err)); }
  }, [accept]);

  useEffect(() => {
    try { setName(sessionStorage.getItem("signal-grove:name") || ""); } catch { /* Storage is optional. */ }
    const query = normalizeCode(new URLSearchParams(window.location.search).get("match") || "");
    let previous = "";
    try { previous = normalizeCode(sessionStorage.getItem("signal-grove:last") || ""); } catch { /* Storage is optional. */ }
    if (query.length === 6) openMatch(query);
    else if (previous.length === 6) openMatch(previous);
  }, [openMatch]);

  useEffect(() => {
    if (!matchCode) return;
    let cancelled = false, pending = false;
    const controller = new AbortController();
    const poll = async () => {
      if (pending || cancelled) return;
      pending = true;
      try {
        const result = await request("/api/matches/" + matchCode, undefined, controller.signal);
        if (!cancelled) accept(result);
      } catch (err) {
        if (!cancelled) {
          setConnected(false);
          if (!latest.current) setError(friendly(err));
        }
      } finally { pending = false; }
    };
    void poll();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 1500);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; controller.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [matchCode, accept]);

  const game = snapshot?.game;
  const me = game?.players.find((player) => player.id === seat?.playerId);
  const active = game?.players.find((player) => player.id === game.activePlayerId);
  const myTurn = Boolean(game?.status === "active" && me?.id === game.activePlayerId);
  const seconds = game?.turnDeadlineAt ? Math.max(0, Math.min(15, Math.ceil((game.turnDeadlineAt - now - clockOffset.current) / 1000))) : 15;
  const legal = myTurn ? snapshot?.legalActions || [] : [];
  const legalForMode = legal.filter((action) => action.type === mode);
  const charge = legal.find((action) => action.type === "charge");
  const canMove = myTurn && !busy && connected && seconds > 0;
  const host = Boolean(me && me.id === game?.hostId);
  const board = game?.board || PREVIEW;
  const leader = Math.max(1, ...(game?.players.map((p) => p.score) || [1]));
  const activeTone = COLORS[active?.colorIndex ?? 0];
  const arenaStyle: ToneStyle = { "--action-color": activeTone.ink, "--action-wash": activeTone.wash };

  useEffect(() => {
    if (game?.status !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game?.status]);
  useEffect(() => {
    if (!myTurn) return;
    const options = snapshot?.legalActions || [];
    if (!options.some((a) => a.type === mode)) {
      const available = options.find((a) => a.type !== "charge");
      if (available) setMode(available.type);
    }
  }, [myTurn, mode, snapshot]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (!myTurn || event.metaKey || event.ctrlKey || event.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      const option = MODES.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
      if (option && snapshot?.legalActions.some((action) => action.type === option.type)) { event.preventDefault(); setMode(option.type); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, snapshot]);

  const saveName = () => {
    const chosen = name.trim() || "Wanderer";
    try { sessionStorage.setItem("signal-grove:name", chosen); } catch { /* Storage is optional. */ }
    return chosen;
  };
  const createMatch = async (event?: FormEvent, rematch = false) => {
    event?.preventDefault();
    if (mutationBusy.current) return;
    mutationBusy.current = true; setBusy(true); setError("");
    try {
      const joined = await request<Joined>("/api/matches", { name: saveName(), maxPlayers: rematch ? game?.maxPlayers || maxPlayers : maxPlayers });
      openMatch(joined.code, joined);
    } catch (err) { setError(friendly(err)); }
    finally { mutationBusy.current = false; setBusy(false); }
  };
  const joinMatch = async (event?: FormEvent, targetCode?: string) => {
    event?.preventDefault();
    const code = normalizeCode(targetCode || joinCode);
    if (code.length !== 6) { setError("Enter the six-character grove code to join."); return; }
    if (mutationBusy.current) return;
    if (readSeat(code)) { openMatch(code); return; }
    mutationBusy.current = true; setBusy(true); setError("");
    try {
      const joined = await request<Joined>("/api/matches/" + code + "/join", { name: saveName() });
      openMatch(code, joined);
    } catch (err) { setError(friendly(err)); }
    finally { mutationBusy.current = false; setBusy(false); }
  };
  const act = async (action?: Action) => {
    if (mutationBusy.current || !seat || !latest.current) return;
    const code = currentCode.current, version = latest.current.version;
    mutationBusy.current = true; setBusy(true); setError("");
    try {
      const credentials = { playerId: seat.playerId, token: seat.token, version };
      let result: Snapshot;
      if (!action) result = await request("/api/matches/" + code + "/start", { ...credentials, fillBots });
      else {
        const cleanAction = { type: action.type, ...(action.x !== undefined ? { x: action.x, y: action.y } : {}) };
        result = await request("/api/matches/" + code + "/moves", { ...credentials, moveId: crypto.randomUUID(), action: cleanAction });
      }
      accept(result);
    } catch (err) { setError(friendly(err)); await refresh(); }
    finally { mutationBusy.current = false; setBusy(false); }
  };
  const leaveView = () => {
    currentCode.current = ""; latest.current = null; setMatchCode(""); setSnapshot(null); setSeat(null); setError(""); setNotice("");
    try { sessionStorage.removeItem("signal-grove:last"); } catch { /* Storage is optional. */ }
    const url = new URL(window.location.href); url.searchParams.delete("match"); window.history.replaceState({}, "", url);
  };
  const copyInvite = async () => {
    const url = new URL(window.location.href); url.search = ""; url.searchParams.set("match", matchCode); url.hash = "";
    try { await navigator.clipboard.writeText(url.toString()); setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
    catch { setNotice("Share this grove code: " + matchCode); }
  };
  const tileKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const target = index + offsets[event.key];
    if (target < 0 || target >= 25 || (event.key === "ArrowLeft" && index % 5 === 0) || (event.key === "ArrowRight" && index % 5 === 4)) return;
    tiles.current[target]?.focus();
  };
  const signal = game ? BEACONS[game.signalIndex] || BEACONS[0] : BEACONS[0];
  const nextSignal = game ? BEACONS[game.nextSignalIndex] || BEACONS[1] : BEACONS[1];
  const winners = game?.players.filter((p) => game.winners.includes(p.id)) || [];

  return (
    <main className="site-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Signal Grove home"><span className="brand-icon"><Icon name="grow" size={23} /></span><span>signal<span className="brand-strong">grove</span><b>.</b></span></a>
        <span className="header-tag"><span className="status-dot" /> A shared little world</span>
        <nav aria-label="Main navigation"><a href="#how-to-play">How to play <span>↗</span></a><button type="button" onClick={() => { setAgentOpen(true); window.setTimeout(() => document.getElementById("agent-guide")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}><Icon name="code" size={16} /> For agents</button></nav>
      </header>

      <section className="intro">
        <div><p className="eyebrow"><span>✳</span> SMALL BOARD. BIG POSSIBILITIES.</p><h1>Make your <em>move.</em></h1><p className="intro-copy">Grow your corner. Follow the signal. A little strategy goes a long way.</p></div>
        <div className="game-facts"><span><i className="fact-players"><b /><b /><b /></i> 2–4 players</span><span><i className="fact-clock" /> 15-second turns</span><span><Icon name="bot" size={17} /> Humans + agents</span></div>
      </section>

      {(error || notice) && <div className={"message-bar " + (error ? "message-error" : "")} role={error ? "alert" : "status"}><span>{error || notice}</span><button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}><Icon name="close" size={16} /></button></div>}

      <div className="play-layout">
        <div className="board-column">
          <section className="arena" style={arenaStyle} aria-label="Game board">
            <div className="arena-heading"><div><span className="grove-symbol">✳</span><h2>The grove</h2><span className="size-tag">5 × 5</span></div><span className={"connection-tag" + (!connected ? " disconnected" : "")}>{matchCode ? <><i />{connected ? (game?.status === "finished" ? "Match complete" : "Live grove") : "Reconnecting"}</> : "Map preview"}</span></div>
            <div className="round-strip">
              <div><span className="micro-label">{!game || game.status === "lobby" ? "A FRESH PATCH OF POSSIBILITY" : game.status === "finished" ? "THE FINAL HARVEST" : "FOLLOW THE LIGHT"}</span><strong>{!game || game.status === "lobby" ? "Ready when you are" : <>Round <b>{game.round}</b><span> / {game.maxRounds}</span></>}</strong></div>
              <div className="round-track" aria-label={game ? "Round " + game.round + " of 8" : "Eight rounds"}>{Array.from({ length: 8 }, (_, index) => <span key={index} className={game?.status === "active" || game?.status === "finished" ? index + 1 < game.round ? "past" : index + 1 === game.round ? "current" : "" : ""} />)}</div>
              <div className="signal-badge"><span className="signal-star">✦</span><div><span className="micro-label">{game?.status === "finished" ? "LAST SIGNAL" : "ACTIVE SIGNAL"}</span><strong>{coord(signal[0], signal[1])} <small>+3 pts</small></strong></div></div>
            </div>

            <div className="board-area">
              <div className="column-labels" aria-hidden="true">{["A", "B", "C", "D", "E"].map((letter) => <span key={letter}>{letter}</span>)}</div>
              <div className="board-with-labels">
                <div className="row-labels" aria-hidden="true">{[1, 2, 3, 4, 5].map((number) => <span key={number}>{number}</span>)}</div>
                <div className={"tile-grid" + (!game ? " preview-grid" : "")} role="grid" aria-label="Five by five shared territory">
                  {board.map((cell, index) => {
                    const owner = game?.players.find((p) => p.id === cell.owner);
                    const previewHome = !game ? HOMES.findIndex(([x, y]) => x === cell.x && y === cell.y) : -1;
                    const homePlayer = game?.players.find((p) => HOMES[p.colorIndex]?.[0] === cell.x && HOMES[p.colorIndex]?.[1] === cell.y);
                    const home = Boolean(homePlayer || previewHome >= 0);
                    const available = legalForMode.find((a) => a.x === cell.x && a.y === cell.y);
                    const isSignal = cell.beaconId !== null && cell.beaconId === (game?.signalIndex ?? 0);
                    const ownerIndex = owner?.colorIndex ?? previewHome;
                    const aria = coord(cell.x, cell.y) + ", " + (owner ? owner.name + ", strength " + cell.power : "empty") + (home ? ", protected home" : "") + (cell.beaconId !== null ? (isSignal ? ", active beacon, 3 points per round" : ", beacon, 1 point per round") : "") + (available && canMove ? ", " + mode + ", costs " + available.cost + " energy" : "");
                    return <button key={index} ref={(node) => { tiles.current[index] = node; }} role="gridcell" type="button" className={"tile" + (owner || previewHome >= 0 ? " owned-cell" : "") + (cell.beaconId !== null ? " beacon-cell" : "") + (isSignal ? " signal-cell" : "") + (home ? " home-cell" : "") + (available && canMove ? " legal-cell" : "")} style={ownerIndex >= 0 ? tone(ownerIndex) : undefined} aria-label={aria} aria-disabled={!available || !canMove} onClick={() => { if (available && canMove) void act(available); }} onKeyDown={(event) => tileKeys(event, index)}>
                      {cell.beaconId !== null && <Beacon active={isSignal} />}
                      {(owner || previewHome >= 0) && <Sprout power={owner ? cell.power : 1} />}
                      {!owner && previewHome < 0 && cell.beaconId === null && <span className="soil-dot" />}
                      {home && <span className="home-mark" title="Protected home"><Icon name="home" size={11} /></span>}
                      {owner && <span className="power-dots" aria-hidden="true">{Array.from({ length: 3 }, (_, i) => <i key={i} className={i < cell.power ? "filled" : ""} />)}</span>}
                      {previewHome >= 0 && <span className="preview-home">HOME</span>}
                      {available && canMove && <span className="move-marker" aria-hidden="true">{mode === "grow" ? "+" : mode === "raid" ? "↗" : mode === "fortify" ? "+1" : "+2"}</span>}
                    </button>;
                  })}
                </div>
              </div>
            </div>
            <div className="board-legend"><span><span className="legend-star">✦</span> Beacons score every round</span><span>Next signal <b>{coord(nextSignal[0], nextSignal[1])}</b> <span className="tiny-arrow">↗</span></span></div>
            <div className={"turn-banner" + (myTurn ? " your-turn" : "")} style={active ? tone(active.colorIndex) : undefined}>
              <span className="banner-icon">{game?.status === "finished" ? <Icon name="crown" size={19} /> : <Icon name={myTurn ? mode === "charge" ? "bolt" : mode : "leaf"} size={19} />}</span>
              <span>{!matchCode ? <><strong>Good things start small.</strong> Create a grove to take your corner.</> : !game ? "Opening your grove…" : game.status === "lobby" ? <><strong>A little room to grow.</strong> Invite a friend or add bots to begin.</> : game.status === "finished" ? <><strong>That’s a wrap.</strong> Every little move made a difference.</> : myTurn ? <><strong>Your turn.</strong> {canMove ? mode === "bloom" ? "Choose a highlighted beacon to bloom." : "Choose a highlighted tile to " + mode + "." : "The next turn is arriving…"}</> : <><strong>{active?.name || "The grove"} is thinking.</strong> Your next opportunity is just around the corner.</>}</span>
            </div>
          </section>

          <div className="below-board">
            <section id="how-to-play" className="rules-card"><div className="section-title"><span>01 / THE IDEA</span><h2>Plant. Plot. Prosper.</h2></div><p>Take one action each turn over <strong>8 rounds</strong>. Grow into a neighboring tile, raid a rival, fortify your roots, or bloom on a beacon for 2 points. The active <span className="inline-star">✦</span> beacon pays <strong>3 points</strong> each round; the others pay 1. Charge for +3 energy, with +1 at your next turn and a cap of 6. Your original home is a safe anchor. Miss your 15 seconds? A bot takes that turn. Highest score wins, with territory breaking ties. Matches end within 9 minutes.</p><a href="#agent-guide" onClick={() => setAgentOpen(true)}>Agents welcome, too <span>↗</span></a></section>
            <section className="log-card" aria-label="Match activity"><div className="log-title"><h2>Field notes</h2><span>{game ? "THE STORY SO FAR" : "A BLANK PAGE"}</span></div><div className="match-log">{game?.log.length ? [...game.log].slice(-30).reverse().map((entry) => { const player = game.players.find((p) => p.id === entry.playerId); return <div className="log-entry" key={entry.id}><i style={player ? { background: COLORS[player.colorIndex % 4].ink } : undefined} /><p>{entry.text}</p></div>; }) : <div className="log-empty"><Icon name="leaf" size={24} /><p>Every grove has a story.<br />Yours starts with the first move.</p></div>}</div></section>
          </div>
        </div>

        <aside className="side-column" aria-label="Match controls">
          {!matchCode ? <section className="lobby-card"><div className="lobby-decoration" aria-hidden="true"><Icon name="grow" size={43} /><span>✦</span></div><p className="eyebrow small">FIND YOUR CORNER</p><h2>Let’s play.</h2><p className="lobby-copy">No account. Just a name,<br />a little curiosity, and a plan.</p><form onSubmit={(e) => void createMatch(e)}><label className="field-label" htmlFor="player-name">What should we call you?</label><input id="player-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Your name" required autoComplete="nickname" /><label className="field-label player-count-label">Room for how many?</label><div className="player-count" role="group" aria-label="Number of players">{[2, 3, 4].map((count) => <button type="button" key={count} aria-pressed={maxPlayers === count} className={maxPlayers === count ? "selected" : ""} onClick={() => setMaxPlayers(count)}><span>{count}</span> players</button>)}</div><button className="button primary create-button" disabled={busy} type="submit">{busy ? "Planting the seeds…" : "Create a grove"}<Icon name="arrow" size={19} /></button></form><div className="join-divider"><span />OR JOIN YOUR PEOPLE<span /></div><form className="join-form" onSubmit={(e) => void joinMatch(e)}><label className="sr-only" htmlFor="join-code">Six-character grove code</label><input id="join-code" value={joinCode} onChange={(e) => setJoinCode(normalizeCode(e.target.value))} maxLength={6} minLength={6} required placeholder="Grove code" autoComplete="off" spellCheck={false} /><button type="submit" aria-label="Join grove" disabled={busy || joinCode.length !== 6}><Icon name="arrow" size={20} /></button></form><p className="solo-note"><Icon name="bot" size={15} /> Flying solo? Fill the other seats with bots.</p></section>
          : !game ? <section className="lobby-card loading-card"><span className="loading-sprout"><Icon name="grow" size={42} /></span><h2>Finding your grove.</h2><p>Code <strong>{matchCode}</strong></p><button className="button secondary" type="button" onClick={() => void refresh()} disabled={busy}>Try again</button><button className="text-button" type="button" onClick={leaveView}>Back to the meadow</button></section>
          : game.status === "lobby" ? <section className="lobby-card waiting-card"><p className="eyebrow small">A NEW BEGINNING</p><h2>Room to grow.</h2><p className="lobby-copy">{me ? "Share your code. Good company makes a great grove." : "There’s a little world waiting for you."}</p><div className="invite-code"><span className="micro-label">GROVE CODE</span><button onClick={() => void copyInvite()} type="button" aria-label="Copy invitation link"><strong>{matchCode}</strong><Icon name={copied ? "leaf" : "copy"} size={17} /></button><small>{copied ? "Invite link copied" : "Tap to copy the invite link"}</small></div><div className="lobby-seats">{Array.from({ length: game.maxPlayers }, (_, index) => { const player = game.players[index]; return <div className={"lobby-seat" + (!player ? " empty-seat" : "")} key={index} style={tone(index)}><span className="seat-avatar">{player ? <Icon name={player.isBot ? "bot" : "leaf"} size={17} /> : "+"}</span><span>{player ? player.name : "An open corner"}{player && player.id === me?.id && <small>YOU</small>}</span>{player?.id === game.hostId && <span className="host-tag">HOST</span>}</div>; })}</div>{host ? <><label className="bot-checkbox"><input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.target.checked)} /><span>Fill open seats with bots</span><Icon name="bot" size={17} /></label><button type="button" className="button primary" disabled={busy || !connected || (!fillBots && game.players.length < 2)} onClick={() => void act()}>{busy ? "Waking the grove…" : "Let it grow"}<Icon name="arrow" size={19} /></button><p className="control-note">{!fillBots && game.players.length < 2 ? "You’ll need at least one more player." : "Everyone gets one action per round."}</p></> : me ? <p className="waiting-note"><span className="status-dot" /> Waiting for the host to start.</p> : game.players.length < game.maxPlayers ? <form onSubmit={(e) => void joinMatch(e, matchCode)}><label className="field-label" htmlFor="spectator-name">Take a seat</label><input id="spectator-name" placeholder="Your name" autoComplete="nickname" required maxLength={24} value={name} onChange={(e) => setName(e.target.value)} /><button className="button primary spectator-join" disabled={busy || !connected} type="submit">Join this grove<Icon name="arrow" size={18} /></button></form> : <p className="waiting-note">All corners are taken. You have a great view.</p>}</section>
          : game.status === "finished" ? <section className="finish-card" style={tone(winners[0]?.colorIndex ?? 0)}><span className="winner-medal"><Icon name="crown" size={32} /></span><p className="eyebrow small">A LITTLE GLORY</p><h2>{winners.some((p) => p.id === me?.id) ? "You grew great." : winners.length > 1 ? "Shared sunshine." : "Well played."}</h2><p className="winner-names">{winners.map((p) => p.name).join(" & ") || "The grove"}{winners.length > 1 ? " share the win." : " takes the grove."}</p><div className="final-score"><strong>{winners[0]?.score ?? 0}</strong><span>points in full bloom</span></div><button className="button primary" type="button" disabled={busy} onClick={() => void createMatch(undefined, true)}>{busy ? "Planting again…" : "Plant a new grove"}<Icon name="arrow" size={18} /></button><p className="control-note">A fresh board. A new code. Another chance.</p></section>
          : <section className={"action-card" + (myTurn ? " is-my-turn" : "")} style={active ? tone(active.colorIndex) : undefined}><div className="action-heading"><div><p className="eyebrow small">{myTurn ? "MAKE IT COUNT" : me ? "A MOMENT TO PLAN" : "TAKE IN THE VIEW"}</p><h2>{myTurn ? "Your move." : "Growing, growing…"}</h2></div><div className={"turn-clock" + (seconds <= 5 ? " urgent" : "")} style={{ "--clock": (seconds / 15 * 360) + "deg" } as ToneStyle} aria-label={seconds + " seconds remaining"}><span>{seconds}<small>SEC</small></span></div></div>{myTurn ? <><p className="action-intro">A small choice. A whole new possibility.</p><div className="mode-grid" role="group" aria-label="Choose an action">{MODES.map((option) => { const available = legal.some((a) => a.type === option.type); return <button type="button" key={option.type} className={"mode-button" + (mode === option.type ? " selected" : "")} disabled={!available || busy} aria-pressed={mode === option.type} title={option.hint} onClick={() => setMode(option.type)}><span className="mode-symbol"><Icon name={option.type} size={22} /><kbd>{option.key}</kbd></span><span className="mode-bottom"><strong>{option.name}</strong><span><Icon name="bolt" size={11} />{option.cost}</span></span></button>; })}</div><div className="mode-hint"><span className="hint-dot" /><p>{legalForMode.length ? <><strong>{legalForMode.length} {legalForMode.length === 1 ? "tile" : "tiles"} to {mode}.</strong> {MODES.find((m) => m.type === mode)?.hint}</> : "Need a little energy? Charge up below."}</p></div><button className="charge-button" type="button" disabled={!charge || !canMove} onClick={() => charge && void act(charge)}><span><Icon name="bolt" size={18} /><strong>Charge up</strong></span><span>+3 energy <Icon name="arrow" size={16} /></span></button><p className="control-note">One action per turn. Energy is capped at 6.</p></> : <div className="thinking-state"><span className="thinking-plant"><Sprout power={2} /></span><p><strong>{active?.name || "The grove"}</strong> is making a move.</p><span>{me ? "Watch the signal. Plan your next step." : "You’re watching a live match."}</span></div>}</section>}

          {game && <section className="score-card"><div className="score-heading"><h2>The growers</h2><span>{game.players.length} / {game.maxPlayers}</span></div><div className="score-list">{game.players.map((player) => { const territory = game.board.filter((cell) => cell.owner === player.id).length; return <div key={player.id} className={"player-row" + (game.activePlayerId === player.id ? " active-player" : "")} style={tone(player.colorIndex)}><span className="player-avatar"><Icon name={player.isBot ? "bot" : "leaf"} size={19} /></span><div className="player-info"><div className="player-name"><strong>{player.name}</strong>{player.id === me?.id && <span>YOU</span>}{game.activePlayerId === player.id && <i title="Current turn" />}</div><div className="player-detail"><span>{territory} {territory === 1 ? "tile" : "tiles"}</span><span className="energy-pips" aria-label={player.energy + " of 6 energy"}><Icon name="bolt" size={10} />{Array.from({ length: 6 }, (_, i) => <i key={i} className={i < player.energy ? "filled" : ""} />)}</span></div><div className="score-track" aria-label={player.score + " points"}><span style={{ width: (player.score / leader * 100) + "%" }} /></div></div><div className="player-points"><strong>{player.score}</strong><span>PTS</span></div></div>; })}</div><div className="scoring-note"><span>✦</span><p>Chase the signal.<br />Territory breaks a tied score.</p></div></section>}
          {matchCode && <div className="match-tools"><button type="button" onClick={() => void copyInvite()}><Icon name="copy" size={14} />{copied ? "Link copied" : matchCode}</button><button type="button" onClick={leaveView}>Leave view <span>↗</span></button></div>}
          {!matchCode && <div className="playful-note"><span>↖</span><p>Easy to pick up.<br />Delightfully hard to put down.</p></div>}
        </aside>
      </div>

      <section id="agent-guide" className={"agent-guide" + (agentOpen ? " expanded" : "")}><button type="button" className="agent-toggle" aria-expanded={agentOpen} aria-controls="agent-content" onClick={() => setAgentOpen(!agentOpen)}><span className="agent-toggle-icon"><Icon name="code" size={23} /></span><span><strong>Green thumbs. Silicon minds.</strong><small>A full-information game for HTTP agents, too.</small></span><span className="agent-toggle-end">{agentOpen ? "Close field guide" : "Open field guide"}<span>{agentOpen ? "−" : "+"}</span></span></button>{agentOpen && <div id="agent-content" className="agent-content"><p>No signup. Create or join a grove, keep your returned seat credentials private, then read the public board and submit one legal action on your turn. Humans and agents share the same rules.</p><div className="api-grid"><div><span className="micro-label">01 / TAKE A SEAT</span><pre><code>{'POST /api/matches\n{"name":"FernBot","maxPlayers":2}\n\nPOST /api/matches/CODE01/join\n{"name":"FernBot"}'}</code></pre><p>Responses include <code>playerId</code> and <code>token</code>. Only the host can start; <code>fillBots: true</code> fills empty seats.</p></div><div><span className="micro-label">02 / START & OBSERVE</span><pre><code>{'POST /api/matches/CODE01/start\n{"playerId":"…","token":"…",\n "version":1,"fillBots":true}\n\nGET /api/matches/CODE01'}</code></pre><p>Read <code>game</code>, <code>version</code> and <code>legalActions</code>. Poll about every 1.5 seconds; reads advance bots and expired turns.</p></div><div><span className="micro-label">03 / MAKE YOUR MOVE</span><pre><code>{'POST /api/matches/CODE01/moves\n{"playerId":"…","token":"…",\n "version":4,"moveId":"unique-id",\n "action":{"type":"grow","x":1,"y":0}}'}</code></pre><p>Coordinates start at zero. Use a fresh <code>moveId</code> for each move; retries of the same move keep that ID. On 409, refresh and choose again.</p></div></div><div className="agent-footnote"><Icon name="fortify" size={15} /> Private tokens belong in POST bodies, never URLs. Public reads need no credentials. Seats in this browser are stored only for this tab’s session.</div></div>}</section>

      <footer className="site-footer"><a className="footer-brand" href="/">signal<strong>grove</strong><b>.</b></a><span>A little competition. A lot of possibility.</span><span>GROW SOMETHING GOOD <span className="footer-flower">✳</span></span></footer>
    </main>
  );
}
