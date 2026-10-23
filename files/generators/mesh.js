// Mesh plumbing shared by the docs site's part generators (back plate,
// openGrid board). Plain ES module: no DOM, no libraries, so node can test it
// (tools/test_generators.mjs).
//
// A mesh is { pos: Float32Array of xyz per vertex, tri: Uint32Array of three
// vertex indices per triangle, counter-clockwise seen from outside }.

export class Builder {
  constructor() { this.p = []; this.t = []; this.index = new Map(); }
  v(x, y, z) {
    // weld by position, so neighbouring pieces share their edge vertices
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let i = this.index.get(key);
    if (i === undefined) { i = this.p.length / 3; this.p.push(x, y, z); this.index.set(key, i); }
    return i;
  }
  tri(a, b, c) { if (a !== b && b !== c && a !== c) this.t.push(a, b, c); }
  mesh() { return { pos: Float32Array.from(this.p), tri: Uint32Array.from(this.t) }; }
}

// Binary STL in, mesh out (welded).
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

export function toStl(mesh, name = 'part') {
  const n = mesh.tri.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  const head = `${name}, buttonboard docs generator`.slice(0, 80);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  const P = mesh.pos;
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [mesh.tri[3 * t], mesh.tri[3 * t + 1], mesh.tri[3 * t + 2]].map((i) => 3 * i);
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
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

// One face of a grid cell: the flat ring between the cell's square outline
// (half-size h, centred on cx, cy) and an inner ring of points `inner`,
// counter-clockwise, star-shaped about the centre. The outline is sampled on
// the rays through the inner points, plus its four corners, so two cells
// sample their shared edge at the same places and weld into one solid.
// `extra` adds outline points (a rounded plate corner); `project` maps a ray
// to the outline when that is not the plain square. Returns the outline chain
// per inner segment, for the caller's edge walls.
export function cellFace(b, cx, cy, h, inner, z, up, { project, extra = [] } = {}) {
  const n = inner.length;
  const ang = (x, y) => { let a = Math.atan2(y, x); if (a < 0) a += 2 * Math.PI; return a; };
  const sq = (x, y) => { const t = h / Math.max(Math.abs(x), Math.abs(y)); return [x * t, y * t]; };
  const ring = inner.map(([x, y], k) => {
    const [px, py] = project ? project(x, y) : sq(x, y);
    return { x: px, y: py, k, a: ang(x, y) };
  });
  const corners = [[h, h], [-h, h], [-h, -h], [h, -h]].map(([x, y]) => ({ x, y, k: -1, a: ang(x, y) }));
  for (const p of [...corners, ...extra.map(([x, y]) => ({ x, y, k: -1, a: ang(x, y) }))])
    if (!ring.some((q) => Math.abs(q.a - p.a) < 1e-7) && (!project || inside(p, project))) ring.push(p);
  ring.sort((p, q) => p.a - q.a);
  const chains = [];
  const m = ring.length;
  for (let s = 0; s < m; s++) {
    if (ring[s].k < 0) continue;
    const chain = [ring[s]];
    let q = (s + 1) % m;
    while (ring[q].k < 0) { chain.push(ring[q]); q = (q + 1) % m; }
    chain.push(ring[q]);
    const k0 = ring[s].k, k1 = ring[q].k;
    const c0 = b.v(cx + inner[k0][0], cy + inner[k0][1], z), c1 = b.v(cx + inner[k1][0], cy + inner[k1][1], z);
    const o = (p) => b.v(cx + p.x, cy + p.y, z);
    for (let t = 0; t + 1 < chain.length; t++) up ? b.tri(c0, o(chain[t]), o(chain[t + 1]))
                                                  : b.tri(c0, o(chain[t + 1]), o(chain[t]));
    const last = o(chain[chain.length - 1]);
    up ? b.tri(c0, last, c1) : b.tri(c0, c1, last);
    chains.push(chain);
  }
  return chains;
}

function inside(p, project) {
  // a square corner is kept only if the outline still reaches it (a rounded corner cuts it off)
  const [x, y] = project(p.x, p.y);
  return Math.abs(x - p.x) < 1e-7 && Math.abs(y - p.y) < 1e-7;
}

// Vertical wall between two copies of one outline chain, at z0 (below) and z1,
// facing outward: for a cell's segments that lie on the plate's edge.
export function edgeWall(b, cx, cy, A, B, z0, z1) {
  const a1 = b.v(cx + A.x, cy + A.y, z1), b1 = b.v(cx + B.x, cy + B.y, z1);
  const a0 = b.v(cx + A.x, cy + A.y, z0), b0 = b.v(cx + B.x, cy + B.y, z0);
  b.tri(a1, a0, b0); b.tri(a1, b0, b1);
}

// Whether a chain segment lies on the plate's edge rather than on an edge
// shared with a neighbouring cell. (sx, sy): -1/0/+1, which outer edges this
// cell touches, with 2 for both (a 1-wide plate).
export function onPlateEdge(A, B, h, sx, sy) {
  const e = 1e-6;
  const onX = (v) => Math.abs(A.x - v) < e && Math.abs(B.x - v) < e;
  const onY = (v) => Math.abs(A.y - v) < e && Math.abs(B.y - v) < e;
  if (onX(-h)) return sx === -1 || sx === 2;
  if (onX(h)) return sx === 1 || sx === 2;
  if (onY(-h)) return sy === -1 || sy === 2;
  if (onY(h)) return sy === 1 || sy === 2;
  return true;          // on a rounded outer corner
}
