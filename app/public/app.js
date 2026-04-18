/* ────────────────────────────────────────────────
   Synweft — app.js
   Recherche · Filtres · Aperçu note · Taille nœuds · Tags
   Design fidèle au Graph View d'Obsidian
   ──────────────────────────────────────────────── */

// ── Références DOM ──────────────────────────────
const btnSave         = document.getElementById('btn-save');
const btnLoad         = document.getElementById('btn-load');
const btnLive         = document.getElementById('btn-live');
const snapshotSelect  = document.getElementById('snapshot-select');
const readonlyBadge   = document.getElementById('readonly-badge');
const ghostList       = document.getElementById('ghost-list');
const infoNodes       = document.getElementById('info-nodes');
const infoEdges       = document.getElementById('info-edges');
const infoGhosts      = document.getElementById('info-ghosts');
const infoTags        = document.getElementById('info-tags');
const liveIndicator   = document.getElementById('live-indicator');
const btnToggle       = document.getElementById('btn-toggle-panel');
const panel           = document.getElementById('side-panel');
const searchInput     = document.getElementById('search-input');
const searchClear     = document.getElementById('search-clear');
const filterGhosts    = document.getElementById('filter-ghosts');
const filterTags      = document.getElementById('filter-tags');
const filterDegree    = document.getElementById('filter-degree-range');
const filterDegreeVal  = document.getElementById('filter-degree-val');
const filterDirections = document.getElementById('filter-directions');

// ── État global ──────────────────────────────────
let cy           = null;
let isReadOnly   = false;
let hasSelection = false;

// ── Palette slate / green ──
const COLORS = {
  nodeDefault:  '#64748B',
  nodeHover:    '#22C55E',
  nodeSelected: '#4ADE80',
  nodeNeighbor: '#86EFAC',
  nodeGhost:    '#1E293B',
  nodeTag:      '#6366F1',
  edgeDefault:  'rgba(100,116,139,0.12)',
  edgeActive:   '#22C55E',
  glowHover:    'rgba(34,197,94,0.55)',
  glowSelected: 'rgba(74,222,128,0.45)',
  glowTag:      'rgba(99,102,241,0.4)',
};

// ────────────────────────────────────────────────
// CALCUL DES DEGRÉS
// ────────────────────────────────────────────────

/**
 * Calcule le degré total (in + out) de chaque nœud et l'injecte dans node.data.degree.
 * Obsidian utilise le degré total pour la taille des nœuds.
 */
function computeDegrees(graphData) {
  const deg = {};
  for (const edge of graphData.edges) {
    const s = edge.data.source;
    const t = edge.data.target;
    deg[s] = (deg[s] || 0) + 1;
    deg[t] = (deg[t] || 0) + 1;
  }
  for (const node of graphData.nodes) {
    node.data.degree = deg[node.data.id] || 0;
  }
}

// ────────────────────────────────────────────────
// CYTOSCAPE — initialisation
// ────────────────────────────────────────────────

function initCytoscape(graphData) {
  if (cy) cy.destroy();
  hasSelection = false;

  computeDegrees(graphData);

  cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [...graphData.nodes, ...graphData.edges],

    style:  buildCytoscapeStyle(),

    // ── Cola.js : physique fluide continue ────────
    // infinite:true → la simulation ne s'arrête jamais.
    // Dragging un nœud → les voisins suivent en temps réel.
    // Au relâchement → le graphe se réinstalle doucement.
    layout: {
      name: 'cola',
      animate: true,
      infinite: true,          // simulation continue = comportement "eau"
      fit: false,              // ne pas recentrer automatiquement
      padding: 60,
      randomize: false,
      avoidOverlap: true,
      ungrabifyWhileSimulating: false, // permettre le drag pendant la simulation
      nodeSpacing: () => 35,
      edgeLength: 130,         // longueur naturelle des liens
      refresh: 2,              // mise à jour toutes les 2 frames (fluide)
      convergenceThreshold: 0.0001,
    },

    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
    selectionType: 'single',
  });

  bindCytoscapeEvents();
  applyFilters();
}

/**
 * Retourne la feuille de style Cytoscape inspirée d'Obsidian.
 * Séparée pour rester lisible.
 */
