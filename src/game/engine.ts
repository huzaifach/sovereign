// Deterministic simulation core — Phase 1.
// Tick-based troop growth, send/attack resolution, elimination, scoring.
// 100% deterministic given (seed, actionLog): fixed timestep, seeded RNG only at
// setup, integer troop math, no wall-clock or Math.random anywhere in the sim.

import { MAP_TEMPLATES, type MapTemplate } from './map';
import type { BotTier } from './bots';
import {
  defenseBonus,
  growthMultiplier,
  updateEdicts,
  type ActiveEdict,
  type PendingPlague,
} from './edicts';

export type OwnerId = string; // commander id, or NEUTRAL
export const NEUTRAL: OwnerId = 'neutral';

export interface SimConfig {
  seed: number;
  tickMs: number; // fixed sim step (100ms)
  homeAdvantage: number; // defender multiplier, e.g. 0.10
  growthIntervalMs: number; // 3000 Blitz — one growth pulse per territory
  streamSpeed: number; // world units per second of troop-stream travel
  startingTroops: number; // capital garrison at match start (12)
}

/** Blitz tuning per GAME-DESIGN.md §7. */
export function blitzConfig(seed: number): SimConfig {
  return {
    seed,
    tickMs: 100,
    homeAdvantage: 0.1,
    growthIntervalMs: 3000,
    streamSpeed: 45,
    startingTroops: 12,
  };
}

export interface SendAction {
  tick: number;
  from: string;
  to: string;
  fraction: 1 | 0.5;
  owner: OwnerId;
}

export interface TerritoryState {
  id: string;
  owner: OwnerId;
  troops: number; // integer, always >= 0
  growthFrac: number; // fractional growth accumulator (deterministic)
  prosperity: number; // copied from the map node
  isCapital: boolean;
  /** Wall-sim timestamp until which the renderer pulses the under-attack ring. */
  underAttackUntilMs: number;
}

export interface StreamState {
  id: number;
  owner: OwnerId;
  from: string;
  to: string;
  troops: number;
  departMs: number;
  arriveMs: number;
}

export interface CommanderState {
  id: OwnerId;
  name: string;
  colorIdx: number;
  isBot: boolean;
  tier: BotTier | null;
  alive: boolean;
  eliminations: number;
}

export type MatchStatus = 'running' | 'won' | 'lost';

export interface GameState {
  config: SimConfig;
  map: MapTemplate;
  tick: number;
  timeMs: number;
  /** Fractional-ms accumulator for fixed-step advancement. */
  accMs: number;
  territories: TerritoryState[];
  terrById: Record<string, TerritoryState>;
  adj: Record<string, string[]>;
  streams: StreamState[];
  commanders: CommanderState[];
  playerId: OwnerId;
  actionLog: SendAction[];
  status: MatchStatus;
  winnerId: OwnerId | null;
  endTimeMs: number | null;
  nextStreamId: number;
  // Edicts (GAME-DESIGN.md §17) — timed god-powers, one active per commander.
  edicts: ActiveEdict[];
  /** `${owner}:${edictType}` -> wall-ms timestamp when the cooldown ends. */
  edictCooldowns: Record<string, number>;
  pendingPlagues: PendingPlague[];
  /** territoryId -> wall-ms until which the plague telegraph renders. */
  plagueMarks: Record<string, number>;
}

// mulberry32 — deterministic RNG shared by sim + bots.
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
  tier: BotTier | null;
}

/**
 * Build a fresh match. `startTerritoryIds[i]` is the capital of `commanders[i]`.
 * Everything else starts neutral with a seeded army (4–8, scaled by prosperity).
 */
export function createGame(
  mapId: MapTemplate['id'],
  config: SimConfig,
  commanders: CommanderSetup[],
  startTerritoryIds: string[],
  playerId: OwnerId,
): GameState {
  const map = MAP_TEMPLATES[mapId];
  const rng = mulberry32(config.seed);
  const terrById: Record<string, TerritoryState> = {};
  const adj: Record<string, string[]> = {};
  const territories: TerritoryState[] = map.nodes.map((n) => {
    const t: TerritoryState = {
      id: n.id,
      owner: NEUTRAL,
      // Neutral garrison: 4–8, scaled by prosperity (richer land costs more).
      troops: Math.max(
        4,
        Math.min(8, Math.round(4 + n.prosperity * 2.5 + (rng() - 0.5) * 1.5)),
      ),
      growthFrac: 0,
      prosperity: n.prosperity,
      isCapital: false,
      underAttackUntilMs: 0,
    };
    terrById[n.id] = t;
    adj[n.id] = [...n.neighbors];
    return t;
  });

  commanders.forEach((c, i) => {
    const cap = terrById[startTerritoryIds[i]];
    cap.owner = c.id;
    cap.troops = config.startingTroops;
    cap.isCapital = true;
  });

  return {
    config,
    map,
    tick: 0,
    timeMs: 0,
    accMs: 0,
    territories,
    terrById,
    adj,
    streams: [],
    commanders: commanders.map((c) => ({ ...c, alive: true, eliminations: 0 })),
    playerId,
    actionLog: [],
    status: 'running',
    winnerId: null,
    endTimeMs: null,
    nextStreamId: 1,
    edicts: [],
    edictCooldowns: {},
    pendingPlagues: [],
    plagueMarks: {},
  };
}

