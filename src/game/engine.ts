// Simulation core — State.io-exact mechanics.
// - Territories are circles; any territory can target any other (no adjacency).
// - Tap/drag from your circle sends ALL of its troops ("the territory left
//   behind will reset to zero"); they march as individual dots in a stream.
// - Each arriving dot fights 1:1: it kills one defender, reinforces one friend,
//   or captures an empty/neutral circle (first dot claims it, rest reinforce).
// - Owned circles regenerate +1 troop per growthIntervalMs up to maxTroops.
//   Neutral circles never regenerate.
// - Win: own every circle. Lose: own none.

import { generateMap, pickStarts, type CircleTerritory } from './map';

export type OwnerId = string; // commander id, or NEUTRAL
export const NEUTRAL: OwnerId = 'neutral';

export interface SimConfig {
  seed: number;
  tickMs: number; // fixed sim step (100ms)
  growthIntervalMs: number; // 1500 — owned-circle regen pulse
  maxTroops: number; // regen cap per circle (99)
  dotSpeed: number; // world units per second of dot travel
  staggerMs: number; // gap between consecutive dots of one send (45)
  startingTroops: number; // opening garrison per commander (10)
}

export function defaultConfig(seed: number): SimConfig {
  return {
    seed,
    tickMs: 100,
    growthIntervalMs: 1500,
    maxTroops: 99,
    dotSpeed: 26,
    staggerMs: 45,
    startingTroops: 10,
  };
}

export interface TerritoryState {
  id: string;
  x: number;
  y: number;
  r: number;
  owner: OwnerId;
  troops: number; // integer, always >= 0
  /** Wall-ms timestamp until which the renderer pulses the under-attack ring. */
  underAttackUntilMs: number;
}

/** One marching troop. Position is derived from timeMs (no integration). */
export interface DotState {
  id: number;
  owner: OwnerId;
  targetId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  departMs: number;
  arriveMs: number;
  /** Fixed lateral offset (world units) so streams don't perfectly overlap. */
  lat: number;
}

export interface CommanderState {
  id: OwnerId;
  name: string;
  colorIdx: number;
  isBot: boolean;
  alive: boolean;
  eliminations: number;
}

export type MatchStatus = 'running' | 'won' | 'lost';

export interface GameState {
  config: SimConfig;
  circles: CircleTerritory[];
  tick: number;
  timeMs: number;
  accMs: number;
  territories: TerritoryState[];
  terrById: Record<string, TerritoryState>;
  dots: DotState[];
  commanders: CommanderState[];
  playerId: OwnerId;
  status: MatchStatus;
  winnerId: OwnerId | null;
  endTimeMs: number | null;
  nextDotId: number;
  /** Deterministic RNG for cosmetic sim randomness (dot wobble). */
  rng: () => number;
}

// mulberry32 — seeded RNG.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join('‖');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface CommanderSetup {
  id: OwnerId;
  name: string;
  colorIdx: number;
  isBot: boolean;
}

/**
 * Build a fresh match. Commanders start on maximally-separated circles with
 * `startingTroops` each; everything else is neutral with a seeded garrison.
 */
export function createGame(
  config: SimConfig,
  commanders: CommanderSetup[],
  playerId: OwnerId,
  circleCount = 22,
): GameState {
  const circles = generateMap(config.seed, circleCount);
  const starts = pickStarts(circles, commanders.length, config.seed);
  const rng = mulberry32(config.seed ^ 0x1234abcd);

  const terrById: Record<string, TerritoryState> = {};
  const territories: TerritoryState[] = circles.map((c) => {
    // Neutral garrison 5–15, slightly higher on bigger circles.
    const troops = Math.round(5 + rng() * 8 + (c.r - 4) * 1.2);
    const t: TerritoryState = {
      id: c.id,
      x: c.x,
      y: c.y,
      r: c.r,
      owner: NEUTRAL,
      troops,
      underAttackUntilMs: 0,
    };
    terrById[c.id] = t;
    return t;
  });

  commanders.forEach((c, i) => {
    const t = terrById[starts[i]];
    t.owner = c.id;
    t.troops = config.startingTroops;
  });

  return {
    config,
    circles,
    tick: 0,
    timeMs: 0,
    accMs: 0,
    territories,
    terrById,
    dots: [],
    commanders: commanders.map((c) => ({ ...c, alive: true, eliminations: 0 })),
    playerId,
    status: 'running',
    winnerId: null,
    endTimeMs: null,
    nextDotId: 1,
    rng: mulberry32(config.seed ^ 0x77aa55cc),
  };
}

/**
 * Send EVERY troop from `fromId` to `toId` as a staggered stream of dots.
 * The source resets to zero — exactly like State.io.
 * Returns false if illegal (wrong owner, no troops, dead commander, over).
 */
