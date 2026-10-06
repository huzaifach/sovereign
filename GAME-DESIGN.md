# SOVEREIGN — Game Design Document

**Version:** 1.1 (Stack v2) — 30 September 2026
**Genre:** Minimalist real-time conquest strategy
**Platforms:** Web — responsive mobile + desktop (touch + mouse)
**Tech:** Phaser 3.90 + TypeScript + Vite (WebGL) · Kenney CC0 assets + Google Fonts (OFL) · Supabase (Postgres + Auth) backend · Vercel hosting (all free tiers)
**Status:** Stack v2 foundation built (Boot/Menu/Game/GameOver scenes, Pangaea, 1 bot tier, Edicts). Playable polish next.
**Changelog:** v1.1 — vanilla Canvas stack replaced with Phaser 3 (§18); new signature mechanic: Edicts (§17). All mechanics, numbers, and economy from v1.0 unchanged.

---

## 1. High Concept

SOVEREIGN is a minimalist real-time strategy game about carving a single empire out of a hand-designed world. You begin with one capital territory. You fling its growing armies at neighbors to capture them, snowball your production, and eliminate every rival commander before they eliminate you. A full Blitz match takes 3–5 minutes; an Epic, 15–30. Every run feeds a persistent account: XP levels, a ranked Elo ladder with seasons, daily challenges on a single shared seed, achievements, and unlockable cosmetics.

One sentence: **Risk's territorial hunger + Snake's one-more-run itch + a Duolingo-grade daily habit loop, drawn in five pixels of color.**

---

## 2. Design Pillars

1. **One-finger readable.** The entire game state must be legible in a one-second glance: who owns what, where the biggest armies are. No unit icons, no minimap, no clutter — territory color = owner, number = army size, pulsing ring = under attack.
2. **Thirty seconds to learn, a thousand hours to master.** The only verb is *send troops* (tap source, drag to destination). Depth comes from *timing and tempo*: when to expand vs. consolidate, when to backstab, how to read a bot's posture.
3. **Every tap feeds forever.** Nothing you do is throwaway: every match pays XP, moves your seasonal rating, fills achievement counters, and — once per day — contributes to a global daily leaderboard. Retention is a design output, not a marketing afterthought.
4. **Fair by construction.** Same seed, same world, same bots, same physics for everyone — the daily challenge is a laboratory-grade fair contest. No pay-to-win, ever; monetization is cosmetic-only.
5. **Hand-crafted, not generated.** Maps are designed, not rolled. Every territory placement is a deliberate decision about chokepoints, expansion pressure, and tempo. Procedural generation is a tool of last resort, used only where fairness *requires* determinism (the daily seed).

---

## 3. How SOVEREIGN Differs from States.io

States.io is the reference point, not the blueprint. Deliberate divergences:

| Axis | States.io | SOVEREIGN |
|---|---|---|
| World | US states map | Original fantasy continents, 4 hand-designed map templates |
| Opponents | Human multiplayer | 3 tiers of deterministic bot AI (fair, replayable, always available) |
| Identity | Session-only | Persistent accounts: levels, ranked seasons, achievements, cosmetics |
| Retention | Match-to-match | Daily shared-seed challenge, Elo ladder, battle pass (Phase 2) |
| Economy | None | Coin faucet/sinks designed for a cosmetic shop + season pass (Phase 2) |
| Fairness | Host-dependent | Seeded deterministic simulation — every player faces the *identical* challenge |
| Art | Flat colored states | Minimalist premium: glow, trails, animated captures, dark obsidian theme |

The core verb (fling troops between adjacent territories) is genre vocabulary, like "jump" in a platformer — it cannot be owned. Everything around it (world, opponents, persistence, economy, fairness) is original.

---

## 4. Core Loop

