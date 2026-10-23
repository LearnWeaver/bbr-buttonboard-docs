// The back-plate generator on the "Back plate for the leads" docs page.
// Mounts into #back-plate-generator. Geometry is in backplate-mesh.js; the
// numbers and the support come from hardware/back-plate/back_plate.py.
import { plateMesh, parseStl, stretchSupport, prongStrain, toStl } from './backplate-mesh.js';
import { BED, MAX_CELLS, useStyles, el, field, download, loadFailed, topView, sizeErrors } from '../generators/ui.js';

const here = (f) => new URL(f, import.meta.url);

async function mount(root) {
  root.textContent = 'Loading the generator…';
  let P, support;
  try {
    const [pr, sr] = await Promise.all([fetch(here('backplate-params.json')), fetch(here('back-plate-support.stl'))]);
    if (!pr.ok || !sr.ok) throw new Error('could not load the part data');
    P = await pr.json();
    support = parseStl(new Uint8Array(await sr.arrayBuffer()));
  } catch (e) {
    loadFailed(root, e.message);
    return;
  }
  useStyles();

  const cols = field('Columns (cells)', { min: 1, max: MAX_CELLS, step: 1, value: 5 });
  const rows = field('Rows (cells)', { min: 1, max: MAX_CELLS, step: 1, value: 5 });
  const gap = field('Gap behind the board (mm)', { min: P.gap, max: P.gap_max, step: 0.5, value: P.gap });
  const hole = field('Plate hole (mm), printer fit', { min: P.post_od + 0.1, max: P.post_od + 0.5, step: 0.05,
                                                      value: P.hole_d });
  const view = el('div', { class: 'gen-view' });
  const facts = el('ul', { class: 'gen-facts', 'aria-live': 'polite' });
  const bPlate = el('button', { type: 'button' }, 'Download plate STL');
  const bSupport = el('button', { type: 'button', class: 'secondary' }, 'Download support STL');
  root.textContent = '';
  root.className = 'gen';
  root.append(el('div', { class: 'gen-controls' }, cols.node, rows.node, gap.node, hole.node), view, facts,
              el('div', { class: 'gen-buttons' }, bPlate, bSupport));

  const read = () => {
    const c = Math.round(+cols.input.value), r = Math.round(+rows.input.value);
    const g = +gap.input.value, h = +hole.input.value;
    const errs = sizeErrors(c, r);
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
      facts.append(el('li', { class: 'gen-bad' }, `Check the values: ${errs.join('; ')}.`));
      return;
    }
    view.append(topView(P.pitch, c, r, P.plate_r, (add, x, y) => add('circle', { cx: x, cy: y, r: h / 2, class: 'gen-hole' })));
    const W = c * P.pitch, H = r * P.pitch;
    facts.append(el('li', {}, `Plate ${W} × ${H} × ${P.plate_t} mm, ${c * r} holes.`));
    if (Math.max(W, H) > BED)
      facts.append(el('li', { class: 'gen-warn' }, `Wider than ${BED} mm: check it fits your printer's bed, or print two smaller plates.`));
    const n = 4 + Math.max(0, Math.ceil((c * r - 25) / 16));
    facts.append(el('li', {}, c * r < 4 ? `Supports: one in each cell.`
                                        : `Supports: about ${n}, one near each corner${n > 4 ? ' and the rest spread across the middle' : ''}.`));
    const st = prongStrain(P, g);
    facts.append(el('li', { class: st > 2.2 ? 'gen-warn' : '' },
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
