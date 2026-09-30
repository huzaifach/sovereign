// Circle-territory maps — State.io-style.
// Territories are plain circles scattered on the field (no adjacency graph:
// in State.io you can send troops to ANY territory; distance = travel time).
// Layouts are generated from the match seed: deterministic for a given seed,
// fresh every match. Rejection sampling guarantees no overlaps.

import { mulberry32 } from './engine';

export interface CircleTerritory {
  id: string;
  x: number; // normalized 0..100
  y: number; // normalized 0..62.5 (16:10 field)
  r: number; // normalized radius
}

export const FIELD_W = 100;
export const FIELD_H = 62.5;

const MIN_R = 3.4;
const MAX_R = 5.2;
const EDGE_GAP = 1.2; // minimum clear space between two circles
const MARGIN = 6; // keep circles away from the field border

/**
 * Generate `count` non-overlapping circles from `seed`.
 * Deterministic: the same seed always yields the same layout.
 * The edge gap relaxes automatically on stubborn seeds so generation
 * never fails at runtime.
 */
export function generateMap(seed: number, count = 22): CircleTerritory[] {
  for (const gap of [EDGE_GAP, 0.8, 0.4, 0]) {
    const circles = tryPlace(seed, count, gap);
    if (circles) return circles;
  }
  throw new Error(`generateMap: could not place ${count} circles (seed ${seed})`);
}

function tryPlace(
  seed: number,
  count: number,
  gap: number,
): CircleTerritory[] | null {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const circles: CircleTerritory[] = [];
  let attempts = 0;
  let i = 0;
  while (i < count && attempts < 6000) {
    attempts++;
    const r = MIN_R + rng() * (MAX_R - MIN_R);
    const x = MARGIN + r + rng() * (FIELD_W - 2 * (MARGIN + r));
    const y = MARGIN + r + rng() * (FIELD_H - 2 * (MARGIN + r));
    let ok = true;
    for (const c of circles) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < c.r + r + gap) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    circles.push({ id: `t${i}`, x, y, r });
    i++;
  }
  return circles.length === count ? circles : null;
}

/**
 * Pick `n` start circles maximally separated from each other
 * (greedy farthest-point sampling), so commanders begin far apart.
 */
export function pickStarts(circles: CircleTerritory[], n: number, seed: number): string[] {
  const rng = mulberry32(seed ^ 0x51ed2703);
  const picked: CircleTerritory[] = [];
  const first = circles[Math.floor(rng() * circles.length)];
  picked.push(first);
  while (picked.length < n) {
    let best: CircleTerritory | null = null;
    let bestScore = -1;
    for (const c of circles) {
      if (picked.includes(c)) continue;
      let minD = Infinity;
      for (const p of picked) minD = Math.min(minD, Math.hypot(c.x - p.x, c.y - p.y));
      // Slight jitter so the same seed doesn't always pick identical spreads.
      const score = minD + rng() * 4;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked.map((c) => c.id);
}
