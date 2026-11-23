// Key labels on a case lid: a word beside each MX key, inlaid flush in the
// lid's top for a two-colour print. The rules are hardware/lowpro/lp_label_lid.py's,
// so the planner puts a label where that script would: on the side of its key
// that faces no other key (south first, then north, west, east), in the strip
// of lid between the keycap's edge and the lid's edge, at the largest capital
// height up to MAX_CAP that fits, and never under MIN_CAP, where a bold stroke
// gets thinner than a nozzle. Plain ES module, no DOM: node tests it
// (tools/test_generators.mjs). Coordinates are the case frame's: x east, y north, mm.
//
// `font` is a three.js Font (vendor/three/FontLoader.js) of the subset in
// vendor/three/droid_sans_bold_labels.typeface.json.

export const LABEL_D = 0.6;      // inlay depth: three 0.2 layers, all among a top-down lid's first layers
export const PITCH_MX = 19.05;
const CAP = 18.0;                // a keycap's footprint: it hides the plate under it
const PITCH = 19.05;             // MX key pitch: a label under a key is at most this wide, less GAP_X
const GAP_X = 1.0;
const EDGE = 0.6;                // text to the cap's edge and to the lid's edge
export const MAX_CAP = 4.0, MIN_CAP = 2.5;
export const MAX_LEN = 12;
const DIRS = [['S', 0, -1], ['N', 0, 1], ['W', -1, 0], ['E', 1, 0]];

// What a label may hold: the font subset's characters, upper case, at most MAX_LEN.
export const cleanLabel = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 .+\-/&!?]/g, '').slice(0, MAX_LEN);

// The outline of `text` at em `size`, and its box. Shapes are three.js Shapes.
function outline(font, text, size) {
  const shapes = font.generateShapes(text, size);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) for (const p of s.getPoints(4)) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { shapes, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// The label at the largest size whose capitals stay under MAX_CAP and that fits w x h, or null.
export function fitted(font, text, w, h) {
  const capRatio = outline(font, 'H', 1).h;
  let size = MAX_CAP / capRatio, o = outline(font, text, size);
  for (let i = 0; i < 12; i++) {
    const k = Math.min(1, w / o.w, h / o.h);
    if (k > 0.999) break;
    size *= k * 0.995;
    o = outline(font, text, size);
  }
  if (o.w > w + 1e-6 || o.h > h + 1e-6 || size * capRatio < MIN_CAP * 0.98) return null;
  return { size, cap: size * capRatio, ...o };
}

// Where each key's label goes. spec: the case model's entry (keys, out); inset: from the case outline to
// the lid's visible edge (the rim and the lid's clearance). -> { placed: [{ i, text, side, size, cap, cx, cy,
// w, h }], refused: [{ i, text, why }] }, the label's box centred on (cx, cy).
export function placeLabels(spec, labels, font, inset) {
  const keys = spec.keys || [], ex = spec.out[0] / 2 - inset, ey = spec.out[1] / 2 - inset;
  const placed = [], refused = [];
  keys.forEach(([kx, ky], i) => {
    const text = cleanLabel(labels?.[i]).trim();
    if (!text) return;
    const tried = [];
    for (const [side, dx, dy] of DIRS) {
      if (keys.some(([ox, oy]) => Math.abs(ox - kx - dx * PITCH) < 2 && Math.abs(oy - ky - dy * PITCH) < 2)) {
        tried.push(`a key to the ${side}`);
        continue;
      }
      const near = CAP / 2 + EDGE;               // the label hugs its key: its near edge at the cap's
      let a, b, w, h;
      if (dy) { [a, b] = [ky + dy * near, dy * (ey - EDGE)].sort((p, q) => p - q); w = PITCH - GAP_X; h = Math.min(b - a, MAX_CAP + 0.01); }
      else { [a, b] = [kx + dx * near, dx * (ex - EDGE)].sort((p, q) => p - q); w = b - a; h = MAX_CAP + 0.01; }
      if (b - a < MIN_CAP || w < 4 * MIN_CAP) { tried.push(`${Math.max(0, Math.min(w, b - a)).toFixed(1)} mm of lid to the ${side}`); continue; }
      const t = fitted(font, text, w, h);
      if (!t) { tried.push(`too long for ${w.toFixed(1)} mm to the ${side}`); continue; }
      const cx = dy ? kx : kx + dx * (near + t.w / 2), cy = dy ? ky + dy * (near + t.h / 2) : ky;
      placed.push({ i, text, side, size: t.size, cap: t.cap, cx, cy, w: t.w, h: t.h });
      return;
    }
    refused.push({ i, text, why: tried.join('; ') });
  });
  return { placed, refused };
}

// A placed label's outline: three.js Shapes, and the shift (dx, dy) that centres their box on (cx, cy).
export function labelShapes(font, p) {
  const o = outline(font, p.text, p.size);
  return { shapes: o.shapes, dx: p.cx - (o.x0 + o.x1) / 2, dy: p.cy - (o.y0 + o.y1) / 2 };
}

// Which key is which, for the inputs: the case scripts' KEYS order.
export function keyNames(id, n) {
  if (id === 'mx4') return ['W', 'A', 'S', 'D'];
  if (id === 'mx1s') return ['Key'];
  return Array.from({ length: n }, (_, i) => `Key ${i + 1}`);
}
