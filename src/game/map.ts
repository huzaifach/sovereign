// Map template definitions — Phase 1.
// Hand-designed territory graphs per GAME-DESIGN.md §5.
// Pangaea is fully authored below; the other three templates are stubs for Phase 2.
// Doctrine: zero random proc-gen — every position, adjacency, and prosperity value
// on Pangaea is a deliberate authored decision.

export interface TerritoryNode {
  id: string;
  name: string;
  x: number; // normalized 0..100
  y: number; // normalized 0..62.5 (16:10 canvas)
  prosperity: number; // troop tick multiplier, 0.6..1.6
  neighbors: string[]; // adjacency by id (must be symmetric)
  isBridge?: boolean; // Phase 2 (Twin Continents)
  isStrait?: boolean; // Phase 2 (Archipelago / Shattered Isles)
}

export interface MapTemplate {
  id: 'pangaea' | 'twin-continents' | 'archipelago' | 'shattered-isles';
  displayName: string;
  mode: 'blitz' | 'epic';
  /** True while the template is a placeholder awaiting hand-authoring. */
  stub?: boolean;
  nodes: TerritoryNode[];
}

// ---------------------------------------------------------------------------
// Template A — PANGAEA ("The First Continent")
// 12 territories, Blitz default. One contiguous oval landmass:
//   1 center  (Heartlands, 1.6x prosperity) — degree 5
//   5 inner ring (1.0x) — degree 5
//   6 outer ring (0.7x) — degree 3 (two ring neighbors + one inner)
// Graph diameter: 4 hops. No chokepoints — pure expansion race.
// 4 commanders start on the 4 diagonal outer territories, maximally separated.
// ---------------------------------------------------------------------------

const PANGAEA_NODES: TerritoryNode[] = [
  // The Heartlands — the prize at the center.
  {
    id: 'heartlands',
    name: 'Heartlands',
    x: 50,
    y: 31.25,
    prosperity: 1.6,
    neighbors: ['emberhold', 'vessalyne', 'duskmere', 'karthos', 'lyssara'],
  },
  // Inner ring (clockwise from the top).
  {
    id: 'emberhold',
    name: 'Emberhold',
    x: 50,
    y: 18.25,
    prosperity: 1.0,
    neighbors: ['heartlands', 'vessalyne', 'lyssara', 'frostgate', 'saltspire'],
  },
  {
    id: 'vessalyne',
    name: 'Vessalyne',
    x: 62.4,
    y: 27.2,
    prosperity: 1.0,
    neighbors: ['heartlands', 'emberhold', 'duskmere', 'cinderfall'],
  },
  {
    id: 'duskmere',
    name: 'Duskmere',
    x: 57.6,
    y: 41.3,
    prosperity: 1.0,
    neighbors: ['heartlands', 'vessalyne', 'karthos', 'thornwatch'],
  },
  {
    id: 'karthos',
    name: 'Karthos',
    x: 42.4,
    y: 41.3,
    prosperity: 1.0,
    neighbors: ['heartlands', 'duskmere', 'lyssara', 'mistral'],
  },
  {
    id: 'lyssara',
    name: 'Lyssara',
    x: 37.6,
    y: 27.2,
    prosperity: 1.0,
    neighbors: ['heartlands', 'karthos', 'emberhold', 'gravehollow'],
  },
  // Outer ring (clockwise from the top).
  {
    id: 'frostgate',
    name: 'Frostgate',
    x: 50,
    y: 6.25,
    prosperity: 0.7,
    neighbors: ['emberhold', 'cinderfall', 'saltspire'],
  },
  {
    id: 'cinderfall',
    name: 'Cinderfall',
    x: 71.65,
    y: 18.75,
    prosperity: 0.7,
    neighbors: ['frostgate', 'thornwatch', 'vessalyne'],
  },
  {
    id: 'thornwatch',
    name: 'Thornwatch',
    x: 71.65,
    y: 43.75,
    prosperity: 0.7,
    neighbors: ['cinderfall', 'mistral', 'duskmere'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    x: 50,
    y: 56.25,
    prosperity: 0.7,
    neighbors: ['thornwatch', 'gravehollow', 'karthos'],
  },
  {
    id: 'gravehollow',
    name: 'Gravehollow',
    x: 28.35,
    y: 43.75,
    prosperity: 0.7,
    neighbors: ['mistral', 'saltspire', 'lyssara'],
  },
  {
    id: 'saltspire',
    name: 'Saltspire',
    x: 28.35,
    y: 18.75,
    prosperity: 0.7,
    neighbors: ['gravehollow', 'frostgate', 'emberhold'],
  },
];

/** Commander start territories on Pangaea: the 4 diagonal outers, maximally separated. */
export const PANGAEA_START_IDS = [
  'cinderfall',
  'thornwatch',
  'gravehollow',
  'saltspire',
] as const;

export const MAP_TEMPLATES: Record<MapTemplate['id'], MapTemplate> = {
  pangaea: {
    id: 'pangaea',
    displayName: 'Pangaea — The First Continent',
    mode: 'blitz',
    nodes: PANGAEA_NODES,
  },
  // Stubs — hand-authored in Phase 2 per GAME-DESIGN.md §5. Kept in the module
  // graph now so mode/template selection code compiles against all four.
  'twin-continents': {
    id: 'twin-continents',
    displayName: 'Twin Continents — Veyl & Morvain',
    mode: 'blitz',
    stub: true,
    nodes: [],
  },
  archipelago: {
    id: 'archipelago',
    displayName: 'Archipelago — The Drowned Reaches',
    mode: 'epic',
    stub: true,
    nodes: [],
  },
  'shattered-isles': {
    id: 'shattered-isles',
    displayName: 'Shattered Isles — The Breaking',
    mode: 'epic',
    stub: true,
    nodes: [],
  },
};

/** Debug helper: verifies every adjacency edge is symmetric. */
export function validateTemplate(t: MapTemplate): string[] {
  const errors: string[] = [];
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  for (const n of t.nodes) {
    for (const nb of n.neighbors) {
      const other = byId.get(nb);
      if (!other) errors.push(`${n.id} -> missing node ${nb}`);
      else if (!other.neighbors.includes(n.id))
        errors.push(`${n.id} -> ${nb} not symmetric`);
    }
  }
  return errors;
}
