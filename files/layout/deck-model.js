// The planner's low-profile deck (IMPLEMENTATION.md §84): a thin plate under a
// layout, with half a link key standing on it under every link pocket, so the
// low-profile cases (hardware/lowpro) press onto it. Plain ES module, no DOM,
// so node can test it (tools/test_generators.mjs).
//
// It is hardware/lowpro/lowpro.py's Layout.deck(), drawn here with
// manifold-3d. Which cell edges of each case have a pocket comes from
// lowpro/deck.json (tools/lowpro_deck_parts.py), as [col, row, side] in the
// case's own unturned cells; this file turns them with the case.
//
// The plate covers the whole board (the planner's grid), the rectangle round
// the cases, or only the cells under them (COVERS). Only the first two are on
// the page: under the cases alone, a layout with empty cells comes apart into
// islands. 'cases' is lowpro.py's own deck, kept for the test against it. A
// drop cable tile's cell gets a hole, for a lead coming up from behind.
//
// Cable trays (IMPLEMENTATION.md §86): along any of the outside edges, the
// deck grows half a cell and stands a wall on it, level with the cases, with a
// lip whose underside is 45 degrees so it prints flat with the rest. Leads lie
// on the deck under the lip. The tray is cut away in front of anything a
// case's "opens" lists (the main module's USB). It is lp_rail.py's tray_deck().
//
// A cover (§88): one plate over the cases and the trays, held by pegs that drop
// into holes in the tray tops, open over every key group, lid opening and
// case too tall to go under it (deck.cases[id].cover). buildCover() makes it,
// and buildDeck(..., pegs = true) gives the deck its holes. lp_cover.py.

import { cellsAt } from './layout-model.js';
import { footprint, fitsBed } from './onepiece-model.js';

export const COVERS = ['board', 'rect', 'cases'];
export const TRAY_SIDES = ['N', 'E', 'S', 'W'];

const SIDES = ['N', 'E', 'S', 'W'];
const turnSide = (s, r) => SIDES[(SIDES.indexOf(s) + r) % 4];   // r quarter turns clockwise

// Every pocket in the layout, as { x, y, side }: (x, y) the cell it is in, side
// the edge of that cell it sits on.
export const pockets = (layout, cat, deck) => cellEdges(layout, cat, deck, 'pockets');

// Every opening a tray must not wall in (deck.cases[id].opens), as pockets().
export const openings = (layout, cat, deck) => cellEdges(layout, cat, deck, 'opens');

function cellEdges(layout, cat, deck, key) {
  const out = [];
  for (const it of layout.items) {
    const mod = cat.get(it.id), spec = deck.cases[it.id];
    if (!spec?.[key]) continue;
    // turn the case's own cells as shape() does, then move them to where shape() puts the top-left
    let occ = [], over = (mod.blocks || []).map(([x, y]) => [x, y]);
    for (let y = 0; y < mod.h; y++) for (let x = 0; x < mod.w; x++) occ.push([x, y]);
    let ps = spec[key].map(([x, y, s]) => [x, y, s]);
    for (let k = 0; k < it.r % 4; k++) {
      const turn = ([x, y]) => [-y, x];
      occ = occ.map(turn); over = over.map(turn);
      ps = ps.map(([x, y, s]) => [...turn([x, y]), turnSide(s, 1)]);
    }
    const all = occ.concat(over);
    const mx = Math.min(...all.map((c) => c[0])), my = Math.min(...all.map((c) => c[1]));
    for (const [x, y, s] of ps) out.push({ x: it.x + x - mx, y: it.y + y - my, side: s });
  }
  return out;
}

// The grid-line point a pocket faces, in cells from the board's top-left, y down.
export const linePoint = (p) => ({ N: [p.x + 0.5, p.y], S: [p.x + 0.5, p.y + 1], W: [p.x, p.y + 0.5], E: [p.x + 1, p.y + 0.5] })[p.side];

