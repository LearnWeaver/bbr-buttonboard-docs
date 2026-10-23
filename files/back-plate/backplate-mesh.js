// Back-plate geometry for the docs site's generator. Plain ES module: no DOM,
// no libraries, so node can test it (tools/test_backplate.mjs).
//
// The source of truth is hardware/back-plate/back_plate.py. It writes
// backplate-params.json and back-plate-support.stl beside this file; this
// module only rebuilds the plate from those numbers, for any size, and
// stretches the support for a larger gap.
//
// A mesh is { pos: Float32Array of xyz per vertex, tri: Uint32Array of three
// vertex indices per triangle, counter-clockwise seen from outside }.

import { Builder, parseStl, toStl, meshStats } from '../generators/mesh.js';
export { parseStl, toStl, meshStats };

const SEG = 96;          // segments round each hole: a multiple of 8, so every cell's square corners are vertices
const ARC_SEG = 6;       // segments round each of the plate's outer corners

// The cell's outline, as one closed ring of 2D points round the cell centre:
// one point per hole segment, on the same ray as that segment's hole point,
// plus extra points round any rounded outer corner. The outline is convex
// about the centre, so sorting every point by angle gives the ring. A shared
// edge between two cells is sampled at the same heights from both sides (the
// ray angles are symmetric), so the plate welds into one watertight solid.
function cellRing(h, arcs) {
  // arcs: [{ sx, sy, r }], the outer corners in quadrants (sx, sy) that are rounded
  const ring = [];
  const inArc = (x, y) => arcs.find((a) => Math.sign(x) === a.sx && Math.sign(y) === a.sy &&
                                           Math.abs(x) > h - a.r + 1e-9 && Math.abs(y) > h - a.r + 1e-9);
  for (let k = 0; k < SEG; k++) {
    const ang = (2 * Math.PI * k) / SEG;
    const c = Math.cos(ang), s = Math.sin(ang);
    const t = h / Math.max(Math.abs(c), Math.abs(s));        // the ray meets the square here
    let x = c * t, y = s * t;
    const a = inArc(x, y);
    if (a) {
      // inside a rounded corner: meet the arc instead, solving |p - o| = r along the ray
      const ox = a.sx * (h - a.r), oy = a.sy * (h - a.r);
      const b = c * ox + s * oy, q = ox * ox + oy * oy - a.r * a.r;
      const tt = b + Math.sqrt(b * b - q);
      x = c * tt; y = s * tt;
    }
    ring.push({ x, y, k, ang });
  }
  for (const a of arcs) {
    const ox = a.sx * (h - a.r), oy = a.sy * (h - a.r);
    const base = Math.atan2(a.sy, a.sx) - Math.PI / 4;      // the arc runs from the x-edge to the y-edge
    for (let m = 1; m < ARC_SEG; m++) {
      const t = base + (Math.PI / 2) * (m / ARC_SEG);
      const x = ox + a.r * Math.cos(t), y = oy + a.r * Math.sin(t);
      let ang = Math.atan2(y, x); if (ang < 0) ang += 2 * Math.PI;
      if (ring.some((p) => Math.abs(p.ang - ang) < 1e-6)) continue;   // already a ray point
      ring.push({ x, y, k: -1, ang });
    }
  }
  return ring.sort((p, q) => p.ang - q.ang);
}

// The plate: cols x rows cells on the pitch, plate_t thick, a hole_d hole on
// every cell centre, plate_r on the four outer corners. z = 0 is its
// underside; a support's ledge meets it there.
export function plateMesh(P, cols, rows, holeD = P.hole_d) {
  const h = P.pitch / 2, r = holeD / 2, T = P.plate_t;
  if (!(r > 0 && r < h - 1)) throw new Error('hole does not fit the cell');
  const b = new Builder();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const cx = (i - (cols - 1) / 2) * P.pitch, cy = (j - (rows - 1) / 2) * P.pitch;
      const sx = i === 0 ? -1 : i === cols - 1 ? 1 : 0;
      const sy = j === 0 ? -1 : j === rows - 1 ? 1 : 0;
      // the plate's outer corners that fall in this cell (all four, on a 1 x 1 plate)
      const arcs = [];
      for (const ax of (cols === 1 ? [-1, 1] : sx ? [sx] : []))
        for (const ay of (rows === 1 ? [-1, 1] : sy ? [sy] : [])) arcs.push({ sx: ax, sy: ay, r: P.plate_r });
      const ring = cellRing(h, arcs);
      emitCell(b, ring, cx, cy, r, T, h, sx, sy, cols, rows);
    }
  }
  return b.mesh();
}

