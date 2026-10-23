// The back-plate generator on the "Back plate for the leads" docs page.
// Mounts into #back-plate-generator. Geometry is in backplate-mesh.js; the
// numbers and the support come from hardware/back-plate/back_plate.py.
import { plateMesh, parseStl, stretchSupport, prongStrain, toStl } from './backplate-mesh.js';

const here = (f) => new URL(f, import.meta.url);
const BED = 250;          // mm: warn when the plate will not fit a typical bed
const MAX_CELLS = 12;

const CSS = `
.bpg { border: 1px solid var(--border); border-radius: 10px; background: var(--bg-subtle);
       padding: 1rem 1.1rem; margin: 1.25rem 0; }
.bpg-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .75rem 1rem; }
.bpg label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; color: var(--text-muted); }
.bpg input { font: inherit; font-size: .95rem; color: var(--text); background: var(--bg);
             border: 1px solid var(--border-strong); border-radius: 6px; padding: .4rem .5rem; width: 100%;
             box-sizing: border-box; }
.bpg input:focus { outline: none; border-color: var(--accent); }
.bpg-view { margin: 1rem 0 .5rem; display: flex; justify-content: center; }
.bpg-view svg { width: 100%; max-width: 22rem; height: auto; }
.bpg-plate { fill: var(--bg-raised); stroke: var(--text-muted); stroke-width: .6; }
.bpg-hole { fill: var(--bg-subtle); stroke: var(--text-faint); stroke-width: .4; }
.bpg-dim { fill: var(--text-muted); font: 7px var(--font); }
.bpg-facts { margin: .25rem 0 .75rem; padding: 0; list-style: none; font-size: .9rem; }
.bpg-facts li { margin: .2rem 0; }
.bpg-warn { color: var(--hint-warning-bd); }
.bpg-bad { color: var(--hint-danger-bd); }
.bpg-buttons { display: flex; flex-wrap: wrap; gap: .5rem; }
.bpg button { font: inherit; font-size: .9rem; padding: .5rem .85rem; border-radius: 6px; cursor: pointer;
              border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.bpg button.secondary { background: transparent; color: var(--accent); }
.bpg button:disabled { opacity: .5; cursor: not-allowed; }
.bpg-error { color: var(--hint-danger-bd); font-size: .9rem; }
`;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}

