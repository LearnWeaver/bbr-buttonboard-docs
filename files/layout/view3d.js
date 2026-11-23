// The layout planner's 3D view: the panel built from the real case models,
// openGrid or low profile, on its board or deck. layout.js owns the layout and
// every rule; this draws it, and answers which cell or case is under the
// pointer, so the planner's own drag and drop works here as on the 2D grid.
//
// Models come from tools/planner_models.py (models/models.json and .bin), in
// each case's frame: x east, y north, z up, mm. The scene is three.js's: y up,
// and the grid's rows run toward the viewer (+z), so a case-frame point
// (x, y, z) is (x, z, -y) here, and a case turned r quarter turns clockwise
// (seen from above, as layout-model.js turns them) is rotated -r × 90° about y.
import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { cellsAt } from './layout-model.js';
import { placeLabels, labelShapes } from './labels.js';

export const STYLES = { opengrid: 'openGrid', lowpro: 'Low profile' };

const LOOK = {
  opengrid: { base: 0x30343b, lid: 0x3b4048, edge: 0x14161a, cap: 0xeeece6, floor: 0x4a505a, hole: 0x2a2e35 },
  lowpro: { base: 0xd8d3c9, lid: 0xefece5, edge: 0x8f897d, cap: 0x2c3038, floor: 0xc9c3b8, hole: 0xb8b1a4 },
};
const SELECT = 0x2357e6, OK = 0x3fbf7f, BAD = 0xe5484d, PCB = 0x2c8a5c, SCREEN = 0x0d1015, KNOB = 0x2a2e35;
// leads.js's leadRoutes: a lead where two ports meet, and a mark on every other port by where its lead can go
const LEAD = 0xf08a24;
const INK = { opengrid: 0xf2f1ec, lowpro: 0x1f3f9e };      // key labels: a second filament, inlaid flush
const PORT = { pair: 0xf08a24, top: 0xa9afb9, open: 0x3fbf7f, edge: 0xf5a524, blocked: 0xe5484d, usb: 0x4f8bff };

export async function loadModels() {
  const [index, bin] = await Promise.all([
    fetch(new URL('models/models.json', import.meta.url)).then((r) => { if (!r.ok) throw new Error('could not load the case models'); return r.json(); }),
    fetch(new URL('models/models.bin', import.meta.url)).then((r) => { if (!r.ok) throw new Error('could not load the case models'); return r.arrayBuffer(); }),
  ]);
  return { index, bin };
}

