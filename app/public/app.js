/* ────────────────────────────────────────────────
   Synweft — app.js  (sigma.js v2 + graphology)
   ──────────────────────────────────────────────── */

// ── DOM refs ──────────────────────────────────
const btnSave          = document.getElementById('btn-save');
const btnLoad          = document.getElementById('btn-load');
const btnLive          = document.getElementById('btn-live');
const snapshotSelect   = document.getElementById('snapshot-select');
const readonlyBadge    = document.getElementById('readonly-badge');
const ghostList        = document.getElementById('ghost-list');
const infoNodes        = document.getElementById('info-nodes');
const infoEdges        = document.getElementById('info-edges');
const infoGhosts       = document.getElementById('info-ghosts');
const infoTags         = document.getElementById('info-tags');
const liveIndicator    = document.getElementById('live-indicator');
const btnSettings      = document.getElementById('btn-settings');
const settingsPanel    = document.getElementById('settings-panel');
const btnSpClose       = document.getElementById('btn-sp-close');
const btnAnimate       = document.getElementById('btn-animate');
const ghostCountBadge  = document.getElementById('ghost-count-badge');
const spLabelThr       = document.getElementById('sp-label-thr');
const spNodeScale      = document.getElementById('sp-node-scale');
const spEdgeScale      = document.getElementById('sp-edge-scale');
const spGravity        = document.getElementById('sp-gravity');
const spRepulsion      = document.getElementById('sp-repulsion');
const spAttraction     = document.getElementById('sp-attraction');
const spMinDist        = document.getElementById('sp-min-dist');
const valLabelThr      = document.getElementById('val-label-thr');
const valNodeScale     = document.getElementById('val-node-scale');
const valEdgeScale     = document.getElementById('val-edge-scale');
const valGravity       = document.getElementById('val-gravity');
const valRepulsion     = document.getElementById('val-repulsion');
const valAttraction    = document.getElementById('val-attraction');
const valMinDist       = document.getElementById('val-min-dist');
const searchInput      = document.getElementById('search-input');
const searchClear      = document.getElementById('search-clear');
const filterGhosts     = document.getElementById('filter-ghosts');
const filterTags       = document.getElementById('filter-tags');
const filterDegree     = document.getElementById('filter-degree-range');
const filterDegreeVal  = document.getElementById('filter-degree-val');
const filterDirections = document.getElementById('filter-directions');
const tooltip          = document.getElementById('node-tooltip');
const tooltipName      = document.getElementById('tooltip-name');
const tooltipMeta      = document.getElementById('tooltip-meta');

// ── Palette ───────────────────────────────────
const COLORS = {
  nodeDefault:  '#64748B',
  nodeHover:    '#22C55E',
  nodeSelected: '#4ADE80',
  nodeNeighbor: '#86EFAC',
  nodeGhost:    '#253348',
  nodeTag:      '#818CF8',
  edgeDefault:  'rgba(100,116,139,0.18)',
  edgeActive:   'rgba(34,197,94,0.7)',
  fadedNode:    '#1A2535',
  fadedEdge:    'rgba(100,116,139,0.03)',
};

// ── Paramètres UI ─────────────────────────────
const uiSettings = {
  labelThreshold: 5,
  nodeScale:      1.0,
  edgeScale:      1.0,
  gravity:        0,
  repulsion:      5000,
  attraction:     0.008,
  minDist:        60,
};

// ── État ──────────────────────────────────────
let graph         = null;
let renderer      = null;
let isReadOnly    = false;
let animateId     = null;
let animState     = null;
let overlayCanvas = null;
let overlayCtx    = null;

const state = {
  hoveredNode:  null,
  selectedNode: null,
  searchQuery:  '',
};

// Cache des voisins pour éviter graph.neighbors() dans chaque frame
let activeNeighbors = new Set();

function refreshNeighbors() {
  activeNeighbors.clear();
  const active = state.selectedNode || state.hoveredNode;
  if (active && graph && graph.hasNode(active)) {
    graph.neighbors(active).forEach(n => activeNeighbors.add(n));
  }
}

// ── LOI 1 — Taille des nœuds selon degré ─────
// Plus un nœud est connecté, plus il est grand
function getBaseSize(isGhost, isTag, wdeg) {
  // LOI 1 — taille ∝ √(degré pondéré). Fallback : wdeg = degré simple si pas de poids.
  if (isTag)   return 3.5;
  if (isGhost) return 3;
  return 3 + 1.8 * Math.sqrt(Math.max(0, wdeg));
}

// ── LOI 2 — Opacité des nœuds selon degré ────
// Les hubs sont opaques, les feuilles transparentes
function getNodeOpacity(wdeg) {
  // LOI 2 — opacité interpolée continue selon le degré pondéré.
  const t = Math.min(1, wdeg / 18);
  return {
    fill:    0.08 + t * 0.16,
    stroke:  0.35 + t * 0.65,
    strokeW: 0.6  + t * 0.9,
  };
}

