// Full openGrid board geometry for the docs site's generator. Plain ES module:
// no DOM, so node can test it (tools/test_generators.mjs).
//
// The source of truth is hardware/opengrid-board/opengrid_board.py, which
// writes opengrid-params.json beside this file: the pitch, the thickness, and
// the cell opening as (depth, flat, corner) stations. Between stations the
// opening is a straight loft of an octagon, so every wall is a flat panel and
// this mesh is exact, not an approximation.
//
// openGrid is CC BY 4.0, by David D (https://www.printables.com/model/1214361).
// The cell profile follows morganp/openscad-opengrid (MIT). openGrid
// compatible, not official.
import { Builder, cellFace, edgeWall, onPlateEdge } from '../generators/mesh.js';

// The openGrid octagon: `flat` across the straight faces, `corner` from the
// centre to the 45 degree faces. Counter-clockwise from just below +x.
export function octagon(flat, corner) {
  const f = flat / 2, k = corner * Math.SQRT2 - f;
  return [[f, -k], [f, k], [k, f], [-k, f], [-f, k], [-f, -k], [-k, -f], [k, -f]];
}

// The board, z = 0 on its back face and z = thickness on its front.
export function boardMesh(P, cols, rows) {
  const h = P.pitch / 2, T = P.thickness;
  const rings = P.stations.map(([d, flat, corner]) => ({ z: T - d, pts: octagon(flat, corner) }));
  const b = new Builder();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const cx = (i - (cols - 1) / 2) * P.pitch, cy = (j - (rows - 1) / 2) * P.pitch;
      const sx = cols === 1 ? 2 : i === 0 ? -1 : i === cols - 1 ? 1 : 0;
      const sy = rows === 1 ? 2 : j === 0 ? -1 : j === rows - 1 ? 1 : 0;
      const front = rings[0], back = rings[rings.length - 1];
      const chains = cellFace(b, cx, cy, h, front.pts, front.z, true);
      cellFace(b, cx, cy, h, back.pts, back.z, false);
      // the opening's walls, station to station, facing into the opening
      for (let s = 0; s + 1 < rings.length; s++) {
        const up = rings[s], dn = rings[s + 1];
        for (let k = 0; k < 8; k++) {
          const k1 = (k + 1) % 8;
          const t0 = b.v(cx + up.pts[k][0], cy + up.pts[k][1], up.z), t1 = b.v(cx + up.pts[k1][0], cy + up.pts[k1][1], up.z);
          const u0 = b.v(cx + dn.pts[k][0], cy + dn.pts[k][1], dn.z), u1 = b.v(cx + dn.pts[k1][0], cy + dn.pts[k1][1], dn.z);
          b.tri(t0, t1, u1); b.tri(t0, u1, u0);
        }
      }
      // the board's outside edge. The front and back openings are the same octagon, so the two faces'
      // outlines are sampled at the same points and the wall between them is upright.
      for (const chain of chains)
        for (let s = 0; s + 1 < chain.length; s++)
          if (onPlateEdge(chain[s], chain[s + 1], h, sx, sy)) edgeWall(b, cx, cy, chain[s], chain[s + 1], 0, T);
    }
  }
  return b.mesh();
}

// The exact volume, for checking: the slab less each opening, whose
// cross-section is an octagon that changes linearly between stations.
export function boardVolume(P, cols, rows) {
  const area = (flat, corner) => {
    // the square of side flat, less the four corner triangles cut by the 45 degree faces
    const f = flat / 2, k = corner * Math.SQRT2 - f, leg = f - k;
    return flat * flat - 2 * leg * leg;
  };
  let open = 0;
  for (let s = 0; s + 1 < P.stations.length; s++) {
    const [d0, f0, c0] = P.stations[s], [d1, f1, c1] = P.stations[s + 1];
    // area is quadratic in depth along a linear loft: Simpson's rule is exact
    const mid = area((f0 + f1) / 2, (c0 + c1) / 2);
    open += ((d1 - d0) / 6) * (area(f0, c0) + 4 * mid + area(f1, c1));
  }
  return cols * rows * (P.pitch * P.pitch * P.thickness - open);
}