```
START (1 capital, 12 troops)
  → SURVEY: glance at map, identify weak neighbors & chokepoints        (2s)
  → EXPAND: drag troops to adjacent neutral/enemy territory to capture  (core verb)
  → CONSOLIDATE: leave garrisons on border territories; pull troops home
  → SNOWBALL: each captured territory ticks +troops/sec; bigger empire = faster growth
  → OPPORTUNISM: hit a bot while it's overextended; defend when a ring pulses red
  → ELIMINATE: capture every territory of a rival → their lands go neutral, free for the taking
  → WIN: last commander standing → score screen → XP/rank/daily rewards
```

**Micro-loop (every 5–15 seconds):** pick a source territory → drag to a target → watch the number drain and the target's number fall → capture flash → reallocate.

**Macro-loop (every match):** draft plan → early expansion race → mid-game border wars → endgame elimination race against the strongest bot.

**Meta-loop (every day):** daily challenge attempt → ranked Blitz/Epic games → level/achievement progress → season rank climb.

### 4.1 The Core Verb: Sending Troops

- **Desktop:** click-drag from an owned territory to any adjacent territory; release to send. Right-click (or Shift-drag) sends *half* the garrison instead of all-but-one.
- **Mobile:** touch-drag, same gesture; a two-finger tap on a territory sends half.
- **Rules:** You may only send from territories you own, to *adjacent* territories (adjacency defined by the map graph, with a visible faint link line on hover/selection). Each send moves `floor(army × sendFraction)` troops, minimum 1; the source always retains at least 1 (a territory can never be emptied — this prevents accidental self-destruction and is a deliberate simplification vs. the genre).
- **Travel time:** proportional to on-screen distance (troops visibly stream as animated dots/trails — juicy and readable). Attack resolves on arrival: `attackerTroops − defenderTroops`; if positive, territory flips to attacker with the remainder; if not, defender keeps it with the difference. Defender gets a small **home advantage** (+10% effective defense, rounded down) so turtling is viable but not dominant.
- **Growth:** every owned territory generates troops on a tick: `base 1 troop / 4s`, scaled by a per-territory **prosperity** value (0.6×–1.6×, hand-set per map, shown as a subtle dot density). Capitals generate 2×. This makes territory *quality* matter, not just quantity — the strategic heart of Epic mode.

### 4.2 Win / Lose Conditions

- **Win:** eliminate all rival commanders (capture their last territory). In matches with no rivals left standing but neutrals remaining, mopping up neutrals is optional — victory triggers on last elimination.
- **Lose:** lose your last territory. You may then spectate the bots' endgame (great for learning) or exit to the score screen.
- **Draw/timeout:** none — bots always press the attack eventually (see §6 opportunism), so every match terminates.

---

## 5. World Theme & Map Templates

**Theme:** original fantasy — the shattered world of **Aethermoor**. Territory names are evocative but abstract (Emberhold, Vessalyne, Duskmere…), grouped into named regions per template. Visual language: dark obsidian background, territories as soft organic polygons with glowing borders in the owner's color, capital marked with a crown glyph (drawn, not an asset).

**Doctrine: zero random proc-gen by default.** All four templates below are *hand-designed*: every node position, adjacency, and prosperity value is chosen. The ONLY procedural content in the game is the daily challenge, which uses a *seeded, deterministic variant* (see §10) — same seed for everyone, so it is fair by construction.

Each template is described as a **territory graph**: nodes (territories) with positions on a normalized 100×62.5 canvas (16:10), edges (adjacency), and roles.

### Template A — PANGAEA ("The First Continent")
- **Size:** 12 territories (Blitz default).
- **Structure:** one contiguous landmass, roughly oval. 1 central high-prosperity territory (the "Heartlands", 1.6×) ringed by 5 mid territories (1.0×), ringed by 6 outer low territories (0.7×).
- **Graph properties:** diameter 4 hops; center node degree 5; outer ring degree 3 (two ring neighbors + one inner). No chokepoints — pure expansion race.
- **Player/bot placement:** 4 commanders start at the 4 diagonal outer territories, maximally separated. Neutrals elsewhere (army 4–8, scaled by prosperity).
- **Strategic character:** fastest tempo; rewards greedy early expansion and Heartlands control. The "learn the verb" map.

