// Page plumbing shared by the docs site's part generators: the panel's look,
// number fields, and saving an STL. Uses the site's theme tokens, so light and
// dark follow the rest of the page.

const CSS = `
.gen { border: 1px solid var(--border); border-radius: 10px; background: var(--bg-subtle);
       padding: 1rem 1.1rem; margin: 1.25rem 0; }
.gen-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .75rem 1rem; }
.gen label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; color: var(--text-muted); }
.gen input { font: inherit; font-size: .95rem; color: var(--text); background: var(--bg);
             border: 1px solid var(--border-strong); border-radius: 6px; padding: .4rem .5rem; width: 100%;
             box-sizing: border-box; }
.gen input:focus { outline: none; border-color: var(--accent); }
.gen-view { margin: 1rem 0 .5rem; display: flex; justify-content: center; }
.gen-view svg { width: 100%; max-width: 22rem; height: auto; }
.gen-plate { fill: var(--bg-raised); stroke: var(--text-muted); stroke-width: .6; }
.gen-hole { fill: var(--bg-subtle); stroke: var(--text-faint); stroke-width: .4; }
.gen-dim { fill: var(--text-muted); font: 7px var(--font); }
.gen-facts { margin: .25rem 0 .75rem; padding: 0; list-style: none; font-size: .9rem; }
.gen-facts li { margin: .2rem 0; }
.gen-warn { color: var(--hint-warning-bd); }
.gen-bad { color: var(--hint-danger-bd); }
.gen-buttons { display: flex; flex-wrap: wrap; gap: .5rem; }
.gen button { font: inherit; font-size: .9rem; padding: .5rem .85rem; border-radius: 6px; cursor: pointer;
              border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.gen button.secondary { background: transparent; color: var(--accent); }
.gen button:disabled { opacity: .5; cursor: not-allowed; }
.gen-error { color: var(--hint-danger-bd); font-size: .9rem; }
`;

export const BED = 250;          // mm: warn when a part will not fit a typical bed
export const MAX_CELLS = 12;

let styled = false;
export function useStyles() {
  if (styled) return;
  styled = true;
  document.head.append(el('style', {}, CSS));
}

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}

export function field(label, attrs) {
  const input = el('input', { type: 'number', ...attrs });
  return { input, node: el('label', {}, label, input) };
}

export function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function loadFailed(root, why) {
  root.textContent = '';
  root.append(el('p', { class: 'gen-error' }, `The generator did not load (${why}). Reload the page to try again.`));
}

// A top view of a cols x rows plate on the pitch, for the panel: the outline,
// one shape per cell drawn by `cell(add, x, y)`, and the two dimensions.
export function topView(pitch, cols, rows, cornerR, cell) {
  const W = cols * pitch, H = rows * pitch, pad = 12;
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`);
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `Top view: ${cols} by ${rows} cells, ${W} by ${H} mm`);
  const add = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); s.append(e); return e; };
  add('rect', { x: 0, y: 0, width: W, height: H, rx: cornerR, class: 'gen-plate' });
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) cell(add, (i + 0.5) * pitch, (j + 0.5) * pitch);
  add('text', { x: W / 2, y: -3, 'text-anchor': 'middle', class: 'gen-dim' }).textContent = `${W} mm`;
  add('text', { x: -3, y: H / 2, 'text-anchor': 'middle', class: 'gen-dim', transform: `rotate(-90 -3 ${H / 2})` })
    .textContent = `${H} mm`;
  return s;
}

// The cols / rows checks every generator makes.
export function sizeErrors(c, r) {
  const errs = [];
  if (!(Number.isInteger(c) && c >= 1 && c <= MAX_CELLS)) errs.push(`columns must be 1–${MAX_CELLS}`);
  if (!(Number.isInteger(r) && r >= 1 && r <= MAX_CELLS)) errs.push(`rows must be 1–${MAX_CELLS}`);
  return errs;
}