// Where two cases' pockets face each other across a grid line: one whole key each, on a deck or loose.
export function keySites(layout, cat, deck) {
  const seen = new Set(), sites = [];
  for (const p of pockets(layout, cat, deck)) {
    const k = linePoint(p).join(',');
    if (seen.has(k)) sites.push(linePoint(p));
    seen.add(k);
  }
  return sites;
}

// The rectangle of cells the deck spans, { x0, y0, cols, rows }, or null with nothing placed.
export function extent(layout, cat, cover = 'board') {
  const fp = footprint(layout, cat);
  if (!fp || cover !== 'board') return fp;
  // the board, grown to any case hanging off it, so every stud still has plate under it
  const x0 = Math.min(0, fp.x0), y0 = Math.min(0, fp.y0);
  return { x0, y0, cols: Math.max(layout.cols, fp.x0 + fp.cols) - x0, rows: Math.max(layout.rows, fp.y0 + fp.rows) - y0 };
}

// The cells the plate covers.
export function deckCells(layout, cat, cover = 'board') {
  if (cover !== 'cases') {
    const fp = extent(layout, cat, cover);
    if (!fp) return [];
    const out = [];
    for (let y = fp.y0; y < fp.y0 + fp.rows; y++) for (let x = fp.x0; x < fp.x0 + fp.cols; x++) out.push([x, y]);
    return out;
  }
  const seen = new Map();
  for (const it of layout.items) for (const c of cellsAt(cat.get(it.id), it.x, it.y, it.r).occ) seen.set(c.join(','), c);
  return [...seen.values()];
}

// Outside size in mm: the plate is the whole grid under its cells, with no 0.25 margin, as lowpro.py's,
// and half a cell more on each side with a tray (trays: a string of TRAY_SIDES letters).
export function deckSize(layout, cat, deck, cover = 'board', trays = '') {
  const fp = extent(layout, cat, cover);
  if (!fp) return null;
  const t = (s) => (trays.includes(s) ? deck.tray.w : 0);
  return { w: fp.cols * deck.pitch + t('E') + t('W'), h: fp.rows * deck.pitch + t('N') + t('S'), cols: fp.cols, rows: fp.rows };
}

// Openings that face a tray, and so get a gap cut in it.
export function trayGaps(layout, cat, deck, trays = '') {
  return openings(layout, cat, deck).filter((o) => trays.includes(o.side));
}

// Why this layout cannot have a deck, as sentences; empty if it can.
export function deckProblems(layout, cat, deck, bed, cover = 'board', trays = '') {
  if (!layout.items.length) return ['Place some cases first.'];
  const out = [];
  const missing = [...new Set(layout.items.map((it) => it.id).filter((id) => !deck.cases[id]))];
  if (missing.length) out.push(`No low-profile case for ${missing.map((id) => cat.get(id).name).join(', ')} yet.`);
  if (trays && cover === 'cases') out.push('Cable trays need the deck to cover the board or the rectangle round the cases.');
  const { w, h } = deckSize(layout, cat, deck, cover, trays);
  if (!fitsBed(w, h, bed)) out.push(`At ${w} × ${h} mm it is too big for a ${bed.x} × ${bed.y} mm bed.`);
  return out;
}

// The deck's rectangle in mm about its centre, as buildDeck() lays it out: the cases' edges (hx, hy) and the
// outline grown half a cell on each tray side, and the board-cell -> mm map (y up).
function frameOf(layout, cat, deck, cover, trays) {
  const P = deck.pitch, fp = extent(layout, cat, cover), tw = trays ? deck.tray.w : 0;
  const grow = (s) => (trays.includes(s) ? tw : 0);
  const hx = fp.cols * P / 2, hy = fp.rows * P / 2;
  return { fp, hx, hy, X0: -hx - grow('W'), X1: hx + grow('E'), Y0: -hy - grow('S'), Y1: hy + grow('N'),
           mm: (gx, gy) => [(gx - fp.x0 - fp.cols / 2) * P, (fp.rows / 2 - (gy - fp.y0)) * P] };
}