### Template B — TWIN CONTINENTS ("Veyl & Morvain")
- **Size:** 24 territories (Blitz large / Epic small).
- **Structure:** two 12-node continents, each Pangaea-like at small scale, joined by exactly **2 bridge territories** (1.2× prosperity, degree 4 — two links per side). Bridges are the only cross edges.
- **Graph properties:** each continent diameter 3; inter-continent distance 5 hops via bridges.
- **Placement:** 6 commanders, 3 per continent, corners.
- **Strategic character:** chokepoint warfare; bridges are king. Rewards timing a bridge rush while rivals fight internally. First map where defense matters.

### Template C — ARCHIPELAGO ("The Drowned Reaches")
- **Size:** 36 territories (Epic).
- **Structure:** 7 islands (4–6 nodes each, dense internal adjacency, degree 3–4) connected in a ring by single **strait** edges between designated port territories (1.3× prosperity, degree 5: island links + 2 strait links).
- **Graph properties:** intra-island diameter 2; ring distance up to 4 straits between far islands.
- **Placement:** 8 commanders, one per island except the central richest island which starts neutral-but-heavily-defended (army 25 — a mid-game prize).
- **Strategic character:** secure-your-island-then-project-power. Naval-tempo without water mechanics; straits are natural timers (travel time is longer across strait edges — 1.5×).

### Template D — SHATTERED ISLES ("The Breaking")
- **Size:** 48 territories (Epic large).
- **Structure:** 12 micro-isles of 3–5 nodes in a loose 3×4 grid; adjacency is sparse — each isle connects to 2–3 neighbors via single strait edges. 4 "shard" territories (1.6× prosperity) sit at grid intersections, each the prize of its local cluster.
- **Graph properties:** low average degree (2.6); longest shortest-path 9 hops.
- **Placement:** 8 commanders at the 4 corners + 4 edge-centers; far apart.
- **Strategic character:** slow-burn Epic; expansion is safe but *projection* is expensive. Rewards long-horizon planning and multi-front coordination. The thousand-hour map.

**Map rotation:** Blitz cycles A → B → A(variant start corners) → B …; Epic cycles C → D. Daily challenge uses a seeded variant of the current week's template (see §10).

---

## 6. Bot AI — Three Difficulty Tiers

Bots are the entire opponent architecture (locked decision: bots + global leaderboards, no realtime PvP). They must feel like *personalities*, not difficulty sliders. All bots share the same engine hooks and the same deterministic RNG (mulberry32 seeded per match; daily challenge seed is public and shared), so behavior is reproducible.

### 6.1 Shared Decision Cycle

Every bot ticks every **600ms** ( Recruit 900ms — slower "thinking" is itself a handicap):

1. **Assess:** list my territories, border territories (adjacent to non-owned), threat level per border (incoming enemy streams + adjacent enemy armies).
2. **Defend (highest priority):** if a border territory's effective defense < incoming threat × 1.2, pull troops from the nearest safe interior territory.
3. **Expand:** pick the weakest adjacent neutral/enemy territory where my local superiority > threshold; send.
4. **Consolidate:** every N ticks, rebalance — move surplus from interior to the weakest border.
5. **Opportunism check:** if any rival's total army < 60% of mine and they're fighting someone else, redirect 40% of my offensive budget at their borders.
6. **Idle:** if nothing to do, stack troops on the capital (telegraphs "I'm saving up" — readable).

### 6.2 Tier Personalities

**RECRUIT (★☆☆) — "The Eager Lieutenant"**
- Expansion threshold low (attacks at 1.1× superiority — often unfavorable), defense reaction slow (1200ms tick), **blunders**: 15% chance per decision to send from the wrong territory or split an attack across two targets; never consolidates; ignores opportunism (never backstabs). Loses to any player who learns the half-send. *Purpose: onboarding wins, confidence.*