function emitCell(b, ring, cx, cy, r, T, h, sx, sy, cols, rows) {
  const hole = (k, z) => {
    const a = (2 * Math.PI * k) / SEG;
    return b.v(cx + r * Math.cos(a), cy + r * Math.sin(a), z);
  };
  const out = (p, z) => b.v(cx + p.x, cy + p.y, z);
  const n = ring.length;
  for (let m = 0; m < n; m++) {
    const p = ring[m];
    if (p.k < 0) continue;
    // the ring points from this ray to the next ray, inclusive
    const chain = [p];
    let q = (m + 1) % n;
    while (ring[q].k < 0) { chain.push(ring[q]); q = (q + 1) % n; }
    chain.push(ring[q]);
    const k0 = p.k, k1 = ring[q].k;
    for (const [z, up] of [[T, true], [0, false]]) {
      const c0 = hole(k0, z), c1 = hole(k1, z);
      // fan from the hole point on this ray over the outline chain, then close to the next hole point
      for (let s = 0; s + 1 < chain.length; s++) {
        const a = out(chain[s], z), bb = out(chain[s + 1], z);
        up ? b.tri(c0, a, bb) : b.tri(c0, bb, a);
      }
      const last = out(chain[chain.length - 1], z);
      up ? b.tri(c0, last, c1) : b.tri(c0, c1, last);
    }
    // hole wall, facing the hole's axis
    const t0 = hole(k0, T), t1 = hole(k1, T), u0 = hole(k0, 0), u1 = hole(k1, 0);
    b.tri(t0, t1, u1); b.tri(t0, u1, u0);
    // outer wall, where this stretch of outline is the plate's edge
    for (let s = 0; s + 1 < chain.length; s++) {
      const A = chain[s], B = chain[s + 1];
      if (!onPlateEdge(A, B, h, sx, sy, cols, rows)) continue;
      const a1 = out(A, T), b1 = out(B, T), a0 = out(A, 0), b0 = out(B, 0);
      b.tri(a1, a0, b0); b.tri(a1, b0, b1);
    }
  }
}

function onPlateEdge(A, B, h, sx, sy, cols, rows) {
  // a segment is on the plate's edge if it is not on an edge shared with a neighbouring cell
  const e = 1e-6;
  const onX = (v) => Math.abs(A.x - v) < e && Math.abs(B.x - v) < e;
  const onY = (v) => Math.abs(A.y - v) < e && Math.abs(B.y - v) < e;
  const westIn = !(cols === 1 || sx === -1), eastIn = !(cols === 1 || sx === 1);
  const southIn = !(rows === 1 || sy === -1), northIn = !(rows === 1 || sy === 1);
  if (onX(-h)) return !westIn;
  if (onX(h)) return !eastIn;
  if (onY(-h)) return !southIn;
  if (onY(h)) return !northIn;
  return true;          // on a corner arc: always the plate's edge
}

// The support for a larger gap: every vertex above stretch_z moves up by the
// extra. Exact because the post is straight there (back_plate.py write_docs).
export function stretchSupport(P, mesh, gap) {
  if (!(gap >= P.gap && gap <= P.gap_max)) throw new Error(`gap must be ${P.gap}-${P.gap_max} mm`);
  const pos = Float32Array.from(mesh.pos), d = gap - P.gap;
  for (let i = 2; i < pos.length; i += 3) if (pos[i] > P.stretch_z) pos[i] += d;
  return { pos, tri: mesh.tri };
}

// Peak strain in a clip prong as the barb passes the plate hole, in percent:
// a cantilever from slit_z0, bent in by the barb (as back_plate.py prints it).
export function prongStrain(P, gap) {
  const L = gap + P.plate_t - P.slit_z0;
  return (300 * P.prong_t * P.barb) / (2 * L * L);
}
