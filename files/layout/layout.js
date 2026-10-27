// The layout planner on the "Plan your panel" docs page. Mounts into
// #layout-planner. The rules are in layout-model.js; the cases and their
// footprints in modules.json.
//
// Drag a case from the list onto the grid; drag a placed case to move it, or
// off the grid to take it away. Without a mouse: pick a case from the list,
// then a cell. A picked case turns with R, moves with the arrow keys and goes
// with Delete; the buttons under the grid do the same.
import { catalogue, cellsAt, shape, conflict, place, move, remove, freeCells, fillBlanks, partsList, warnings,
         encode, decode, MAX_CELLS } from './layout-model.js';
import { footprint, sizeMm, heightMm, problems as onePieceProblems, build as buildOnePiece } from './onepiece-model.js';
import { useStyles, el, field, loadFailed, download, BED } from '../generators/ui.js';
import { toStl } from '../generators/mesh.js';
import { leadCheck, leadWarnings } from './leads.js';
import { standoffCount } from '../back-plate/backplate-mesh.js';

const STORE = 'bb-layout';
const BED_STORE = 'bb-bed';
// the back of the one-piece tray (onepiece-model.js BACKS)
const BACKS = { snaps: 'Snaps, onto an openGrid board', plain: 'Plain and flat', board: 'openGrid board built in' };
const DRAG_PX = 4;          // movement before a press becomes a drag
// one colour per group, in modules.json's order; the cable tiles always grey (GREY), since red would read as an error
const HUES = [[212, 75], [28, 75], [145, 60], [280, 60], [330, 65], [220, 8]];
const GREY = HUES.length - 1;