// ── Reducers (appelés chaque frame par sigma) ──
function nodeReducer(node, data) {
  const res = { ...data, type: 'circle' };
  if (data._hidden) { res.hidden = true; return res; }

  const isGhost    = data.ghost === true;
  const isTag      = data.ntype === 'tag';
  const deg        = graph.degree(node);
  const wdeg       = data.wdegree || deg;

  // LOI 1 — Taille ∝ √(degré pondéré)
  res.size = getBaseSize(isGhost, isTag, wdeg) * uiSettings.nodeScale;

  // LOI 4 — Toujours circle pour que les liens s'arrêtent au bord
  res.type = 'circle';

  // Couleur WebGL = fond opaque → masque l'arête à l'intérieur du nœud.
  // L'apparence réelle (cercle vitré / triangle tag) est dessinée par drawNodeOverlay().
  res.color = '#09060F';

  // LOI 6 — Les hubs sont au-dessus (basé sur wdeg)
  res.zIndex = isTag || isGhost ? 1 : wdeg > 10 ? 3 : wdeg > 4 ? 2 : 1;

  // Recherche — estompe les non-matchs (supprime le label)
  if (state.searchQuery && !node.toLowerCase().includes(state.searchQuery)) {
    res.label = '';
  }

  return res;
}

function edgeReducer(edge, data) {
  const res     = { ...data };
  const src     = graph.source(edge);
  const tgt     = graph.target(edge);
  const srcData = graph.getNodeAttributes(src);
  const tgtData = graph.getNodeAttributes(tgt);

  if (srcData._hidden || tgtData._hidden) { res.hidden = true; return res; }

  const isGhostEdge = srcData.ghost || tgtData.ghost;
  const w           = data.weight || 1;
  const tw          = Math.min(1, (w - 1) / 2); // w=1→0, w≥3→1

  // ── Lien fantôme — rose, intensité modulée par le poids
  if (isGhostEdge) {
    res.color  = `rgba(244,114,182,${(0.22 + tw * 0.28).toFixed(2)})`;
    res.size   = (0.5 + tw * 0.5) * uiSettings.edgeScale;
    res.zIndex = 1; // ghost edges SOUS les nœuds ghost (zIndex:1)
    return res;
  }

  // ── Lien normal — épaisseur + opacité ∝ poids du lien (pas degré des nœuds)
  const opacity = 0.14 + tw * 0.38;   // 0.14 → 0.52
  const weight  = 0.5  + tw * 1.3;    // 0.5  → 1.8

  res.color  = `rgba(168,85,247,${opacity.toFixed(2)})`;
  res.size   = weight * uiSettings.edgeScale;
  // Z-order : liens forts au-dessus
  res.zIndex = w >= 3 ? 2 : 1;

  return res;
}

// ── Canvas overlay : nœuds vitrés + triangles tags ──────
// Inséré entre le WebGL nodes et le canvas labels de sigma.
// Le WebGL node (couleur = fond) masque l'arête ; l'overlay dessine l'apparence réelle.

function setupNodeOverlay() {
  const existing = document.getElementById('node-overlay');
  if (existing) existing.remove();

  overlayCanvas = document.createElement('canvas');
  overlayCanvas.id = 'node-overlay';
  overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';

  // Insérer APRÈS le canvas WebGL "nodes" de sigma (et donc avant "labels")
  const sigmaCanvases = renderer.getCanvases();
  sigmaCanvases.nodes.after(overlayCanvas);

  resizeOverlay();
}