**VETERAN (★★☆) — "The Warden"**
- Attacks at 1.5× superiority, defends at 1.2× threat ratio, consolidates every 8s, opportunism active but only against the *weakest* rival, 3% blunder rate (occasional overextension). Holds bridges/straits with garrisons. *Purpose: the real game. Beats careless play, loses to tempo control.*

**SOVEREIGN (★★★) — "The Namesake"**
- Attacks at 1.35× (better target selection compensates), defends at 1.05×, consolidates every 5s, **multi-front opportunism** (hits the two weakest rivals), feints: 10% of attacks are deliberately under-strength probes to bait your defense, then the real wave follows 3s later. 0% blunders. Slightly faster troop streams (psychological pressure). *Purpose: aspirational wall; beating Sovereign on Shattered Isles is the game's skill ceiling.*

### 6.3 Deterministic Seeded RNG

- RNG: mulberry32(seed). Match seed = `hash(mapTemplateId ‖ startPositions ‖ matchCounter)` for normal play; daily challenge seed = `hash("daily" ‖ YYYY-MM-DD)` — identical for every player on Earth that day.
- Blunder rolls, tie-breaks, and neutral army jitter all draw from this stream. **Same seed ⇒ same bot behavior**, which is what makes the daily leaderboard a fair contest and enables replay verification for anti-cheat (§12).

---

## 7. Game Modes

### BLITZ (default)
- Maps: Pangaea (12) or Twin Continents (24). 4 commanders (you + 3 bots) or 6 on Twin.
- Duration: 3–5 minutes. Troop tick 3s, stream speed fast.
- Scoring: `score = territoriesHeld×100 + eliminations×500 + (timeBonus: max(0, 300 − seconds)×2)`.
- Purpose: retention engine — the mode you play on the bus.

### EPIC
- Maps: Archipelago (36) or Shattered Isles (48). 8 commanders.
- Duration: 15–30 minutes. Troop tick 4s, strait edges 1.5× travel time.
- Scoring: `score = territoriesHeld×100 + eliminations×750 + prosperityControlled×50 + (timeBonus: max(0, 1800 − seconds))`.
- Purpose: depth showcase — the mode you play on Sunday morning.

Mode selection happens pre-match; ranked ladder tracks Blitz and Epic ratings separately (§9).

---

## 8. Progression: XP, Levels, Cosmetics, Achievements, Stats

### 8.1 XP & Player Levels
- XP per match: `100 + score/10 + (win ? 150 : 0) + (dailyChallenge ? 100 : 0)`.
- Level curve: `xpForLevel(n) = 500 × n^1.6` (L1→2 = 500, L10 ≈ 20k). 50 levels, then prestige stars.
- Levels unlock cosmetic slots, never power. Level-gating is purely "time served" prestige.

### 8.2 Cosmetics (unlockable colors / skins / trails) — future monetization hook
- **Slots:** Commander Color (territory/border glow), Trail Style (troop stream rendering: Comet / Ribbon / Ember / Neon), Capital Sigil (crown / star / rune / skull, drawn vector glyphs), Victory Banner (score-screen frame).
- **Acquisition:** level unlocks (free track), achievement rewards, daily-challenge placement rewards, and — Phase 2 — coin shop + battle pass.
- **Rule: cosmetic-only, forever.** No stat changes. This is a load-bearing design promise for fair leaderboards.

### 8.3 Achievements (~20 at launch)
*First Blood* (first elimination) · *Cartographer* (win on all 4 templates) · *Blitzkrieg* (win a Blitz in <150s) · *Turtle* (win without losing a territory) · *Giant Slayer* (eliminate a Sovereign-tier bot) · *Untouchable* (win Epic with >40 territories) · *Opportunist* (eliminate a commander with <10 troops spent in the final blow) · *Week Warrior* (7-day daily streak) · *Top 100* (daily leaderboard) · *Gold Rush* (hold all 1.6× territories on a map simultaneously) · *Comeback* (win after dropping below 3 territories) · *Pacifist's Nightmare* (1000 total eliminations) · *Marathon* (play 100 Epics) · *Perfectionist* (win daily challenge) · *Diplomat's Bane* (eliminate 3 commanders in one match) · *Speed Demon* (capture 5 territories in 20s) · *Fortress* (hold a bridge/strait 60s under attack) · *Scholar* (reach level 25) · *Sovereign Slayer* (win Shattered Isles vs 7 Sovereign bots) · *Founder* (play during season 0).

