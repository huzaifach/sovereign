// Territory shapes — deterministic organic polygons.
// Positions come from the hand-authored map templates (map.ts); the organic
// outline is derived deterministically from the node id, so it is identical
// on every client and every run. Pure TS: no Phaser dependency.

import { hashSeed, mulberry32 } from './engine';
import type { TerritoryNode } from './map';

export interface Vec {
  x: number;
  y: number;
}

/**
 * Organic blob polygon around a map node, in world coordinates.
 * Radius scales gently with prosperity (rich land reads larger).
 */
export function territoryPolygon(node: TerritoryNode): Vec[] {
  const rng = mulberry32(hashSeed('poly', node.id));
  const radius = 4.4 + node.prosperity * 0.9;
  const n = 10;
  const rot = rng() * Math.PI * 2;
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const r = radius * (0.8 + rng() * 0.38);
    pts.push({
      x: node.x + Math.cos(a) * r,
      y: node.y + Math.sin(a) * r * 0.84,
    });
  }
  return pts;
}

/** Centroid of a polygon (screen-space label anchor). */
export function centroid(pts: Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** Point-in-polygon (ray cast) — used for pointer hit-testing. */
export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}