function buildCytoscapeStyle() {
  return [
    {
      selector: 'node[type = "note"][!ghost]',
      style: {
        'background-color': COLORS.nodeDefault,
        'border-width': 0,
        'width':  'mapData(degree, 0, 12, 14, 46)',
        'height': 'mapData(degree, 0, 12, 14, 46)',
        'label': 'data(id)',
        'color': 'rgba(148,163,184,0.5)',
        'font-size': '9px',
        'font-family': 'IBM Plex Sans, system-ui, sans-serif',
        'text-valign': 'bottom',
        'text-margin-y': 3,
        'text-outline-width': 2,
        'text-outline-color': '#0F172A',
        'shadow-blur': 6,
        'shadow-color': COLORS.nodeDefault,
        'shadow-opacity': 0.12,
        'shadow-offset-x': 0,
        'shadow-offset-y': 0,
        'transition-property': 'background-color, width, height, shadow-blur, shadow-opacity',
        'transition-duration': '200ms',
      }
    },

    {
      selector: 'node[type = "note"][?ghost]',
      style: {
        'background-color': '#253348',
        'border-width': 1,
        'border-color': '#1E293B',
        'opacity': 0.4,
        'width': 8,
        'height': 8,
        'label': 'data(id)',
        'color': 'rgba(100,116,139,0.45)',
        'font-size': '8px',
        'text-valign': 'bottom',
        'text-margin-y': 2,
        'text-outline-width': 1,
        'text-outline-color': '#0F172A',
      }
    },

    {
      selector: 'node[type = "tag"]',
      style: {
        'background-color': COLORS.nodeTag,
        'shape': 'ellipse',
        'width': 9,
        'height': 9,
        'label': 'data(id)',
        'color': 'rgba(99,102,241,0.55)',
        'font-size': '8px',
        'text-valign': 'bottom',
        'text-margin-y': 2,
        'text-outline-width': 1,
        'text-outline-color': '#0F172A',
        'opacity': 0.75,
      }
    },

    {
      selector: 'edge',
      style: {
        'width': 0.8,
        'line-color': COLORS.edgeDefault,
        'target-arrow-color': COLORS.edgeDefault,
        'target-arrow-shape': 'none',
        'curve-style': 'bezier',
        'opacity': 1,
        'transition-property': 'line-color, width, opacity',
        'transition-duration': '150ms',
      }
    },
    {
      selector: 'edge[target ^= "#"]',
      style: {
        'line-color': 'rgba(99,102,241,0.08)',
        'width': 0.6,
      }
    },

    {
      selector: 'node.hovered',
      style: {
        'background-color': COLORS.nodeHover,
        'shadow-blur': 22,
        'shadow-color': COLORS.glowHover,
        'shadow-opacity': 1,
        'color': 'rgba(34,197,94,0.8)',
      }
    },

    {
      selector: 'node.neighbor',
      style: {
        'background-color': COLORS.nodeNeighbor,
        'shadow-blur': 10,
        'shadow-color': COLORS.glowSelected,
        'shadow-opacity': 0.7,
        'color': 'rgba(134,239,172,0.75)',
      }
    },

    {
      selector: 'node.selected',
      style: {
        'background-color': COLORS.nodeSelected,
        'shadow-blur': 22,
        'shadow-color': COLORS.glowSelected,
        'shadow-opacity': 1,
        'color': 'rgba(74,222,128,0.9)',
        'border-width': 0,
      }
    },

    {
      selector: 'edge.edge-active',
      style: {
        'line-color': COLORS.edgeActive,
        'target-arrow-color': COLORS.edgeActive,
        'width': 1.4,
        'opacity': 0.85,
      }
    },

    {
      selector: '.faded',
      style: { 'opacity': 0.12 }
    },

    {
      selector: 'node.search-match',
      style: {
        'background-color': COLORS.nodeSelected,
        'shadow-blur': 14,
        'shadow-color': COLORS.glowSelected,
        'shadow-opacity': 0.7,
        'color': 'rgba(74,222,128,0.9)',
        'border-width': 0,
      }
    },
  ];
}

// ────────────────────────────────────────────────
// ÉVÉNEMENTS CYTOSCAPE
// ────────────────────────────────────────────────