// Where the cover's pegs go, [x, y] in the deck's mm frame: on each tray side, over the wall's inner face, at the
// first and last cell and every peg_every-th between, none within a USB gap (lp_cover.peg_sites).
export function pegSites(layout, cat, deck, cover = 'board', trays = '') {
  const { fp, hx, hy, mm } = frameOf(layout, cat, deck, cover, trays);
  const a = deck.tray.w - deck.tray.wall, every = deck.cover.peg_every;
  const gaps = trayGaps(layout, cat, deck, trays).map((o) => ({ side: o.side, at: mm(...linePoint(o)) }));
  const out = [];
  for (const s of trays) {
    const n = s === 'N' || s === 'S' ? fp.cols : fp.rows;
    for (let i = 0; i < n; i++) {
      if (!(i === 0 || i === n - 1 || i % every === 0)) continue;
      const p = s === 'N' ? [mm(fp.x0 + i + 0.5, 0)[0], hy + a] : s === 'S' ? [mm(fp.x0 + i + 0.5, 0)[0], -hy - a]
              : s === 'E' ? [hx + a, mm(0, fp.y0 + i + 0.5)[1]] : [-hx - a, mm(0, fp.y0 + i + 0.5)[1]];
      const k = s === 'N' || s === 'S' ? 0 : 1;
      if (gaps.some((g) => g.side === s && Math.abs(g.at[k] - p[k]) < deck.tray.gap_w / 2 + deck.cover.hole_d)) continue;
      out.push(p);
    }
  }
  return out;
}

// Why this layout cannot have a cover, as sentences; empty if it can. On top of deckProblems().
export function coverProblems(layout, cat, deck, cover = 'board', trays = '') {
  const out = [];
  if (cover === 'cases') out.push('A cover needs the deck to cover the board or the rectangle round the cases.');
  if (trays.length < 2) out.push('A cover is held by pegs in the cable trays: tick trays on two sides at least.');
  return out;
}

// The cover's plate seen from above, in the deck's frame (mm, y north, about the deck's centre): `solid`, its
// outline less every opening (CrossSection); its top at z0 + t; and every MX key on the panel, { uid, i, x, y,
// text }, i in the case's KEYS order and text that key's label (layout item .labels), for cover-labels.js.
export function coverPlate(M, layout, cat, deck, cover = 'board', trays = '') {
  const { t, key_cut: kc, key_r: kr, clr, tall_clr: tc } = deck.cover;
  const P = deck.pitch, r = deck.corner_r, z0 = deck.deck_t + deck.tray.h;
  const { X0, X1, Y0, Y1, mm } = frameOf(layout, cat, deck, cover, trays);
  const rr = (w, h, rad) => M.CrossSection.square([w - 2 * rad, h - 2 * rad], true).offset(rad, 'Round', 2, 32);
  const outline = rr(X1 - X0, Y1 - Y0, r).translate([(X0 + X1) / 2, (Y0 + Y1) / 2]);
  // every opening, case-local (y north, about the case centre), turned clockwise with the case and moved to it
  const cuts = [], keys = [];
  for (const it of layout.items) {
    const spec = deck.cases[it.id]?.cover, mod = cat.get(it.id);
    if (!spec) continue;
    const q = it.r % 4, w = q % 2 ? mod.h : mod.w, h = q % 2 ? mod.w : mod.h;
    const [cx, cy] = mm(it.x + w / 2, it.y + h / 2);
    const place = (cs) => cs.rotate(-90 * q).translate([cx, cy]);
    if (spec.outline) cuts.push(place(rr(spec.outline[0] + 2 * tc, spec.outline[1] + 2 * tc, 2.0 + tc)));
    spec.keys.forEach(([x, y], i) => {
      cuts.push(place(rr(kc, kc, kr).translate([x, y])));
      let [kx, ky] = [x, y];
      for (let k = 0; k < q; k++) [kx, ky] = [ky, -kx];             // a clockwise quarter turn, y north
      keys.push({ uid: it.uid, i, x: cx + kx, y: cy + ky, text: spec.lid_labels ? '' : it.labels?.[i] || '' });   // an open case's are on its lid
    });
    for (const poly of spec.holes) cuts.push(place(M.CrossSection.ofPolygons([poly], 'NonZero').offset(clr, 'Round', 2, 32)));
  }
  // less the scraps left where rounded case corners meet; more than one piece left and the cover comes apart
  const pieces = (cuts.length ? outline.subtract(M.CrossSection.union(cuts)) : outline).decompose()
    .filter((c) => c.area() >= deck.cover.chip);
  const solid = M.CrossSection.union(pieces);
  return { outline, solid, pieces: pieces.length, cuts, keys, z0, t, keyCut: kc };
}