function resizeOverlay() {
  if (!overlayCanvas || !renderer) return;
  const { width, height } = renderer.getDimensions();
  const dpr = window.devicePixelRatio || 1;
  // Match sigma's physical resolution (DPR-scaled buffer, CSS-sized display)
  overlayCanvas.width  = Math.round(width  * dpr);
  overlayCanvas.height = Math.round(height * dpr);
  overlayCanvas.style.width  = width  + 'px';
  overlayCanvas.style.height = height + 'px';
  overlayCtx = overlayCanvas.getContext('2d');
  // Apply DPR scale once : coordinates in CSS pixels → draws at physical resolution
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawNodeOverlay() {
  if (!overlayCtx || !renderer || !graph) return;
  // clearRect in CSS pixel space (transform already applied once in resizeOverlay)
  const { width, height } = renderer.getDimensions();
  overlayCtx.clearRect(0, 0, width, height);

  // Taille des nœuds : reproduit la formule WebGL sigma
  // gl_PointSize = size * max(W,H) / normRatio / camRatio → rayon = gl_PointSize / 2
  const normRatio = renderer.normalizationFunction.ratio;
  const camRatio  = renderer.getCamera().ratio;
  // Formule validée visuellement : rayon CSS = size * max(W,H) / normRatio / camRatio
  const sizeScale = Math.max(width, height) / normRatio / camRatio;

  graph.forEachNode((node, attrs) => {
    if (attrs._hidden) return;
    const dd = renderer.getNodeDisplayData(node);
    if (!dd || dd.hidden) return;

    const vp       = renderer.graphToViewport({ x: attrs.x, y: attrs.y });
    const deg      = attrs.degree  || 0;
    const wdeg     = attrs.wdegree || deg;
    const isGhost  = attrs.ghost === true;
    const isTag    = attrs.ntype === 'tag';
    // LOI 1 — taille cohérente avec nodeReducer (wdeg)
    const baseSize = getBaseSize(isGhost, isTag, wdeg);
    const r        = baseSize * uiSettings.nodeScale * sizeScale;
    if (r < 0.4) return;

    const isHov = node === state.hoveredNode;
    const isSel = node === state.selectedNode;

    const isDimmed = !!(state.searchQuery && !node.toLowerCase().includes(state.searchQuery));

    overlayCtx.save();
    if (isTag) {
      _drawTagNode(vp.x, vp.y, r, isHov, isDimmed);
    } else {
      _drawNoteNode(vp.x, vp.y, r, wdeg, isGhost, isHov, isSel, isDimmed);
    }
    overlayCtx.restore();
  });
}

function _drawNoteNode(x, y, r, wdeg, isGhost, isHov, isSel, isDimmed) {
  // 1. Fond opaque légèrement plus grand → couvre l'arête jusqu'au bord du stroke
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, r + 1.2, 0, Math.PI * 2);
  overlayCtx.fillStyle = '#09060F';
  overlayCtx.fill();

  // 2. Remplissage vitré — LOI 2 : opacité selon degré
  let fill, stroke, sw;
  if (isDimmed) {
    // Recherche : non-match — très estompé
    fill   = 'rgba(168,85,247,0.03)';
    stroke = 'rgba(168,85,247,0.06)';
    sw     = 0.5;
  } else if (isGhost) {
    fill   = 'rgba(244,114,182,0.07)';
    stroke = isHov ? 'rgba(244,114,182,0.95)' : 'rgba(244,114,182,0.45)';
    sw     = isHov ? 1.5 : 0.8;
  } else {
    const op = getNodeOpacity(wdeg);
    fill   = isHov || isSel ? 'rgba(168,85,247,0.35)' : `rgba(168,85,247,${op.fill})`;
    stroke = isHov || isSel ? '#A855F7'               : `rgba(168,85,247,${op.stroke})`;
    sw     = isHov || isSel ? 1.8                     : op.strokeW;
  }

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, r, 0, Math.PI * 2);
  overlayCtx.fillStyle = fill;
  overlayCtx.fill();
  overlayCtx.strokeStyle = stroke;
  overlayCtx.lineWidth   = sw;
  overlayCtx.stroke();
}

function _drawTagNode(x, y, r, isHov, isDimmed) {
  const h = r * 1.3; // légèrement plus grand pour équilibrer visuellement
  overlayCtx.beginPath();
  overlayCtx.moveTo(x,            y - h);
  overlayCtx.lineTo(x + h * 0.866, y + h * 0.5);
  overlayCtx.lineTo(x - h * 0.866, y + h * 0.5);
  overlayCtx.closePath();

  // Fond opaque légèrement agrandi (scale depuis le centre du nœud)
  const hm = h * 1.08;
  overlayCtx.beginPath();
  overlayCtx.moveTo(x,               y - hm);
  overlayCtx.lineTo(x + hm * 0.866,  y + hm * 0.5);
  overlayCtx.lineTo(x - hm * 0.866,  y + hm * 0.5);
  overlayCtx.closePath();
  overlayCtx.fillStyle = '#09060F';
  overlayCtx.fill();
  // Fill magenta vitré (ou estompé si non-match)
  overlayCtx.fillStyle = isDimmed ? 'rgba(224,64,251,0.03)' : isHov ? 'rgba(224,64,251,0.22)' : 'rgba(224,64,251,0.10)';
  overlayCtx.fill();
  // Contour
  overlayCtx.strokeStyle = isDimmed ? 'rgba(224,64,251,0.06)' : isHov ? 'rgba(224,64,251,0.90)' : 'rgba(224,64,251,0.55)';
  overlayCtx.lineWidth   = isDimmed ? 0.5 : isHov ? 1.2 : 0.8;
  overlayCtx.stroke();
}

// ── Rendu hover personnalisé (halo + label uniquement) ──
// Le nœud lui-même est déjà redessiné avec l'état hover par drawNodeOverlay().
// Ce callback (canvas "hovers" sigma, z-order au-dessus de l'overlay) ajoute le halo
// extérieur et le label — sans aucun rectangle noir.
function customDrawNodeHover(context, data, settings) {
  const isGhost = data.ghost === true;
  const isTag   = data.ntype === 'tag';
  const size    = data.size;
  const x       = data.x;
  const y       = data.y;

  // Halo extérieur subtil
  context.beginPath();
  context.arc(x, y, size + 6, 0, Math.PI * 2);
  context.fillStyle = isTag
    ? 'rgba(224,64,251,0.10)'
    : isGhost
    ? 'rgba(244,114,182,0.10)'
    : 'rgba(168,85,247,0.12)';
  context.fill();

  // Label — fond sombre, PAS de rectangle noir sigma
  if (data.label) {
    const fs = Math.max(settings.labelSize || 12, 11);
    context.font = `500 ${fs}px IBM Plex Sans, sans-serif`;
    const tw = context.measureText(data.label).width;
    const ly = y - size - 8;

    context.fillStyle = 'rgba(9,6,15,0.85)';
    context.beginPath();
    context.roundRect(x - tw / 2 - 6, ly - fs, tw + 12, fs + 5, 3);
    context.fill();

    context.fillStyle = '#EDE8F5';
    context.textAlign = 'center';
    context.fillText(data.label, x, ly);
  }
}

