# SOVEREIGN

An original fantasy real-time conquest strategy game — States.io-inspired, but an
original design. Conquer hand-crafted fantasy continents against deterministic bot
AI, and turn the tide with **Edicts** — timed god-powers (Golden Age, Plague,
Iron Wall) that no States-like has. Every match feeds a persistent account: XP
levels, a ranked Elo ladder with seasons, a daily shared-seed challenge,
achievements, and unlockable cosmetics.

Full design: [`GAME-DESIGN.md`](./GAME-DESIGN.md)

## Stack

- **Frontend:** Phaser 3 + TypeScript + Vite (WebGL, particles, glow effects)
- **Assets:** strictly CC0 / public-domain (Kenney.nl particle + UI packs) and
  SIL OFL fonts (Cinzel, Spectral) — every asset logged in [`ASSETS-LICENSES.md`](./ASSETS-LICENSES.md)
- **Backend:** Supabase (Postgres + Auth + Row Level Security) — free tier
- **Hosting:** Vercel — free tier (GitHub pipeline)
- **Package manager:** pnpm with a shared global content-addressable store

## Run locally

```bash
# one-time: point pnpm at the shared store (storage doctrine: single copy on disk)
pnpm config set store-dir ~/workspace/.pnpm-store

pnpm install
pnpm dev        # → http://localhost:5173
```

Other commands: `pnpm typecheck` (`tsc --noEmit`), `pnpm build`.

## Project layout

```
sovereign/
├── GAME-DESIGN.md          # the full design document (start here)
├── ASSETS-LICENSES.md      # per-asset license log (CC0 / OFL)
├── index.html
├── package.json / tsconfig.json / vite.config.ts / vercel.json
├── public/assets/          # CC0 sprites + OFL fonts (served as-is)
├── src/
│   ├── main.ts             # Phaser game boot
│   ├── game/
│   │   ├── map.ts          # hand-designed map templates (Pangaea, +3 planned)
│   │   ├── engine.ts       # deterministic simulation core (framework-free)
│   │   ├── bots.ts         # 3-tier bot AI personalities
│   │   ├── edicts.ts       # Edicts mechanic (god-powers)
│   │   ├── shapes.ts       # organic territory polygon generation
│   │   └── theme.ts        # obsidian + sovereign-gold art direction
│   ├── scenes/             # Boot, Menu, Game, GameOver Phaser scenes
│   ├── ui/styles.css
│   └── net/supabase.ts     # Supabase client + dual-auth helpers (Phase 2)
└── supabase/
    └── schema.sql          # Postgres schema + RLS policies
```

## Database

`supabase/schema.sql` is the full schema: `profiles`, `scores`, `daily_runs`,
`cosmetics`, `season_ratings`, `achievements`, with RLS policies (public read on
leaderboards, users write only their own rows; score inserts go through a
service-role edge function). Apply it in the Supabase SQL editor or:

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
```

## Deploy notes

1. Push to GitHub → import repo in Vercel → `vercel.json` already sets the
   Vite build (`pnpm build` → `dist/`) → deploy.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars in Vercel
   when backend wiring lands (Phase 2).
3. Create the Supabase project, run `schema.sql`, add the `submit-score` edge
   function (Phase 2/3).
4. Everything runs on free tiers; no always-on server needed (bots, not realtime PvP).

## Roadmap

- **Phase 0** ✅ design doc + schema + Phaser v2 scaffold (this repo state)
- **Phase 1:** Pangaea, Recruit/Veteran bots, Blitz mode, Edicts, local stub accounts, XP/levels
- **Phase 2:** Epic mode, remaining 3 maps, Sovereign bot, daily challenge + leaderboards, ranked seasons, Supabase wiring, cosmetics, achievements
- **Phase 3:** anti-cheat hardening, shop + battle pass, Season 0 launch