// The cover as a mesh, in the deck's frame, turned top-down for printing (its top on z = 0, pegs up), or with
// print = false as it sits on the deck (the 3D view). letters: a Manifold of key labels (cover-labels.js) to
// inlay in its top; what is kept of them comes back as `text`, turned the same way.
export function buildCover(M, layout, cat, deck, cover = 'board', trays = '', print = true, letters = null) {
  const { peg_d: pd, peg_l: pl } = deck.cover;
  const { X0, X1, Y0, Y1 } = frameOf(layout, cat, deck, cover, trays);
  const { solid: flat, pieces, z0, t } = coverPlate(M, layout, cat, deck, cover, trays);
  const plate = flat.extrude(t).translate([0, 0, z0]);
  const pegs = pegSites(layout, cat, deck, cover, trays).map(([x, y]) =>
    M.Manifold.cylinder(pl + 0.01, pd / 2, pd / 2, 48).translate([x, y, z0 - pl]));
  let solid = M.Manifold.union([plate, ...pegs]);
  const text = letters ? letters.intersect(plate) : null;
  if (text) solid = solid.subtract(text);
  const pose = (m) => (print ? m.rotate([180, 0, 0]).translate([0, 0, z0 + t]) : m);
  return { mesh: toMesh(pose(solid)), text: text && !text.isEmpty() ? toMesh(pose(text)) : null, status: solid.status(),
           genus: solid.genus(), volume: solid.volume(), pieces, pegs: pegs.length, size: { w: X1 - X0, h: Y1 - Y0 } };
}

const toMesh = (m) => {
  const g = m.getMesh();
  const pos = new Float32Array(g.numVert * 3);
  for (let v = 0; v < g.numVert; v++) for (let k = 0; k < 3; k++) pos[3 * v + k] = g.vertProperties[v * g.numProp + k];
  return { pos, tri: Uint32Array.from(g.triVerts) };
};