// ── Spring animation (per-frame) ──────────────
function startAnimation() {
  if (animateId || !graph) return;
  btnAnimate.textContent = 'Stop';
  btnAnimate.classList.add('active');

  const nodes = graph.nodes();
  const n = nodes.length;
  const nodeIndex = {};
  nodes.forEach((nd, i) => { nodeIndex[nd] = i; });

  animState = {
    nodes, n, nodeIndex,
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    xs: nodes.map(nd => graph.getNodeAttribute(nd, 'x')),
    ys: nodes.map(nd => graph.getNodeAttribute(nd, 'y')),
  };

  function frame() {
    const { nodes, n, nodeIndex, vx, vy, xs, ys } = animState;
    const REP  = uiSettings.repulsion;
    const ATT  = uiSettings.attraction;
    const GRAV = uiSettings.gravity;
    const DAMP = 0.55;
    const MIND = Math.max(1, uiSettings.minDist);
    const MAXV = 30;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
        const dist  = Math.max(MIND, Math.sqrt(dx * dx + dy * dy));
        const force = REP / (dist * dist);
        const fx = force * dx / dist, fy = force * dy / dist;
        vx[i] -= fx; vy[i] -= fy;
        vx[j] += fx; vy[j] += fy;
      }
    }
    if (GRAV > 0) {
      for (let i = 0; i < n; i++) {
        vx[i] -= GRAV * xs[i];
        vy[i] -= GRAV * ys[i];
      }
    }
    graph.forEachEdge((_e, _a, src, tgt) => {
      const si = nodeIndex[src], ti = nodeIndex[tgt];
      if (si === undefined || ti === undefined) return;
      const dx = xs[ti] - xs[si], dy = ys[ti] - ys[si];
      vx[si] += ATT * dx; vy[si] += ATT * dy;
      vx[ti] -= ATT * dx; vy[ti] -= ATT * dy;
    });
    for (let i = 0; i < n; i++) {
      vx[i] *= DAMP; vy[i] *= DAMP;
      const spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      if (spd > MAXV) { vx[i] = vx[i] / spd * MAXV; vy[i] = vy[i] / spd * MAXV; }
      xs[i] += vx[i]; ys[i] += vy[i];
    }
    // Collision correction par frame (3 passes légères)
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < MIND * MIND && d2 > 0.001) {
            const d    = Math.sqrt(d2);
            const push = (MIND - d) * 0.5 / d;
            xs[i] -= dx * push; ys[i] -= dy * push;
            xs[j] += dx * push; ys[j] += dy * push;
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      graph.setNodeAttribute(nodes[i], 'x', xs[i]);
      graph.setNodeAttribute(nodes[i], 'y', ys[i]);
    }
    if (renderer) renderer.refresh();
    animateId = requestAnimationFrame(frame);
  }
  animateId = requestAnimationFrame(frame);
}

function stopAnimation() {
  if (animateId) { cancelAnimationFrame(animateId); animateId = null; }
  animState = null;
  btnAnimate.textContent = 'Animer';
  btnAnimate.classList.remove('active');
}