export function issueSend(
  state: GameState,
  owner: OwnerId,
  fromId: string,
  toId: string,
): boolean {
  if (state.status !== 'running') return false;
  if (fromId === toId) return false;
  const from = state.terrById[fromId];
  const to = state.terrById[toId];
  if (!from || !to) return false;
  if (from.owner !== owner) return false;
  if (from.troops < 1) return false;
  const me = state.commanders.find((c) => c.id === owner);
  if (!me || !me.alive) return false;

  const n = from.troops;
  from.troops = 0;

  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const travelMs = Math.max(
    state.config.tickMs,
    (dist / state.config.dotSpeed) * 1000,
  );
  for (let i = 0; i < n; i++) {
    const departMs = state.timeMs + i * state.config.staggerMs;
    state.dots.push({
      id: state.nextDotId++,
      owner,
      targetId: toId,
      x0: from.x,
      y0: from.y,
      x1: to.x,
      y1: to.y,
      departMs,
      arriveMs: departMs + travelMs,
      lat: (state.rng() - 0.5) * 1.8,
    });
  }
  return true;
}

/** Advance the simulation by dtMs of wall time, in fixed tickMs quanta. */
export function step(state: GameState, dtMs: number): void {
  state.accMs += Math.min(dtMs, 1000); // clamp: no spiral after tab-switch
  while (state.accMs >= state.config.tickMs) {
    state.accMs -= state.config.tickMs;
    advanceTick(state);
  }
}

function advanceTick(state: GameState): void {
  state.tick += 1;
  state.timeMs += state.config.tickMs;

  // Regen pulse: every owned circle +1 troop, up to the cap.
  if (state.timeMs % state.config.growthIntervalMs === 0) {
    for (const t of state.territories) {
      if (t.owner === NEUTRAL) continue;
      if (t.troops < state.config.maxTroops) t.troops += 1;
    }
  }

  // Resolve arrived dots (earliest departure first — fair 1:1 fights).
  if (state.dots.length > 0) {
    const due = state.dots.filter((d) => d.arriveMs <= state.timeMs);
    if (due.length > 0) {
      due.sort((a, b) => a.departMs - b.departMs || a.id - b.id);
      const dueIds = new Set(due.map((d) => d.id));
      state.dots = state.dots.filter((d) => !dueIds.has(d.id));
      for (const d of due) resolveDot(state, d);
    }
  }

  checkEnd(state);
}

function resolveDot(state: GameState, d: DotState): void {
  const target = state.terrById[d.targetId];
  if (!target) return;
  const ownerAlive = state.commanders.find((c) => c.id === d.owner)?.alive;
  if (!ownerAlive) return; // eliminated mid-flight: the dot fizzles

  if (target.owner === d.owner) {
    target.troops += 1; // reinforcement
    return;
  }
  if (target.troops > 0) {
    target.troops -= 1; // 1:1 trade — the dot dies killing one defender
    target.underAttackUntilMs = state.timeMs + 900;
  } else {
    // Capture: the dot claims the circle.
    const prevOwner = target.owner;
    target.owner = d.owner;
    target.troops = 1;
    target.underAttackUntilMs = state.timeMs + 900;
    if (prevOwner !== NEUTRAL) eliminateIfWiped(state, prevOwner, d.owner);
  }
}

/** A commander holding no circles is eliminated; their dots vanish. */
function eliminateIfWiped(
  state: GameState,
  victimId: OwnerId,
  killerId: OwnerId,
): void {
  const victim = state.commanders.find((c) => c.id === victimId);
  if (!victim || !victim.alive) return;
  if (state.territories.some((t) => t.owner === victimId)) return;
  victim.alive = false;
  state.dots = state.dots.filter((d) => d.owner !== victimId);
  const killer = state.commanders.find((c) => c.id === killerId);
  if (killer) killer.eliminations += 1;
}

function checkEnd(state: GameState): void {
  if (state.status !== 'running') return;
  const player = state.commanders.find((c) => c.id === state.playerId);
  if (!player) return;
  if (!player.alive) {
    state.status = 'lost';
    state.endTimeMs = state.timeMs;
    const rest = state.commanders.filter((c) => c.alive);
    if (rest.length === 1) state.winnerId = rest[0].id;
    return;
  }
  const botsAlive = state.commanders.some((c) => c.isBot && c.alive);
  if (!botsAlive) {
    state.status = 'won';
    state.winnerId = player.id;
    state.endTimeMs = state.timeMs;
  }
}

// --- queries ---------------------------------------------------------------

export function commanderById(
  state: GameState,
  id: OwnerId,
): CommanderState | undefined {
  return state.commanders.find((c) => c.id === id);
}

export function territoriesOf(state: GameState, owner: OwnerId): TerritoryState[] {
  return state.territories.filter((t) => t.owner === owner);
}

export function totalTroops(state: GameState, owner: OwnerId): number {
  let sum = 0;
  for (const t of state.territories) if (t.owner === owner) sum += t.troops;
  return sum;
}

export interface ScoreBreakdown {
  territories: number;
  eliminations: number;
  timeBonus: number;
  total: number;
  seconds: number;
  won: boolean;
}

/** Blitz scoring. Time bonus is paid on victory only. */
export function computeScore(state: GameState, playerId: OwnerId): ScoreBreakdown {
  const me = commanderById(state, playerId);
  const territories = territoriesOf(state, playerId).length;
  const eliminations = me ? me.eliminations : 0;
  const won = state.status === 'won';
  const seconds = Math.floor((state.endTimeMs ?? state.timeMs) / 1000);
  const timeBonus = won ? Math.max(0, 300 - seconds) * 2 : 0;
  return {
    territories,
    eliminations,
    timeBonus: Math.round(timeBonus),
    total: territories * 100 + eliminations * 500 + Math.round(timeBonus),
    seconds,
    won,
  };
}