function field(label, attrs) {
  const input = el('input', { type: 'number', ...attrs });
  return { input, node: el('label', {}, label, input) };
}

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function topView(P, cols, rows, holeD) {
  const W = cols * P.pitch, H = rows * P.pitch, pad = 12;
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`);
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `Top view: ${cols} by ${rows} cells, ${W} by ${H} mm`);
  const add = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); s.append(e); return e; };
  add('rect', { x: 0, y: 0, width: W, height: H, rx: P.plate_r, class: 'bpg-plate' });
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++)
      add('circle', { cx: (i + 0.5) * P.pitch, cy: (j + 0.5) * P.pitch, r: holeD / 2, class: 'bpg-hole' });
  add('text', { x: W / 2, y: -3, 'text-anchor': 'middle', class: 'bpg-dim' }).textContent = `${W} mm`;
  const t = add('text', { x: -3, y: H / 2, 'text-anchor': 'middle', class: 'bpg-dim',
                          transform: `rotate(-90 ${-3} ${H / 2})` });
  t.textContent = `${H} mm`;
  return s;
}

async function mount(root) {
  root.textContent = 'Loading the generator…';
  let P, support;
  try {
    const [pr, sr] = await Promise.all([fetch(here('backplate-params.json')), fetch(here('back-plate-support.stl'))]);
    if (!pr.ok || !sr.ok) throw new Error('could not load the part data');
    P = await pr.json();
    support = parseStl(new Uint8Array(await sr.arrayBuffer()));
  } catch (e) {
    root.textContent = '';
    root.append(el('p', { class: 'bpg-error' }, `The generator did not load (${e.message}). Reload the page to try again.`));
    return;
  }
  document.head.append(el('style', {}, CSS));

  const cols = field('Columns (cells)', { min: 1, max: MAX_CELLS, step: 1, value: 5 });
  const rows = field('Rows (cells)', { min: 1, max: MAX_CELLS, step: 1, value: 5 });
  const gap = field('Gap behind the board (mm)', { min: P.gap, max: P.gap_max, step: 0.5, value: P.gap });
  const hole = field('Plate hole (mm), printer fit', { min: P.post_od + 0.1, max: P.post_od + 0.5, step: 0.05,
                                                      value: P.hole_d });
  const view = el('div', { class: 'bpg-view' });
  const facts = el('ul', { class: 'bpg-facts', 'aria-live': 'polite' });
  const bPlate = el('button', { type: 'button' }, 'Download plate STL');
  const bSupport = el('button', { type: 'button', class: 'secondary' }, 'Download support STL');
  root.textContent = '';
  root.className = 'bpg';
  root.append(el('div', { class: 'bpg-controls' }, cols.node, rows.node, gap.node, hole.node), view, facts,
              el('div', { class: 'bpg-buttons' }, bPlate, bSupport));

  const read = () => {
    const c = Math.round(+cols.input.value), r = Math.round(+rows.input.value);
    const g = +gap.input.value, h = +hole.input.value;
    const errs = [];
    if (!(c >= 1 && c <= MAX_CELLS)) errs.push(`columns must be 1–${MAX_CELLS}`);
    if (!(r >= 1 && r <= MAX_CELLS)) errs.push(`rows must be 1–${MAX_CELLS}`);
    if (!(g >= P.gap && g <= P.gap_max)) errs.push(`the gap must be ${P.gap}–${P.gap_max} mm`);
    if (!(h > P.post_od && h <= P.post_od + 0.5)) errs.push(`the hole must be over ${P.post_od} and at most ${P.post_od + 0.5} mm`);
    return { c, r, g, h, errs };
  };

  const update = () => {
    const { c, r, g, h, errs } = read();
    facts.textContent = '';
    view.textContent = '';
    bPlate.disabled = bSupport.disabled = errs.length > 0;
    if (errs.length) {
      facts.append(el('li', { class: 'bpg-bad' }, `Check the values: ${errs.join('; ')}.`));
      return;
    }
    view.append(topView(P, c, r, h));
    const W = c * P.pitch, H = r * P.pitch;
    facts.append(el('li', {}, `Plate ${W} × ${H} × ${P.plate_t} mm, ${c * r} holes.`));
    if (Math.max(W, H) > BED)
      facts.append(el('li', { class: 'bpg-warn' }, `Wider than ${BED} mm: check it fits your printer's bed, or print two smaller plates.`));
    const n = 4 + Math.max(0, Math.ceil((c * r - 25) / 16));
    facts.append(el('li', {}, c * r < 4 ? `Supports: one in each cell.`
                                        : `Supports: about ${n}, one near each corner${n > 4 ? ' and the rest spread across the middle' : ''}.`));
    const st = prongStrain(P, g);
    facts.append(el('li', { class: st > 2.2 ? 'bpg-warn' : '' },
      `Clip strain going in: ${st.toFixed(1)} %${st > 2.2 ? ', at the top of PLA\'s range: print the supports in PETG if PLA ones crack.' : '.'}`));
  };

  bPlate.addEventListener('click', () => {
    const { c, r, h } = read();
    download(toStl(plateMesh(P, c, r, h), `back plate ${c}x${r}`), `back-plate-${c}x${r}.stl`);
  });
  bSupport.addEventListener('click', () => {
    const { g } = read();
    download(toStl(stretchSupport(P, support, g), `back plate support, gap ${g}`),
             `back-plate-support-gap${String(g).replace('.', '_')}.stl`);
  });
  for (const f of [cols, rows, gap, hole]) f.input.addEventListener('input', update);
  update();
}

const root = document.getElementById('back-plate-generator');
if (root) mount(root);