// ── Initialisation du graphe ───────────────────
function initGraph(graphData) {
  stopAnimation();
  if (renderer) { renderer.kill(); renderer = null; }

  graph = new graphology.Graph({ multi: false, allowSelfLoops: false });

  // Calcul des degrés (count) ET des degrés pondérés (somme des poids).
  // Fallback w=1 si l'arête n'a pas de weight → rétro-compatible avec ton backend.
  const deg  = {};
  const wdeg = {};
  for (const e of graphData.edges) {
    const w = (typeof e.data.weight === 'number' && e.data.weight > 0) ? e.data.weight : 1;
    deg[e.data.source]  = (deg[e.data.source]  || 0) + 1;
    deg[e.data.target]  = (deg[e.data.target]  || 0) + 1;
    wdeg[e.data.source] = (wdeg[e.data.source] || 0) + w;
    wdeg[e.data.target] = (wdeg[e.data.target] || 0) + w;
  }

  // Nœuds
  for (const n of graphData.nodes) {
    const id      = n.data.id;
    const degree  = deg[id]  || 0;
    const wDegree = wdeg[id] || 0;
    const isTag   = n.data.type === 'tag';
    const isGhost = !!n.data.ghost;
    // baseSize cohérent avec getBaseSize (LOI 1, sur degré pondéré)
    const baseSize = getBaseSize(isGhost, isTag, wDegree);
    const color    = isTag ? COLORS.nodeTag : isGhost ? COLORS.nodeGhost : COLORS.nodeDefault;

    if (graph.hasNode(id)) continue;
    graph.addNode(id, {
      x:         (Math.random() - 0.5) * 200,
      y:         (Math.random() - 0.5) * 200,
      size:      baseSize,
      _baseSize: baseSize,
      label:     id,
      color,
      ntype:     n.data.type || 'note',
      ghost:     isGhost,
      degree,
      wdegree:   wDegree,
      _hidden:   false,
    });
  }

  // Arêtes
  for (const e of graphData.edges) {
    const s = e.data.source, t = e.data.target;
    if (s === t) continue; // ignore self-loops
    if (!graph.hasNode(s) || !graph.hasNode(t)) continue;
    if (graph.hasEdge(s, t) || graph.hasEdge(t, s)) continue;
    const w = (typeof e.data.weight === 'number' && e.data.weight > 0) ? e.data.weight : 1;
    graph.addEdge(s, t, {
      color:         COLORS.edgeDefault,
      size:          0.6,
      weight:        w,
      bidirectional: e.data.bidirectional || false,
    });
  }

  // Layout initial : circulaire puis spring synchrone (stable avant init sigma)
  if (graph.order > 0) {
    circularLayout(graph);
    springStep(500);
  }

  // Rendu sigma.js (WebGL)
  renderer = new Sigma(graph, document.getElementById('cy'), {
    renderEdgeLabels:          false,
    allowInvalidContainer:     true,
    defaultNodeType:           'circle',
    minCameraRatio:            0.005,
    maxCameraRatio:            20,
    nodeReducer,
    edgeReducer,
    labelFont:                 'IBM Plex Sans, system-ui, sans-serif',
    labelSize:                 10,
    labelColor:                { color: 'rgba(148,163,184,0.65)' },
    labelThreshold:            uiSettings.labelThreshold,
    // LOI 3 — Labels seulement sur les nœuds assez grands
    labelRenderedSizeThreshold: 6,
    edgeLabelSize:             8,
    stagePadding:              40,
    backgroundColor:           '#09060F',
    // LOI 6 — Z-order : hubs au-dessus, liens entre hubs au-dessus
    zIndex:                    true,
    drawNodeHover:             customDrawNodeHover,
  });

  // Canvas overlay (nœuds vitrés + triangles tags + masque arêtes internes)
  setupNodeOverlay();
  renderer.on('afterRender', drawNodeOverlay);
  renderer.on('resize', () => { resizeOverlay(); drawNodeOverlay(); });

  bindSigmaEvents();
  applyFilters();
  fitCamera();

  window._g = graph;
  window._r = renderer;
}

// ── Fit caméra sur le cluster principal ───────
function fitCamera(animated = false) {
  if (!renderer || !graph || graph.order === 0) return;

  // Bounding box des notes connectées uniquement (exclut les isolés et les tags/fantômes
  // qui dérivent loin sous l'effet de la répulsion)
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  graph.forEachNode((node, attrs) => {
    if (attrs.ntype === 'note' && !attrs.ghost && attrs.degree > 0) {
      if (attrs.x < xMin) xMin = attrs.x;
      if (attrs.x > xMax) xMax = attrs.x;
      if (attrs.y < yMin) yMin = attrs.y;
      if (attrs.y > yMax) yMax = attrs.y;
    }
  });
  if (xMin === Infinity) { xMin = -100; xMax = 100; yMin = -100; yMax = 100; }

  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const normCenter = renderer.normalizationFunction({ x: cx, y: cy });
  const normXmin   = renderer.normalizationFunction({ x: xMin, y: cy });
  const normXmax   = renderer.normalizationFunction({ x: xMax, y: cy });
  const normYmin   = renderer.normalizationFunction({ x: cx, y: yMin });
  const normYmax   = renderer.normalizationFunction({ x: cx, y: yMax });

  const normW = normXmax.x - normXmin.x;
  const normH = normYmax.y - normYmin.y;

  const { width, height } = renderer.getDimensions();
  // sigma viewport transform: vp = (norm - cam) * effective / ratio + center
  // effective = width - 2 * stagePadding (we set stagePadding=40)
  // visible norm span: width * ratio / effective (x), height * ratio / effective (y)
  const stagePadding = 40;
  const effective = width - 2 * stagePadding;
  const fill = 0.82;
  const ratioX = normW > 0 ? normW * effective / (fill * width)  : 0.5;
  const ratioY = normH > 0 ? normH * effective / (fill * height) : 0.5;
  const ratio  = Math.max(ratioX, ratioY, 0.05);

  const target = { x: normCenter.x, y: normCenter.y, ratio, angle: 0 };
  if (animated) {
    renderer.getCamera().animate(target, { duration: 500, easing: 'quadraticInOut' });
  } else {
    renderer.getCamera().setState(target);
  }
  renderer.refresh();
}

// ── Layout circulaire (positions initiales stables) ──
function circularLayout(graph) {
  const nodes = graph.nodes();
  const n = nodes.length;
  // Larger initial radius → less overlap before spring runs
  const radius = Math.max(150, n * 6);
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    graph.setNodeAttribute(node, 'x', radius * Math.cos(angle));
    graph.setNodeAttribute(node, 'y', radius * Math.sin(angle));
  });
}

