// Art direction constants — SOVEREIGN v2: obsidian + sovereign gold arcane theme.
// Pure data (no Phaser): the scenes consume these for every fill, stroke, tint.

/** Phaser-ready hex numbers. */
export const THEME = {
  bg: 0x07070d,
  bgPanel: 0x0e0e1a,
  gold: 0xd8b45a,
  goldBright: 0xf5d67b,
  goldDim: 0x8a6d2f,
  text: '#ece5cf',
  muted: '#8f8a76',
  danger: 0xff4d5e,
  plague: 0x86efac,
  wall: 0x7dd3fc,
} as const;

/** CSS strings for DOM-adjacent use (menus, overlays). */
export const THEME_CSS = {
  bg: '#07070d',
  gold: '#d8b45a',
  goldBright: '#f5d67b',
  text: '#ece5cf',
  muted: '#8f8a76',
} as const;

/**
 * Commander colors, index-aligned with CommanderState.colorIdx.
 * 0 = the player (sovereign gold). Bots: crimson, arcane violet, steel teal.
 * Neutral: cold slate.
 */
export const OWNER_COLORS = [
  0xd8b45a, // player — sovereign gold
  0xb03a4b, // bot — war crimson
  0x7a5fd0, // bot — arcane violet
  0x3fa7a0, // bot — deep teal
  0x8f6b3d, // spare — bronze
  0x4a6fa5, // spare — steel blue
  0x9a4a8f, // spare — dusk magenta
  0x5a8f3d, // spare — moss
] as const;

export const NEUTRAL_COLOR = 0x2b2f3d;

export function ownerColor(colorIdx: number): number {
  return OWNER_COLORS[colorIdx % OWNER_COLORS.length];
}

/** Darkened fill variant of an owner color (territory interiors). */
export function ownerFill(colorIdx: number): number {
  const c = ownerColor(colorIdx);
  const r = Math.floor(((c >> 16) & 0xff) * 0.28);
  const g = Math.floor(((c >> 8) & 0xff) * 0.28);
  const b = Math.floor((c & 0xff) * 0.32);
  return (r << 16) | (g << 8) | b;
}