### 8.4 Stats Tracked (profile page)
Per mode: matches, wins, win rate, best score, fastest win, avg territories, eliminations, current/longest win streak, daily streak, best daily rank, total playtime. Global: level, XP, season rating + tier, achievement count, cosmetics owned.

---

## 9. Ranked Ladder with Seasons

- **Rating:** Elo-like, start 1000, K=32 (Blitz) / K=24 (Epic). Opponent rating = mean bot tier rating (Recruit 800 / Veteran 1100 / Sovereign 1400, tuned). Win = upset-aware gains; beating Sovereigns pays ~+40, losing to Recruits costs ~−25.
- **Tiers:** Bronze (<900) · Silver (900–1099) · Gold (1100–1299) · Platinum (1300–1499) · Diamond (1500–1699) · **Sovereign (1700+)**.
- **Seasons:** 8-week seasons. Soft reset: `newRating = 1000 + (oldRating − 1000) × 0.5`. End-of-season rewards: tier-based cosmetics + coins (Phase 2). Season 0 = launch calibration (4 weeks).
- **Leaderboards:** per mode + per season, top 1000, public read. Anti-smurf: ranked unlocks at account level 3 (~5 matches).

---

## 10. Daily Challenge

- **One shared seed per day** (`hash("daily"‖YYYY-MM-DD)`), one attempt per account per day, fixed template (rotates weekly: A→B→C→D), fixed bot tier mix (e.g., 2 Veteran + 1 Sovereign on Blitz weeks).
- **Rules:** identical start positions, identical bot RNG stream, identical physics for every player on Earth. Your score is `score − (yourTimeMs / 1000)` tiebreak by faster time.
- **Leaderboard:** global, per-day, frozen at UTC midnight; top 10 get a profile badge + cosmetic shard.
- **Streaks:** consecutive days attempted → streak counter (Week Warrior achievement). Miss a day → streak resets (the Duolingo mechanic, deliberately).
- **Why it retains:** appointment gaming + fair contest + watercooler ("today's seed is brutal").

---

## 11. Accounts

**Dual signup (locked):** the player chooses at registration —
- **(a) Username + password only** — no email. Fastest onboarding.
- **(b) Email + password** — enables password recovery.

**Constraints:** username globally unique (case-insensitive), 3–16 chars, `[a-zA-Z0-9_]`. Display name = username everywhere (leaderboards, profiles).

**Implementation note (Supabase Auth):** Supabase requires an email per auth user. Username-only accounts map to hidden internal emails: `<slug>@users.sovereign.game` (never exposed, never routable, password set by user). Email accounts use their real email. A `profiles` row (keyed by `auth.users.id`) stores the canonical username + optional real email. Login screen offers both tabs; username login resolves → internal email → `signInWithPassword`. This keeps one auth code path for both account types.

---

## 12. Anti-Cheat (Leaderboards)

Threat model: score submission is client-initiated, so clients are untrusted.

1. **Server-side validation (Supabase Edge Function `submit-score`):** recomputes score plausibility — max achievable score for (template, mode, seed) is bounded; reject outliers > theoretical max. Checks match duration vs. submitted time, territory counts vs. template size.
2. **Replay hash:** client submits `hash(seed ‖ actionLog ‖ finalState)`. The action log (every send: tick, from, to, fraction) is tiny (<2 KB/match). Edge function spot-verifies by re-simulating (deterministic engine ⇒ same result). Top-100 daily scores are auto-verified; failures → score quarantined + account flagged.
3. **Rate limits:** one score per match id (UUID generated at match start, stored server-side on first heartbeat); one daily attempt enforced by `UNIQUE(profile_id, day)`.
4. **RLS:** leaderboards public read; inserts only via the edge function (service role), never direct client inserts.

