// A labelled lid to print: the case's lid with each key label cut LABEL_D
// into its top, and the letters as a second body that fills the cuts exactly,
// as hardware/lowpro/lp_label_lid.py makes them. Both come top-down, as every
// lid STL does, so the colour change is only in a lid's first layers. Load the
// two STLs together as one object with two parts and give the letters the
// second filament.
//
// The lid is the planner's display model (models/models.bin, tessellated to
// 0.04 mm), not the case zip's, so it carries the planner's labels without
// CadQuery. M is the manifold-3d module after setup(); THREE the three.js module.
import { LABEL_D, placeLabels, labelShapes } from './labels.js';
import { Builder } from '../generators/mesh.js';

// a models.bin mesh as manifold's Mesh, in the case frame (z up)
function lidMesh(M, index, bin, m) {
  const buf = bin.buffer ? bin.buffer : bin, base = bin.byteOffset || 0;
  const off = base + index.meshes[m.mesh];
  const q = new Int16Array(buf, off, 3 * m.nv);
  let at = off + 6 * m.nv;
  at += (4 - (at % 4)) % 4;
  const tri = m.wide ? new Uint32Array(buf, at, 3 * m.nt) : new Uint16Array(buf, at, 3 * m.nt);
  const pos = new Float32Array(3 * m.nv);
  for (let i = 0; i < 3 * m.nv; i++) pos[i] = q[i] * index.scale;
  return new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: pos, triVerts: Uint32Array.from(tri) }));
}

// one glyph outline, extruded LABEL_D down from the lid's top, welded into a solid
function glyph(M, THREE, shape, dx, dy, top) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: LABEL_D + 0.2, bevelEnabled: false, curveSegments: 8 });
  const p = g.getAttribute('position').array, b = new Builder();
  for (let i = 0; i < p.length; i += 9) {
    const v = [0, 3, 6].map((k) => b.v(p[i + k] + dx, p[i + k + 1] + dy, p[i + k + 2] + top - LABEL_D));
    b.tri(v[0], v[1], v[2]);
  }
  g.dispose();
  const m = b.mesh();
  return new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: m.pos, triVerts: m.tri }));
}

// placed labels (labels.js's shape: text, size, cx, cy) as one Manifold, their tops at `top`, LABEL_D deep
// (and 0.2 proud, so a cut is clean)
export function lettersSolid(M, THREE, font, placed, top) {
  const parts = placed.flatMap((p) => {
    const { shapes, dx, dy } = labelShapes(font, p);
    return shapes.map((s) => glyph(M, THREE, s, dx, dy, top));
  });
  return parts.length ? M.Manifold.union(parts) : null;
}

const toMesh = (m) => {
  const g = m.getMesh();
  const pos = new Float32Array(g.numVert * 3);
  for (let v = 0; v < g.numVert; v++) for (let k = 0; k < 3; k++) pos[3 * v + k] = g.vertProperties[v * g.numProp + k];
  return { pos, tri: Uint32Array.from(g.triVerts) };
};

// -> { lid, text: meshes (mesh.js's { pos, tri }), top-down on the bed; placed, refused (labels.js);
//      offLid: the placed labels that would cross a hole or slot, and were left off }
export function labelledLid(M, THREE, font, index, bin, style, id, labels, inset) {
  const spec = index.cases[style][id];
  const { placed, refused } = placeLabels(spec, labels, font, inset);
  const lid = lidMesh(M, index, bin, spec.lid);
  if (lid.status() !== 'NoError') throw new Error(`the ${id} lid model: ${lid.status()}`);
  const top = spec.top;
  // the letters stand 0.2 proud of the top, so the cut is clean; what is kept of them is what the lid had there
  const slab = M.Manifold.cube([spec.out[0] + 2, spec.out[1] + 2, LABEL_D], true).translate([0, 0, top - LABEL_D / 2]);
  const kept = [], offLid = [];
  for (const p of placed) {
    const { shapes, dx, dy } = labelShapes(font, p);
    const letters = M.Manifold.union(shapes.map((s) => glyph(M, THREE, s, dx, dy, top))).intersect(slab);
    const on = letters.intersect(lid);
    if (on.volume() < 0.995 * letters.volume()) offLid.push(p); else kept.push(on);
  }
  const text = kept.length ? M.Manifold.union(kept) : null;
  const cut = text ? lid.subtract(text) : lid;
  const flip = (m) => m.rotate([180, 0, 0]).translate([0, 0, top]);
  return { lid: toMesh(flip(cut)), text: text && toMesh(flip(text)), placed: placed.filter((p) => !offLid.includes(p)), refused, offLid,
           volumes: { lid: lid.volume(), cut: cut.volume(), text: text ? text.volume() : 0 } };
}
