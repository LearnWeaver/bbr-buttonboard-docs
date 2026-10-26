// The planner's one-piece case: the whole panel as one tray and one lid
// (IMPLEMENTATION.md §64). Plain ES module, no DOM, so node can test it
// (tools/test_generators.mjs).
//
// The pieces come from tools/one_piece_parts.py, which cuts every case script's
// base and lid into parts that butt together on the grid: per case a tray, a
// lid and a rim strip per side; an empty cell; the snap. Here they are turned,
// placed and unioned with manifold-3d, then trimmed to the panel's outline.
//
// The case covers the smallest rectangle round everything placed, not the
// whole board: cells in it with nothing on them (or a blank) become empty
// cells, a floor and a pillar under the lid.

import { cellsAt } from './layout-model.js';

const SIDES = ['N', 'E', 'S', 'W'];
const turnSide = (s, r) => SIDES[(SIDES.indexOf(s) + r) % 4];   // r quarter turns clockwise

// The rectangle of cells the case covers: { x0, y0, cols, rows }, or null.
export function footprint(layout, cat) {
  const cells = layout.items.flatMap((it) => cellsAt(cat.get(it.id), it.x, it.y, it.r).occ);
  if (!cells.length) return null;
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x0, y0, cols: Math.max(...xs) - x0 + 1, rows: Math.max(...ys) - y0 + 1 };
}

// Outside size in mm: the grid less the 0.25 mm clearance every case leaves at each edge.
export function sizeMm(fp, parts) {
  return { w: fp.cols * parts.pitch - 0.5, h: fp.rows * parts.pitch - 0.5 };
}

// Whether a w x h mm part fits a bed, either way round.
export const fitsBed = (w, h, bed) => (w <= bed.x && h <= bed.y) || (h <= bed.x && w <= bed.y);

// The largest square panel, in cells, that fits the bed.
export function largestCells(bed, parts) {
  return Math.floor((Math.min(bed.x, bed.y) + 0.5) / parts.pitch);
}

// Why this layout cannot be made as one piece, as sentences; empty if it can.
export function problems(layout, cat, parts, bed) {
  const out = [];
  const fp = footprint(layout, cat);
  if (!fp) return ['Place some cases first.'];
  const missing = [...new Set(layout.items.map((it) => it.id).filter((id) => !parts.cases[id]))];
  if (missing.length) out.push(`No one-piece version of ${missing.map((id) => cat.get(id).name).join(', ')} yet.`);
  if (layout.items.some((it) => cat.get(it.id).blocks?.length)) out.push('A case with an overhang cannot go in a one-piece case.');
  const { w, h } = sizeMm(fp, parts);
  if (!fitsBed(w, h, bed)) {
    const n = largestCells(bed, parts);
    out.push(`At ${w} × ${h} mm it is too big for a ${bed.x} × ${bed.y} mm bed. The largest that fits is ${n} × ${n} cells; ` +
             'print the cases separately, or as two one-piece cases.');
  }
  for (const it of layout.items) {
    const mod = cat.get(it.id);
    if (!mod.edge) continue;
    const side = turnSide(mod.edge, it.r), c = cellsAt(mod, it.x, it.y, it.r).occ;
    const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
    const onEdge = { N: Math.min(...ys) === fp.y0, S: Math.max(...ys) === fp.y0 + fp.rows - 1,
                     W: Math.min(...xs) === fp.x0, E: Math.max(...xs) === fp.x0 + fp.cols - 1 }[side];
    if (!onEdge) out.push(`Turn or move the ${mod.name} so its ${mod.edgeWhat || 'connector'} end is on the outside of the panel.`);
  }
  return out;
}

// Split parts.bin into the pieces parts.json indexes.
function pieceReader(M, parts, bin) {
  const buf = bin.buffer ? bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) : bin;
  const cache = new Map();
  return (i) => {
    if (i === null || i === undefined) return null;
    if (!cache.has(i)) {
      const { off, nv, nt } = parts.pieces[i];
      const mesh = new M.Mesh({ numProp: 3, vertProperties: new Float32Array(buf, off, 3 * nv),
                                triVerts: new Uint32Array(buf, off + 12 * nv, 3 * nt) });
      mesh.merge();
      const m = new M.Manifold(mesh);
      if (m.status() !== 'NoError') throw new Error(`piece ${i}: ${m.status()}`);
      cache.set(i, m);
    }
    return cache.get(i);
  };
}

