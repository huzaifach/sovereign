// Bot AI — Phase 1.
// Three tiers per GAME-DESIGN.md §6: Recruit / Veteran / Sovereign.
// Shared decision cycle (600ms; Recruit 900ms); deterministic via seeded RNG.
// Bots act through the same issueSend path as the player, so every bot action
// lands in the engine's actionLog and replays deterministically.

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
  attackSuperiority: number; // min local ratio to attack
  defendThreatRatio: number;
  consolidateEveryMs: number;
  blunderRate: number; // 0..1 per decision
  opportunism: boolean;
  multiFront: boolean;
  feints: boolean;
}

export const BOT_TIERS: Record<BotTier, BotPersonality> = {
  recruit: {
    tier: 'recruit',
    displayName: 'The Eager Lieutenant',
    decisionIntervalMs: 900,
    attackSuperiority: 1.1,
    defendThreatRatio: 1.4,
    consolidateEveryMs: Number.POSITIVE_INFINITY,
    blunderRate: 0.15,
    opportunism: false,
    multiFront: false,
    feints: false,
  },
  veteran: {
    tier: 'veteran',
    displayName: 'The Warden',
    decisionIntervalMs: 600,
    attackSuperiority: 1.5,
    defendThreatRatio: 1.2,
    consolidateEveryMs: 8000,
    blunderRate: 0.03,
    opportunism: true,
    multiFront: false,
    feints: false,
  },
  sovereign: {
    tier: 'sovereign',
    displayName: 'The Namesake',
    decisionIntervalMs: 600,
    attackSuperiority: 1.35,
    defendThreatRatio: 1.05,
    consolidateEveryMs: 5000,
    blunderRate: 0,
    opportunism: true,
    multiFront: true,
    feints: true,
  },
};

/** Display-name pools so same-tier bots are distinguishable. */
export const BOT_NAMES: Record<BotTier, string[]> = {
  recruit: ['Rook', 'Pip', 'Sarge'],
  veteran: ['Warden', 'Kael', 'Sable'],
  sovereign: ['Nyx', 'Veyl', 'Morgath'],
};

export type SendFn = (
  from: string,
  to: string,
  fraction: 1 | 0.5,
) => boolean;

interface Feint {
  dueMs: number;
  from: string;
  to: string;
}

export class BotController {
  readonly id: OwnerId;
  readonly name: string;
  private readonly p: BotPersonality;
  private readonly rng: () => number;
  private nextDecisionMs = 0;
  private lastConsolidateMs = 0;
  private feints: Feint[] = [];
  private prey: Set<OwnerId> = new Set();

  constructor(id: OwnerId, name: string, tier: BotTier, seed: number) {
    this.id = id;
    this.name = name;
    this.p = BOT_TIERS[tier];
    // Independent RNG stream per bot: same seed => same behavior, and bot
    // count/order changes never disturb another bot's stream.
    this.rng = mulberry32(hashSeed(seed, 'bot', id));
  }

  /** Called every frame; acts only when the bot's decision timer is due. */
  update(state: GameState, send: SendFn): void {
    const me = state.commanders.find((c) => c.id === this.id);
    if (!me || !me.alive) return;

    // Feint follow-ups fire on their own schedule, outside the decision cycle.
    if (this.feints.length > 0) {
      const remaining: Feint[] = [];
      for (const f of this.feints) {
        if (state.timeMs >= f.dueMs) {
          const src = state.terrById[f.from];
          if (src && src.owner === this.id && src.troops >= 3) {
            send(f.from, f.to, 1); // the real wave, 3s after the probe
          }
        } else {
          remaining.push(f);
        }
      }
      this.feints = remaining;
    }

    if (state.timeMs < this.nextDecisionMs) return;
    this.nextDecisionMs = state.timeMs + this.p.decisionIntervalMs;
    this.decide(state, send);
  }

