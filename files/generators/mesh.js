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

// A closed mesh as a STEP solid (AP214, millimetres), so CAD opens it at its
// true size, which an STL cannot promise. Edge-connected coplanar triangles
// become one planar face, holes and all, and a straight run of edges between
// the same two faces becomes one edge, so a flat top is one face to sketch on.
// Curved surfaces stay faceted, as the mesh made them.
export function toStep(mesh, name = 'part') {
  // weld by position first: a mesh from manifold can hold two vertices at one
  // point, and the triangles between them have no area to make a face of
  const P = mesh.pos, b = new Builder();
  const idx = (i) => b.v(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
  for (let t = 0; t < mesh.tri.length; t += 3) b.tri(idx(mesh.tri[t]), idx(mesh.tri[t + 1]), idx(mesh.tri[t + 2]));
  return stepText(b.mesh(), name);
}

function stepText(mesh, name) {
  const P = mesh.pos, T = mesh.tri, nt = T.length / 3;
  const pt = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((c) => c / l); };
  const tv = (t, k) => T[3 * t + k];
  const area2 = [], normal = [], sliver = [];
  for (let t = 0; t < nt; t++) {
    const e = [0, 1, 2].map((k) => sub(pt(tv(t, (k + 1) % 3)), pt(tv(t, k)))), n = cross(e[0], e[1]);
    area2.push(Math.hypot(...n));
    normal.push(unit(n));
    // three points on a line (the mesh has the odd one): no plane of its own, it joins a neighbour's
    sliver.push(area2[t] < 1e-6 * Math.max(...e.map((v) => dot(v, v))));
  }
  const half = new Map();                       // "a,b" -> the triangle with that directed edge
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) half.set(`${tv(t, k)},${tv(t, (k + 1) % 3)}`, t);

  // coplanar groups: flood out from the biggest triangles, whose planes are the most exact
  const group = new Int32Array(nt).fill(-1), groups = [];
  const order = [...Array(nt).keys()].sort((a, b) => area2[b] - area2[a]);
  for (const s of order) {
    if (group[s] >= 0) continue;
    const n = normal[s], d = dot(n, pt(tv(s, 0))), g = groups.length, tris = [s];
    group[s] = g;
    for (let q = 0; q < tris.length; q++) {
      const t = tris[q];
      for (let k = 0; k < 3; k++) {
        const o = half.get(`${tv(t, (k + 1) % 3)},${tv(t, k)}`);
        if (o === undefined || group[o] >= 0 || (!sliver[o] && dot(normal[o], n) < 0.999)) continue;
        if ([0, 1, 2].every((j) => Math.abs(dot(n, pt(tv(o, j))) - d) < 1e-4)) { group[o] = g; tris.push(o); }
      }
    }
    groups.push({ n, tris });
  }

  // each group's boundary as loops; at a vertex the boundary passes twice, take the
  // turn that keeps to the same corner of the face
  const faces = [];
  for (const { n, tris } of groups) {
    const out = new Map();
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const a = tv(t, k), b = tv(t, (k + 1) % 3);
      if (group[half.get(`${b},${a}`)] === group[t]) continue;
      if (!out.has(a)) out.set(a, []);
      out.get(a).push(b);
    }
    const loops = [];
    for (const [a0, ends] of out) while (ends.length) {
      const loop = [a0];
      let prev = a0, cur = ends.pop();
      while (cur !== a0) {
        loop.push(cur);
        const c = out.get(cur);
        let pick = 0;
        if (c.length > 1) {
          const back = sub(pt(prev), pt(cur));
          const cw = (b) => { const v = sub(pt(b), pt(cur)); let a = Math.atan2(dot(cross(v, back), n), dot(back, v)); return a <= 0 ? a + 2 * Math.PI : a; };
          pick = c.reduce((best, b, i) => (cw(b) < cw(c[best]) ? i : best), 0);
        }
        prev = cur;
        cur = c.splice(pick, 1)[0];
      }
      let s = [0, 0, 0];
      for (let i = 0; i < loop.length; i++) {
        const c = cross(pt(loop[i]), pt(loop[(i + 1) % loop.length]));
        s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
      }
      loops.push({ loop, area: dot(s, n) / 2 });
    }
    const outer = loops.filter((l) => l.area > 0);
    if (outer.length === 1) faces.push({ n, loops: [outer[0].loop, ...loops.filter((l) => l.area <= 0).map((l) => l.loop)] });
    else for (const t of tris) faces.push({ n: normal[t], loops: [[tv(t, 0), tv(t, 1), tv(t, 2)]] });   // not one simple region
  }

  // drop the vertices in the middle of a straight run between the same two faces
  const nbrs = new Map();
  const link = (a, b) => { if (!nbrs.has(a)) nbrs.set(a, new Set()); nbrs.get(a).add(b); };
  for (const f of faces) for (const l of f.loops) l.forEach((a, i) => { const b = l[(i + 1) % l.length]; link(a, b); link(b, a); });
  const straight = (v) => {
    const s = nbrs.get(v);
    if (s.size !== 2) return false;
    const [a, b] = [...s];
    const u = unit(sub(pt(a), pt(v))), w = unit(sub(pt(b), pt(v)));
    return dot(u, w) < -1 + 1e-9;
  };
  for (const f of faces) f.loops = f.loops.map((l) => l.filter((v) => !straight(v)));

  // write it out
  const lines = [];
  const add = (s) => { lines.push(`#${lines.length + 1}=${s};`); return `#${lines.length}`; };
  const r = (x) => { if (Math.abs(x) < 1e-12) return '0.'; const s = x.toExponential(10).replace(/\.?0+e/, 'e'); return s.replace(/^(-?\d)e/, '$1.e').toUpperCase(); };
  const xyz = (a) => `(${a.map(r).join(',')})`;
  const ctx = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
  const pctx = add(`PRODUCT_CONTEXT('',${ctx},'mechanical')`);
  const dctx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  const prod = add(`PRODUCT(${q(name)},${q(name)},'',(${pctx}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${dctx})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const mm = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const rad = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const sr = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),${mm},'distance_accuracy_value','confusion accuracy')`);
  const gctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))` +
                   `GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('',''))`);
  const origin = add(`AXIS2_PLACEMENT_3D('',${add("CARTESIAN_POINT('',(0.,0.,0.))")},${add("DIRECTION('',(0.,0.,1.))")},${add("DIRECTION('',(1.,0.,0.))")})`);
  const vtx = new Map();
  const vertex = (i) => {
    if (!vtx.has(i)) vtx.set(i, add(`VERTEX_POINT('',${add(`CARTESIAN_POINT('',${xyz(pt(i))})`)})`));
    return vtx.get(i);
  };
  const edges = new Map();
  const edge = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!edges.has(k)) {
      const [u, w] = a < b ? [a, b] : [b, a], d = sub(pt(w), pt(u)), len = Math.hypot(...d);
      const line = add(`LINE('',${add(`CARTESIAN_POINT('',${xyz(pt(u))})`)},${add(`VECTOR('',${add(`DIRECTION('',${xyz(unit(d))})`)},${r(len)})`)})`);
      edges.set(k, add(`EDGE_CURVE('',${vertex(u)},${vertex(w)},${line},.T.)`));
    }
    return add(`ORIENTED_EDGE('',*,*,${edges.get(k)},${a < b ? '.T.' : '.F.'})`);
  };
  const faceRefs = faces.map(({ n, loops }) => {
    const bounds = loops.map((l, i) => {
      const loop = add(`EDGE_LOOP('',(${l.map((a, j) => edge(a, l[(j + 1) % l.length])).join(',')}))`);
      return add(`${i ? 'FACE_BOUND' : 'FACE_OUTER_BOUND'}('',${loop},.T.)`);
    });
    const o = loops[0];
    const nn = unit(n), e = sub(pt(o[1]), pt(o[0])), ref = unit(sub(e, nn.map((c) => c * dot(e, nn))));
    const plane = add(`PLANE('',${add(`AXIS2_PLACEMENT_3D('',${add(`CARTESIAN_POINT('',${xyz(pt(o[0]))})`)},` +
                                      `${add(`DIRECTION('',${xyz(nn)})`)},${add(`DIRECTION('',${xyz(ref)})`)})`)})`);
    return add(`ADVANCED_FACE('',(${bounds.join(',')}),${plane},.T.)`);
  });
  const brep = add(`MANIFOLD_SOLID_BREP(${q(name)},${add(`CLOSED_SHELL('',(${faceRefs.join(',')}))`)})`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${q(name)},(${origin},${brep}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
  const text = ['ISO-10303-21;', 'HEADER;', `FILE_DESCRIPTION((${q(`${name}, buttonboard docs generator`)}),'2;1');`,
                `FILE_NAME(${q(name)},'',(''),(''),'buttonboard docs generator','','');`,
                "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;', ...lines,
                'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
  return new TextEncoder().encode(text);
}