/**
 * Troops moved by a send: floor(army × fraction), minimum 1, source always
 * retains at least 1 (a territory can never be emptied — deliberate simplification).
 */
export function sendAmount(troops: number, fraction: 1 | 0.5): number {
  if (troops < 2) return 0;
  return Math.max(1, Math.min(troops - 1, Math.floor(troops * fraction)));
}

/**
 * Queue a troop stream. Returns false if the send is illegal
 * (wrong owner, non-adjacent, too few troops, dead commander, match over).
 */
export function issueSend(
  state: GameState,
  owner: OwnerId,
  fromId: string,
  toId: string,
  fraction: 1 | 0.5,
): boolean {
  if (state.status !== 'running') return false;
  const from = state.terrById[fromId];
  const to = state.terrById[toId];
  if (!from || !to) return false;
  if (from.owner !== owner) return false;
  if (!state.adj[fromId]?.includes(toId)) return false;
  const me = state.commanders.find((c) => c.id === owner);
  if (!me || !me.alive) return false;
  const amount = sendAmount(from.troops, fraction);
  if (amount < 1) return false;

  from.troops -= amount;
  const a = state.map.nodes.find((n) => n.id === fromId);
  const b = state.map.nodes.find((n) => n.id === toId);
  const dist = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 10;
  const travelMs = Math.max(
    state.config.tickMs,
    (dist / state.config.streamSpeed) * 1000,
  );
  state.streams.push({
    id: state.nextStreamId++,
    owner,
    from: fromId,
    to: toId,
    troops: amount,
    departMs: state.timeMs,
    arriveMs: state.timeMs + travelMs,
  });
  state.actionLog.push({ tick: state.tick, from: fromId, to: toId, fraction, owner });
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

  updateEdicts(state);

  // Growth pulse: every owned (commander) territory accrues
  // prosperity × (capital ? 2 : 1) × edict multiplier per growthIntervalMs.
  if (state.timeMs % state.config.growthIntervalMs === 0) {
    for (const t of state.territories) {
      if (t.owner === NEUTRAL) continue;
      t.growthFrac +=
        t.prosperity * (t.isCapital ? 2 : 1) * growthMultiplier(state, t.owner);
      const whole = Math.floor(t.growthFrac);
      if (whole > 0) {
        t.troops += whole;
        t.growthFrac -= whole;
      }
    }
  }

  // Resolve arrivals due this tick (stable order: earliest depart first).
  if (state.streams.length > 0) {
    const due = state.streams.filter((s) => s.arriveMs <= state.timeMs);
    if (due.length > 0) {
      due.sort((x, y) => x.departMs - y.departMs || x.id - y.id);
      const dueIds = new Set(due.map((s) => s.id));
      state.streams = state.streams.filter((s) => !dueIds.has(s.id));
      for (const s of due) resolveArrival(state, s);
    }
  }

  checkEnd(state);
}

function resolveArrival(state: GameState, s: StreamState): void {
  const target = state.terrById[s.to];
  if (!target) return;

  // Reinforcement: streams into own territory just add troops.
  if (target.owner === s.owner) {
    target.troops += s.troops;
    return;
  }

  const prevOwner = target.owner;
  const effDef = Math.floor(
    target.troops *
      (1 + state.config.homeAdvantage + defenseBonus(state, target.owner)),
  );
  if (s.troops > effDef) {
    // Capture: remainder holds the territory.
    target.owner = s.owner;
    target.troops = Math.max(1, s.troops - effDef);
    target.isCapital = false;
    target.underAttackUntilMs = state.timeMs + 1200;
    if (prevOwner !== NEUTRAL) {
      const victim = state.commanders.find((c) => c.id === prevOwner);
      const killer = state.commanders.find((c) => c.id === s.owner);
      if (victim && state.territories.every((t) => t.owner !== prevOwner)) {
        victim.alive = false;
        if (killer) killer.eliminations += 1;
      }
    }
  } else {
    // Failed attack: defender keeps the raw difference.
    target.troops = Math.max(0, target.troops - s.troops);
    target.underAttackUntilMs = state.timeMs + 1200;
  }
}

function checkEnd(state: GameState): void {
  const player = state.commanders.find((c) => c.id === state.playerId);
  if (!player) return;
  if (state.status === 'won') return;

  if (!player.alive && state.status === 'running') {
    state.status = 'lost';
    state.endTimeMs = state.timeMs;
  }
  const botsAlive = state.commanders.filter((c) => c.isBot && c.alive);
  const commandersAlive = state.commanders.filter((c) => c.alive);
  if (player.alive && botsAlive.length === 0 && state.status === 'running') {
    state.status = 'won';
    state.winnerId = player.id;
    state.endTimeMs = state.timeMs;
  } else if (state.status === 'lost' && commandersAlive.length === 1) {
    // Spectated endgame resolved.
    state.winnerId = commandersAlive[0].id;
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

/** Blitz scoring per GAME-DESIGN.md §7. Time bonus is paid on victory only. */
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
