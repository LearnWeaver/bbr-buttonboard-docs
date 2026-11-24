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
import { coverPlate, extent, deckProblems, deckSize, keySites, pockets, buildDeck, trayGaps, TRAY_SIDES, buildCover, coverProblems, pegSites } from './deck-model.js';
import { useStyles, el, field, loadFailed, download, BED } from '../generators/ui.js';
import { toStl, toStep } from '../generators/mesh.js';
import { leadCheck, leadWarnings, leadRoutes } from './leads.js';
import { standoffCount } from '../back-plate/backplate-mesh.js';

const STORE = 'bb-layout';
const BED_STORE = 'bb-bed';
const VIEW_STORE = 'bb-view';     // { tab: 'build' | '2d' | 'labels' | 'leads', style: 'opengrid' | 'lowpro', xray }
const TABS = [['build', 'Build'], ['2d', '2D plan'], ['labels', 'Labels'], ['leads', 'Leads']];
// The one-piece case is hidden for now: the section under the parts list is
// left off the page. Its data still loads, since the lead checks use it.
// Set true, and restore the section in getting-started/layout.md, to bring it back.
const ONE_PIECE = false;
// The low-profile deck (deck-model.js): a plate the low-profile cases press onto. Set false to take
// its section off the page, and its paragraph out of getting-started/layout.md.
const DECK = true;
const STEP = 'model/step';
const STEP_NOTE = 'The STEP is the same part, lying the same way, in millimetres: open it in CAD to add labels. ' +
                  'Each flat area is one face to sketch on; round holes and pegs stay faceted.';
