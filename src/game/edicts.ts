// Edicts — timed god-powers. SOVEREIGN's signature mechanic (GAME-DESIGN.md §17).
// Pure logic (no Phaser): deterministic, headless-testable, replay-safe.
// Rules: 3 edicts per match, each with a cooldown. One ACTIVE edict per
// commander at a time. Plague is telegraphed 1.5s before it lands so both
// the player and bots can react — fairness is load-bearing for leaderboards.

import type { GameState, OwnerId } from './engine';
import type { BotTier } from './bots';
import { hashSeed, mulberry32, NEUTRAL } from './engine';

export type EdictType = 'golden-age' | 'plague' | 'iron-wall';

export interface EdictDef {
  type: EdictType;
  name: string;
  epithet: string;
  description: string;
  /** Active duration in ms. 0 = instant (plague: telegraph then strike). */
  durationMs: number;
  cooldownMs: number;
  /** UI accent color (hex number for Phaser). */
  color: number;
}

export const EDICTS: Record<EdictType, EdictDef> = {
  'golden-age': {
    type: 'golden-age',
    name: 'Golden Age',
    epithet: 'The granaries overflow.',
    description: '2× troop growth on all your lands for 20s.',
    durationMs: 20_000,
    cooldownMs: 75_000,
    color: 0xf5d67b,
  },
  plague: {
    type: 'plague',
    name: 'Plague',
    epithet: 'The pale riders come.',
    description:
      'Halve the army of a rival territory. Telegraphs 1.5s before it lands.',
    durationMs: 0,
    cooldownMs: 90_000,
    color: 0x86efac,
  },
  'iron-wall': {
    type: 'iron-wall',
    name: 'Iron Wall',
    epithet: 'Hold the line.',
    description: '+50% defense on all your lands for 30s.',
    durationMs: 30_000,
    cooldownMs: 75_000,
    color: 0x7dd3fc,
  },
};

export const EDICT_ORDER: EdictType[] = ['golden-age', 'plague', 'iron-wall'];

/** Telegraph delay before a plague lands (ms) — readable, reactable. */
export const PLAGUE_TELEGRAPH_MS = 1500;

export interface ActiveEdict {
  type: EdictType;
  owner: OwnerId;
  expiresMs: number;
}

export interface PendingPlague {
  targetId: string;
  caster: OwnerId;
  applyAtMs: number;
}

const key = (owner: OwnerId, type: EdictType): string => `${owner}:${type}`;

/**
 * True if the commander could invoke this edict ignoring target validity
 * (cooldown ready, no other active edict, match running, commander alive).
 */
export function edictReady(
  state: GameState,
  owner: OwnerId,
  type: EdictType,
): boolean {
  if (state.status !== 'running') return false;
  const me = state.commanders.find((c) => c.id === owner);
  if (!me || !me.alive) return false;
  // One active edict at a time per commander.
  if (state.edicts.some((e) => e.owner === owner)) return false;
  const readyAt = state.edictCooldowns[key(owner, type)] ?? 0;
  return state.timeMs >= readyAt;
}

/** True if the commander may invoke this edict right now. */
export function canUseEdict(
  state: GameState,
  owner: OwnerId,
  type: EdictType,
  targetId?: string,
): boolean {
  if (!edictReady(state, owner, type)) return false;
  if (type === 'plague') {
    if (!targetId) return false;
    const t = state.terrById[targetId];
    if (!t || t.owner === owner || t.owner === NEUTRAL) return false;
    if (t.troops < 2) return false;
  }
  return true;
}

/**
 * Invoke an edict. Returns false if illegal (see canUseEdict).
 * Cooldown starts at invocation, so it ticks during the effect.
 */
export function useEdict(
  state: GameState,
  owner: OwnerId,
  type: EdictType,
  targetId?: string,
): boolean {
  if (!canUseEdict(state, owner, type, targetId)) return false;
  const def = EDICTS[type];
  state.edictCooldowns[key(owner, type)] = state.timeMs + def.cooldownMs;
  if (type === 'plague' && targetId) {
    const applyAtMs = state.timeMs + PLAGUE_TELEGRAPH_MS;
    state.pendingPlagues.push({ targetId, caster: owner, applyAtMs });
    state.plagueMarks[targetId] = applyAtMs; // renderer telegraph
  } else {
    state.edicts.push({ type, owner, expiresMs: state.timeMs + def.durationMs });
  }
  return true;
}