// ── Spring layout stable (avec clamping des forces) ──
function springStep(iterations) {
  if (!graph) return;
  const nodes      = graph.nodes();
  const n          = nodes.length;
  const REPULSION  = uiSettings.repulsion;
  const ATTRACTION = uiSettings.attraction;
  const DAMPING    = 0.55;
  const MIN_DIST   = Math.max(1, uiSettings.minDist);
  const MAX_VEL    = 30;

  // Index O(1) pour l'attraction (évite indexOf O(n) dans la boucle)
  const nodeIndex = {};
  nodes.forEach((nd, i) => { nodeIndex[nd] = i; });

  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const xs = nodes.map(nd => graph.getNodeAttribute(nd, 'x'));
  const ys = nodes.map(nd => graph.getNodeAttribute(nd, 'y'));

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
        const dist  = Math.max(MIN_DIST, Math.sqrt(dx * dx + dy * dy));
        const force = REPULSION / (dist * dist);
        const fx = force * dx / dist, fy = force * dy / dist;
        vx[i] -= fx; vy[i] -= fy;
        vx[j] += fx; vy[j] += fy;
      }
    }
    // Attraction
    graph.forEachEdge((_e, _a, src, tgt) => {
      const si = nodeIndex[src], ti = nodeIndex[tgt];
      if (si === undefined || ti === undefined) return;
      const dx = xs[ti] - xs[si], dy = ys[ti] - ys[si];
      vx[si] += ATTRACTION * dx; vy[si] += ATTRACTION * dy;
      vx[ti] -= ATTRACTION * dx; vy[ti] -= ATTRACTION * dy;
    });
    // Appliquer avec clamp
    for (let i = 0; i < n; i++) {
      vx[i] *= DAMPING; vy[i] *= DAMPING;
      const spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      if (spd > MAX_VEL) { vx[i] = vx[i] / spd * MAX_VEL; vy[i] = vy[i] / spd * MAX_VEL; }
      xs[i] += vx[i]; ys[i] += vy[i];
    }
  }
  // ── Collision correction : 15 passes post-spring ──
  // Garantit qu'aucun nœud ne se superpose à un autre (min sep = MIN_DIST)
  for (let pass = 0; pass < 15; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < MIN_DIST * MIN_DIST && d2 > 0.001) {
          const d    = Math.sqrt(d2);
          const push = (MIN_DIST - d) * 0.5 / d;
          xs[i] -= dx * push; ys[i] -= dy * push;
          xs[j] += dx * push; ys[j] += dy * push;
        }
      }
    }
  }

  // Écrire les positions finales dans le graphe
  nodes.forEach((nd, i) => {
    graph.setNodeAttribute(nd, 'x', xs[i]);
    graph.setNodeAttribute(nd, 'y', ys[i]);
  });
}

// ── Événements sigma ──────────────────────────
function bindSigmaEvents() {
  const cyDiv = document.getElementById('cy');

  // Tooltip : suit la souris
  cyDiv.addEventListener('mousemove', (e) => {
    if (tooltip.classList.contains('visible')) {
      tooltip.style.left = e.clientX + 'px';
      tooltip.style.top  = e.clientY + 'px';
    }
  });

  renderer.on('enterNode', ({ node }) => {
    state.hoveredNode = node;
    refreshNeighbors();

    const attrs = graph.getNodeAttributes(node);
    tooltipName.textContent = node;
    tooltipMeta.textContent =
      attrs.ntype === 'tag' ? `#tag · ${attrs.degree} note${attrs.degree !== 1 ? 's' : ''}` :
      attrs.ghost           ? 'note fantôme' :
                              `${attrs.degree} lien${attrs.degree !== 1 ? 's' : ''}`;
    tooltip.style.left = '-200px'; // positionnement initial hors écran
    tooltip.classList.add('visible');
    renderer.refresh();
  });

  renderer.on('leaveNode', () => {
    state.hoveredNode = null;
    activeNeighbors.clear();
    tooltip.classList.remove('visible');
    renderer.refresh();
  });

  renderer.on('clickNode', ({ node }) => {
    tooltip.classList.remove('visible');
    state.hoveredNode = null;
    state.selectedNode = state.selectedNode === node ? null : node;
    refreshNeighbors();

    if (state.selectedNode) {
      const attrs = graph.getNodeAttributes(node);
      const norm  = renderer.normalizationFunction({ x: attrs.x, y: attrs.y });
      renderer.getCamera().animate(
        { x: norm.x, y: norm.y, ratio: 0.25 },
        { duration: 350, easing: 'quadraticInOut' }
      );
    }
    renderer.refresh();
  });

  renderer.on('clickStage', () => {
    state.selectedNode = null;
    state.hoveredNode  = null;
    activeNeighbors.clear();
    renderer.refresh();
  });

  // Drag nœuds
  let dragging = false;
  let dragNode = null;

  renderer.on('downNode', ({ node }) => {
    dragging = true;
    dragNode = node;
    renderer.getCamera().disable();
  });

  renderer.getMouseCaptor().on('mousemovebody', (e) => {
    if (!dragging || !dragNode) return;
    const pos = renderer.viewportToGraph(e);
    graph.setNodeAttribute(dragNode, 'x', pos.x);
    graph.setNodeAttribute(dragNode, 'y', pos.y);
    e.preventSigmaDefault();
    e.original.preventDefault();
    e.original.stopPropagation();
  });

  renderer.getMouseCaptor().on('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    dragNode = null;
    renderer.getCamera().enable();
  });
}

