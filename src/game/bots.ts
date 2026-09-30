// Bot AI — State.io-style.
// Bots think in the same currency as the player: pick the strongest circle,
// hurl ALL of its troops at the weakest beatable target. No adjacency limits,
// no half-measures — exactly how State.io's AI plays.

import {
  hashSeed,
  mulberry32,
  NEUTRAL,
  type GameState,
  type OwnerId,
  type TerritoryState,
} from './engine';

export type BotTier = 'recruit' | 'veteran' | 'sovereign';

export interface BotPersonality {
  tier: BotTier;
  displayName: string;
  decisionIntervalMs: number;
  /** Required surplus over the defender (incl. regen during flight). */
  margin: number;
  /** Chance per decision to do something dumb. */
  blunderRate: number;
  /** Attacks per decision cycle. */
  attacksPerTurn: number;
  /** Hunt the current troop leader (usually the player). */
  bullyLeader: boolean;
}

export const BOT_TIERS: Record<BotTier, BotPersonality> = {
  recruit: {
    tier: 'recruit',
    displayName: 'The Eager Lieutenant',
    decisionIntervalMs: 2600,
    margin: 6,
    blunderRate: 0.2,
    attacksPerTurn: 1,
    bullyLeader: false,
  },
  veteran: {
    tier: 'veteran',
    displayName: 'The Warden',
    decisionIntervalMs: 1600,
    margin: 3,
    blunderRate: 0.05,
    attacksPerTurn: 1,
    bullyLeader: false,
  },
  sovereign: {
    tier: 'sovereign',
    displayName: 'The Namesake',
    decisionIntervalMs: 1000,
    margin: 1,
    blunderRate: 0,
    attacksPerTurn: 2,
    bullyLeader: true,
  },
};

/** Display-name pools so same-tier bots are distinguishable. */
export const BOT_NAMES: Record<BotTier, string[]> = {
  recruit: ['Rook', 'Pip', 'Sarge', 'Dreg'],
  veteran: ['Warden', 'Kael', 'Sable', 'Mira'],
  sovereign: ['Nyx', 'Veyl', 'Morgath', 'Ossa'],
};

export type SendFn = (from: string, to: string) => boolean;

export class BotController {
  readonly id: OwnerId;
  readonly name: string;
  private readonly p: BotPersonality;
  private readonly rng: () => number;
  private nextDecisionMs = 0;

  constructor(id: OwnerId, name: string, tier: BotTier, seed: number) {
    this.id = id;
    this.name = name;
    this.p = BOT_TIERS[tier];
    this.rng = mulberry32(hashSeed(seed, 'bot', id));
  }

  /** Called every frame; acts only when the decision timer is due. */
  update(state: GameState, send: SendFn): void {
    const me = state.commanders.find((c) => c.id === this.id);
    if (!me || !me.alive || state.status !== 'running') return;
    if (state.timeMs < this.nextDecisionMs) return;
    this.nextDecisionMs = state.timeMs + this.p.decisionIntervalMs;

    // Blunder: hurl a random garrison at a random circle, odds be damned.
    if (this.rng() < this.p.blunderRate) {
      const owned = state.territories.filter(
        (t) => t.owner === this.id && t.troops >= 4,
      );
      if (owned.length > 0) {
        const src = owned[Math.floor(this.rng() * owned.length)];
        const others = state.territories.filter((t) => t.id !== src.id);
        const dst = others[Math.floor(this.rng() * others.length)];
        send(src.id, dst.id);
      }
      return;
    }

    for (let a = 0; a < this.p.attacksPerTurn; a++) {
      if (!this.attackOnce(state, send)) break;
    }
  }

  /** One all-in strike from the strongest circle at the best beatable target. */
  private attackOnce(state: GameState, send: SendFn): boolean {
    const owned = state.territories
      .filter((t) => t.owner === this.id && t.troops >= 3)
      .sort((a, b) => b.troops - a.troops);
    if (owned.length === 0) return false;

    const leader = this.p.bullyLeader ? this.troopLeader(state) : null;

    let bestFrom: TerritoryState | null = null;
    let bestTo: TerritoryState | null = null;
    let bestScore = -Infinity;

    for (const src of owned.slice(0, 4)) {
      // only consider the few strongest sources — cheap and decisive
      for (const dst of state.territories) {
        if (dst.owner === this.id || dst.id === src.id) continue;
        const dist = Math.hypot(dst.x - src.x, dst.y - src.y);
        const travelMs = (dist / state.config.dotSpeed) * 1000;
        const regenDuringFlight = Math.ceil(travelMs / state.config.growthIntervalMs);
        const need = dst.troops + regenDuringFlight + this.p.margin;
        if (src.troops <= need) continue; // can't guarantee the kill
        let score =
          (dst.owner === NEUTRAL ? 1000 : 500) - dist * 3 - dst.troops * 2;
        if (leader && dst.owner === leader) score += 400; // hunt the leader
        if (score > bestScore) {
          bestScore = score;
          bestFrom = src;
          bestTo = dst;
        }
      }
      if (bestFrom) break; // strongest source already has a victim — go
    }

    if (bestFrom && bestTo) {
      send(bestFrom.id, bestTo.id);
      return true;
    }
    return false;
  }

  /** Commander (not me, not neutral) holding the most troops right now. */
  private troopLeader(state: GameState): OwnerId | null {
    let best: OwnerId | null = null;
    let bestN = -1;
    for (const c of state.commanders) {
      if (!c.alive || c.id === this.id) continue;
      let n = 0;
      for (const t of state.territories) if (t.owner === c.id) n += t.troops;
      if (n > bestN) {
        bestN = n;
        best = c.id;
      }
    }
    return best;
  }
}
