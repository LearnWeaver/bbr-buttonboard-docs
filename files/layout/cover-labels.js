// Key labels on the low-profile cover (deck-model.js coverPlate): the word typed for each key, set on the
// cover's top beside that key's opening, upright as the panel faces its driver. The rules follow labels.js:
// the side of the key that faces no other key on the panel (south first, then north, west, east), capitals
// MAX_CAP at most and MIN_CAP at least, and every label on solid cover, clear of the openings, the edge and
// the other labels by EDGE. A label that meets an opening beside its key (a tall case's, a display's) moves
// out, up to SLIDE, until it is clear. Coordinates are the deck's frame: mm, y north.
import { fitted, MAX_CAP, PITCH_MX } from './labels.js';

const EDGE = 0.8;                // label to an opening, the cover's edge, or another label
const GAP_X = 1.0;
const SLIDE = 8.0;               // how far past its key's opening a label may sit, to clear another opening
const DIRS = [['S', 0, -1], ['N', 0, 1], ['W', -1, 0], ['E', 1, 0]];

// plate: coverPlate()'s result. -> { placed: [{ uid, i, text, side, size, cap, cx, cy, w, h }], refused: [{ uid, i, text, why }] }
export function placeCoverLabels(M, font, plate) {
  const { solid, keys, keyCut } = plate;
  const placed = [], refused = [];
  let taken = null;
  for (const k of keys) {
    const text = (k.text || '').trim();
    if (!text) continue;
    const tried = [];
    let done = false;
    for (const [side, dx, dy] of DIRS) {
      if (keys.some((o) => Math.abs(o.x - k.x - dx * PITCH_MX) < 2 && Math.abs(o.y - k.y - dy * PITCH_MX) < 2)) { tried.push(`a key to the ${side}`); continue; }
      // above or below a key a label is a key pitch wide at most, as on a lid; beside it, two
      const t = fitted(font, text, (dy ? 1 : 2) * PITCH_MX - GAP_X, MAX_CAP + 0.01);
      if (!t) { tried.push(`too long to the ${side}`); continue; }
      // from the key's opening outward, as far as SLIDE, to the first place it sits on solid cover
      let why = `no cover to the ${side}`;
      for (let out = 0; out <= SLIDE && !done; out += 0.5) {
        const near = keyCut / 2 + EDGE + out;
        const cx = dy ? k.x : k.x + dx * (near + t.w / 2), cy = dy ? k.y + dy * (near + t.h / 2) : k.y;
        const box = M.CrossSection.square([t.w + 2 * EDGE, t.h + 2 * EDGE], true).translate([cx, cy]);
        if (box.subtract(solid).area() > 0.01) continue;
        if (taken && box.intersect(taken).area() > 0.01) { why = `another label to the ${side}`; continue; }
        placed.push({ uid: k.uid, i: k.i, text, side, size: t.size, cap: t.cap, cx, cy, w: t.w, h: t.h });
        taken = taken ? M.CrossSection.union([taken, box]) : box;
        done = true;
      }
      if (done) break;
      tried.push(why);
    }
    if (!done) refused.push({ uid: k.uid, i: k.i, text, why: tried.join('; ') });
  }
  return { placed, refused };
}