const toMesh = (m) => {
  const g = m.getMesh();
  const pos = new Float32Array(g.numVert * 3);
  for (let v = 0; v < g.numVert; v++) for (let k = 0; k < 3; k++) pos[3 * v + k] = g.vertProperties[v * g.numProp + k];
  return { pos, tri: Uint32Array.from(g.triVerts) };
};

// The tray and the lid as meshes ({ pos, tri }, as mesh.js), centred on the
// origin. The lid is turned top-down for printing, as every case's lid STL.
// M is the manifold-3d module, after setup().
export function build(M, layout, cat, parts, bin) {
  const fp = footprint(layout, cat);
  const piece = pieceReader(M, parts, bin);
  const P = parts.pitch, top = parts.top, seam = parts.seam;
  const trays = [], lids = [];
  const at = (m, r, cx, cy) => m.rotate([0, 0, -90 * r]).translate([cx, cy, 0]);
  const centre = (x, y) => [(x - fp.x0) * P - (fp.cols * P) / 2, (fp.rows * P) / 2 - (y - fp.y0) * P];
  const edge = (s, x, y, w, h) => ({ N: y === fp.y0, S: y + h === fp.y0 + fp.rows,
                                     W: x === fp.x0, E: x + w === fp.x0 + fp.cols })[s];
  const covered = new Set(), ownSnaps = new Set();

  for (const it of layout.items) {
    const spec = parts.cases[it.id];
    if (spec.empty) continue;                     // a blank: left for the empty cells below
    const c = cellsAt(cat.get(it.id), it.x, it.y, it.r);
    const bx = Math.min(...c.occ.map((q) => q[0])), by = Math.min(...c.occ.map((q) => q[1]));
    const [cx, cy] = centre(bx + c.w / 2, by + c.h / 2);
    c.occ.forEach(([a, b]) => { covered.add(`${a},${b}`); if (spec.snaps === 'own') ownSnaps.add(`${a},${b}`); });
    trays.push(at(piece(spec.tray), it.r, cx, cy));
    lids.push(at(piece(spec.lid), it.r, cx, cy));
    for (const s of SIDES)
      if (spec.rim[s] !== null && edge(turnSide(s, it.r), bx, by, c.w, c.h)) trays.push(at(piece(spec.rim[s]), it.r, cx, cy));
  }
  const E = parts.empty;
  for (let y = fp.y0; y < fp.y0 + fp.rows; y++) {
    for (let x = fp.x0; x < fp.x0 + fp.cols; x++) {
      const [cx, cy] = centre(x + 0.5, y + 0.5);
      if (!ownSnaps.has(`${x},${y}`)) trays.push(at(piece(parts.snap), 0, cx, cy));
      if (covered.has(`${x},${y}`)) continue;
      trays.push(at(piece(E.tray), 0, cx, cy));
      lids.push(at(piece(E.lid), 0, cx, cy));
      for (const s of SIDES) if (edge(s, x, y, 1, 1)) trays.push(at(piece(E.wall[s]), 0, cx, cy), at(piece(E.rim[s]), 0, cx, cy));
    }
  }

  const { w, h } = sizeMm(fp, parts);
  const rrect = (rw, rh, r, z0, z1) => M.CrossSection.square([rw - 2 * r, rh - 2 * r], true).offset(r, 'Round', 2, 32)
    .extrude(z1 - z0).translate([0, 0, z0]);
  let tray = M.Manifold.union(trays).intersect(rrect(w, h, parts.corner_r, -parts.snap_depth - 1, top + 1));
  // a pry notch in the middle of each end, as the cases have
  const zb = seam - 0.6;
  for (const sgn of [-1, 1]) {
    const xo = sgn * (w / 2 + 0.5), xi = sgn * (w / 2 - parts.rim - parts.pry_d);
    tray = tray.subtract(M.Manifold.cube([Math.abs(xo - xi), parts.pry_w, top + 1 - zb])
      .translate([Math.min(xo, xi), -parts.pry_w / 2, zb]));
  }
  const m = parts.rim + parts.lid_clr;
  const lid = M.Manifold.union(lids).intersect(rrect(w - 2 * m, h - 2 * m, parts.corner_r - m, 0, top + 1));
  const out = { tray: toMesh(tray), lid: toMesh(lid.rotate([180, 0, 0])),
                status: [tray.status(), lid.status()], genus: [tray.genus(), lid.genus()],
                volume: { tray: tray.volume(), lid: lid.volume() }, clash: tray.intersect(lid).volume(),
                size: { w, h, cols: fp.cols, rows: fp.rows } };
  return out;
}