const CSS = `
.lp { display: grid; grid-template-columns: minmax(11rem, 14rem) 1fr; gap: 1rem; margin-top: .9rem; }
@media (max-width: 700px) { .lp { grid-template-columns: 1fr; } }
.lp-palette { max-height: 34rem; overflow-y: auto; padding-right: .25rem; }
.lp-palette h4 { margin: .7rem 0 .3rem; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em;
                 color: var(--text-faint); }
.lp-palette h4:first-child { margin-top: 0; }
.gen .lp-item { display: flex; align-items: center; gap: .55rem; width: 100%; text-align: left; margin: 0 0 .3rem;
           padding: .3rem .4rem; border-radius: 7px; border: 1px solid var(--border); background: var(--bg);
           color: var(--text); font: inherit; font-size: .85rem; cursor: grab; touch-action: none; user-select: none; }
.gen .lp-item:hover { border-color: var(--border-strong); }
.gen .lp-item[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.gen .lp-item img, .gen .lp-item svg { width: 3.2rem; height: 2.2rem; object-fit: contain; flex: none; border-radius: 4px; background: #fff; margin: 0; }
.gen .lp-item .lp-nocase { width: 3.2rem; height: 2.2rem; flex: none; display: flex; align-items: center; justify-content: center;
                           text-align: center; font-size: .6rem; line-height: 1.1; color: var(--text-faint);
                           border: 1px dashed var(--border-strong); border-radius: 4px; box-sizing: border-box; }
.gen .lp-item .lp-size { margin-left: auto; color: var(--text-muted); font-size: .75rem; white-space: nowrap; }
.lp-board { min-width: 0; }
.lp-grid { position: relative; width: 100%; user-select: none; touch-action: none;
           background-color: var(--bg);
           background-image: linear-gradient(var(--border) 1px, transparent 1px),
                             linear-gradient(90deg, var(--border) 1px, transparent 1px);
           border: 1px solid var(--border-strong); border-radius: 4px; box-sizing: border-box; }
.lp-piece { position: absolute; box-sizing: border-box; border-radius: 5px; border: 1.5px solid; padding: 3px 5px;
            font-size: .72rem; line-height: 1.15; overflow: hidden; cursor: grab; touch-action: none;
            display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.lp-piece small { color: var(--text-muted); }
.lp-piece.lp-sel { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 2; }
.lp-piece.lp-off { border-color: var(--hint-danger-bd) !important; border-style: dashed; }
.lp-piece svg { width: 100%; height: 100%; }
.lp-piece.lp-tile { padding: 0; }
.lp-over { position: absolute; box-sizing: border-box; border: 1.5px dashed; border-radius: 5px; pointer-events: none;
           background-image: repeating-linear-gradient(45deg, transparent 0 4px, currentColor 4px 5px); opacity: .45; }
.lp-preview { position: absolute; box-sizing: border-box; border: 2px dashed var(--hint-success-bd); border-radius: 5px;
              background: color-mix(in srgb, var(--hint-success-bd) 15%, transparent); pointer-events: none; z-index: 3; }
.lp-preview.lp-bad { border-color: var(--hint-danger-bd); background: color-mix(in srgb, var(--hint-danger-bd) 15%, transparent); }
.lp-ghost { position: fixed; pointer-events: none; z-index: 1000; opacity: .85; }
.lp-dragging { opacity: .25; }
.lp-status { min-height: 1.6rem; margin: .55rem 0 .2rem; font-size: .85rem; color: var(--text-muted);
             display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
.lp-status button { padding: .25rem .6rem; font-size: .8rem; }
.lp-parts { width: 100%; border-collapse: collapse; font-size: .85rem; margin-top: .4rem; }
.lp-parts td, .lp-parts th { padding: .3rem .4rem; border-bottom: 1px solid var(--border); text-align: left; }
.lp-parts th { color: var(--text-muted); font-weight: 500; }
.lp-edge { position: absolute; font-size: .6rem; line-height: 1; padding: 1px 3px; border-radius: 3px;
           background: var(--bg); color: var(--text-muted); border: 1px solid currentColor; }
.lp-edge-N { top: 2px; left: 50%; transform: translateX(-50%); } .lp-edge-S { bottom: 2px; left: 50%; transform: translateX(-50%); }
.lp-edge-W { left: 2px; top: 50%; transform: translateY(-50%); } .lp-edge-E { right: 2px; top: 50%; transform: translateY(-50%); }
.lp-port { position: absolute; pointer-events: none; border-radius: 2px; }
.lp-port-N { top: -1px; height: 4px; } .lp-port-S { bottom: -1px; height: 4px; }
.lp-port-E { right: -1px; width: 4px; } .lp-port-W { left: -1px; width: 4px; }
.lp-port-top { background: var(--text-faint); } .lp-port-ok { background: var(--hint-success-bd); }
.lp-port-bad { background: var(--hint-danger-bd); }
.lp-cut { border-color: var(--hint-danger-bd) !important; }
.lp-one { margin-top: 1.1rem; padding-top: .2rem; border-top: 1px solid var(--border); }
.lp-one p { font-size: .85rem; margin: .3rem 0 .6rem; }
.lp-one .gen-controls { max-width: 34rem; }
.gen .lp-one select { font: inherit; font-size: .95rem; color: var(--text); background: var(--bg);
                      border: 1px solid var(--border-strong); border-radius: 6px; padding: .4rem .5rem; width: 100%; }
.lp-one .gen-buttons { margin-top: .6rem; }
${HUES.map(([h, s], i) => `.lp-g${i} { background: hsla(${h}, ${s}%, 55%, .18); border-color: hsla(${h}, ${s}%, 45%, .9); color: var(--text); }
.lp-over.lp-g${i} { color: hsla(${h}, ${s}%, 45%, .9); background-color: transparent; }`).join('\n')}
`;

// The cable tiles' channels, on a 28-unit cell, unturned (as the tiles are drawn in their README).
const GLYPH = {
  blank: 'M3 3H25V25H3Z',          // only the lid's outline: a blank has no channel
  straight: 'M0 14H28',
  corner: 'M14 28V21Q14 14 21 14H28',
  tee: 'M0 14H28M14 14V28',
  cross: 'M0 14H28M14 0V28',
  drop: 'M0 14H28',
};
function glyph(name, r = 0) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 28 28');
  s.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('transform', `rotate(${90 * r} 14 14)`);
  if (GLYPH[name]) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', GLYPH[name]);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-opacity', '.35');
    p.setAttribute('stroke-width', name === 'blank' ? '1' : '9');
    g.append(p);
  }
  if (name === 'drop') {
    const c = document.createElementNS(ns, 'circle');
    Object.entries({ cx: 14, cy: 14, r: 5.5, fill: 'currentColor', 'fill-opacity': '.6' }).forEach(([k, v]) => c.setAttribute(k, v));
    g.append(c);
  }
  s.append(g);
  return s;
}

