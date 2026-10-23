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

class Builder {
  constructor() { this.p = []; this.t = []; this.index = new Map(); }
  v(x, y, z) {
    // weld by position, so neighbouring cells share their edge vertices
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let i = this.index.get(key);
    if (i === undefined) { i = this.p.length / 3; this.p.push(x, y, z); this.index.set(key, i); }
    return i;
  }
  tri(a, b, c) { if (a !== b && b !== c && a !== c) this.t.push(a, b, c); }
  mesh() { return { pos: Float32Array.from(this.p), tri: Uint32Array.from(this.t) }; }
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

// Binary STL in, mesh out (welded, so the stretch below moves shared vertices once).
export function parseStl(buf) {
  const dv = new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength);
  const n = dv.getUint32(80, true);
  if (84 + 50 * n !== dv.byteLength) throw new Error('not a binary STL');
  const b = new Builder();
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i + 12;
    const v = [0, 1, 2].map((j) => b.v(dv.getFloat32(o + 12 * j, true), dv.getFloat32(o + 12 * j + 4, true),
                                       dv.getFloat32(o + 12 * j + 8, true)));
    b.tri(v[0], v[1], v[2]);
  }
  return b.mesh();
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

export function toStl(mesh, name = 'back-plate') {
  const n = mesh.tri.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  const head = `${name}, generated from hardware/back-plate/back_plate.py`.slice(0, 80);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  const P = mesh.pos;
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [mesh.tri[3 * t], mesh.tri[3 * t + 1], mesh.tri[3 * t + 2]].map((i) => 3 * i);
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const o = 84 + 50 * t;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (const [j, i] of [a, b, c].entries())
      for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + 12 * j + 4 * k, P[i + k], true);
  }
  return new Uint8Array(buf);
}

// Signed volume (positive for an outward-facing closed mesh), and the count of
// edges not shared by exactly one opposite-facing pair: 0 for a watertight one.
export function meshStats(mesh) {
  const P = mesh.pos, T = mesh.tri;
  let vol = 0;
  const edges = new Map();
  for (let t = 0; t < T.length; t += 3) {
    const [a, b, c] = [T[t], T[t + 1], T[t + 2]];
    const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
    const bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
    const cx = P[3 * c], cy = P[3 * c + 1], cz = P[3 * c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const k = `${u},${w}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let open = 0;
  for (const [k, n] of edges) {
    const [u, w] = k.split(',');
    if (n !== 1 || edges.get(`${w},${u}`) !== 1) open++;
  }
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < P.length; i += 3) { zmin = Math.min(zmin, P[i]); zmax = Math.max(zmax, P[i]); }
  return { volume: vol, triangles: T.length / 3, openEdges: open, zmin, zmax };
}