/** Growth multiplier for a commander's territories (Golden Age = 2×). */
export function growthMultiplier(state: GameState, owner: OwnerId): number {
  return state.edicts.some(
    (e) => e.owner === owner && e.type === 'golden-age',
  )
    ? 2
    : 1;
}

/** Extra defense bonus for a commander's territories (Iron Wall = +0.5). */
export function defenseBonus(state: GameState, owner: OwnerId): number {
  if (owner === NEUTRAL) return 0;
  return state.edicts.some(
    (e) => e.owner === owner && e.type === 'iron-wall',
  )
    ? 0.5
    : 0;
}

/** Cooldown remaining in ms (0 = ready). */
export function edictCooldownLeft(
  state: GameState,
  owner: OwnerId,
  type: EdictType,
): number {
  return Math.max(0, (state.edictCooldowns[key(owner, type)] ?? 0) - state.timeMs);
}

/** Advance edict timers: expire actives, land due plagues. Called every tick. */
export function updateEdicts(state: GameState): void {
  if (state.edicts.length > 0) {
    state.edicts = state.edicts.filter((e) => e.expiresMs > state.timeMs);
  }
  if (state.pendingPlagues.length > 0) {
    const remaining: PendingPlague[] = [];
    for (const p of state.pendingPlagues) {
      if (state.timeMs >= p.applyAtMs) {
        const t = state.terrById[p.targetId];
        if (t && t.owner !== NEUTRAL) {
          t.troops = Math.floor(t.troops / 2);
          t.underAttackUntilMs = state.timeMs + 1200;
        }
        delete state.plagueMarks[p.targetId];
      } else {
        remaining.push(p);
      }
    }
    state.pendingPlagues = remaining;
  }
}

// --- bot edict usage ---------------------------------------------------------
// Veteran+ bots invoke edicts with the same rules and cooldowns as the player.
// Checked on a slow cadence from the scene; rolls are deterministic per
// (seed, bot, 5s-window) so replays stay identical.

export function maybeCastBotEdict(
  state: GameState,
  botId: OwnerId,
  tier: BotTier,
): void {
  if (tier === 'recruit') return; // the Lieutenant never learned statecraft
  if (state.edicts.some((e) => e.owner === botId)) return;

  const rng = mulberry32(
    hashSeed(state.config.seed, 'edict', botId, Math.floor(state.timeMs / 5000)),
  );
  const owned = state.territories.filter((t) => t.owner === botId);
  if (owned.length === 0) return;

  // 1. IRON WALL — a threatened border is the highest calling.
  if (edictReady(state, botId, 'iron-wall')) {
    const homeAdv = state.config.homeAdvantage;
    for (const t of owned) {
      let threat = 0;
      for (const n of state.adj[t.id]) {
        const nt = state.terrById[n];
        if (nt.owner !== botId && nt.owner !== NEUTRAL) threat += nt.troops;
      }
      for (const s of state.streams) {
        if (s.to === t.id && s.owner !== botId) threat += s.troops;
      }
      const effDef = Math.floor(t.troops * (1 + homeAdv));
      if (threat > effDef && rng() < 0.6) {
        useEdict(state, botId, 'iron-wall');
        return;
      }
    }
  }

  // 2. PLAGUE — Sovereign-tier malice: cripple the strongest rival border.
  if (tier === 'sovereign' && edictReady(state, botId, 'plague')) {
    let bestId: string | null = null;
    let bestTroops = 12;
    for (const t of owned) {
      for (const n of state.adj[t.id]) {
        const nt = state.terrById[n];
        if (nt.owner === botId || nt.owner === NEUTRAL) continue;
        if (nt.troops > bestTroops) {
          bestTroops = nt.troops;
          bestId = n;
        }
      }
    }
    if (bestId && rng() < 0.5) {
      useEdict(state, botId, 'plague', bestId);
      return;
    }
  }

  // 3. GOLDEN AGE — early snowball, or pressed while ahead.
  if (edictReady(state, botId, 'golden-age') && owned.length >= 3) {
    const early = state.timeMs < 60_000;
    const mostLand =
      owned.length >=
      Math.max(...state.commanders.filter((c) => c.alive).map((c) => state.territories.filter((t) => t.owner === c.id).length));
    if ((early || mostLand) && rng() < 0.35) {
      useEdict(state, botId, 'golden-age');
    }
  }
}
