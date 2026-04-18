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
  repulsion:      4000,
  attraction:     0.008,
  minDist:        15,
};

// ── État ──────────────────────────────────────
let graph      = null;
let renderer   = null;
let isReadOnly = false;
let animateId  = null;
let animState  = null;

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

// ── Reducers (appelés chaque frame par sigma) ──
function nodeReducer(node, data) {
  const res = { ...data, type: 'circle' };
  if (data._hidden) { res.hidden = true; return res; }

  const isGhost    = data.ghost === true;
  const isTag      = data.ntype === 'tag';
  const isHovered  = node === state.hoveredNode;
  const isSelected = node === state.selectedNode;
  const deg        = data.degree || 0;

  const baseSize = isGhost ? 4 : isTag ? 5 : deg > 8 ? 9 : deg > 4 ? 6 : 5;
  res.size       = baseSize * uiSettings.nodeScale;

  if (isTag) {
    res.color       = 'rgba(224,64,251,0.10)';
    res.borderColor = '#E040FB';
    res.borderSize  = 0.7;
  } else if (isGhost) {
    res.color       = 'rgba(244,114,182,0.07)';
    res.borderColor = isHovered ? 'rgba(244,114,182,0.95)' : 'rgba(244,114,182,0.45)';
    res.borderSize  = isHovered ? 1.2 : 0.7;
  } else {
    const fillOp   = deg > 8 ? 0.22 : deg > 4 ? 0.15 : 0.10;
    const strokeOp = deg > 8 ? 1.0  : deg > 4 ? 0.70 : 0.45;
    const strokeW  = deg > 8 ? 1.4  : deg > 4 ? 1.0  : 0.7;
    res.color       = isHovered || isSelected ? 'rgba(168,85,247,0.35)' : `rgba(168,85,247,${fillOp})`;
    res.borderColor = isHovered || isSelected ? '#A855F7' : `rgba(168,85,247,${strokeOp})`;
    res.borderSize  = isHovered ? 1.5 : strokeW;
  }

  if (state.searchQuery && !node.toLowerCase().includes(state.searchQuery)) {
    res.color       = 'rgba(168,85,247,0.04)';
    res.borderColor = 'rgba(168,85,247,0.08)';
    res.label       = '';
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
  const degSum      = (srcData.degree || 0) + (tgtData.degree || 0);

  if (isGhostEdge) {
    res.color = 'rgba(244,114,182,0.32)';
    res.size  = 0.7 * uiSettings.edgeScale;
    return res;
  }

  const t       = Math.min(1, degSum / 20);
  const opacity = 0.18 + t * 0.32;
  const weight  = 0.7  + t * 0.9;
  res.color = `rgba(168,85,247,${opacity.toFixed(2)})`;
  res.size  = weight * uiSettings.edgeScale;

  return res;
}

// ── Rendu personnalisé (supprime le carré noir sigma) ──
function customDrawNodeHover(context, data, settings) {
  const isGhost = data.ghost === true;
  const color   = isGhost ? '#F472B6' : '#A855F7';
  const size    = data.size;
  const x       = data.x;
  const y       = data.y;

  // Halo extérieur
  context.beginPath();
  context.arc(x, y, size + 5, 0, Math.PI * 2);
  context.fillStyle = isGhost ? 'rgba(244,114,182,0.12)' : 'rgba(168,85,247,0.15)';
  context.fill();

  // Contour vif
  context.beginPath();
  context.arc(x, y, size, 0, Math.PI * 2);
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();

  // Label — fond semi-transparent, PAS de rectangle noir
  if (data.label) {
    const fs   = Math.max(settings.labelSize || 12, 12);
    context.font = `500 ${fs}px IBM Plex Sans, sans-serif`;
    const tw   = context.measureText(data.label).width;
    const lx   = x - tw / 2;
    const ly   = y - size - 10;

    context.fillStyle = 'rgba(9,6,15,0.82)';
    context.beginPath();
    context.roundRect(lx - 6, ly - fs, tw + 12, fs + 6, 3);
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

  // Calcul des degrés
  const deg = {};
  for (const e of graphData.edges) {
    deg[e.data.source] = (deg[e.data.source] || 0) + 1;
    deg[e.data.target] = (deg[e.data.target] || 0) + 1;
  }

  // Nœuds
  for (const n of graphData.nodes) {
    const id     = n.data.id;
    const degree = deg[id] || 0;
    const isTag  = n.data.type === 'tag';
    const isGhost = !!n.data.ghost;
    const baseSize = isTag ? 4 : isGhost ? 3 : Math.max(4, Math.min(24, 4 + degree * 1.4));
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
      _hidden:   false,
    });
  }

  // Arêtes
  for (const e of graphData.edges) {
    const s = e.data.source, t = e.data.target;
    if (s === t) continue; // ignore self-loops
    if (!graph.hasNode(s) || !graph.hasNode(t)) continue;
    if (graph.hasEdge(s, t) || graph.hasEdge(t, s)) continue;
    graph.addEdge(s, t, {
      color:         COLORS.edgeDefault,
      size:          0.6,
      bidirectional: e.data.bidirectional || false,
    });
  }

  // Layout initial : circulaire puis spring synchrone (stable avant init sigma)
  if (graph.order > 0) {
    circularLayout(graph);
    springStep(300);
  }

  // Rendu sigma.js (WebGL)
  renderer = new Sigma(graph, document.getElementById('cy'), {
    renderEdgeLabels:   false,
    allowInvalidContainer: true,
    defaultNodeType:    'circle',
    minCameraRatio:     0.005,
    maxCameraRatio:     20,
    nodeReducer,
    edgeReducer,
    labelFont:          'IBM Plex Sans, system-ui, sans-serif',
    labelSize:          10,
    labelColor:         { color: 'rgba(148,163,184,0.65)' },
    labelThreshold:     uiSettings.labelThreshold,
    edgeLabelSize:      8,
    stagePadding:       40,
    backgroundColor:    '#0F172A',
    drawNodeHover:      customDrawNodeHover,
  });

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
  const radius = Math.max(100, n * 4);
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
