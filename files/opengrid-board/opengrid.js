// The openGrid board generator on the "openGrid board" docs page. Mounts into
// #opengrid-generator. Geometry is in opengrid-mesh.js; the numbers come from
// hardware/opengrid-board/opengrid_board.py.
import { boardMesh, boardVolume, octagon } from './opengrid-mesh.js';
import { toStl } from '../generators/mesh.js';
import { BED, MAX_CELLS, useStyles, el, field, download, loadFailed, topView, sizeErrors } from '../generators/ui.js';

const PLA = 1.24;         // g/cm3, for the weight estimate

async function mount(root) {
  root.textContent = 'Loading the generator…';
  let P;
  try {
    const r = await fetch(new URL('opengrid-params.json', import.meta.url));
    if (!r.ok) throw new Error('could not load the part data');
    P = await r.json();
  } catch (e) {
    loadFailed(root, e.message);
    return;
  }
  useStyles();

  // the layout planner links here with its grid size: ?cols=5&rows=4
  const q = new URLSearchParams(location.search), start = (k) => Math.min(MAX_CELLS, Math.max(1, Math.round(+q.get(k)) || 5));
  const cols = field('Columns (cells)', { min: 1, max: MAX_CELLS, step: 1, value: start('cols') });
  const rows = field('Rows (cells)', { min: 1, max: MAX_CELLS, step: 1, value: start('rows') });
  const view = el('div', { class: 'gen-view' });
  const facts = el('ul', { class: 'gen-facts', 'aria-live': 'polite' });
  const bBoard = el('button', { type: 'button' }, 'Download board STL');
  root.textContent = '';
  root.className = 'gen';
  root.append(el('div', { class: 'gen-controls' }, cols.node, rows.node), view, facts,
              el('div', { class: 'gen-buttons' }, bBoard));

  const face = octagon(P.stations[0][1], P.stations[0][2]);
  const read = () => {
    const c = Math.round(+cols.input.value), r = Math.round(+rows.input.value);
    return { c, r, errs: sizeErrors(c, r) };
  };

  const update = () => {
    const { c, r, errs } = read();
    facts.textContent = '';
    view.textContent = '';
    bBoard.disabled = errs.length > 0;
    if (errs.length) {
      facts.append(el('li', { class: 'gen-bad' }, `Check the values: ${errs.join('; ')}.`));
      return;
    }
    view.append(topView(P.pitch, c, r, 0, (add, x, y) =>
      add('polygon', { points: face.map(([px, py]) => `${x + px},${y + py}`).join(' '), class: 'gen-hole' })));
    const W = c * P.pitch, H = r * P.pitch;
    const grams = (boardVolume(P, c, r) / 1000) * PLA;
    facts.append(el('li', {}, `Board ${W} × ${H} × ${P.thickness} mm, ${c * r} cells, about ${Math.round(grams)} g of PLA.`));
    if (Math.max(W, H) > BED)
      facts.append(el('li', { class: 'gen-warn' }, `Wider than ${BED} mm: check it fits your printer's bed. This board has no connectors to join two together, so it has to print in one piece.`));
  };

  bBoard.addEventListener('click', () => {
    const { c, r } = read();
    download(toStl(boardMesh(P, c, r), `openGrid full ${c}x${r}`), `opengrid-full-${c}x${r}.stl`);
  });
  for (const f of [cols, rows]) f.input.addEventListener('input', update);
  update();
}

const root = document.getElementById('opengrid-generator');
if (root) mount(root);
