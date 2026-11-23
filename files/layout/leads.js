// Where each case's leads can go: the planner's cabling check. Plain ES
// module, no DOM, so node can test it (tools/test_generators.mjs).
//
// tools/one_piece_parts.py records every case's ports: each opening where it
// crosses the case's outline, in the case's own frame. A port that reaches up
// through the lid lets a lead rise out of the slot and cross over the top to
// wherever it is going, so it always counts. A low one, under the board
// (disp1, disp2, the mx1 1x1) or under a cable tile's lid, only lets a lead out
// sideways, so it needs the cell beside it to take the lead:
//
//   off the board          the lead leaves the panel's edge
//   a free cell            nothing there to stop it
//   a blank                stops it, as a solid filler; in a one-piece case it
//                          is a hollow cell, so it does not
//   another case or tile   only through a port of its own on the facing side
//                          that overlaps this one along the edge
//
// A case all of whose ports are blocked has no way to join the bus.

import { cellsAt } from './layout-model.js';

const SIDES = ['N', 'E', 'S', 'W'];
const turnSide = (s, r) => SIDES[(SIDES.indexOf(s) + r) % 4];
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
const MIN_OVERLAP = 1.0;        // mm two ports must share along the edge to pass a lead

// Every placed case's ports on the grid: screen-style mm, x right and y down from
// the board's top-left, with `side` turned and `a0..a1` along that side.
export function placedPorts(layout, cat, parts) {
  const P = parts.pitch, out = [];
  for (const it of layout.items) {
    const spec = parts.cases[it.id];
    if (!spec?.ports) continue;
    const c = cellsAt(cat.get(it.id), it.x, it.y, it.r);
    const bx = Math.min(...c.occ.map((q) => q[0])), by = Math.min(...c.occ.map((q) => q[1]));
    const cx = (bx + c.w / 2) * P, cy = (by + c.h / 2) * P;
    const ex = (spec.w * P - 0.5) / 2, ey = (spec.h * P - 0.5) / 2;
    const turn = ([x, y]) => { for (let k = 0; k < it.r; k++) [x, y] = [-y, x]; return [x, y]; };  // clockwise, y down
    for (const p of spec.ports) {
      // the port's two ends in the case's frame, y flipped to point down like the grid
      const ends = { N: [[p.a0, -ey], [p.a1, -ey]], S: [[p.a0, ey], [p.a1, ey]],
                     E: [[ex, -p.a0], [ex, -p.a1]], W: [[-ex, -p.a0], [-ex, -p.a1]] }[p.side].map(turn);
      const side = turnSide(p.side, it.r);
      const along = side === 'N' || side === 'S' ? 0 : 1;
      const a = ends.map((e) => e[along] + (along ? cy : cx));
      out.push({ it, side, a0: Math.min(...a), a1: Math.max(...a), top: p.z1 > parts.seam, z0: p.z0, z1: p.z1,
                 usb: cat.get(it.id).edge === p.side });
    }
  }
  return out;
}

// Each port with where its lead goes: { ...port, ok, into: [what blocks it] },
// and the cases left with no way out. onePiece: blanks are hollow cells.
export function leadCheck(layout, cat, parts, onePiece = false) {
  const P = parts.pitch, ports = placedPorts(layout, cat, parts);
  const owner = new Map();
  for (const it of layout.items) for (const [x, y] of cellsAt(cat.get(it.id), it.x, it.y, it.r).occ) owner.set(`${x},${y}`, it);
  const checked = ports.map((p) => {
    if (p.top) return { ...p, ok: true, into: [] };
    const c = cellsAt(cat.get(p.it.id), p.it.x, p.it.y, p.it.r);
    const xs = c.occ.map((q) => q[0]), ys = c.occ.map((q) => q[1]);
    const span = (lo, hi) => { const r = []; for (let i = Math.floor(lo / P + 1e-6); i <= Math.floor(hi / P - 1e-6); i++) r.push(i); return r; };
    const cells = { E: span(p.a0, p.a1).map((y) => [Math.max(...xs) + 1, y]), W: span(p.a0, p.a1).map((y) => [Math.min(...xs) - 1, y]),
                    N: span(p.a0, p.a1).map((x) => [x, Math.min(...ys) - 1]), S: span(p.a0, p.a1).map((x) => [x, Math.max(...ys) + 1]) }[p.side];
    const into = [];
    let ok = false;
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) { ok = true; continue; }
      const n = owner.get(`${x},${y}`);
      if (!n) { ok = true; continue; }
      if (n.id === 'blank' || parts.cases[n.id]?.empty) { if (onePiece) ok = true; else into.push(cat.get(n.id).name.toLowerCase()); continue; }
      const meets = ports.some((q) => q.it === n && !q.usb && q.side === OPPOSITE[p.side] &&
                                      Math.min(p.a1, q.a1) - Math.max(p.a0, q.a0) >= MIN_OVERLAP);
      if (meets) ok = true; else into.push(`the ${cat.get(n.id).name}`);
    }
    return { ...p, ok, into: [...new Set(into)] };
  });
  const cutOff = [];
  for (const it of layout.items) {
    const mod = cat.get(it.id);
    if (mod.glyph) continue;                    // a cable tile with nowhere to go is just unused
    const mine = checked.filter((p) => p.it === it && !p.usb);
    if (mine.length && !mine.some((p) => p.ok)) cutOff.push({ it, mod, ports: mine });
  }
  const usbBlocked = checked.filter((p) => p.usb && !p.ok);
  return { ports: checked, cutOff, usbBlocked };
}

