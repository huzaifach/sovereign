# ASSETS-LICENSES.md — SOVEREIGN third-party asset log

Every non-code asset vendored under `public/assets/` is recorded here.
**Policy: CC0 / public domain only, or SIL OFL for fonts.** No CC-BY, no NC,
no unclear licenses. If a license can't be confirmed, the asset is not used.

## Kenney — Particle Pack 1.1 (CC0 1.0)
- **Source page:** https://kenney.nl/assets/particle-pack (License: Creative Commons CC0 — confirmed on page 2026-09-30)
- **Author:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero 1.0 — http://creativecommons.org/publicdomain/zero/1.0/ (also stated in the pack's `License.txt`)
- **Date fetched:** 2026-09-30
- **Files vendored** (`public/assets/particles/`):
  - `circle_01.png` — soft glow dot (ember/starfield particles, troop streams)
  - `circle_03.png` — soft glow dot variant (background embers)
  - `magic_01.png` — arcane burst (capture explosions, edict effects)
  - `magic_03.png` — arcane burst variant
  - `flare_01.png` — lens glow (capital markers, selection glow)
  - `light_02.png` — soft light wash (menu ambience)

## Kenney — UI Pack 2.0 (CC0 1.0)
- **Source page:** https://kenney.nl/assets/ui-pack (License: Creative Commons CC0 — confirmed on page 2026-09-30)
- **Author:** Kenney (Kenney.nl)
- **License:** Creative Commons Zero 1.0 — http://creativecommons.org/publicdomain/zero/1.0/ (also stated in the pack's `License.txt`)
- **Date fetched:** 2026-09-30
- **Files vendored** (`public/assets/ui/`):
  - `button_rectangle_depth_gradient.png` — gold menu buttons (difficulty select, game-over)
  - `button_rectangle_depth_flat.png` — gold flat button (secondary actions)
  - `button_square_depth_gradient.png` — gold square button (edict buttons)
  - `button_square_depth_flat.png` — gold square flat (edict button alt)
  - `icon_play_light.png` — play glyph accent

## Google Fonts — Cinzel (OFL 1.1)
- **Source:** https://fonts.google.com/specimen/Cinzel (license confirmed via google/fonts METADATA.pb: `license: "OFL"`)
- **Author:** Natanael Gama
- **License:** SIL Open Font License 1.1
- **Date fetched:** 2026-09-30
- **Files vendored** (`public/assets/fonts/`):
  - `cinzel-700-900.woff2` — display face for titles, HUD numerals, buttons (weights 700 + 900)

## Google Fonts — Spectral (OFL 1.1)
- **Source:** https://fonts.google.com/specimen/Spectral (license confirmed via google/fonts METADATA.pb: `license: "OFL"`)
- **Author:** Production Type
- **License:** SIL Open Font License 1.1
- **Date fetched:** 2026-09-30
- **Files vendored** (`public/assets/fonts/`):
  - `spectral-400.woff2` — body/UI text
  - `spectral-600.woff2` — emphasized UI text
  - `spectral-700.woff2` — troop counts, labels

## Code libraries (not assets, listed for completeness)
- **Phaser 3.90.0** — MIT License — https://phaser.io (via pnpm)
- **@supabase/supabase-js 2.44.0** — MIT License (auth/backend client, wired in Phase 2)