// what the deck covers (deck-model.js COVERS; 'cases' is left off: it comes apart where cells are empty)
const COVER = { board: 'The whole board', rect: 'Just round the cases' };
// the deck's cable trays (§86), by the edge of the board as drawn on the page
const TRAY_NAMES = { N: 'Top', E: 'Right', S: 'Bottom', W: 'Left' };
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
.lp-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--bg-subtle); border: 1px solid var(--border); }
.gen .lp-seg button { border: 0; background: transparent; color: var(--text-muted); padding: .4rem .75rem; border-radius: 7px; font-size: .85rem; font-weight: 500; }
.gen .lp-seg button[aria-pressed="true"] { background: var(--bg); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.lp-3d { position: relative; width: 100%; border-radius: 10px; overflow: hidden;
         border: 1px solid var(--border-strong); background: #1b1e24; touch-action: none; user-select: none; }
.lp-3d canvas { display: block; }
.lp-3d:fullscreen { height: 100vh; border: 0; border-radius: 0; }
.lp-3d-cam { position: absolute; top: .5rem; right: .5rem; display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #262a32; }
.gen .lp-3d-cam button { border: 0; background: transparent; color: #d9dce2; padding: .35rem .6rem; border-radius: 6px; font-size: .8rem; }
.gen .lp-3d-cam button:hover { background: #343944; }
.lp-3d-hint { position: absolute; left: .5rem; bottom: .5rem; padding: .3rem .55rem; border-radius: 6px; background: #262a32;
              color: #c9cdd4; font-size: .78rem; pointer-events: none; }
.lp-3d-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #c9cdd4; font-size: .9rem; }
/* the planner as an app: header, then cases | view | details, filling the window under the site's top bar */
.gen.lp-app { border: 0; border-radius: 0; padding: 0; margin: 0; background: var(--bg-subtle);
              display: flex; flex-direction: column; height: calc(100vh - var(--topbar-h)); min-height: 600px; }
.lp-head { display: flex; align-items: center; gap: .9rem 1.2rem; flex-wrap: wrap; padding: .6rem 1.1rem;
           background: var(--bg); border-bottom: 1px solid var(--border); }
.lp-title { display: flex; flex-direction: column; min-width: 0; }
.prose .lp-title h2 { margin: 0; padding: 0; border: 0; font-size: 1.05rem; line-height: 1.3; }
.lp-sub { font-size: .75rem; color: var(--text-muted); }
.lp-gap { flex: 1; }
.lp-tabs { display: flex; gap: 3px; flex-wrap: wrap; }
.gen .lp-tabs button { border: 0; background: transparent; color: var(--text-muted); padding: .45rem .85rem; border-radius: 8px; font-size: .88rem; font-weight: 500; }
.gen .lp-tabs button:hover { background: var(--bg-subtle); color: var(--text); }
.gen .lp-tabs button[aria-current="page"] { background: var(--text); color: var(--bg); }
.gen .lp-toggle { border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); padding: .4rem .75rem;
                  border-radius: 8px; font-size: .84rem; font-weight: 500; }
.gen .lp-toggle:hover { border-color: var(--accent); }
.gen .lp-toggle[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.lp-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 15.5rem minmax(0, 1fr) 20rem; }
.lp-left, .lp-right { overflow-y: auto; background: var(--bg); padding: .9rem .8rem; }
.lp-left { border-right: 1px solid var(--border); }
.lp-right { border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: .75rem; }
.prose .lp-app h3 { margin: 0 0 .45rem; padding: 0; font-size: .92rem; border: 0; }
.prose .lp-app p { margin: 0 0 .5rem; }
.lp-hint { font-size: .8rem; color: var(--text-muted); }
.gen.lp-app .lp-palette { max-height: none; overflow: visible; padding: 0; }
.lp-center { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: .6rem; padding: .75rem 1rem; }
.lp-tools { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.gen .lp-size { display: inline-flex; flex-direction: row; align-items: center; gap: .35rem; font-size: .84rem; color: var(--text-muted); }
.gen .lp-size input { width: 3.4rem; padding: .3rem .4rem; font-size: .88rem; }
.lp-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.lp-stage .lp-grid { margin: 0 auto; }
.gen.lp-app .lp-3d { height: 100%; }
.gen.lp-app .lp-status { margin: 0; min-height: 1.3rem; font-size: .82rem; }
.lp-card { border: 1px solid var(--border); border-radius: 10px; padding: .75rem .8rem; background: var(--bg); }
.lp-right > .lp-card:first-child { background: var(--bg-subtle); }
.lp-chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .4rem; margin-bottom: .6rem; }
.lp-chip { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: .35rem .55rem; font-size: .75rem; color: var(--text-muted); }
.lp-chip b { display: block; color: var(--text); font-size: .85rem; font-weight: 600; }
.lp-card .gen-buttons button { padding: .4rem .75rem; font-size: .84rem; }
.lp-card ul { list-style: none; margin: 0; padding: 0; }
.lp-card li { position: relative; padding: .15rem 0 .15rem 1rem; font-size: .82rem; line-height: 1.4; }
.lp-warn::before, .lp-ok::before { content: ''; position: absolute; left: 0; top: .55rem; width: .5rem; height: .5rem; border-radius: 50%; }
.lp-warn::before { background: var(--hint-warning-bd); } .lp-ok::before { background: var(--hint-success-bd); }
.lp-legend li { padding-left: 0; display: flex; align-items: center; gap: .5rem; }
.lp-swatch { width: .9rem; height: .55rem; border-radius: 2px; flex: none; }
.lp-label-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .35rem; margin-bottom: .4rem; }
.gen .lp-label-grid input { padding: .35rem .45rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
.lp-labels { display: flex; flex-direction: column; gap: .75rem; }
.lp-parts { width: 100%; border-collapse: collapse; font-size: .8rem; }
.prose .lp-parts td { padding: .3rem .2rem; border: 0; border-bottom: 1px solid var(--border); background: none; }
.prose .lp-parts td:nth-child(2) { color: var(--text-muted); white-space: nowrap; }
.prose .lp-parts td:last-child { text-align: right; }
.lp-more { margin-top: .7rem; font-size: .82rem; }
.lp-more summary { cursor: pointer; font-weight: 600; }
.lp-more[open] summary { margin-bottom: .5rem; }
.lp-form { display: flex; flex-direction: column; gap: .45rem; margin-bottom: .6rem; }
.lp-row { display: grid; grid-template-columns: 3.4rem minmax(0, 1fr); align-items: center; gap: .5rem; }
.lp-row-k { color: var(--text-muted); }
.lp-row-stack { grid-template-columns: 1fr; gap: .25rem; }
.lp-row-v { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .6rem; min-width: 0; }
.gen .lp-row-v input[type=number] { width: 4.2rem; padding: .3rem .4rem; font-size: .84rem; }
.gen .lp-row-v select { width: 100%; padding: .3rem .4rem; font-size: .84rem; }
.gen .lp-check { display: inline-flex; flex-direction: row; align-items: center; gap: .3rem; font-size: .82rem; color: var(--text); }
.gen .lp-check input { width: auto; margin: 0; }
.lp-deck-facts { margin-bottom: .5rem !important; }
.lp-more .gen-buttons button { padding: .4rem .7rem; font-size: .82rem; }
@media (max-width: 1100px) {
  .gen.lp-app { height: auto; }
  .lp-body { grid-template-columns: 1fr; }
  .lp-left .lp-palette { display: flex; gap: .4rem; overflow-x: auto; }
  .lp-left .lp-palette h4 { display: none; }
  .gen .lp-left .lp-item { width: auto; flex: none; }
  .gen.lp-app .lp-3d { height: 60vh; }
}
.gen .lp-one select { font: inherit; font-size: .95rem; color: var(--text); background: var(--bg);
                      border: 1px solid var(--border-strong); border-radius: 6px; padding: .4rem .5rem; width: 100%; }
.lp-one .gen-buttons { margin-top: .6rem; }
.lp-one + .lp-one { margin-top: .4rem; }
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
  let cat, groups, onePiece, gridParams, deckData;
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
    const dk = await fetch(new URL('lowpro/deck.json', import.meta.url));
    if (!dk.ok) throw new Error('could not load the low-profile deck data');
    deckData = await dk.json();
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
  const num = (label, value) => { const input = el('input', { type: 'number', min: 1, max: MAX_CELLS, step: 1, value, 'aria-label': label }); return { input }; };
  const cols = num('Board columns', L.cols), rows = num('Board rows', L.rows);
  const bFill = el('button', { type: 'button', class: 'lp-toggle', title: 'Put a blank cable tile in every free cell' }, 'Fill with blanks');
  const bClear = el('button', { type: 'button', class: 'lp-toggle' }, 'Clear');
  const palette = el('div', { class: 'lp-palette', role: 'list', 'aria-label': 'Cases' });
  const grid = el('div', { class: 'lp-grid', role: 'application', 'aria-label': 'Panel grid', tabindex: '0' });
  const status = el('div', { class: 'lp-status', 'aria-live': 'polite' });
  const labelSec = el('div', { class: 'lp-labels', hidden: '' });
  // the 3D view (view3d.js), loaded the first time it is asked for; the layout and its rules stay here
  let view = { tab: 'build', style: 'opengrid', xray: false, showCover: true };
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_STORE));
    if (v) view = { ...view, ...v, tab: TABS.some(([k]) => k === v.tab) ? v.tab : v.mode === '2d' ? '2d' : 'build' };
  } catch { /* none kept */ }
  let v3 = null, v3Loading = null;
  // the case models and the label font, shared by the 3D view and the key labels; loaded when first needed
  let kitP = null;
  const loadKit = () => (kitP ??= Promise.all([
    import('./view3d.js').then((m) => m.loadModels()), import('../vendor/three/FontLoader.js'), import('./labels.js'),
    fetch(new URL('../vendor/three/droid_sans_bold_labels.typeface.json', import.meta.url)).then((r) => { if (!r.ok) throw new Error('could not load the label font'); return r.json(); }),
  ]).then(([models, { Font }, labels, fj]) => ({ models, font: new Font(fj), labels })));
  const inset = onePiece.rim + onePiece.lid_clr;      // case outline to the lid's visible edge (mm_case RIM + LID_CLR)
  const is3d = () => view.tab !== '2d' && v3;
  const leadsOn = () => view.tab === 'leads';
  // the cover over the panel in 3D: the key labels are on it then, not on the lids under it
  const coverOn = () => view.style === 'lowpro' && view.tab === 'build' && view.showCover && lidBox?.checked;
  const box3d = el('div', { class: 'lp-3d', role: 'application', 'aria-label': 'Panel in 3D: drag to turn the view', tabindex: '0' });
  const hint3d = el('div', { class: 'lp-3d-hint' });
  const seg = (label, items, cur, pick) => {
    const g = el('div', { class: 'lp-seg', role: 'group', 'aria-label': label });
    for (const [k, text] of items) {
      const b = el('button', { type: 'button', 'aria-pressed': String(k === cur()) }, text);
      b.addEventListener('click', () => { pick(k); for (const o of g.children) o.setAttribute('aria-pressed', String(o === b)); });
      g.append(b);
    }
    return g;
  };
  const keepView = () => { try { localStorage.setItem(VIEW_STORE, JSON.stringify(view)); } catch { /* storage blocked */ } };
  const styleSeg = seg('Case style', [['opengrid', 'openGrid'], ['lowpro', 'Low profile']], () => view.style, (k) => { view.style = k; keepView(); labelUid = null; render(); });
  const tabBar = el('nav', { class: 'lp-tabs', 'aria-label': 'Planner views' });
  for (const [k, text] of TABS) {
    const b = el('button', { type: 'button', 'data-tab': k }, text);
    b.addEventListener('click', () => { view.tab = k; keepView(); labelUid = null; showView(); });
    tabBar.append(b);
  }
  const xrayBtn = el('button', { type: 'button', class: 'lp-toggle', 'aria-pressed': String(view.xray) }, 'X-ray');
  const coverBtn = el('button', { type: 'button', class: 'lp-toggle', 'aria-pressed': String(view.showCover), title: 'Show the cover over the panel' }, 'Cover');
  coverBtn.addEventListener('click', () => { view.showCover = !view.showCover; coverBtn.setAttribute('aria-pressed', String(view.showCover)); keepView(); render(); });
  xrayBtn.addEventListener('click', () => { view.xray = !view.xray; xrayBtn.setAttribute('aria-pressed', String(view.xray)); keepView(); render(); });
  // the low-profile cases' ports, from the model data, in the shape leads.js reads (one-piece/parts.json's);
  // a link block has no port data of its own, and stands in for the cable tile whose windows it copies
  const lpParts = () => {
    const cases = {};
    for (const [id, c] of Object.entries(v3models.index.cases.lowpro))
      cases[id] = { ports: c.ports || v3models.index.cases.opengrid[id]?.ports || onePiece.cases[id]?.ports };
    return { pitch: onePiece.pitch, seam: 8.5, cases };
  };
  let v3models = null;
  const routes = () => (leadsOn() && v3models ? leadRoutes(L, cat, view.style === 'lowpro' ? lpParts() : onePiece) : null);
  const cam = el('div', { class: 'lp-3d-cam', role: 'group', 'aria-label': 'Camera' });
  for (const [k, text] of [['iso', '3D'], ['top', 'Top'], ['front', 'Front']]) {
    const b = el('button', { type: 'button' }, text);
    b.addEventListener('click', () => v3?.view(k));
    cam.append(b);
  }
  if (box3d.requestFullscreen) {
    const b = el('button', { type: 'button' }, 'Full screen');
    b.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : box3d.requestFullscreen()));
    cam.append(b);
  }
  box3d.append(cam);
  async function showView() {
    const three = view.tab !== '2d';
    grid.hidden = three;
    box3d.hidden = !three;
    xrayBtn.hidden = view.tab !== 'build';
    for (const b of tabBar.children) b.setAttribute('aria-current', b.dataset.tab === view.tab ? 'page' : 'false');
    if (three && !v3) {
      if (!v3Loading) {
        const msg = el('div', { class: 'lp-3d-msg' }, 'Loading the case models…');
        box3d.append(msg);
        v3Loading = Promise.all([import('./view3d.js'), loadKit()])
          .then(([m, kit]) => {
            v3models = kit.models;
            v3 = m.createView(box3d, { ...kit.models, cat, boardT: gridParams.thickness, deckT: deckData.deck_t, font: kit.font, inset });
            box3d.prepend(v3.canvas);
            msg.remove();
          })
          .catch((e) => { msg.textContent = `The 3D view did not load (${e.message}). The 2D view still works.`; });
      }
      await v3Loading;
    }
    render();
  }
  const facts = el('ul', { class: 'gen-facts', 'aria-live': 'polite' });
  const parts = el('div');
  // the one-piece case: the bed it has to fit, and the build, kept until the layout or the bed changes
  let bed0 = { x: BED, y: BED };
  let back0 = 'snaps', cover0 = 'board', trays0 = '', lid0 = false;
  try {
    const b = JSON.parse(localStorage.getItem(BED_STORE));
    if (b?.x > 0 && b?.y > 0) bed0 = { x: b.x, y: b.y };
    if (BACKS[b?.back]) back0 = b.back;
    if (COVER[b?.cover]) cover0 = b.cover;
    if (typeof b?.trays === 'string') trays0 = TRAY_SIDES.filter((t) => b.trays.includes(t)).join('');
    lid0 = b?.lid === true;
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
    el('div', { class: 'gen-controls' }, ...(DECK ? [] : [bedX.node, bedY.node]), backField), oneFacts, oneButtons);
  let built = null;           // { key, tray, lid }
  // the low-profile deck: the same bed, and what it covers
  const coverSel = el('select', {});
  for (const [k, label] of Object.entries(COVER)) {
    const o = el('option', { value: k }, label);
    if (k === cover0) o.selected = true;
    coverSel.append(o);
  }
  const trayBoxes = Object.fromEntries(TRAY_SIDES.map((t) => [t, el('input', { type: 'checkbox' })]));
  for (const t of TRAY_SIDES) trayBoxes[t].checked = trays0.includes(t);
  const lidBox = el('input', { type: 'checkbox' });
  lidBox.checked = lid0;
  const deckFacts = el('ul', { class: 'lp-deck-facts', 'aria-live': 'polite' });
  const coverNotes = el('ul', { class: 'lp-deck-facts', 'aria-live': 'polite' });
  const bDeck = el('button', { type: 'button' }, 'Make the deck');
  const deckButtons = el('div', { class: 'gen-buttons' }, bDeck);
  for (const f of [bedX, bedY]) f.input.setAttribute('aria-label', f === bedX ? 'Printer bed width, mm' : 'Printer bed depth, mm');
  const row = (label, ...kids) => el('div', { class: 'lp-row' }, el('span', { class: 'lp-row-k' }, label), el('div', { class: 'lp-row-v' }, ...kids));
  const deckSec = el('details', { class: 'lp-more' },
    el('summary', {}, 'Deck, trays and cover'),
    el('div', { class: 'lp-form' },
      el('div', { class: 'lp-row lp-row-stack' }, el('span', { class: 'lp-row-k' }, '3D printer bed size'),
         el('div', { class: 'lp-row-v' }, bedX.input, el('span', {}, '×'), bedY.input, el('span', {}, 'mm'))),
      row('Deck', coverSel),
      row('Trays', ...TRAY_SIDES.map((t) => el('label', { class: 'lp-check' }, trayBoxes[t], TRAY_NAMES[t]))),
      row('Cover', el('label', { class: 'lp-check' }, lidBox, 'Over the whole panel'))),
    deckFacts, coverNotes, deckButtons);
  let deckBuilt = null;       // { key, mesh, pockets, cover }
  const sub = el('span', { class: 'lp-sub' });
  const bCopy = el('button', { type: 'button', class: 'lp-toggle' }, 'Copy link');
  bCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); flash('Link copied: it opens this layout, labels and all.'); }
    catch { flash('Copy the address bar: it holds this layout.'); }
  });
  const selCard = el('section', { class: 'lp-card', 'aria-live': 'polite' });
  const leadsCard = el('section', { class: 'lp-card' });
  const checks = el('section', { class: 'lp-card' }, el('h3', {}, 'Checks'), facts);
  const printCard = el('section', { class: 'lp-card' }, el('h3', {}, 'Print files'), parts, ...(DECK ? [deckSec] : []), ...(ONE_PIECE ? [one] : []));
  const stage = el('div', { class: 'lp-stage' }, grid, box3d);
  root.textContent = '';
  root.className = 'gen lp-app';
  root.append(
    el('div', { class: 'lp-head' },
       el('div', { class: 'lp-title' }, el('h2', {}, 'Plan your panel'), sub),
       tabBar, el('div', { class: 'lp-gap' }), styleSeg, bCopy),
    el('div', { class: 'lp-body' },
       el('aside', { class: 'lp-left', 'aria-label': 'Cases' }, el('h3', {}, 'Cases'), el('p', { class: 'lp-hint' }, 'Drag one onto the board.'), palette),
       el('div', { class: 'lp-center' },
          el('div', { class: 'lp-tools' },
             el('label', { class: 'lp-size' }, 'Board', cols.input, '×', rows.input), bFill, bClear, el('div', { class: 'lp-gap' }), coverBtn, xrayBtn),
          stage, status),
       el('aside', { class: 'lp-right', 'aria-label': 'Details' }, selCard, labelSec, leadsCard, checks, printCard)));

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
    if (is3d()) return v3.cellAt(cx, cy);
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
    grid.style.width = `min(100%, ${L.cols * 76}px, calc((100vh - 15rem) * ${L.cols / L.rows}))`;
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
    renderLabels();
    renderLeads();
    deckSec.hidden = view.style !== 'lowpro';
    renderFacts();
    renderOnePiece();
    renderDeck();
    if (is3d()) {
      v3.update(L, { sel: sel?.kind === 'piece' ? sel.uid : null, style: view.style, xray: view.tab === 'build' && view.xray, routes: routes(), lidLabels: !coverOn() });
      hint3d.textContent = sel?.kind === 'palette' ? 'Green fits. Click to drop, R turns it.'
        : sel?.kind === 'piece' ? 'Drag to move, off the board to remove. R turns.'
        : 'Drag to orbit · right-drag to pan · scroll to zoom';
    }
  }

  // the one-line hint under the view, and the card at the top of the right-hand panel
  function renderStatus() {
    status.textContent = sel?.kind === 'palette' ? 'Click a free slot to drop it. R turns it, Esc puts it back.'
      : sel?.kind === 'piece' ? 'Arrow keys move it, R turns it, Delete removes it.'
      : 'Drag a case from the list onto the board, or click one and then a slot.';
    selCard.textContent = '';
    if (sel?.kind === 'palette') {
      const m = cat.get(sel.id);
      selCard.append(el('h3', {}, `Placing ${m.name}`), el('div', { class: 'lp-chips' }, chip('Size', `${m.w} × ${m.h} cells`)),
                     el('div', { class: 'gen-buttons' }, btn('Turn', () => { sel.r = (sel.r + 1) % 4; renderStatus(); }),
                                                         btn('Put it back', () => { sel = null; hidePreview(); render(); })));
    } else if (sel?.kind === 'piece') {
      const it = L.items.find((i) => i.uid === sel.uid);
      if (!it) { sel = null; return renderStatus(); }
      const m = cat.get(it.id), s2 = shape(m, it.r);
      selCard.append(el('h3', {}, m.name),
                     el('div', { class: 'lp-chips' }, chip('Slot', `col ${it.x + 1}, row ${it.y + 1}`), chip('Size', `${s2.w * 28} × ${s2.h * 28} mm`)),
                     el('div', { class: 'gen-buttons' }, btn('Turn 90°', () => turnSelected()), btn('Remove', () => { remove(L, it.uid); sel = null; changed(); })));
    } else {
      const free = freeCells(L, cat).length;
      selCard.append(el('h3', {}, 'Your panel'),
                     el('div', { class: 'lp-chips' }, chip('Cases', String(L.items.length)), chip('Free cells', String(free))),
                     el('p', { class: 'lp-hint' }, 'Click a case to select it.'));
    }
    sub.textContent = `${L.cols} × ${L.rows} cells · ${L.cols * 28} × ${L.rows * 28} mm · ${view.style === 'lowpro' ? 'low profile, on a deck' : 'openGrid, on the board'}`;
  }
  const chip = (k, v) => el('div', { class: 'lp-chip' }, el('span', {}, k), el('b', {}, v));
  const btn = (label, fn) => { const b = el('button', { type: 'button', class: 'secondary' }, label); b.addEventListener('click', fn); return b; };

  function renderFacts() {
    facts.textContent = '';
    const warns = [...warnings(L, cat), ...leadWarnings(L, cat, onePiece)];
    for (const w of warns) facts.append(el('li', { class: 'lp-warn' }, w));
    if (!warns.length) facts.append(el('li', { class: 'lp-ok' }, L.items.length ? 'Everything fits, and every case\'s leads have somewhere to go.' : 'Nothing placed yet.'));
    parts.textContent = '';
    const { parts: list } = partsList(L, cat);
    if (!list.length) return;
    const t = el('table', { class: 'lp-parts' });
    const shown = new Set(), lp = view.style === 'lowpro';
    // low profile: the case's own zip (case_downloads.py's lowpro- names); a cable tile is a link block there
    const zipOf = (m) => !lp ? m.zip
                       : m.group === 'Cable tiles' ? 'lowpro-link-blocks'
                       : m.zip && deckData.cases[m.id] ? `lowpro-${m.zip}` : null;
    for (const m of list) {
      const zip = zipOf(m);
      const dl = !zip ? el('span', { class: 'lp-hint', title: m.nocase }, 'not yet')
               : shown.has(zip) ? el('span', { class: 'lp-hint' }, 'above') : el('a', { href: zipUrl(zip), download: '' }, 'zip');
      if (zip) shown.add(zip);
      t.append(el('tr', {}, el('td', {}, m.group === 'Cable tiles' ? `${m.name} tile` : m.name), el('td', {}, `× ${m.count}`), el('td', {}, dl)));
    }
    if (!lp) {
      t.append(el('tr', {}, el('td', {}, `openGrid board ${L.cols} × ${L.rows}`), el('td', {}, '× 1'),
                  el('td', {}, el('a', { href: `opengrid-board.html?cols=${L.cols}&rows=${L.rows}` }, 'make'))));
      // the back plate is optional: it holds the cables behind the board, on standoffs that snap into its back
      t.append(el('tr', {}, el('td', { title: 'Optional: holds the cables behind the board' }, 'Back plate (optional)'), el('td', {}, `+ ${standoffCount(L.cols, L.rows)} standoffs`),
                  el('td', {}, el('a', { href: `back-plate.html?cols=${L.cols}&rows=${L.rows}` }, 'make'))));
    }
    if (lp) {
      // what joins them: keys and feet, or the deck below
      t.append(el('tr', {}, el('td', { title: 'Or press the cases onto a deck, below' }, 'Link keys and feet'), el('td', {}, ''),
                  el('td', {}, el('a', { href: zipUrl('lowpro-links'), download: '' }, 'zip'))));
    }
    parts.append(t);
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
                        btn('Download lid STL', () => download(toStl(built.lid, `${name} lid`), `${name}-lid.stl`)),
                        btn('Download lid STEP', () => download(toStep(built.lid, `${name}-lid`), `${name}-lid.step`, STEP)));
      oneFacts.append(el('li', {}, 'The lid STL is turned top-down for printing, like every case lid.'),
                      el('li', {}, STEP_NOTE));
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
  const cover = () => coverSel.value;
  const trays = () => TRAY_SIDES.filter((t) => trayBoxes[t].checked).join('');
  const lid = () => lidBox.checked;
  const deckKey = () => `${encode(L)}|${bed().x}x${bed().y}|${cover()}|${trays()}|${lid()}`;
  // the low-profile deck in 3D: the planner's own deck (deck-model.js) with its trays, and the cover when ticked
  let manifoldP = null, deck3dKey = '';
  const manifold = () => (manifoldP ??= import('../vendor/manifold-3d/manifold.js').then(async ({ default: Module }) => {
    const M = await Module(); M.setup(); return M;
  }));
  // the key labels on the cover (cover-labels.js): where each goes, and the ones with no room
  async function coverLabels(M, cv, tr) {
    const [kit, { placeCoverLabels }] = await Promise.all([loadKit(), import('./cover-labels.js')]);
    const plate = coverPlate(M, L, cat, deckData, cv, tr);
    const r = placeCoverLabels(M, kit.font, plate);
    coverNotes.textContent = '';
    for (const x of r.refused) coverNotes.append(el('li', { class: 'lp-warn' }, `Cover: no room for "${x.text}". Shorten it.`));
    return { ...r, top: plate.z0 + plate.t, font: kit.font };
  }
  async function deck3d() {
    const lp = view.style === 'lowpro';
    coverBtn.hidden = !(lp && lid() && view.tab === 'build');
    if (!is3d()) return;
    if (!lp || !L.items.length) { if (deck3dKey) { deck3dKey = ''; v3.setDeck(null); } return; }
    const cv = cover(), tr = cv === 'cases' ? '' : trays();
    const withCover = lid() && view.showCover && view.tab === 'build' && !coverProblems(L, cat, deckData, cv, tr).length;
    const key = `${encode(L)}|${cv}|${tr}|${withCover}|${view.tab}`;
    if (key === deck3dKey) return;
    deck3dKey = key;
    try {
      const M = await manifold();
      if (key !== deck3dKey) return;
      const d = buildDeck(M, L, cat, deckData, cv, tr, withCover);
      const c = withCover ? buildCover(M, L, cat, deckData, cv, tr, false) : null;
      const cl = withCover ? await coverLabels(M, cv, tr) : null;
      if (key !== deck3dKey) return;
      const fp = extent(L, cat, cv), P = deckData.pitch;
      v3.setDeck({ deck: d.mesh, cover: c?.mesh || null, labels: cl?.placed || [], top: cl?.top,
                   ox: (fp.x0 + fp.cols / 2) * P - (L.cols * P) / 2, oz: (fp.y0 + fp.rows / 2) * P - (L.rows * P) / 2 });
    } catch { v3.setDeck(null); }
  }
  function renderDeck() {
    deck3d();
    deckFacts.textContent = '';
    deckButtons.textContent = '';
    deckButtons.append(bDeck);
    const b = bed();
    const bad = !(b.x >= 50 && b.y >= 50) ? ['Set the size of your printer\'s bed.'] : [...deckProblems(L, cat, deckData, b, cover(), trays()), ...(lid() ? coverProblems(L, cat, deckData, cover(), trays()) : [])];
    bDeck.disabled = bad.length > 0;
    for (const w of bad) deckFacts.append(el('li', { class: 'gen-warn' }, w));
    if (bad.length) return;
    const s = deckSize(L, cat, deckData, cover(), trays()), keys = keySites(L, cat, deckData).length;
    const tall = +(deckData.deck_t + deckData.link.h).toFixed(1);
    void tall;
    deckFacts.append(el('li', { class: 'lp-ok' }, `${s.w} × ${s.h} mm, fits your bed`),
                     ...(trays() ? [el('li', {}, `Trays ${[...trays()].map((t) => TRAY_NAMES[t].toLowerCase()).join(', ')}` +
                                    (trayGaps(L, cat, deckData, trays()).length ? ', cut for the USB' : ''))] : []),
                     ...(lid() ? [el('li', {}, `Cover with ${pegSites(L, cat, deckData, cover(), trays()).length} pegs`)] : []));
    const feet = pockets(L, cat, deckData).length - 2 * keys;
    // without a deck: a padded key across every joint and a foot in every other pocket (lowpro.py)
    deckFacts.append(el('li', { class: 'lp-hint' }, `No deck? ${keys} padded key${keys === 1 ? '' : 's'} and ${feet} ${feet === 1 ? 'foot' : 'feet'} instead.`));
    if (deckBuilt?.key === deckKey()) {
      const name = `lowpro-deck-${s.cols}x${s.rows}${trays() ? `-trays-${trays().toLowerCase()}` : ''}`;
      deckButtons.textContent = '';
      deckButtons.append(btnMain('Download deck STL', () => download(toStl(deckBuilt.mesh, name), `${name}.stl`)));
      if (deckBuilt.cover) {
        const cname = name.replace('lowpro-deck', 'lowpro-cover');
        const text = deckBuilt.text, both = (fn) => () => { fn(deckBuilt.cover, cname); if (text) setTimeout(() => fn(text, `${cname}-text`), 300); };
        deckButtons.append(btnMain(text ? 'Cover + labels STL' : 'Cover STL', both((m, n) => download(toStl(m, n), `${n}.stl`))),
                           btn(text ? 'Cover + labels STEP' : 'Cover STEP', both((m, n) => download(toStep(m, n), `${n}.step`, STEP))));
      }
      deckFacts.append(el('li', { class: 'lp-hint' }, deckBuilt.text ? 'Print flat as the STLs lie. Load the cover and its labels as one object, the labels in a second filament.'
                                                                     : 'Print flat as the STLs lie, no supports.'));
    }
  }
  bDeck.addEventListener('click', async () => {
    const key = deckKey();
    bDeck.disabled = true;
    bDeck.textContent = 'Building…';
    try {
      const { default: Module } = await import('../vendor/manifold-3d/manifold.js');
      const M = await Module();
      M.setup();
      const r = buildDeck(M, L, cat, deckData, cover(), trays(), lid());
      if (r.status !== 'NoError') throw new Error(r.status);
      let letters = null;
      if (lid() && L.items.some((it) => it.labels?.some((t) => t))) {
        const [cl, THREE, { lettersSolid }] = await Promise.all([coverLabels(M, cover(), trays()), import('../vendor/three/three.module.min.js'), import('./label-export.js')]);
        letters = lettersSolid(M, THREE, cl.font, cl.placed, cl.top);
      }
      const c = lid() ? buildCover(M, L, cat, deckData, cover(), trays(), true, letters) : null;
      if (c && c.status !== 'NoError') throw new Error(`cover: ${c.status}`);
      if (key === deckKey()) deckBuilt = { key, mesh: r.mesh, pockets: r.pockets, cover: c?.mesh, text: c?.text };
    } catch (e) {
      deckFacts.append(el('li', { class: 'gen-bad' }, `The deck did not build (${e.message}).`));
      bDeck.textContent = 'Make the deck';
      bDeck.disabled = false;
      return;
    }
    bDeck.textContent = 'Make the deck';
    renderDeck();
  });
  const keep = () => {
    try { localStorage.setItem(BED_STORE, JSON.stringify({ ...bed(), back: back(), cover: cover(), trays: trays(), lid: lid() })); } catch { /* storage blocked */ }
    render();          // the deck, the cover and whose labels show in 3D follow
  };
  for (const f of [bedX, bedY]) f.input.addEventListener('input', keep);
  backSel.addEventListener('change', keep);
  coverSel.addEventListener('change', keep);
  for (const t of TRAY_SIDES) trayBoxes[t].addEventListener('change', keep);
  lidBox.addEventListener('change', keep);

  // ---- state changes
  // ---- key labels (labels.js): a word beside each key of the selected MX case, cut into its lid
  const KEYED = new Set(['mx1s', 'mx3', 'mx4', 'mx6', 'mx9']);
  let labelUid = null;        // the set of label editors shown, so typing does not rebuild them
  // In the Labels view, an editor for every case with keys; elsewhere, for the selected one. Rebuilt only when
  // that set changes, so typing keeps the focus.
  function renderLabels() {
    const sp = sel?.kind === 'piece' ? L.items.find((i) => i.uid === sel.uid) : null;
    const items = view.tab === 'labels' ? L.items.filter((i) => KEYED.has(i.id))
      : view.tab !== 'leads' && sp && KEYED.has(sp.id) ? [sp] : [];
    labelSec.hidden = !items.length && view.tab !== 'labels';
    const key = `${view.tab}|${view.style}|${items.map((i) => i.uid).join(',')}`;
    if (key === labelUid) return labelNotes();
    labelUid = key;
    labelSec.textContent = '';
    if (view.tab === 'labels' && !items.length) {
      labelSec.append(el('section', { class: 'lp-card' }, el('h3', {}, 'Labels'), el('p', { class: 'lp-hint' }, 'Place a key case (mx1 1x1, mx3rgb, mx4rgb, mx6rgb, mx9rgb) to label its keys.')));
      return;
    }
    loadKit().then((kit) => {
      if (labelUid !== key) return;
      for (const it of items) labelSec.append(labelEditor(it, kit));
      labelNotes();
    }).catch((e) => { labelSec.textContent = `The labels did not load (${e.message}).`; });
  }
  function labelEditor(it, kit) {
    const n = kit.models.index.cases.opengrid[it.id].keys.length, names = kit.labels.keyNames(it.id, n);
    const inputs = el('div', { class: 'lp-label-grid' });
    for (let i = 0; i < n; i++) {
      const inp = el('input', { type: 'text', maxlength: String(kit.labels.MAX_LEN), value: it.labels?.[i] || '', placeholder: names[i],
                                'aria-label': `${cat.get(it.id).name} ${names[i]} label`, spellcheck: 'false' });
      inp.addEventListener('focus', () => {
        if (sel?.kind === 'piece' && sel.uid === it.uid) return;
        sel = { kind: 'piece', uid: it.uid };
        renderStatus();
        if (is3d()) v3.update(L, { sel: it.uid, style: view.style, xray: view.tab === 'build' && view.xray, routes: routes(), lidLabels: !coverOn() });
      });
      inp.addEventListener('input', () => {
        const v = kit.labels.cleanLabel(inp.value);
        if (v !== inp.value) inp.value = v;
        it.labels = Array.from({ length: n }, (_, k) => (k === i ? v : it.labels?.[k] || ''));
        saveLayout();
        if (is3d()) v3.update(L, { sel: sel?.kind === 'piece' ? sel.uid : null, style: view.style, xray: view.tab === 'build' && view.xray, routes: routes(), lidLabels: !coverOn() });
        labelNotes();
        renderDeck();
      });
      inputs.append(inp);
    }
    const bStl = el('button', { type: 'button', class: 'lp-toggle' }, 'Lid STL');
    const bStep = el('button', { type: 'button', class: 'lp-toggle' }, 'Lid STEP');
    bStl.title = bStep.title = 'The lid with the words cut in, and the words as a second part, for a two-colour print';
    bStl.addEventListener('click', () => exportLid(it, 'stl', bStl));
    bStep.addEventListener('click', () => exportLid(it, 'step', bStep));
    return el('section', { class: 'lp-card', 'data-uid': String(it.uid) },
      el('h3', {}, `${cat.get(it.id).name} labels`), inputs,
      el('ul', { class: 'lp-label-notes', 'aria-live': 'polite' }), el('div', { class: 'gen-buttons' }, bStl, bStep));
  }
  function labelNotes() {
    if (!kitP) return;
    kitP.then((kit) => {
      for (const card of labelSec.querySelectorAll('[data-uid]')) {
        const it = L.items.find((i) => i.uid === +card.dataset.uid), notes = card.querySelector('.lp-label-notes');
        if (!it) continue;
        const spec = kit.models.index.cases[view.style][it.id];
        const names = kit.labels.keyNames(it.id, spec.keys.length);
        notes.textContent = '';
        for (const r of kit.labels.placeLabels(spec, it.labels, kit.font, inset).refused)
          notes.append(el('li', { class: 'lp-warn' }, `${names[r.i]}: "${r.text}" has no room. Shorten it, or label the keycap.`));
      }
    });
  }
  // the Leads view: what the colours mean, and anything with nowhere to go
  function renderLeads() {
    leadsCard.hidden = !leadsOn();
    if (!leadsOn()) return;
    leadsCard.textContent = '';
    const r = routes();
    const key = (c, t) => el('li', {}, el('span', { class: 'lp-swatch', style: `background:${c}` }), t);
    leadsCard.append(el('h3', {}, 'Leads'),
      el('ul', { class: 'lp-legend' }, key('#f08a24', 'Lead between two cases'), key('#a9afb9', 'Slot open through the lid'),
         key('#3fbf7f', 'Opening into a free cell'), key('#f5a524', 'Opening at the panel edge'), key('#e5484d', 'Opening blocked')));
    if (r) leadsCard.append(el('p', { class: 'lp-hint' }, `${r.pairs.length} lead${r.pairs.length === 1 ? '' : 's'} where two cases\' openings meet.`));
  }
  async function exportLid(it, kind, button) {
    const was = button.textContent;
    button.disabled = true;
    button.textContent = 'Building…';
    try {
      const [kit, THREE, { labelledLid }, { default: Module }] = await Promise.all([
        loadKit(), import('../vendor/three/three.module.min.js'), import('./label-export.js'), import('../vendor/manifold-3d/manifold.js')]);
      const M = await Module();
      M.setup();
      const r = labelledLid(M, THREE, kit.font, kit.models.index, kit.models.bin, view.style, it.id, it.labels, inset);
      const name = `${view.style === 'lowpro' ? 'lp-' : ''}${it.id}-lid`;
      if (!r.text) { flash('Type a label first: there is nothing to cut.'); return; }
      if (r.offLid.length) flash(`Left off, over a hole or slot in the lid: ${r.offLid.map((p) => p.text).join(', ')}.`);
      if (kind === 'stl') {
        download(toStl(r.lid, `${name} labelled`), `${name}-labelled.stl`);
        setTimeout(() => download(toStl(r.text, `${name} text`), `${name}-text.stl`), 300);
      } else {
        download(toStep(r.lid, `${name}-labelled`), `${name}-labelled.step`, 'model/step');
        setTimeout(() => download(toStep(r.text, `${name}-text`), `${name}-text.step`, 'model/step'), 300);
      }
    } catch (e) {
      flash(`The labelled lid did not build (${e.message}).`);
    } finally {
      button.disabled = false;
      button.textContent = was;
    }
  }

  function saveLayout() {
    const text = encode(L);
    try { history.replaceState(null, '', `#${text}`); } catch { /* sandboxed */ }
    try { localStorage.setItem(STORE, text); } catch { /* storage blocked */ }
  }

  function changed() {
    saveLayout();
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
    if (is3d()) return v3.preview(id, x, y, r, !!conflict(L, cat, id, x, y, r, ignore));
    const mod = cat.get(id), s = shape(mod, r);
    if (!preview) { preview = el('div', { class: 'lp-preview' }); }
    grid.append(preview);
    box(preview, x, y, s.w, s.h);
    preview.classList.toggle('lp-bad', !!conflict(L, cat, id, x, y, r, ignore));
  }
  function hidePreview() { preview?.remove(); v3?.hidePreview(); }

  // ---- pointer: drag from the list, drag a placed case, or click
  // (the browser's own drag, of a thumbnail or a text selection, would cancel the pointer events)
  for (const t of [palette, grid, box3d]) t.addEventListener('dragstart', (e) => e.preventDefault());
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
  // in 3D a press on a case drags it, as on the grid; anywhere else it turns the view (OrbitControls, on the canvas)
  let press3d = null;
  box3d.addEventListener('pointerdown', (e) => {
    press3d = { x: e.clientX, y: e.clientY };
    if (!is3d() || e.target !== v3.canvas) return;
    const uid = v3.pickPiece(e.clientX, e.clientY);
    if (uid === null) return;
    e.stopPropagation();          // capture phase: the orbit controls never see it
    const it = L.items.find((i) => i.uid === uid);
    const c = v3.cellAt(e.clientX, e.clientY);
    startPress(e, { id: it.id, r: it.r, uid, gx: c.x - it.x, gy: c.y - it.y, src: box3d });
  }, true);
  box3d.addEventListener('click', (e) => {
    if (!is3d() || sel?.kind !== 'palette' || e.target !== v3.canvas) return;
    if (press3d && Math.hypot(e.clientX - press3d.x, e.clientY - press3d.y) >= DRAG_PX) return;   // that was a turn of the view
    const c = cellAt(e.clientX, e.clientY);
    const it = place(L, cat, sel.id, c.x, c.y, sel.r);
    if (!it) return flash(`It doesn't fit there: ${conflict(L, cat, sel.id, c.x, c.y, sel.r)}.`);
    sel = { kind: 'piece', uid: it.uid };
    hidePreview();
    changed();
  });
  box3d.addEventListener('pointerleave', () => { if (!drag) hidePreview(); });
  window.addEventListener('pointermove', (e) => {
    if (!drag) {
      // hover preview while a case is picked from the list
      if (sel?.kind === 'palette' && (e.target.closest?.('.lp-grid') === grid || (is3d() && e.target === v3.canvas))) {
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
      if (is3d()) drag.ghost.style.visibility = 'hidden';     // the see-through case in the scene shows where it goes
      document.body.append(drag.ghost);
      if (drag.uid && drag.src !== box3d) drag.src.classList.add('lp-dragging');
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
  showView();
}

const root = document.getElementById('layout-planner');
if (root) mount(root);