Phase 1 ships 1 + 3 + 4; replay verification (2) ships with the daily leaderboard hardening sprint.

---

## 13. Retention Systems Wiring

The systems are not a list — they are a loop:

```
Daily Challenge ──► streak ──► achievement (Week Warrior) ──► cosmetic shard ──┐
      │                                                                          │
      ▼                                                                          ▼
 XP (every match) ──► levels ──► cosmetic unlocks ──► profile flex ──► play more
      │                                                                          ▲
      ▼                                                                          │
 Ranked games ──► Elo ──► season tier ──► end-of-season rewards ──────────────────┘
```

- **Daily → Ranked:** daily warm-up lowers ranked anxiety ("I'm already warmed up").
- **Ranked → Cosmetics:** tier rewards are exclusive cosmetics — status you can *wear*.
- **Cosmetics → Daily:** daily top-10 shards complete exclusive sets — collectors return daily.
- **Achievements → Everything:** achievements pay XP + coins (Phase 2), pointing players at modes they'd otherwise skip (Epic achievements pull Blitz players up).

**Session design target:** 1 daily attempt (4 min) + 2–3 ranked Blitz (12 min) = a ~15-minute daily habit. Epic is the weekend anchor.

---

## 14. Controls & Rendering

### Controls
| | Desktop | Mobile |
|---|---|---|
| Send all-but-one | Click-drag source → target | Touch-drag source → target |
| Send half | Shift-drag or right-click-drag | Two-finger tap source, then drag |
| Cancel drag | Esc / drag back to source | Drag back to source |
| Camera | Wheel zoom, drag empty space to pan (Epic maps) | Pinch zoom, two-finger pan |
| Select info | Hover territory | Tap territory (no drag) |

Targeting aid: while dragging, valid targets glow, the preview arrow shows troop count that *would* arrive, and invalid targets dim. On release, a quick "stream" animation confirms.

### Rendering
> **Superseded by Stack v2 (§18).** The notes below describe the original
> vanilla-Canvas plan and are kept for history; the shipped renderer is
> Phaser 3 WebGL (scenes, particles, tweens, cameras) with Kenney CC0 assets.

- One `<canvas>`, devicePixelRatio-aware, requestAnimationFrame loop, dirty-rectangle-ish culling (only draw visible territories on Epic maps).
- Territories: precomputed organic polygon per node (seeded jitter around a centroid — computed once at map build, NOT per frame), filled with owner color at 85% + darker stroke; capital gets drawn sigil; selected territory gets animated dashed ring; under-attack territories pulse red.
- Troop streams: pooled particle dots along quadratic curves, colored by owner, with trail style per player's cosmetic.
- UI: DOM overlay (not canvas) for HUD/menus — accessible, cheap, responsive. Canvas is purely the battlefield.
- Performance budget: 60fps on a 3-year-old phone; <500 draw calls; no per-frame allocations in the hot loop (object pools).

---

## 15. Economy (Future Monetization — Phase 2)

Designed now, built later. **Faucets:** match completion coins (Blitz 10 / Epic 25, win ×2), daily challenge (25 + rank bonus), achievements (50–200), season rewards. **Sinks:** cosmetic shop (colors 300, trails 500, sigils 800, banners 1200), season battle pass (1000 coins or $4.99, free + premium tracks), name-change token (500), profile frames. **Rules:** coins never buy power, never buy rating; earnable-only cosmetics always exist alongside paid ones; daily/achievement income guarantees a free player unlocks something meaningful weekly. Shop UI ships as a grayed "Coming Soon" tab in Phase 1 to build anticipation without promising dates.

---

## 16. Open Decisions & Phase Plan