function load(cat) {
  if (location.hash.length > 1) return decode(decodeURIComponent(location.hash.slice(1)), cat);
  try { const t = localStorage.getItem(STORE); if (t) return decode(t, cat); } catch { /* storage blocked */ }
  return decode('5x5', cat);
}

async function mount(root) {
  root.textContent = 'Loading the planner…';
  let cat, groups, onePiece, gridParams;
  try {
    const r = await fetch(new URL('modules.json', import.meta.url));
    if (!r.ok) throw new Error('could not load the case list');
    const json = await r.json();
    cat = catalogue(json);
    groups = json.groups;
    const op = await fetch(new URL('one-piece/parts.json', import.meta.url));
    if (!op.ok) throw new Error('could not load the one-piece case data');
    onePiece = await op.json();
    const gp = await fetch(new URL('../opengrid-board/opengrid-params.json', import.meta.url));
    if (!gp.ok) throw new Error('could not load the openGrid board data');
    gridParams = await gp.json();
  } catch (e) {
    loadFailed(root, e.message);
    return;
  }
  useStyles();
  document.head.append(el('style', {}, CSS));
  const hue = new Map(groups.map((g, i) => [g.name, g.name === 'Cable tiles' ? GREY : i % GREY]));
  const thumb = (zip) => new URL(`../cases/case-${zip}.png`, import.meta.url).href;
  const zipUrl = (zip) => new URL(`../cases/case-${zip}.zip`, import.meta.url).href;

  let L = load(cat);
  let sel = null;            // { kind: 'palette', id, r } or { kind: 'piece', uid }
  let drag = null;
  const cursor = { x: 0, y: 0 };   // where the keyboard places a case picked from the list

  // ---- skeleton
  const cols = field('Columns (cells)', { min: 1, max: MAX_CELLS, step: 1, value: L.cols });
  const rows = field('Rows (cells)', { min: 1, max: MAX_CELLS, step: 1, value: L.rows });
  const bFill = el('button', { type: 'button', class: 'secondary' }, 'Fill empty cells with blanks');
  const bClear = el('button', { type: 'button', class: 'secondary' }, 'Clear');
  const palette = el('div', { class: 'lp-palette', role: 'list', 'aria-label': 'Cases' });
  const grid = el('div', { class: 'lp-grid', role: 'application', 'aria-label': 'Panel grid', tabindex: '0' });
  const status = el('div', { class: 'lp-status', 'aria-live': 'polite' });
  const facts = el('ul', { class: 'gen-facts', 'aria-live': 'polite' });
  const parts = el('div');
  // the one-piece case: the bed it has to fit, and the build, kept until the layout or the bed changes
  let bed0 = { x: BED, y: BED };
  let back0 = 'snaps';
  try {
    const b = JSON.parse(localStorage.getItem(BED_STORE));
    if (b?.x > 0 && b?.y > 0) bed0 = { x: b.x, y: b.y };
    if (BACKS[b?.back]) back0 = b.back;
  } catch { /* none kept */ }
  const bedX = field('Printer bed width (mm)', { min: 50, max: 1000, step: 1, value: bed0.x });
  const bedY = field('Printer bed depth (mm)', { min: 50, max: 1000, step: 1, value: bed0.y });
  const backSel = el('select', {});
  for (const [k, label] of Object.entries(BACKS)) {
    const o = el('option', { value: k }, label);
    if (k === back0) o.selected = true;
    backSel.append(o);
  }
  const backField = el('label', {}, 'Back of the tray', backSel);
  const oneFacts = el('ul', { class: 'gen-facts', 'aria-live': 'polite' });
  const bMake = el('button', { type: 'button' }, 'Make the one-piece case');
  const oneButtons = el('div', { class: 'gen-buttons' }, bMake);
  const one = el('div', { class: 'lp-one' },
    el('h4', { style: 'margin:.9rem 0 .2rem' }, 'Or print it as one piece'),
    el('p', {}, 'One tray and one lid for the whole panel, instead of a case per board. The boards sit on the same supports ' +
                'as in their own cases, and the lid has every cut-out. The tray\'s back can snap onto an openGrid board ' +
                'like the separate cases, be plain and flat, or have an openGrid board built in. ' +
                'It covers the rectangle round everything you placed; cells with nothing on them are left hollow under the lid.'),
    el('div', { class: 'gen-controls' }, bedX.node, bedY.node, backField), oneFacts, oneButtons);
  let built = null;           // { key, tray, lid }
  root.textContent = '';
  root.className = 'gen';
  root.append(el('div', { class: 'gen-controls' }, cols.node, rows.node),
              el('div', { class: 'gen-buttons', style: 'margin-top:.6rem' }, bFill, bClear),
              el('div', { class: 'lp' }, palette, el('div', { class: 'lp-board' }, grid, status, facts, parts, one)));

  for (const g of groups) {
    palette.append(el('h4', {}, g.name));
    for (const m of g.modules) {
      const pic = m.glyph ? glyph(m.glyph) : m.zip ? el('img', { src: thumb(m.zip), alt: '', draggable: 'false' })
                                          : el('span', { class: 'lp-nocase' }, 'no case yet');
      const b = el('button', { type: 'button', class: `lp-item`, 'data-id': m.id, 'aria-pressed': 'false', role: 'listitem',
                              title: m.nocase || m.fits }, pic, el('span', {}, m.name), el('span', { class: 'lp-size' }, `${m.w} × ${m.h}`));
      if (m.glyph) b.querySelector('svg').classList.add(`lp-g${hue.get(g.name)}`);
      palette.append(b);
    }
  }

  // ---- geometry helpers
  const cellPx = () => grid.getBoundingClientRect().width / L.cols;
  const pct = (v, n) => `${(100 * v) / n}%`;
  const box = (e, x, y, w, h) => Object.assign(e.style, { left: pct(x, L.cols), top: pct(y, L.rows), width: pct(w, L.cols), height: pct(h, L.rows) });
  const cellAt = (cx, cy) => {
    const rc = grid.getBoundingClientRect(), s = rc.width / L.cols;
    return { x: Math.floor((cx - rc.left) / s), y: Math.floor((cy - rc.top) / s),
             inside: cx >= rc.left - s / 2 && cx <= rc.right + s / 2 && cy >= rc.top - s / 2 && cy <= rc.bottom + s / 2 };
  };

  // a mark on the piece's edge for each port: grey goes up through the lid, green out sideways, red blocked
  function portMarks(p, ports, bx, by, bw, bh) {
    const P = onePiece.pitch;
    for (const q of ports) {
      const along = q.side === 'N' || q.side === 'S';
      const f0 = (q.a0 - (along ? bx : by) * P) / ((along ? bw : bh) * P), f1 = (q.a1 - (along ? bx : by) * P) / ((along ? bw : bh) * P);
      const m = el('span', { class: `lp-port lp-port-${q.side} lp-port-${q.top ? 'top' : q.ok ? 'ok' : 'bad'}`,
                             title: q.top ? 'lead slot, open through the lid' : q.ok ? 'lead exit' : `lead exit, blocked by ${q.into.join(' and ')}` });
      Object.assign(m.style, along ? { left: `${100 * f0}%`, width: `${100 * (f1 - f0)}%` } : { top: `${100 * f0}%`, height: `${100 * (f1 - f0)}%` });
      p.append(m);
    }
  }

  function pieceEl(it, mod, leads) {
    const p = el('div', { class: `lp-piece lp-g${hue.get(mod.group)}`, 'data-uid': String(it.uid), title: mod.fits });
    const c = cellsAt(mod, it.x, it.y, it.r);
    // the body's own box, inside the overhang-inclusive one
    const bx = Math.min(...c.occ.map((q) => q[0])), by = Math.min(...c.occ.map((q) => q[1]));
    const bw = Math.max(...c.occ.map((q) => q[0])) - bx + 1, bh = Math.max(...c.occ.map((q) => q[1])) - by + 1;
    box(p, bx, by, bw, bh);
    if (mod.glyph) { p.classList.add('lp-tile'); p.append(glyph(mod.glyph, it.r)); p.setAttribute('aria-label', `${mod.name}, turned ${it.r * 90}°`); }
    else p.append(el('span', {}, mod.name), el('small', {}, `${bw} × ${bh}`));
    if (leads) {
      portMarks(p, leads.ports.filter((q) => q.it === it), bx, by, bw, bh);
      if (leads.cutOff.some((k) => k.it === it)) p.classList.add('lp-cut');
    }
    if (mod.edge) p.append(el('span', { class: `lp-edge lp-edge-${'NESW'[('NESW'.indexOf(mod.edge) + it.r) % 4]}` }, mod.edgeWhat || ''));
    return { p, c };
  }

  // ---- render
  function render() {
    grid.style.aspectRatio = `${L.cols} / ${L.rows}`;
    grid.style.maxWidth = `${L.cols * 76}px`;
    grid.style.backgroundSize = `${100 / L.cols}% ${100 / L.rows}%`;
    grid.textContent = '';
    const leads = leadCheck(L, cat, onePiece);
    for (const it of L.items) {
      const mod = cat.get(it.id);
      const { p, c } = pieceEl(it, mod, leads);
      for (const q of c.over) {
        if (q[0] < 0 || q[1] < 0 || q[0] >= L.cols || q[1] >= L.rows) continue;   // off the board: it takes nothing
        const o = el('div', { class: `lp-over lp-g${hue.get(mod.group)}` });
        box(o, q[0], q[1], 1, 1);
        grid.append(o);
      }
      if (sel?.kind === 'piece' && sel.uid === it.uid) p.classList.add('lp-sel');
      if (c.occ.some(([a, b]) => a >= L.cols || b >= L.rows)) p.classList.add('lp-off');
      if (drag?.moved && drag.uid === it.uid) p.classList.add('lp-dragging');
      grid.append(p);
    }
    for (const b of palette.querySelectorAll('.lp-item'))
      b.setAttribute('aria-pressed', String(sel?.kind === 'palette' && sel.id === b.dataset.id));
    renderStatus();
    renderFacts();
    renderOnePiece();
  }

  function renderStatus() {
    status.textContent = '';
    if (sel?.kind === 'palette') {
      const m = cat.get(sel.id);
      status.append(`${m.name}: click a cell to place it (or arrow keys and Enter). `,
                    btn('Turn (R)', () => { sel.r = (sel.r + 1) % 4; renderStatus(); }),
                    btn('Cancel (Esc)', () => { sel = null; hidePreview(); render(); }));
    } else if (sel?.kind === 'piece') {
      const it = L.items.find((i) => i.uid === sel.uid);
      if (!it) { sel = null; return renderStatus(); }
      status.append(`${cat.get(it.id).name} selected. Arrow keys move it. `,
                    btn('Turn (R)', () => turnSelected()), btn('Remove (Del)', () => { remove(L, it.uid); sel = null; changed(); }));
    } else {
      status.append('Drag a case onto the grid, or pick one and click a cell.');
    }
  }
  const btn = (label, fn) => { const b = el('button', { type: 'button', class: 'secondary' }, label); b.addEventListener('click', fn); return b; };

  function renderFacts() {
    facts.textContent = '';
    const free = freeCells(L, cat).length, total = L.cols * L.rows;
    facts.append(el('li', {}, `${total - free} of ${total} cells taken, ${free} free.`));
    for (const w of warnings(L, cat)) facts.append(el('li', { class: 'gen-warn' }, w));
    for (const w of leadWarnings(L, cat, onePiece)) facts.append(el('li', { class: 'gen-warn' }, w));
    parts.textContent = '';
    const { parts: list } = partsList(L, cat);
    if (!list.length) return;
    const t = el('table', { class: 'lp-parts' });
    t.append(el('tr', {}, el('th', {}, 'Print'), el('th', {}, 'Count'), el('th', {}, 'Download')));
    const shown = new Set();
    for (const m of list) {
      const dl = !m.zip ? el('span', { class: 'gen-warn', title: m.nocase }, 'not designed yet')
               : shown.has(m.zip) ? el('span', {}, 'same zip') : el('a', { href: zipUrl(m.zip), download: '' }, `case-${m.zip}.zip`);
      shown.add(m.zip);
      t.append(el('tr', {}, el('td', {}, m.group === 'Cable tiles' ? `Cable tile, ${m.name.toLowerCase()}` : `${m.name} case`),
                  el('td', {}, String(m.count)), el('td', {}, dl)));
    }
    t.append(el('tr', {}, el('td', {}, `openGrid board, ${L.cols} × ${L.rows}`), el('td', {}, '1'),
                el('td', {}, el('a', { href: `opengrid-board.html?cols=${L.cols}&rows=${L.rows}` }, 'make it'))));
    // the back plate is optional: it holds the cables behind the board, on standoffs that snap into its back
    const plateLink = () => el('a', { href: `back-plate.html?cols=${L.cols}&rows=${L.rows}` }, 'make it');
    t.append(el('tr', {}, el('td', {}, `Back plate, ${L.cols} × ${L.rows} (optional, holds the cables behind)`), el('td', {}, '1'),
                el('td', {}, plateLink())));
    t.append(el('tr', {}, el('td', {}, 'Back plate standoffs (with the back plate)'),
                el('td', {}, String(standoffCount(L.cols, L.rows))), el('td', {}, plateLink())));
    parts.append(el('h4', { style: 'margin:.9rem 0 .2rem' }, 'Parts to print'), t);
  }

  const bed = () => ({ x: Math.round(+bedX.input.value), y: Math.round(+bedY.input.value) });
  const back = () => backSel.value;
  const buildKey = () => `${encode(L)}|${bed().x}x${bed().y}|${back()}`;
  function renderOnePiece() {
    oneFacts.textContent = '';
    oneButtons.textContent = '';
    oneButtons.append(bMake);
    const b = bed();
    const bad = !(b.x >= 50 && b.y >= 50) ? ['Set the size of your printer\'s bed.'] : onePieceProblems(L, cat, onePiece, b, back());
    bMake.disabled = bad.length > 0;
    for (const w of bad) oneFacts.append(el('li', { class: 'gen-warn' }, w));
    if (bad.length) return;
    const fp = footprint(L, cat), { w, h } = sizeMm(fp, onePiece, back());
    const tall = +heightMm(onePiece, back(), gridParams).toFixed(1);
    oneFacts.append(el('li', {}, `${fp.cols} × ${fp.rows} cells: ${w} × ${h} mm, ${tall} mm tall` +
                                 { snaps: `, snaps included. Fits your bed.`, plain: '. Fits your bed.',
                                   board: ` with the board. Fits your bed, and needs no separate openGrid board.` }[back()]));
    // only what differs from the warnings above: in one piece a blank is hollow, so it may block less
    const above = new Set(leadWarnings(L, cat, onePiece));
    for (const w of leadWarnings(L, cat, onePiece, true)) if (!above.has(w)) oneFacts.append(el('li', { class: 'gen-warn' }, w));
    if (built?.key === buildKey()) {
      const name = `one-piece-${fp.cols}x${fp.rows}${back() === 'snaps' ? '' : `-${back()}`}`;
      oneButtons.textContent = '';
      oneButtons.append(btnMain('Download tray STL', () => download(toStl(built.tray, `${name} tray`), `${name}-tray.stl`)),
                        btn('Download lid STL', () => download(toStl(built.lid, `${name} lid`), `${name}-lid.stl`)));
      oneFacts.append(el('li', {}, 'The lid STL is turned top-down for printing, like every case lid.'));
    }
  }
  const btnMain = (label, fn) => { const b = el('button', { type: 'button' }, label); b.addEventListener('click', fn); return b; };
  bMake.addEventListener('click', async () => {
    const key = buildKey();
    bMake.disabled = true;
    bMake.textContent = 'Building…';
    try {
      const [{ default: Module }, bin] = await Promise.all([
        import('../vendor/manifold-3d/manifold.js'),
        fetch(new URL('one-piece/parts.bin', import.meta.url)).then((r) => { if (!r.ok) throw new Error('could not load the case pieces'); return r.arrayBuffer(); }),
      ]);
      const M = await Module();
      M.setup();
      const r = buildOnePiece(M, L, cat, onePiece, bin, back(), gridParams);
      if (r.status.some((s) => s !== 'NoError')) throw new Error(r.status.join(', '));
      if (key === buildKey()) built = { key, tray: r.tray, lid: r.lid };
    } catch (e) {
      oneFacts.append(el('li', { class: 'gen-bad' }, `The case did not build (${e.message}).`));
      bMake.textContent = 'Make the one-piece case';
      bMake.disabled = false;
      return;
    }
    bMake.textContent = 'Make the one-piece case';
    renderOnePiece();
  });
  const keep = () => {
    try { localStorage.setItem(BED_STORE, JSON.stringify({ ...bed(), back: back() })); } catch { /* storage blocked */ }
    renderOnePiece();
  };
  for (const f of [bedX, bedY]) f.input.addEventListener('input', keep);
  backSel.addEventListener('change', keep);

  // ---- state changes
  function changed() {
    const text = encode(L);
    try { history.replaceState(null, '', `#${text}`); } catch { /* sandboxed */ }
    try { localStorage.setItem(STORE, text); } catch { /* storage blocked */ }
    render();
  }

  function turnSelected() {
    const it = L.items.find((i) => i.uid === sel?.uid);
    if (!it) return;
    const r = (it.r + 1) % 4;
    // turn in place if it fits; the anchor is the top-left, so a long case pivots on its corner
    if (move(L, cat, it.uid, it.x, it.y, r)) return changed();
    flash(`${cat.get(it.id).name} has no room to turn there.`);
  }
  function flash(msg) { status.textContent = msg; setTimeout(renderStatus, 3000); }

  // ---- preview outline
  let preview = null;
  function showPreview(id, x, y, r, ignore) {
    const mod = cat.get(id), s = shape(mod, r);
    if (!preview) { preview = el('div', { class: 'lp-preview' }); }
    grid.append(preview);
    box(preview, x, y, s.w, s.h);
    preview.classList.toggle('lp-bad', !!conflict(L, cat, id, x, y, r, ignore));
  }
  function hidePreview() { preview?.remove(); }

  // ---- pointer: drag from the list, drag a placed case, or click
  // (the browser's own drag, of a thumbnail or a text selection, would cancel the pointer events)
  for (const t of [palette, grid]) t.addEventListener('dragstart', (e) => e.preventDefault());
  function startPress(e, info) {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { ...info, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
    e.preventDefault();
  }
  palette.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.lp-item');
    if (!b) return;
    const keep = sel?.kind === 'palette' && sel.id === b.dataset.id ? sel.r : 0;
    startPress(e, { id: b.dataset.id, r: keep, uid: null, gx: 0, gy: 0, src: b });
  });
  grid.addEventListener('pointerdown', (e) => {
    const p = e.target.closest('.lp-piece');
    if (!p) return;
    const it = L.items.find((i) => i.uid === +p.dataset.uid);
    const c = cellAt(e.clientX, e.clientY);
    startPress(e, { id: it.id, r: it.r, uid: it.uid, gx: c.x - it.x, gy: c.y - it.y, src: p });
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) {
      // hover preview while a case is picked from the list
      if (sel?.kind === 'palette' && e.target.closest?.('.lp-grid') === grid) {
        const c = cellAt(e.clientX, e.clientY);
        showPreview(sel.id, c.x, c.y, sel.r);
      }
      return;
    }
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      const mod = cat.get(drag.id);
      drag.ghost = pieceEl({ uid: 0, id: drag.id, x: 0, y: 0, r: drag.r }, mod).p;
      drag.ghost.classList.add('lp-ghost');
      document.body.append(drag.ghost);
      if (drag.uid) drag.src.classList.add('lp-dragging');
    }
    const s = cellPx(), sh = shape(cat.get(drag.id), drag.r);
    Object.assign(drag.ghost.style, { width: `${sh.w * s}px`, height: `${sh.h * s}px`,
                                      left: `${e.clientX - (drag.gx + 0.5) * s}px`, top: `${e.clientY - (drag.gy + 0.5) * s}px` });
    const c = cellAt(e.clientX, e.clientY);
    drag.over = c.inside;
    drag.x = c.x - drag.gx; drag.y = c.y - drag.gy;
    if (c.inside) showPreview(drag.id, drag.x, drag.y, drag.r, drag.uid); else hidePreview();
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    d.ghost?.remove();
    hidePreview();
    if (!d.moved) {
      // a click: pick it (or let go of it)
      if (d.uid) sel = sel?.kind === 'piece' && sel.uid === d.uid ? null : { kind: 'piece', uid: d.uid };
      else sel = sel?.kind === 'palette' && sel.id === d.id ? null : { kind: 'palette', id: d.id, r: d.r };
      grid.focus({ preventScroll: true });
      return render();
    }
    grid.focus({ preventScroll: true });
    if (d.uid && !d.over) { remove(L, d.uid); sel = null; return changed(); }
    if (!d.over) return render();
    if (d.uid) {
      if (move(L, cat, d.uid, d.x, d.y, d.r)) { sel = { kind: 'piece', uid: d.uid }; return changed(); }
    } else {
      const it = place(L, cat, d.id, d.x, d.y, d.r);
      if (it) { sel = { kind: 'piece', uid: it.uid }; return changed(); }
    }
    const why = conflict(L, cat, d.id, d.x, d.y, d.r, d.uid);
    render();
    flash(`That spot is taken: ${why}.`);
  });
  window.addEventListener('pointercancel', () => { drag?.ghost?.remove(); drag = null; hidePreview(); render(); });

  // a click on an empty cell with a case picked from the list places it there
  grid.addEventListener('click', (e) => {
    if (sel?.kind !== 'palette' || e.target.closest('.lp-piece')) return;
    const c = cellAt(e.clientX, e.clientY);
    const it = place(L, cat, sel.id, c.x, c.y, sel.r);
    if (!it) return flash(`It doesn't fit there: ${conflict(L, cat, sel.id, c.x, c.y, sel.r)}.`);
    sel = { kind: 'piece', uid: it.uid };
    hidePreview();
    changed();
  });
  grid.addEventListener('pointerleave', () => { if (!drag) hidePreview(); });

  // ---- keyboard
  // Enter or Space on a list entry picks it (a pointer press is handled above)
  palette.addEventListener('click', (e) => {
    const b = e.target.closest('.lp-item');
    if (!b || e.detail !== 0) return;
    sel = sel?.kind === 'palette' && sel.id === b.dataset.id ? null : { kind: 'palette', id: b.dataset.id, r: 0 };
    render();
    if (sel) { grid.focus(); showPreview(sel.id, cursor.x, cursor.y, sel.r); }
  });
  // on the document, so R still turns the case just dropped wherever focus went; only while one is picked
  document.addEventListener('keydown', (e) => {
    if (!sel && !drag) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (sel?.kind === 'palette' && document.activeElement === grid) {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (step) {
        e.preventDefault();
        cursor.x = Math.min(L.cols - 1, Math.max(0, cursor.x + step[0]));
        cursor.y = Math.min(L.rows - 1, Math.max(0, cursor.y + step[1]));
        return showPreview(sel.id, cursor.x, cursor.y, sel.r);
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const it = place(L, cat, sel.id, cursor.x, cursor.y, sel.r);
        if (!it) return flash(`It doesn't fit there: ${conflict(L, cat, sel.id, cursor.x, cursor.y, sel.r)}.`);
        sel = { kind: 'piece', uid: it.uid };
        hidePreview();
        return changed();
      }
    }
    if (drag?.moved && (e.key === 'r' || e.key === 'R')) { drag.r = (drag.r + 1) % 4; e.preventDefault(); return; }
    if (e.key === 'Escape') { sel = null; hidePreview(); render(); return; }
    if (sel?.kind === 'palette' && (e.key === 'r' || e.key === 'R')) {
      sel.r = (sel.r + 1) % 4; e.preventDefault();
      if (document.activeElement === grid) showPreview(sel.id, cursor.x, cursor.y, sel.r);
      return;
    }
    if (sel?.kind !== 'piece') return;
    const it = L.items.find((i) => i.uid === sel.uid);
    if (!it) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) { e.preventDefault(); if (move(L, cat, it.uid, it.x + step[0], it.y + step[1], it.r)) changed(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); turnSelected(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(L, it.uid); sel = null; changed(); }
  });

  // ---- controls
  const resize = () => {
    const c = Math.round(+cols.input.value), r = Math.round(+rows.input.value);
    if (!(c >= 1 && c <= MAX_CELLS && r >= 1 && r <= MAX_CELLS)) return;
    L.cols = c; L.rows = r;
    changed();
  };
  cols.input.addEventListener('input', resize);
  rows.input.addEventListener('input', resize);
  bFill.addEventListener('click', () => { const n = fillBlanks(L, cat); if (!n) flash('There are no empty cells.'); else changed(); });
  bClear.addEventListener('click', () => { L.items = []; sel = null; changed(); });
  window.addEventListener('hashchange', () => {
    L = load(cat); sel = null;
    cols.input.value = L.cols; rows.input.value = L.rows;
    render();
  });
  render();
}

const root = document.getElementById('layout-planner');
if (root) mount(root);