// ── Filtres ───────────────────────────────────
function applyFilters() {
  if (!graph) return;
  const showGhosts   = filterGhosts.checked;
  const showTagNodes = filterTags.checked;
  const minDeg       = parseInt(filterDegree.value, 10);

  graph.forEachNode((node, attrs) => {
    let hidden = false;
    if (attrs.ntype === 'note' && attrs.ghost && !showGhosts) hidden = true;
    if (attrs.ntype === 'tag'  && !showTagNodes)              hidden = true;
    if (attrs.degree < minDeg)                               hidden = true;
    graph.setNodeAttribute(node, '_hidden', hidden);
  });

  if (renderer) renderer.refresh();
}

// ── Recherche ─────────────────────────────────
function applySearch(term) {
  state.searchQuery  = term.toLowerCase().trim();
  state.selectedNode = null;
  state.hoveredNode  = null;
  activeNeighbors.clear();
  if (!renderer) return;

  if (state.searchQuery) {
    let first = null;
    graph.forEachNode((node, attrs) => {
      if (!first && node.toLowerCase().includes(state.searchQuery) && !attrs._hidden) first = node;
    });
    if (first) {
      const attrs = graph.getNodeAttributes(first);
      const norm  = renderer.normalizationFunction({ x: attrs.x, y: attrs.y });
      renderer.getCamera().animate(
        { x: norm.x, y: norm.y, ratio: 0.2 },
        { duration: 350, easing: 'quadraticInOut' }
      );
    }
  }

  renderer.refresh();
}

// ── Panel stats ───────────────────────────────
function updatePanelStats(graphData) {
  const ghostCount = graphData.nodes.filter(n => n.data.ghost && n.data.type === 'note').length;
  const noteCount  = graphData.nodes.filter(n => n.data.type === 'note' && !n.data.ghost).length;
  const el = id => document.getElementById(id);
  if (el('stat-nodes'))  el('stat-nodes').textContent  = noteCount;
  if (el('stat-edges'))  el('stat-edges').textContent  = graphData.edges.length;
  if (el('stat-ghosts')) el('stat-ghosts').textContent = ghostCount;
}

// ── Panel ghost notes ──────────────────────────
function updateGhostPanel(graphData) {
  const ghosts = graphData.nodes.filter(n => n.data.ghost && n.data.type === 'note');
  if (ghostCountBadge) ghostCountBadge.textContent = ghosts.length;
  ghostList.innerHTML = '';

  if (!ghosts.length) {
    ghostList.innerHTML = '<li class="empty-msg">Aucune note fantôme détectée.</li>';
    return;
  }

  for (const g of ghosts) {
    const li = document.createElement('li');
    li.textContent = g.data.id;
    li.title = `Note manquante : ${g.data.id}`;
    li.addEventListener('click', () => {
      if (!graph || !graph.hasNode(g.data.id)) return;
      state.selectedNode = g.data.id;
      refreshNeighbors();
      const a    = graph.getNodeAttributes(g.data.id);
      const norm = renderer.normalizationFunction({ x: a.x, y: a.y });
      renderer.getCamera().animate({ x: norm.x, y: norm.y, ratio: 0.3 }, { duration: 300 });
      renderer.refresh();
    });
    ghostList.appendChild(li);
  }
}

// ── Barre de statut ───────────────────────────
function updateStatusBar(graphData) {
  const ghostCount = graphData.nodes.filter(n => n.data.ghost && n.data.type === 'note').length;
  const tagCount   = graphData.nodes.filter(n => n.data.type === 'tag').length;
  infoNodes.textContent  = `${graphData.nodes.length} nœuds`;
  infoEdges.textContent  = `${graphData.edges.length} liens`;
  infoGhosts.textContent = `${ghostCount} fantôme${ghostCount !== 1 ? 's' : ''}`;
  infoTags.textContent   = `${tagCount} tag${tagCount !== 1 ? 's' : ''}`;
}

// ── Chargement ────────────────────────────────
async function loadLiveGraph() {
  try {
    const res = await fetch('/graph');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    initGraph(data);
    updateGhostPanel(data);
    updateStatusBar(data);
    updatePanelStats(data);

    const maxDeg = Math.max(0, ...data.nodes.map(n => {
      return data.edges.filter(e => e.data.source === n.data.id || e.data.target === n.data.id).length;
    }));
    filterDegree.max = maxDeg || 20;
  } catch (err) {
    console.error('Impossible de charger le graphe :', err);
  }
}

// ── Historique ────────────────────────────────
async function loadSnapshotList() {
  try {
    const res = await fetch('/history');
    const snapshots = await res.json();
    snapshotSelect.innerHTML = '<option value="">— Charger un snapshot —</option>';
    for (const s of snapshots) {
      const opt = document.createElement('option');
      opt.value = s.filename;
      const date = new Date(s.createdAt).toLocaleString('fr-FR');
      opt.textContent = `${s.filename.replace('snapshot-', '').replace('.json', '')} — ${date}`;
      snapshotSelect.appendChild(opt);
    }
  } catch (err) {
    console.error('Erreur liste snapshots :', err);
  }
}