function bindCytoscapeEvents() {
  const tooltip     = document.getElementById('node-tooltip');
  const tooltipName = document.getElementById('tooltip-name');
  const tooltipMeta = document.getElementById('tooltip-meta');

  cy.on('mousemove', (evt) => {
    if (tooltip.classList.contains('visible')) {
      tooltip.style.left = evt.originalEvent.clientX + 'px';
      tooltip.style.top  = evt.originalEvent.clientY + 'px';
    }
  });

  cy.on('mouseover', 'node', (evt) => {
    const node = evt.target;

    // Show tooltip
    const id     = node.data('id');
    const type   = node.data('type');
    const ghost  = node.data('ghost');
    const degree = node.data('degree') || 0;
    tooltipName.textContent = id;
    tooltipMeta.textContent =
      type === 'tag'          ? `#tag · ${degree} note${degree !== 1 ? 's' : ''}` :
      ghost                   ? 'note fantôme' :
                                `${degree} lien${degree !== 1 ? 's' : ''}`;
    tooltip.style.left = evt.originalEvent.clientX + 'px';
    tooltip.style.top  = evt.originalEvent.clientY + 'px';
    tooltip.classList.add('visible');

    if (hasSelection) return;

    const neighbors = node.neighborhood();
    cy.elements().addClass('faded');
    node.removeClass('faded').addClass('hovered');
    neighbors.nodes().removeClass('faded').addClass('neighbor');
    neighbors.edges().removeClass('faded').addClass('edge-active');
  });

  cy.on('mouseout', 'node', () => {
    tooltip.classList.remove('visible');
    if (hasSelection) return;
    cy.elements().removeClass('faded hovered neighbor edge-active');
  });

  // ── Clic sur un nœud → sélection + centrage (comportement Obsidian) ──
  cy.on('tap', 'node', (evt) => {
    const node = evt.target;
    hasSelection = true;

    cy.elements().removeClass('hovered neighbor faded edge-active selected');
    cy.elements().addClass('faded');

    const neighbors = node.neighborhood();
    neighbors.removeClass('faded');
    neighbors.nodes().addClass('neighbor');
    neighbors.edges().addClass('edge-active');
    node.removeClass('faded').addClass('selected');

    // Centrer la vue sur le nœud cliqué (comme Obsidian)
    cy.animate(
      { center: { eles: node }, zoom: Math.max(cy.zoom(), 1.1) },
      { duration: 300, easing: 'ease-in-out-sine' }
    );
  });

  // ── Clic simple sur le fond → reset immédiat (plus besoin de double-clic) ──
  cy.on('tap', (evt) => {
    if (evt.target === cy) resetHighlight();
  });
}

/**
 * Remet le graphe dans son état neutre.
 */
function resetHighlight() {
  hasSelection = false;
  cy.elements().removeClass('selected neighbor faded hovered edge-active search-match');
}

// ────────────────────────────────────────────────
// FILTRES
// ────────────────────────────────────────────────

function applyFilters() {
  if (!cy) return;

  const showGhosts  = filterGhosts.checked;
  const showTagNodes = filterTags.checked;
  const minDeg      = parseInt(filterDegree.value, 10);

  cy.batch(() => {
    cy.nodes().forEach(node => {
      const type  = node.data('type');
      const ghost = node.data('ghost');
      const deg   = node.data('degree') || 0;

      let visible = true;
      if (type === 'note' && ghost && !showGhosts) visible = false;
      if (type === 'tag' && !showTagNodes)          visible = false;
      if (deg < minDeg)                             visible = false;

      if (visible) node.show(); else node.hide();
    });

    // Cacher les arêtes dont un endpoint est caché
    cy.edges().forEach(edge => {
      if (edge.source().hidden() || edge.target().hidden()) {
        edge.hide();
      } else {
        edge.show();
      }
    });
  });
}

// ────────────────────────────────────────────────
// RECHERCHE
// ────────────────────────────────────────────────

function applySearch(term) {
  if (!cy) return;

  cy.elements().removeClass('search-match faded');
  hasSelection = false;

  if (!term) return;

  const lower = term.toLowerCase();
  const matches    = cy.nodes().filter(n => n.data('id').toLowerCase().includes(lower) && !n.hidden());
  const nonMatches = cy.nodes().not(matches).not(':hidden');

  if (!matches.length) return;

  matches.addClass('search-match');
  nonMatches.addClass('faded');
  cy.edges().addClass('faded');

  cy.animate({ fit: { eles: matches, padding: 80 } }, { duration: 350 });
}

// ────────────────────────────────────────────────
// PANNEAU — stats + ghost notes
// ────────────────────────────────────────────────

function updatePanelStats(graphData) {
  const ghostCount = graphData.nodes.filter(n => n.data.ghost && n.data.type === 'note').length;
  const noteCount  = graphData.nodes.filter(n => n.data.type === 'note' && !n.data.ghost).length;
  const el = (id) => document.getElementById(id);
  if (el('stat-nodes'))  el('stat-nodes').textContent  = noteCount;
  if (el('stat-edges'))  el('stat-edges').textContent  = graphData.edges.length;
  if (el('stat-ghosts')) el('stat-ghosts').textContent = ghostCount;
}

