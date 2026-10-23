// The layout planner's model: which cells a case takes, whether it fits, and
// what the layout adds up to. Plain ES module: no DOM, so node can test it
// (tools/test_generators.mjs).
//
// Grid coordinates: x is the column from the left, y the row from the top
// (north), both from 0. A placed case is { uid, id, x, y, r }: (x, y) is the
// top-left of everything it covers, overhang included, and r the number of
// quarter turns clockwise.

export const MAX_CELLS = 12;

export function catalogue(json) {
  const byId = new Map();
  for (const g of json.groups) for (const m of g.modules) byId.set(m.id, { ...m, group: g.name });
  return byId;
}

// The cells a case covers, turned r quarter turns clockwise and moved so its
// top-left is (0, 0): `occ` the ones its body sits on, `over` the ones it
// overhangs.
export function shape(mod, r = 0) {
  let occ = [], over = (mod.blocks || []).map(([x, y]) => [x, y]);
  for (let y = 0; y < mod.h; y++) for (let x = 0; x < mod.w; x++) occ.push([x, y]);
  for (let k = 0; k < ((r % 4) + 4) % 4; k++) {
    const turn = ([x, y]) => [-y, x];               // clockwise, with y pointing down
    occ = occ.map(turn); over = over.map(turn);
  }
  const all = occ.concat(over);
  const mx = Math.min(...all.map((c) => c[0])), my = Math.min(...all.map((c) => c[1]));
  const norm = ([x, y]) => [x - mx, y - my];
  occ = occ.map(norm); over = over.map(norm);
  const w = Math.max(...occ.concat(over).map((c) => c[0])) + 1, h = Math.max(...occ.concat(over).map((c) => c[1])) + 1;
  return { occ, over, w, h };
}

export function cellsAt(mod, x, y, r) {
  const s = shape(mod, r);
  return { occ: s.occ.map(([a, b]) => [x + a, y + b]), over: s.over.map(([a, b]) => [x + a, y + b]), w: s.w, h: s.h };
}

const key = ([x, y]) => `${x},${y}`;

// Why a case cannot go at (x, y, r), or null if it can. `ignore` is a placed
// case's uid to leave out (the one being moved). A body must be on the board
// and on no other case's body or overhang. An overhang may hang off the
// board's edge, and two overhangs may share a cell; an overhang may not sit
// over another case's body.
export function conflict(layout, cat, id, x, y, r, ignore = null) {
  const mod = cat.get(id);
  if (!mod) return 'unknown case';
  const c = cellsAt(mod, x, y, r);
  if (c.occ.some(([a, b]) => a < 0 || b < 0 || a >= layout.cols || b >= layout.rows)) return 'off the board';
  const body = new Set(), over = new Set();
  for (const it of layout.items) {
    if (it.uid === ignore) continue;
    const o = cellsAt(cat.get(it.id), it.x, it.y, it.r);
    o.occ.forEach((p) => body.add(key(p)));
    o.over.forEach((p) => over.add(key(p)));
  }
  if (c.occ.some((p) => body.has(key(p)) || over.has(key(p)))) return 'overlaps another case';
  if (c.over.some((p) => body.has(key(p)))) return 'its overhang lands on another case';
  return null;
}

export function place(layout, cat, id, x, y, r = 0) {
  if (conflict(layout, cat, id, x, y, r)) return null;
  const uid = (layout.items.reduce((m, it) => Math.max(m, it.uid), 0) || 0) + 1;
  const it = { uid, id, x, y, r };
  layout.items.push(it);
  return it;
}

export function move(layout, cat, uid, x, y, r) {
  const it = layout.items.find((i) => i.uid === uid);
  if (!it || conflict(layout, cat, it.id, x, y, r, uid)) return false;
  Object.assign(it, { x, y, r });
  return true;
}

export function remove(layout, uid) {
  layout.items = layout.items.filter((i) => i.uid !== uid);
}

// Cases whose body has fallen off the board (after the grid was made smaller).
export function offBoard(layout, cat) {
  return layout.items.filter((it) => cellsAt(cat.get(it.id), it.x, it.y, it.r).occ
    .some(([a, b]) => a >= layout.cols || b >= layout.rows));
}

// Cells nothing sits on or overhangs.
export function freeCells(layout, cat) {
  const taken = new Set();
  for (const it of layout.items) {
    const o = cellsAt(cat.get(it.id), it.x, it.y, it.r);
    o.occ.concat(o.over).forEach((p) => taken.add(key(p)));
  }
  const free = [];
  for (let y = 0; y < layout.rows; y++) for (let x = 0; x < layout.cols; x++) if (!taken.has(key([x, y]))) free.push([x, y]);
  return free;
}

export function fillBlanks(layout, cat) {
  let n = 0;
  for (const [x, y] of freeCells(layout, cat)) if (place(layout, cat, 'blank', x, y, 0)) n++;
  return n;
}

// What to print: each case with its count, in catalogue order, and the case
// zips they come from (the cable tiles share one).
export function partsList(layout, cat) {
  const counts = new Map();
  for (const it of layout.items) counts.set(it.id, (counts.get(it.id) || 0) + 1);
  const parts = [...cat.values()].filter((m) => counts.has(m.id)).map((m) => ({ ...m, count: counts.get(m.id) }));
  const zips = [...new Set(parts.map((p) => p.zip).filter(Boolean))];   // a board with no case yet has none
  return { parts, zips };
}

// What a layout is missing or has too much of, as sentences for the page.
export function warnings(layout, cat) {
  const out = [];
  const mm = layout.items.filter((i) => i.id === 'mm').length;
  if (mm === 0) out.push('Add a main module: it is what connects the panel to the robot.');
  if (mm > 1) out.push('There is more than one main module. One main module runs a whole panel; two are two separate panels.');
  const off = offBoard(layout, cat).length;
  if (off) out.push(`${off} case${off > 1 ? 's are' : ' is'} off the edge of the board. Make the grid bigger, or move ${off > 1 ? 'them' : 'it'}.`);
  return out;
}

// The layout as text for the page's address, so it can be shared: 5x5:mm,0,0:enc1,2,0,1
export function encode(layout) {
  return [`${layout.cols}x${layout.rows}`, ...layout.items.map((i) => [i.id, i.x, i.y, ...(i.r ? [i.r] : [])].join(','))].join(':');
}

// Back from text. Anything unknown, malformed, or clashing is dropped, so a
// stale link still opens.
export function decode(text, cat) {
  const [size, ...rest] = String(text || '').split(':');
  const m = /^(\d+)x(\d+)$/.exec(size || '');
  const clamp = (n) => Math.min(MAX_CELLS, Math.max(1, n));
  const layout = { cols: m ? clamp(+m[1]) : 5, rows: m ? clamp(+m[2]) : 5, items: [] };
  for (const part of rest) {
    const [id, x, y, r = '0'] = part.split(',');
    // x and y may be -1: an overhang can hang off the board's top or left edge
    if (!cat.has(id) || ![x, y].every((v) => /^-?\d+$/.test(v)) || !/^\d+$/.test(r)) continue;
    place(layout, cat, id, +x, +y, +r % 4);
  }
  return layout;
}