async function saveSnapshot() {
  try {
    btnSave.disabled = true;
    btnSave.textContent = 'Saving…';
    const res = await fetch('/history/save', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadSnapshotList();
      snapshotSelect.value = data.filename;
    }
  } catch (err) {
    console.error('Erreur sauvegarde :', err);
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = 'Snapshot';
  }
}

async function loadSnapshot(filename) {
  if (!filename) return;
  try {
    const res = await fetch(`/history/${filename}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { graph: g } = await res.json();
    initGraph(g);
    updateGhostPanel(g);
    updateStatusBar(g);
    updatePanelStats(g);
    isReadOnly = true;
    readonlyBadge.style.display = 'inline';
    btnLive.style.display       = 'inline';
  } catch (err) {
    console.error('Impossible de charger le snapshot :', err);
  }
}

async function returnToLive() {
  isReadOnly = false;
  readonlyBadge.style.display = 'none';
  btnLive.style.display       = 'none';
  snapshotSelect.value        = '';
  await loadLiveGraph();
}

// ── SSE ───────────────────────────────────────
function connectSSE() {
  const evtSource = new EventSource('/watch');
  evtSource.addEventListener('connected', () => liveIndicator.classList.remove('offline'));
  evtSource.addEventListener('change', async () => {
    if (!isReadOnly) {
      await loadLiveGraph();
      await loadSnapshotList();
    }
  });
  evtSource.onerror = () => {
    liveIndicator.classList.add('offline');
    evtSource.close();
    setTimeout(connectSSE, 3000);
  };
}

// ── Événements UI ────────────────────────────

// Settings panel toggle
btnSettings.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
btnSpClose.addEventListener('click',  () => settingsPanel.classList.add('hidden'));

// Animate button
btnAnimate.addEventListener('click', () => {
  if (animateId) stopAnimation();
  else           startAnimation();
});

// Sliders settings
spLabelThr.addEventListener('input', () => {
  uiSettings.labelThreshold = parseFloat(spLabelThr.value);
  valLabelThr.textContent   = spLabelThr.value;
  if (renderer) renderer.setSetting('labelThreshold', uiSettings.labelThreshold);
});
spNodeScale.addEventListener('input', () => {
  uiSettings.nodeScale     = parseFloat(spNodeScale.value);
  valNodeScale.textContent = parseFloat(spNodeScale.value).toFixed(1);
  if (renderer) renderer.refresh();
});
spEdgeScale.addEventListener('input', () => {
  uiSettings.edgeScale     = parseFloat(spEdgeScale.value);
  valEdgeScale.textContent = parseFloat(spEdgeScale.value).toFixed(1);
  if (renderer) renderer.refresh();
});
spGravity.addEventListener('input', () => {
  uiSettings.gravity      = parseFloat(spGravity.value);
  valGravity.textContent  = parseFloat(spGravity.value).toFixed(2);
});
spRepulsion.addEventListener('input', () => {
  uiSettings.repulsion     = parseInt(spRepulsion.value, 10);
  valRepulsion.textContent = spRepulsion.value;
});
spAttraction.addEventListener('input', () => {
  uiSettings.attraction     = parseFloat(spAttraction.value);
  valAttraction.textContent = parseFloat(spAttraction.value).toFixed(3);
});
spMinDist.addEventListener('input', () => {
  uiSettings.minDist     = parseInt(spMinDist.value, 10);
  valMinDist.textContent = spMinDist.value;
});

btnSave.addEventListener('click', saveSnapshot);
btnLoad.addEventListener('click', () => { if (snapshotSelect.value) loadSnapshot(snapshotSelect.value); });
btnLive.addEventListener('click', returnToLive);

searchInput.addEventListener('input', () => {
  const term = searchInput.value.trim();
  searchClear.classList.toggle('visible', term.length > 0);
  applySearch(term);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    searchClear.classList.remove('visible');
    applySearch('');
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  applySearch('');
  searchInput.focus();
});

filterGhosts.addEventListener('change', applyFilters);
filterTags.addEventListener('change', applyFilters);
filterDegree.addEventListener('input', () => {
  filterDegreeVal.textContent = filterDegree.value;
  applyFilters();
});

filterDirections.addEventListener('change', () => {
  if (!graph || !renderer) return;
  const show = filterDirections.checked;
  // Sigma v2 : type 'arrow' pour les arêtes dirigées, 'line' pour non-dirigées
  graph.forEachEdge((edge, attrs) => {
    if (show) {
      graph.setEdgeAttribute(edge, 'type', attrs.bidirectional ? 'line' : 'arrow');
    } else {
      graph.setEdgeAttribute(edge, 'type', 'line');
    }
  });
  renderer.refresh();
});

// ── Démarrage ────────────────────────────────
(async () => {
  await loadLiveGraph();
  await loadSnapshotList();
  connectSSE();
})();