function updateGhostPanel(graphData) {
  const ghosts = graphData.nodes.filter(n => n.data.ghost && n.data.type === 'note');
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
      const node = cy.$(`node[id = "${g.data.id}"]`);
      if (node.length) {
        cy.animate({ center: { eles: node }, zoom: 1.6 }, { duration: 300 });
        node.emit('tap');
      }
    });
    ghostList.appendChild(li);
  }
}

// ────────────────────────────────────────────────
// BARRE DE STATUT
// ────────────────────────────────────────────────

function updateStatusBar(graphData) {
  const ghostCount = graphData.nodes.filter(n => n.data.ghost && n.data.type === 'note').length;
  const tagCount   = graphData.nodes.filter(n => n.data.type === 'tag').length;

  infoNodes.textContent  = `${graphData.nodes.length} nœuds`;
  infoEdges.textContent  = `${graphData.edges.length} liens`;
  infoGhosts.textContent = `${ghostCount} fantôme${ghostCount !== 1 ? 's' : ''}`;
  infoTags.textContent   = `${tagCount} tag${tagCount !== 1 ? 's' : ''}`;
}

// ────────────────────────────────────────────────
// CHARGEMENT DU GRAPHE
// ────────────────────────────────────────────────

async function loadLiveGraph() {
  try {
    const res = await fetch('/graph');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    initCytoscape(data);
    updateGhostPanel(data);
    updateStatusBar(data);
    updatePanelStats(data);

    // Mettre à jour le max du slider selon le degré max observé
    const maxDeg = Math.max(0, ...data.nodes.map(n => n.data.degree || 0));
    filterDegree.max = maxDeg || 20;
  } catch (err) {
    console.error('Impossible de charger le graphe :', err);
  }
}

// ────────────────────────────────────────────────
// HISTORIQUE
// ────────────────────────────────────────────────

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
    const { graph } = await res.json();

    initCytoscape(graph);
    updateGhostPanel(graph);
    updateStatusBar(graph);
    updatePanelStats(graph);

    isReadOnly = true;
    readonlyBadge.style.display = 'inline';
    btnLive.style.display = 'inline';
  } catch (err) {
    console.error('Impossible de charger le snapshot :', err);
  }
}

async function returnToLive() {
  isReadOnly = false;
  readonlyBadge.style.display = 'none';
  btnLive.style.display = 'none';
  snapshotSelect.value = '';
  await loadLiveGraph();
}

// ────────────────────────────────────────────────
// SSE — auto-refresh
// ────────────────────────────────────────────────

function connectSSE() {
  const evtSource = new EventSource('/watch');

  evtSource.addEventListener('connected', () => {
    liveIndicator.classList.remove('offline');
  });

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

// ────────────────────────────────────────────────
// ÉVÉNEMENTS UI
// ────────────────────────────────────────────────

btnToggle.addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  btnToggle.title = panel.classList.contains('collapsed') ? 'Déplier' : 'Réduire';
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
    resetHighlight();
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  resetHighlight();
  searchInput.focus();
});

filterGhosts.addEventListener('change', applyFilters);
filterTags.addEventListener('change', applyFilters);

// Direction des arêtes — affiche ou cache les flèches
filterDirections.addEventListener('change', () => {
  if (!cy) return;
  const show = filterDirections.checked;
  cy.batch(() => {
    // Arêtes bidirectionnelles → flèches des deux côtés
    cy.edges('[?bidirectional]').style({
      'source-arrow-shape': show ? 'triangle' : 'none',
      'source-arrow-color': COLORS.edgeDefault,
      'target-arrow-shape': show ? 'triangle' : 'none',
      'target-arrow-color': COLORS.edgeDefault,
      'arrow-scale': 0.45,
    });
    // Arêtes unidirectionnelles → flèche uniquement vers la cible
    cy.edges('[!bidirectional]').style({
      'source-arrow-shape': 'none',
      'target-arrow-shape': show ? 'triangle' : 'none',
      'target-arrow-color': COLORS.edgeDefault,
      'arrow-scale': 0.45,
    });
  });
});
filterDegree.addEventListener('input', () => {
  filterDegreeVal.textContent = filterDegree.value;
  applyFilters();
});

// ────────────────────────────────────────────────
// DÉMARRAGE
// ────────────────────────────────────────────────
(async () => {
  await loadLiveGraph();
  await loadSnapshotList();
  connectSSE();
})();