**Phase 0 (this doc + scaffold):** design locked, repo scaffolded, schema written.
**Phase 1:** engine (map graphs, simulation, renderer, input), Recruit/Veteran bots, Blitz on Pangaea, local accounts stub, XP/levels.
**Phase 2:** Epic maps, Sovereign bot, daily challenge + leaderboards, ranked seasons, Supabase wiring, cosmetics system, achievements.
**Phase 3:** hardening (replay verification, edge functions), shop + battle pass, polish, launch Season 0.

Decisions deliberately deferred: exact Elo K-factors (tune in playtest), prestige system details, guild/clan features (post-launch candidate), sound design palette (code-generated WebAudio, zero assets — consistent with the doctrine).

---

## 17. Edicts — Timed God-Powers (signature mechanic, new in v1.1)

Edicts are the States.io differentiator: three timed god-powers per match,
bound to keys **1 / 2 / 3** and to gold buttons in the HUD. They add a second
strategic layer (tempo of *powers*, not just troops) without complicating the
one-tap core verb.

### The three edicts
| Edict | Effect | Duration | Cooldown |
|---|---|---|---|
| **Golden Age** | 2× troop growth on all your lands | 20s | 75s |
| **Plague** | Halve the army of a rival territory | instant (1.5s telegraph) | 90s |
| **Iron Wall** | +50% defense on all your lands | 30s | 75s |

### Rules
- **One active edict at a time** per commander. Cooldowns tick during the effect.
- **Plague is telegraphed 1.5s before it lands** (pulsing green ring on the
  target) — both the player and bots see it coming and can reinforce or
  evacuate. Fairness is load-bearing for leaderboards, so the telegraph is
  a design rule, not decoration.
- Plague targets rival (non-neutral) territories only; minimum 2 troops.
- Edicts never affect neutrals and never grant score directly — they are
  tempo tools, not win buttons.
- **Bots play by the same rules:** Recruit never touches edicts (the
  Lieutenant never learned statecraft); Veteran+ invoke Golden Age (early
  snowball or while ahead) and Iron Wall (when a border is threatened);
  Sovereign-tier bots also cast Plague on the strongest rival border.
  Bot casts are announced ("Warden invokes IRON WALL!") so the player can react.

### Presentation
- Golden Age: gold aura ring on all your lands + banner countdown.
- Iron Wall: steel-blue reinforced borders.
- Plague: green telegraph ring on the victim, then a sickly burst.

## 18. Tech Stack v2 — Phaser 3 (new in v1.1)

The vanilla TS+Canvas scaffold was replaced: Phaser 3.90 + TypeScript + Vite,
WebGL rendering with automatic Canvas fallback.

**Architecture rule: game logic stays framework-free.** `src/game/` holds pure
TypeScript — engine (deterministic fixed-step sim), bots, map data, edicts,
shapes, theme — with zero Phaser imports. It compiles to Node and runs
headless: the smoke test simulates full matches and asserts growth, attack
resolution, determinism, and edict behavior. Phaser owns only
`src/scenes/`: Boot (asset + font preload), Menu (title + difficulty select),
Game (battlefield rendering, drag input, HUD, edict buttons, particles),
GameOver (score breakdown + restart).

**Assets (all copyright-free, logged in ASSETS-LICENSES.md):**
- Kenney Particle Pack (CC0): ember/starfield particles, capture bursts, glows.
- Kenney UI Pack (CC0): sovereign-gold buttons for menus and edict bar.
- Google Fonts Cinzel + Spectral (SIL OFL): display + body typography.
Everything is vendored under `public/assets/` — never hotlinked.

**Art direction:** dark obsidian void + sovereign gold arcane theme. Territories
are organic polygons (deterministic per node id) with glowing owner-color
borders; capitals bear a gold diamond; captures erupt in particle bursts;
troop streams fly as additive glow dots; under-attack lands pulse red.

---

*End of SOVEREIGN Game Design Document v1.1*