// one mesh of models.bin as a flat-shaded geometry in scene axes
function decode(index, bin, m) {
  const off = index.meshes[m.mesh], s = index.scale;
  const q = new Int16Array(bin, off, 3 * m.nv);
  let at = off + 6 * m.nv;
  at += (4 - (at % 4)) % 4;
  const tri = m.wide ? new Uint32Array(bin, at, 3 * m.nt) : new Uint16Array(bin, at, 3 * m.nt);
  const pos = new Float32Array(9 * m.nt);
  for (let t = 0; t < 3 * m.nt; t++) {
    const v = 3 * tri[t];
    pos[3 * t] = q[v] * s; pos[3 * t + 1] = q[v + 2] * s; pos[3 * t + 2] = -q[v + 1] * s;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// font: a three.js Font for the key labels (labels.js); inset: case outline to the lid's visible edge
export function createView(container, { index, bin, cat, boardT = 6.8, deckT = 1.2, font = null, inset = 0.92 }) {
  const P = index.pitch;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1e24);
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 6000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3d44, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 60;
  controls.maxDistance = 1500;
  controls.addEventListener('change', () => draw());

  const floor = new THREE.Group(), pieces = new THREE.Group(), ghost = new THREE.Group(), leads = new THREE.Group();
  scene.add(floor, pieces, ghost, leads);

  // geometry and materials, made once
  const geo = new Map();
  const geometry = (style, id, part) => {
    const k = `${style}/${id}/${part}`;
    if (!geo.has(k)) {
      const m = index.cases[style][id]?.[part];
      const g = m ? decode(index, bin, m) : null;
      geo.set(k, g && { g, edges: new THREE.EdgesGeometry(g, 28) });
    }
    return geo.get(k);
  };
  const capGeo = new THREE.CylinderGeometry(13.0 / Math.SQRT2, 18.0 / Math.SQRT2, 7.6, 4, 1).rotateY(Math.PI / 4);
  const stemGeo = new THREE.BoxGeometry(13.9, 5.2, 13.9);
  const knobGeo = new THREE.CylinderGeometry(7.5, 7.5, 15, 40);
  const mats = {};
  const mat = (key, make) => (mats[key] ??= make());
  const solid = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02, ...o });
  const ghostly = (color) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.5 });
  const faint = (color) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.5 });

  let deck = null;      // the low-profile deck and cover, from deck-model.js: { deck, cover, ox, oz } or null
  let style = 'opengrid', size = { cols: 0, rows: 0 }, framed = false;

  function caseGroup(id, look, kind, labels = null) {
    const spec = index.cases[style][id];
    const g = new THREE.Group();
    if (!spec) return g;
    const edgeMat = mat(`edge/${style}/${kind}`, () => new THREE.LineBasicMaterial({ color: look.edge, transparent: true, opacity: kind === 'xray' ? 0.35 : 0.55 }));
    for (const part of ['base', 'lid']) {
      const m = geometry(style, id, part);
      if (!m) continue;
      const material = kind === 'ghost-ok' ? mat('ghost-ok', () => ghostly(OK)) : kind === 'ghost-bad' ? mat('ghost-bad', () => ghostly(BAD))
        : kind === 'xray' ? mat(`xray/${style}/${part}`, () => faint(look[part]))
        : kind === 'sel' ? mat(`sel/${style}/${part}`, () => solid(look[part], { emissive: SELECT, emissiveIntensity: part === 'lid' ? 0.28 : 0.12 }))
        : mat(`${style}/${part}`, () => solid(look[part]));
      const mesh = new THREE.Mesh(m.g, material);
      mesh.castShadow = mesh.receiveShadow = !kind.startsWith('ghost') && kind !== 'xray';
      g.add(mesh);
      if (!kind.startsWith('ghost')) g.add(new THREE.LineSegments(m.edges, edgeMat));
    }
    if (kind.startsWith('ghost')) return g;
    const top = spec.top;
    const fallback = index.cases.opengrid[id] || {};
    const capMat = mat(`cap/${style}/${kind === 'xray'}`, () => (kind === 'xray' ? faint(look.cap) : solid(look.cap, { roughness: 0.45 })));
    for (const [x, y] of spec.keys || []) {
      const stem = new THREE.Mesh(stemGeo, mat(`stem/${kind === 'xray'}`, () => (kind === 'xray' ? faint(0x15171a) : solid(0x15171a))));
      stem.position.set(x, top + 2.6, -y);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(x, top + 5.2 + 3.8, -y);
      cap.castShadow = true;
      g.add(stem, cap);
    }
    for (const [x, y] of spec.shafts || fallback.shafts || []) {
      const knob = new THREE.Mesh(knobGeo, mat(`knob/${kind === 'xray'}`, () => (kind === 'xray' ? faint(KNOB) : solid(KNOB, { roughness: 0.35, metalness: 0.2 }))));
      knob.position.set(x, top + 2 + 7.5, -y);
      knob.castShadow = true;
      g.add(knob);
    }
    if (font && labels?.some((t) => t) && (kind === 'case' || kind === 'sel')) {
      const ink = mat(`ink/${style}`, () => solid(INK[style], { roughness: 0.55 }));
      for (const p of placeLabels(spec, labels, font, inset).placed) {
        const { shapes, dx, dy } = labelShapes(font, p);
        const t = new THREE.Mesh(new THREE.ShapeGeometry(shapes, 6).translate(dx, dy, 0).rotateX(-Math.PI / 2), ink);
        t.position.y = top + 0.06;
        g.add(t);
      }
    }
    // a display's window shows a dark screen, not the inside of the case
    if (id === 'disp1' || id === 'disp2') {
      const [ox, oy] = spec.out;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(ox - 6, oy - 6).rotateX(-Math.PI / 2), mat('screen', () => solid(SCREEN, { roughness: 0.2 })));
      s.position.y = top - 3;
      g.add(s);
    }
    if (kind === 'xray') {
      const b = spec.pcb || fallback.pcb;
      if (b) {
        const [x0, x1, y0, y1, z0, z1] = b;
        const pcb = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0), mat('pcb', () => solid(PCB, { roughness: 0.5 })));
        pcb.position.set((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
        g.add(pcb);
      }
    }
    return g;
  }

  // where a placed case's centre lands: the middle of the cells its body takes
  function place(g, id, x, y, r) {
    const c = cellsAt(cat.get(id), x, y, r);
    const bx = Math.min(...c.occ.map((q) => q[0])), by = Math.min(...c.occ.map((q) => q[1]));
    const bw = Math.max(...c.occ.map((q) => q[0])) - bx + 1, bh = Math.max(...c.occ.map((q) => q[1])) - by + 1;
    g.position.set((bx + bw / 2) * P - (size.cols * P) / 2, style === 'lowpro' ? deckT : 0, (by + bh / 2) * P - (size.rows * P) / 2);
    g.rotation.y = (-r * Math.PI) / 2;
    return g;
  }

  function buildFloor() {
    floor.clear();
    const look = LOOK[style], W = size.cols * P, H = size.rows * P;
    if (style === 'opengrid') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(W, boardT, H), mat('floor/og', () => solid(look.floor, { roughness: 0.8 })));
      b.position.y = -boardT / 2;
      b.receiveShadow = true;
      floor.add(b);
      // a dark square at every cell, where the openGrid board is open
      const hole = new THREE.PlaneGeometry(P - 7, P - 7).rotateX(-Math.PI / 2);
      const hm = mat('hole/og', () => solid(look.hole, { roughness: 0.9 }));
      for (let i = 0; i < size.cols; i++) for (let j = 0; j < size.rows; j++) {
        const h = new THREE.Mesh(hole, hm);
        h.position.set((i + 0.5) * P - W / 2, 0.05, (j + 0.5) * P - H / 2);
        h.receiveShadow = true;
        floor.add(h);
      }
    } else if (deck) {
      // deck-model.js's frame: centred on its own rectangle, y north, z up, so as a case's, moved by (ox, oz)
      const part = (m, material) => {
        const pos = new Float32Array(9 * (m.tri.length / 3));
        for (let t = 0; t < m.tri.length; t++) {
          const v = 3 * m.tri[t];
          pos[3 * t] = m.pos[v] + deck.ox; pos[3 * t + 1] = m.pos[v + 2]; pos[3 * t + 2] = -m.pos[v + 1] + deck.oz;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = mesh.receiveShadow = true;
        floor.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), mat('edge/deck', () => new THREE.LineBasicMaterial({ color: look.edge, transparent: true, opacity: 0.5 }))));
      };
      part(deck.deck, mat('floor/lp', () => solid(look.floor, { roughness: 0.85 })));
      if (deck.cover) part(deck.cover, mat('cover/lp', () => solid(0xe6e1d6, { roughness: 0.6 })));
      if (deck.cover && font) for (const p of deck.labels || []) {
        const { shapes, dx, dy } = labelShapes(font, p);
        const t = new THREE.Mesh(new THREE.ShapeGeometry(shapes, 6).translate(dx + deck.ox, dy, 0).rotateX(-Math.PI / 2), mat('ink/lowpro', () => solid(INK.lowpro, { roughness: 0.55 })));
        t.position.set(0, deck.top + 0.06, deck.oz);
        floor.add(t);
      }
    } else {
      const d = new THREE.Mesh(new THREE.BoxGeometry(W + 4, deckT, H + 4), mat('floor/lp', () => solid(look.floor, { roughness: 0.85 })));
      d.position.y = deckT / 2;
      d.receiveShadow = true;
      floor.add(d);
    }
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(W * 6 + 600, H * 6 + 600).rotateX(-Math.PI / 2), mat('desk', () => new THREE.ShadowMaterial({ opacity: 0.35 })));
    desk.position.y = style === 'opengrid' ? -boardT - 0.01 : -0.01;
    desk.receiveShadow = true;
    floor.add(desk);
    const span = Math.max(W, H);
    sun.position.set(-span * 0.6, span * 1.4 + 200, span * 0.9 + 120);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: span * 4 + 800 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  function frame(view = 'iso') {
    // far enough that the board's bounding sphere fits the narrower of the two fields of view
    const W = size.cols * P, H = size.rows * P, R = Math.hypot(W, H) / 2 + 15;
    const v = (camera.fov * Math.PI) / 360, h = Math.atan(Math.tan(v) * camera.aspect);
    const d = R / Math.sin(Math.min(v, h)) * 0.86;
    const dir = { iso: [-0.35, 0.78, 0.8], top: [0, 1, 0.0001], front: [0, 0.42, 1] }[view];
    const l = Math.hypot(...dir);
    camera.position.set((dir[0] / l) * d, (dir[1] / l) * d, (dir[2] / l) * d);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function draw() { renderer.render(scene, camera); }
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  new ResizeObserver(resize).observe(container);

  // pointer to scene: the cell under it on the floor, or the case
  const ray = new THREE.Raycaster();
  const aim = (cx, cy) => {
    const rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1), camera);
  };

  // a port in grid mm (leads.js: a0..a1 along its side, the wall at `line`, z0..z1 up) as a slab on that wall
  function drawRoutes(routes) {
    leads.clear();
    if (!routes) return;
    const y0 = style === 'lowpro' ? deckT : 0, X = (gx) => gx - (size.cols * P) / 2, Z = (gy) => gy - (size.rows * P) / 2;
    const lineOf = (p) => {
      const c = cellsAt(cat.get(p.it.id), p.it.x, p.it.y, p.it.r).occ, xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
      return { E: Math.max(...xs) + 1, W: Math.min(...xs), N: Math.min(...ys), S: Math.max(...ys) + 1 }[p.side] * P;
    };
    const mark = (p, kind) => {
      const along = p.side === 'N' || p.side === 'S', len = p.a1 - p.a0, h = p.z1 - p.z0, t = 1.2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(along ? len : t, h, along ? t : len),
                               mat(`port/${kind}`, () => new THREE.MeshBasicMaterial({ color: PORT[kind], transparent: true, opacity: 0.75, depthWrite: false })));
      const line = lineOf(p), mid = (p.a0 + p.a1) / 2;
      m.position.set(along ? X(mid) : X(line), y0 + (p.z0 + p.z1) / 2, along ? Z(line) : Z(mid));
      leads.add(m);
    };
    const leadMat = mat('lead', () => solid(LEAD, { roughness: 0.4 }));
    const plugMat = mat('plug', () => solid(0xf4f3ef, { roughness: 0.5 }));
    for (const r of routes.pairs) {
      mark(r.a, 'pair'); mark(r.b, 'pair');
      const along = r.side === 'N' || r.side === 'S', dir = r.side === 'E' || r.side === 'S' ? 1 : -1, reach = 9;
      const at = (d) => (along ? new THREE.Vector3(X(r.at), y0 + r.z, Z(r.line + d)) : new THREE.Vector3(X(r.line + d), y0 + r.z, Z(r.at)));
      const curve = new THREE.CatmullRomCurve3([at(-dir * reach), at(-dir * reach * 0.3), at(dir * reach * 0.3), at(dir * reach)]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 1.6, 10), leadMat);
      leads.add(tube);
      for (const d of [-dir * reach, dir * reach]) {
        const plug = new THREE.Mesh(new THREE.BoxGeometry(along ? 8 : 6, 4.3, along ? 6 : 8), plugMat);
        plug.position.copy(at(d));
        leads.add(plug);
      }
    }
    for (const l of routes.loose) mark(l.port, l.kind);
  }

  let lastKey = '', ghostKey = '';
  return {
    canvas: renderer.domElement,
    update(L, { sel = null, style: st = style, xray = false, routes = null, lidLabels = true } = {}) {
      const resized = L.cols !== size.cols || L.rows !== size.rows;
      const restyled = st !== style;
      style = st; size = { cols: L.cols, rows: L.rows };
      if (resized || restyled || !floor.children.length) buildFloor();
      if (resized || !framed) { frame(); framed = true; }
      const faintCases = xray || !!routes;
      const key = `${style}|${xray}|${!!routes}|${lidLabels}|${sel}|${JSON.stringify(L.items)}`;
      if (key !== lastKey || resized || restyled) {
        lastKey = key;
        drawRoutes(routes);
        pieces.clear();
        for (const it of L.items) {
          if (!cat.get(it.id)) continue;
          const g = place(caseGroup(it.id, LOOK[style], faintCases ? 'xray' : it.uid === sel ? 'sel' : 'case', lidLabels ? it.labels : null), it.id, it.x, it.y, it.r);
          g.userData.uid = it.uid;
          pieces.add(g);
        }
      }
      ghost.clear(); ghostKey = '';
      draw();
    },
    // the case a pointer is on, by uid, or null
    pickPiece(cx, cy) {
      aim(cx, cy);
      const hit = ray.intersectObjects(pieces.children, true).find((h) => h.object.isMesh);
      let o = hit?.object;
      while (o && o.userData.uid === undefined) o = o.parent;
      return o ? o.userData.uid : null;
    },
    // the grid cell a pointer is over, on the floor the cases stand on, as layout.js's cellAt
    cellAt(cx, cy) {
      aim(cx, cy);
      const y0 = style === 'lowpro' ? deckT : 0;
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0), p)) return { x: -1, y: -1, inside: false };
      const fx = (p.x + (size.cols * P) / 2) / P, fy = (p.z + (size.rows * P) / 2) / P;
      return { x: Math.floor(fx), y: Math.floor(fy), inside: fx >= -0.5 && fy >= -0.5 && fx <= size.cols + 0.5 && fy <= size.rows + 0.5 };
    },
    // a see-through case where a drop would put it: green if it fits, red if not
    preview(id, x, y, r, bad) {
      const k = `${id}|${x}|${y}|${r}|${bad}`;
      if (k === ghostKey) return;
      ghostKey = k;
      ghost.clear();
      const g = place(caseGroup(id, LOOK[style], bad ? 'ghost-bad' : 'ghost-ok'), id, x, y, r);
      g.position.y += 0.3;
      ghost.add(g);
      draw();
    },
    hidePreview() {
      if (!ghost.children.length) return;
      ghost.clear(); ghostKey = '';
      draw();
    },
    view(v) { frame(v); },
    setDeck(d) {
      deck = d;
      if (size.cols) buildFloor();
      draw();
    },
  };
}