const WORDS = { N: 'top', S: 'bottom', E: 'right', W: 'left' };

// The check as sentences for the page.
export function leadWarnings(layout, cat, parts, onePiece = false) {
  const { cutOff, usbBlocked } = leadCheck(layout, cat, parts, onePiece);
  const out = cutOff.map(({ mod, ports }) => {
    const sides = [...new Set(ports.map((p) => WORDS[p.side]))];
    const into = [...new Set(ports.flatMap((p) => p.into))];
    return `The ${mod.name}'s leads have nowhere to go. They leave low down on its ${sides.join(' and ')} ` +
           `${sides.length > 1 ? 'sides' : 'side'}, into ${into.join(' and ')}. Leave a free cell or put a cable tile ` +
           'beside one of them, or move it next to a case whose slot lines up.';
  });
  for (const p of usbBlocked)
    out.push(`The ${cat.get(p.it.id).name}'s USB end runs into ${p.into.join(' and ')}. Turn or move it so the plug has room.`);
  return out;
}

// Where a lead can run, for the 3D view: every pair of facing ports on two
// neighbouring cases that share MIN_OVERLAP along their common wall (a slot
// open through the lid included: the lead still runs through it), as
// { a, b, side (a's), line, at, z }: the wall in grid mm (x for E/W, y for N/S),
// the middle of the overlap along it, and the middle of the two openings'
// shared height. And every other port, with where its lead goes:
// 'top' (up through the lid), 'open' (a free cell beside it), 'edge' (off the
// board), or 'blocked'.
export function leadRoutes(layout, cat, parts) {
  const P = parts.pitch, { ports } = leadCheck(layout, cat, parts);
  const owner = new Map(), box = new Map();
  for (const it of layout.items) {
    const occ = cellsAt(cat.get(it.id), it.x, it.y, it.r).occ;
    for (const [x, y] of occ) owner.set(`${x},${y}`, it);
    const xs = occ.map((q) => q[0]), ys = occ.map((q) => q[1]);
    box.set(it, { x0: Math.min(...xs), x1: Math.max(...xs) + 1, y0: Math.min(...ys), y1: Math.max(...ys) + 1 });
  }
  const lineOf = (p) => { const b = box.get(p.it); return { E: b.x1, W: b.x0, N: b.y0, S: b.y1 }[p.side] * P; };
  const pairs = [], loose = [], paired = new Set();
  for (const p of ports) {
    if (p.usb) { loose.push({ port: p, kind: 'usb' }); continue; }
    const line = lineOf(p);
    const q = ports.find((o) => o !== p && o.it !== p.it && !o.usb && o.side === OPPOSITE[p.side] &&
                                Math.abs(lineOf(o) - line) < 1e-6 && Math.min(p.a1, o.a1) - Math.max(p.a0, o.a0) >= MIN_OVERLAP);
    if (q) {
      if (!paired.has(q)) pairs.push({ a: p, b: q, side: p.side, line, at: (Math.max(p.a0, q.a0) + Math.min(p.a1, q.a1)) / 2,
                                       z: (Math.max(p.z0, q.z0) + Math.min(p.z1, q.z1)) / 2 });
      paired.add(p);
      continue;
    }
    if (p.top) { loose.push({ port: p, kind: 'top' }); continue; }
    const b = box.get(p.it), mid = (p.a0 + p.a1) / 2 / P;
    const [cx, cy] = { E: [b.x1, Math.floor(mid)], W: [b.x0 - 1, Math.floor(mid)], N: [Math.floor(mid), b.y0 - 1], S: [Math.floor(mid), b.y1] }[p.side];
    const off = cx < 0 || cy < 0 || cx >= layout.cols || cy >= layout.rows;
    loose.push({ port: p, kind: off ? 'edge' : !owner.get(`${cx},${cy}`) ? 'open' : 'blocked' });
  }
  return { pairs, loose };
}