// The deck as a mesh ({ pos, tri }, as mesh.js), centred on the rectangle round
// the cases, plate underside on z = 0 and the studs up from its top. M is the
// manifold-3d module, after setup().
export function buildDeck(M, layout, cat, deck, cover = 'board', trays = '', pegs = false) {
  if (!COVERS.includes(cover)) throw new Error(`unknown cover ${cover}`);
  if (trays && cover === 'cases') throw new Error('trays need a rectangular deck');
  const P = deck.pitch, T = deck.deck_t, r = deck.corner_r, L = deck.link;
  const fp = extent(layout, cat, cover);
  // board cells (y down) -> mm (y up), centred on the deck's rectangle
  const mm = (gx, gy) => [(gx - fp.x0 - fp.cols / 2) * P, (fp.rows / 2 - (gy - fp.y0)) * P];

  // the plate: the cells' squares, every vertical edge rounded (convex and concave, as CadQuery's fillet)
  const squares = deckCells(layout, cat, cover).map(([x, y]) => {
    const [x0, y1] = mm(x, y);
    return M.CrossSection.square([P, P]).translate([x0, y1 - P]);
  });
  // the rectangle, grown half a cell on each tray side, in mm about its centre
  const hx = fp.cols * P / 2, hy = fp.rows * P / 2, tw = trays ? deck.tray.w : 0;
  const grow = (s) => (trays.includes(s) ? tw : 0);
  const X0 = -hx - grow('W'), X1 = hx + grow('E'), Y0 = -hy - grow('S'), Y1 = hy + grow('N');
  if (trays) squares.push(M.CrossSection.square([X1 - X0, Y1 - Y0]).translate([X0, Y0]));
  const outline = M.CrossSection.union(squares).offset(-r, 'Round', 2, 32).offset(r, 'Round', 2, 32)
    .offset(r, 'Round', 2, 32).offset(-r, 'Round', 2, 32);
  let plate = outline.extrude(T);
  const holes = layout.items.filter((it) => deck.cases[it.id]?.hole).map((it) => {
    const [cx, cy] = mm(it.x + 0.5, it.y + 0.5);
    return M.Manifold.cylinder(T + 2, deck.hole_d / 2, deck.hole_d / 2, 64).translate([cx, cy, -1]);
  });
  if (holes.length) plate = plate.subtract(M.Manifold.union(holes));

  // each tray: a wall and a lip, two convex prisms along the side (together not convex: the lip's underside
  // meets the wall in a reflex corner), gapped at any opening facing it
  if (trays) {
    const { wall, h: H, lip_z: lz, gap_w: gw } = deck.tray;
    const yi = tw - wall;
    const profs = [[[yi, 0], [tw, 0], [tw, T + H], [yi, T + H]], [[yi, T + lz], [yi, T + H], [yi - (H - lz), T + H]]];
    // side -> (point at distance a past the cases' edge, s along it, height z), and the along-run range
    const frame = {
      N: [(a, s, z) => [s, hy + a, z], X0, X1], S: [(a, s, z) => [s, -hy - a, z], X0, X1],
      E: [(a, s, z) => [hx + a, s, z], Y0, Y1], W: [(a, s, z) => [-hx - a, s, z], Y0, Y1],
    };
    const gaps = trayGaps(layout, cat, deck, trays);
    const walls = [...trays].map((side) => {
      const [at, s0, s1] = frame[side];
      let w = M.Manifold.union(profs.map((prof) => M.Manifold.hull([s0, s1].flatMap((s) => prof.map(([a, z]) => at(a, s, z))))));
      for (const o of gaps.filter((o) => o.side === side)) {
        const [lx, ly] = linePoint(o), c = mm(lx, ly)[side === 'N' || side === 'S' ? 0 : 1];
        const lo = at(-0.01, c - gw / 2, T), hi = at(tw + 1, c + gw / 2, T + H + 1);
        const min = lo.map((v, k) => Math.min(v, hi[k])), max = lo.map((v, k) => Math.max(v, hi[k]));
        w = w.subtract(M.Manifold.cube([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).translate(min));
      }
      return w;
    });
    plate = M.Manifold.union([plate, M.Manifold.union(walls).intersect(outline.extrude(T + H + 2).translate([0, 0, -1]))]);
  }

  // half a key, in the edge frame: the grid line is y = 0, its case at y < 0 (lowpro.half_key)
  const n = L.neck / 2, h = L.head / 2, g = deck.gap / 2;
  const half = M.CrossSection.ofPolygons([[[-h, -g - L.d], [h, -g - L.d], [n, -g], [n, 0.01], [-n, 0.01], [-n, -g]]])
    .extrude(L.h + 0.01).translate([0, 0, T - 0.01]);
  const deg = { N: 0, W: 90, S: 180, E: -90 };
  const studs = pockets(layout, cat, deck).map((p) => half.rotate([0, 0, deg[p.side]]).translate([...mm(...linePoint(p)), 0]));
  let solid = M.Manifold.union([plate, ...studs]);
  if (pegs && trays) {                 // a hole under each of the cover's pegs, from the tray top down
    const { hole_d: hd, hole_depth: dd } = deck.cover, top = T + deck.tray.h;
    const hs = pegSites(layout, cat, deck, cover, trays).map(([x, y]) =>
      M.Manifold.cylinder(dd + 1, hd / 2, hd / 2, 48).translate([x, y, top - dd]));
    if (hs.length) solid = solid.subtract(M.Manifold.union(hs));
  }
  return { mesh: toMesh(solid), status: solid.status(), genus: solid.genus(), volume: solid.volume(),
           pockets: studs.length, keys: keySites(layout, cat, deck).length, size: deckSize(layout, cat, deck, cover, trays),
           gaps: trays ? trayGaps(layout, cat, deck, trays).length : 0 };
}