  private decide(state: GameState, send: SendFn): void {
    const owned = state.territories.filter((t) => t.owner === this.id);
    if (owned.length === 0) return;
    const byId = state.terrById;
    const homeAdv = state.config.homeAdvantage;
    const effDef = (t: TerritoryState) =>
      Math.floor(t.troops * (1 + homeAdv));
    const isBorder = (t: TerritoryState) =>
      state.adj[t.id].some((n) => byId[n].owner !== this.id);
    const borders = owned.filter(isBorder);

    // --- 1. DEFEND (highest priority) ------------------------------------
    // If a border's effective defense < incoming threat × ratio, reinforce it
    // from the strongest adjacent safe-interior territory.
    let acted = false;
    const threats = borders
      .map((t) => {
        let threat = 0;
        for (const n of state.adj[t.id]) {
          const nt = byId[n];
          if (nt.owner !== this.id && nt.owner !== NEUTRAL) threat += nt.troops;
        }
        for (const s of state.streams) {
          if (s.to === t.id && s.owner !== this.id) threat += s.troops;
        }
        return { t, threat };
      })
      .filter((x) => x.threat > 0)
      .sort((a, b) => b.threat - a.threat);
    for (const { t, threat } of threats) {
      if (effDef(t) >= threat * this.p.defendThreatRatio) continue;
      let best: TerritoryState | null = null;
      for (const n of state.adj[t.id]) {
        const nt = byId[n];
        if (nt.owner !== this.id || isBorder(nt) || nt.troops <= 6) continue;
        if (!best || nt.troops > best.troops) best = nt;
      }
      if (best && send(best.id, t.id, 1)) acted = true;
    }

    // --- Blunder roll (Recruit 15%, Veteran 3%, Sovereign 0%) ---------------
    // A blundered decision sends a random half-garrison at a random neighbor
    // instead of the "correct" move — the Eager Lieutenant's signature.
    if (this.rng() < this.p.blunderRate) {
      const candidates = owned.filter((t) => t.troops >= 4);
      if (candidates.length > 0) {
        const src = candidates[Math.floor(this.rng() * candidates.length)];
        const nbs = state.adj[src.id];
        const dst = nbs[Math.floor(this.rng() * nbs.length)];
        send(src.id, dst, 0.5);
      }
      return;
    }

    // --- 2. OPPORTUNISM ----------------------------------------------------
    // If a rival holds < 60% of my total army and is fighting someone else,
    // mark them as prey: attacks on their borders get a lowered threshold.
    this.prey = new Set();
    if (this.p.opportunism) {
      const myTotal = owned.reduce((s, t) => s + t.troops, 0);
      const rivals = state.commanders
        .filter((c) => c.alive && c.id !== this.id)
        .map((c) => ({
          id: c.id,
          total: state.territories.reduce(
            (s, t) => s + (t.owner === c.id ? t.troops : 0),
            0,
          ),
        }))
        .filter((r) => r.total > 0 && r.total < 0.6 * myTotal)
        .filter((r) => this.isFightingSomeoneElse(state, r.id))
        .sort((a, b) => a.total - b.total);
      const targets = this.p.multiFront ? rivals.slice(0, 2) : rivals.slice(0, 1);
      for (const r of targets) this.prey.add(r.id);
    }
    const discount = (targetOwner: OwnerId) =>
      this.prey.has(targetOwner) ? 0.75 : 1;

    // --- 3. EXPAND ---------------------------------------------------------
    // Best local-superiority attack among all owned territories.
    let bestFrom = '';
    let bestTo = '';
    let bestRatio = 0;
    for (const t of owned) {
      if (t.troops < 3) continue;
      const sendable = t.troops - 1;
      for (const nid of state.adj[t.id]) {
        const n = byId[nid];
        if (n.owner === this.id) continue;
        const effTarget = Math.floor(n.troops * (1 + homeAdv));
        const ratio = sendable / Math.max(1, effTarget);
        const bar = this.p.attackSuperiority * discount(n.owner);
        if (ratio > bar && ratio > bestRatio) {
          bestRatio = ratio;
          bestFrom = t.id;
          bestTo = nid;
        }
      }
    }
    if (bestFrom) {
      if (this.p.feints && this.rng() < 0.1) {
        // Sovereign feint: under-strength probe now, real wave in 3s.
        if (send(bestFrom, bestTo, 0.5)) {
          this.feints.push({ dueMs: state.timeMs + 3000, from: bestFrom, to: bestTo });
          acted = true;
        }
      } else if (send(bestFrom, bestTo, 1)) {
        acted = true;
      }
    }

    // --- 4. CONSOLIDATE ----------------------------------------------------
    // Every N ms, shift surplus from the strongest interior territory to the
    // weakest border (Recruit never consolidates: interval = +Infinity).
    if (
      state.timeMs - this.lastConsolidateMs >= this.p.consolidateEveryMs &&
      borders.length > 0
    ) {
      this.lastConsolidateMs = state.timeMs;
      let weakest = borders[0];
      for (const b of borders) if (b.troops < weakest.troops) weakest = b;
      let donor: TerritoryState | null = null;
      for (const t of owned) {
        if (isBorder(t) || t.troops <= 8) continue;
        if (!state.adj[t.id].includes(weakest.id)) continue;
        if (!donor || t.troops > donor.troops) donor = t;
      }
      if (donor && send(donor.id, weakest.id, 1)) acted = true;
    }

    // --- 5. IDLE: stack on the capital -------------------------------------
    // Telegraphs "I'm saving up" — readable, and builds the late-game hammer.
    if (!acted) {
      const capital = owned.find((t) => t.isCapital);
      if (capital) {
        for (const t of owned) {
          if (
            t.id !== capital.id &&
            !isBorder(t) &&
            t.troops > 8 &&
            state.adj[t.id].includes(capital.id)
          ) {
            if (send(t.id, capital.id, 1)) break;
          }
        }
      }
    }
  }

  private isFightingSomeoneElse(state: GameState, rivalId: OwnerId): boolean {
    for (const t of state.territories) {
      if (t.owner !== rivalId) continue;
      for (const n of state.adj[t.id]) {
        const o = state.terrById[n].owner;
        if (o !== rivalId && o !== this.id && o !== NEUTRAL) return true;
      }
    }
    for (const s of state.streams) {
      if (
        s.owner !== this.id &&
        s.owner !== NEUTRAL &&
        state.terrById[s.to]?.owner === rivalId
      ) {
        return true;
      }
    }
    return false;
  }
}
