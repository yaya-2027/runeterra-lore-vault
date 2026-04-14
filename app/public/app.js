/* ────────────────────────────────────────────────
   VaultGraph — app.js
   Logique frontend : graphe Cytoscape + SSE + historique
   ──────────────────────────────────────────────── */

// ── Références DOM ──────────────────────────────
const btnSave        = document.getElementById('btn-save');
const btnLoad        = document.getElementById('btn-load');
const btnLive        = document.getElementById('btn-live');
const snapshotSelect = document.getElementById('snapshot-select');
const readonlyBadge  = document.getElementById('readonly-badge');
const ghostList      = document.getElementById('ghost-list');
const infoNodes      = document.getElementById('info-nodes');
const infoEdges      = document.getElementById('info-edges');
const infoGhosts     = document.getElementById('info-ghosts');
const liveIndicator  = document.getElementById('live-indicator');
const btnToggle      = document.getElementById('btn-toggle-panel');
const panel          = document.getElementById('ghost-panel');

// ── État global ──────────────────────────────────
let cy = null;           // instance Cytoscape
let isReadOnly = false;  // true quand on affiche un snapshot

// ────────────────────────────────────────────────
// CYTOSCAPE — initialisation
// ────────────────────────────────────────────────

/**
 * Crée ou recrée l'instance Cytoscape avec les données fournies.
 * @param {{ nodes: object[], edges: object[] }} graphData
 */
function initCytoscape(graphData) {
  if (cy) cy.destroy();

  cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [...graphData.nodes, ...graphData.edges],

    // ── Style visuel inspiré Obsidian ────────────
    style: [
      // Nœuds normaux
      {
        selector: 'node[!ghost]',
        style: {
          'background-color': '#4fc3f7',
          'border-width': 0,
          'width': 28,
          'height': 28,
          'label': 'data(id)',
          'color': '#ffffff',
          'font-size': '10px',
          'text-valign': 'bottom',
          'text-margin-y': 4,
          'text-outline-width': 2,
          'text-outline-color': '#0d1117',
          'shadow-blur': 12,
          'shadow-color': '#4fc3f7',
          'shadow-opacity': 0.6,
          'shadow-offset-x': 0,
          'shadow-offset-y': 0,
        }
      },
      // Nœuds fantômes (notes inexistantes)
      {
        selector: 'node[?ghost]',
        style: {
          'background-color': '#555555',
          'opacity': 0.6,
          'width': 18,
          'height': 18,
          'label': 'data(id)',
          'color': '#888888',
          'font-size': '9px',
          'text-valign': 'bottom',
          'text-margin-y': 3,
          'text-outline-width': 1,
          'text-outline-color': '#0d1117',
        }
      },
      // Arêtes
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': 'rgba(255,255,255,0.25)',
          'target-arrow-color': 'rgba(255,255,255,0.25)',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.6,
          'curve-style': 'bezier',
          'opacity': 0.5,
        }
      },
      // État : nœud sélectionné
      {
        selector: 'node.selected',
        style: {
          'background-color': '#81d4fa',
          'shadow-blur': 20,
          'shadow-color': '#81d4fa',
          'shadow-opacity': 0.9,
          'width': 34,
          'height': 34,
        }
      },
      // État : nœud voisin highlighté
      {
        selector: 'node.neighbor',
        style: {
          'background-color': '#4fc3f7',
          'shadow-blur': 10,
          'shadow-color': '#4fc3f7',
          'shadow-opacity': 0.5,
        }
      },
      // État : nœud/arête estompé (non concerné par la sélection)
      {
        selector: '.faded',
        style: {
          'opacity': 0.12,
        }
      },
    ],

    // ── Layout force-directed ─────────────────────
    layout: {
      name: 'cose',
      animate: true,
      animationDuration: 600,
      randomize: true,
      nodeRepulsion: () => 12000,
      idealEdgeLength: () => 80,
      edgeElasticity: () => 100,
      gravity: 0.4,
      numIter: 1000,
    },

    // ── Interactions ──────────────────────────────
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
    selectionType: 'single',
  });

  bindCytoscapeEvents();
}

// ────────────────────────────────────────────────
// ÉVÉNEMENTS CYTOSCAPE
// ────────────────────────────────────────────────

/**
 * Bind les interactions sur le graphe (clic nœud, double-clic fond).
 */
function bindCytoscapeEvents() {
  // Clic sur un nœud → highlight + voisins
  cy.on('tap', 'node', (evt) => {
    const node = evt.target;
    highlightNode(node);
  });

  // Double-clic sur le fond → reset du highlight
  cy.on('dbltap', (evt) => {
    if (evt.target === cy) resetHighlight();
  });
}

/**
 * Met en avant un nœud et ses voisins directs, estompe le reste.
 * @param {cytoscape.NodeSingular} node
 */
function highlightNode(node) {
  // Réinitialiser d'abord
  cy.elements().removeClass('selected neighbor faded');

  const neighbors = node.neighborhood();

  // Estomper tout
  cy.elements().addClass('faded');

  // Enlever le fade sur le nœud + ses voisins
  neighbors.removeClass('faded');
  node.removeClass('faded').addClass('selected');

  // Marquer les voisins (nœuds seulement)
  neighbors.nodes().addClass('neighbor');
}

/**
 * Remet le graphe dans son état normal (pas de highlight).
 */
function resetHighlight() {
  cy.elements().removeClass('selected neighbor faded');
}

// ────────────────────────────────────────────────
// PANNEAU GHOST NOTES
// ────────────────────────────────────────────────

/**
 * Met à jour la liste des nœuds fantômes dans le panneau latéral.
 * @param {{ nodes: object[] }} graphData
 */
function updateGhostPanel(graphData) {
  const ghosts = graphData.nodes.filter(n => n.data.ghost === true);

  ghostList.innerHTML = '';

  if (ghosts.length === 0) {
    ghostList.innerHTML = '<li class="empty-msg">Aucune note fantôme détectée.</li>';
    return;
  }

  for (const g of ghosts) {
    const li = document.createElement('li');
    li.textContent = g.data.id;
    li.title = `Note manquante : ${g.data.id}`;
    // Clic sur un fantôme → le sélectionner dans le graphe
    li.addEventListener('click', () => {
      const node = cy.$(`node[id = "${g.data.id}"]`);
      if (node.length) {
        cy.animate({ center: { eles: node }, zoom: 1.6 }, { duration: 300 });
        highlightNode(node);
      }
    });
    ghostList.appendChild(li);
  }
}

// ────────────────────────────────────────────────
// BARRE DE STATUT
// ────────────────────────────────────────────────

/**
 * Met à jour les compteurs dans la barre de statut.
 * @param {{ nodes: object[], edges: object[] }} graphData
 */
function updateStatusBar(graphData) {
  const ghostCount = graphData.nodes.filter(n => n.data.ghost).length;
  infoNodes.textContent  = `${graphData.nodes.length} nœuds`;
  infoEdges.textContent  = `${graphData.edges.length} liens`;
  infoGhosts.textContent = `${ghostCount} fantôme${ghostCount > 1 ? 's' : ''}`;
}

// ────────────────────────────────────────────────
// CHARGEMENT DU GRAPHE
// ────────────────────────────────────────────────

/**
 * Charge le graphe live depuis GET /graph et l'affiche.
 */
async function loadLiveGraph() {
  try {
    const res = await fetch('/graph');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    initCytoscape(data);
    updateGhostPanel(data);
    updateStatusBar(data);
  } catch (err) {
    console.error('Impossible de charger le graphe :', err);
  }
}

// ────────────────────────────────────────────────
// HISTORIQUE — snapshots
// ────────────────────────────────────────────────

/**
 * Charge la liste des snapshots depuis GET /history et remplit le <select>.
 */
async function loadSnapshotList() {
  try {
    const res = await fetch('/history');
    const snapshots = await res.json();

    // Vider sauf l'option par défaut
    snapshotSelect.innerHTML = '<option value="">— Charger un snapshot —</option>';

    for (const s of snapshots) {
      const opt = document.createElement('option');
      opt.value = s.filename;
      // Formatage de la date lisible
      const date = new Date(s.createdAt).toLocaleString('fr-FR');
      opt.textContent = `${s.filename.replace('snapshot-', '').replace('.json', '')} — ${date}`;
      snapshotSelect.appendChild(opt);
    }
  } catch (err) {
    console.error('Impossible de charger la liste des snapshots :', err);
  }
}

/**
 * Sauvegarde le graphe courant en snapshot via POST /history/save.
 */
async function saveSnapshot() {
  try {
    btnSave.disabled = true;
    btnSave.textContent = '💾 Saving…';
    const res = await fetch('/history/save', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadSnapshotList();
      // Sélectionner automatiquement le snapshot qui vient d'être créé
      snapshotSelect.value = data.filename;
    }
  } catch (err) {
    console.error('Erreur lors de la sauvegarde :', err);
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = '💾 Save snapshot';
  }
}

/**
 * Charge et affiche un snapshot en mode lecture seule.
 * @param {string} filename
 */
async function loadSnapshot(filename) {
  if (!filename) return;
  try {
    const res = await fetch(`/history/${filename}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { graph } = await res.json();

    initCytoscape(graph);
    updateGhostPanel(graph);
    updateStatusBar(graph);

    // Passage en mode lecture seule
    isReadOnly = true;
    readonlyBadge.style.display = 'inline';
    btnLive.style.display = 'inline';
  } catch (err) {
    console.error('Impossible de charger le snapshot :', err);
  }
}

/**
 * Revient au graphe live et quitte le mode lecture seule.
 */
async function returnToLive() {
  isReadOnly = false;
  readonlyBadge.style.display = 'none';
  btnLive.style.display = 'none';
  snapshotSelect.value = '';
  await loadLiveGraph();
}

// ────────────────────────────────────────────────
// SSE — auto-refresh quand les notes changent
// ────────────────────────────────────────────────

/**
 * Ouvre une connexion SSE vers GET /watch.
 * Se reconnecte automatiquement en cas de déconnexion.
 */
function connectSSE() {
  const evtSource = new EventSource('/watch');

  evtSource.addEventListener('connected', () => {
    console.log('[SSE] Connexion live établie');
    liveIndicator.classList.remove('offline');
  });

  evtSource.addEventListener('change', async () => {
    console.log('[SSE] Changement détecté — rechargement du graphe');
    // Ne pas recharger si on est en mode lecture seule
    if (!isReadOnly) {
      await loadLiveGraph();
      await loadSnapshotList();
    }
  });

  evtSource.onerror = () => {
    console.warn('[SSE] Connexion perdue — tentative de reconnexion dans 3s');
    liveIndicator.classList.add('offline');
    evtSource.close();
    setTimeout(connectSSE, 3000);
  };
}

// ────────────────────────────────────────────────
// PANNEAU LATÉRAL — toggle
// ────────────────────────────────────────────────
btnToggle.addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  btnToggle.title = panel.classList.contains('collapsed') ? 'Déplier' : 'Réduire';
  btnToggle.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
});

// ────────────────────────────────────────────────
// ÉVÉNEMENTS BOUTONS
// ────────────────────────────────────────────────
btnSave.addEventListener('click', saveSnapshot);

btnLoad.addEventListener('click', () => {
  const selected = snapshotSelect.value;
  if (selected) loadSnapshot(selected);
});

btnLive.addEventListener('click', returnToLive);

// ────────────────────────────────────────────────
// DÉMARRAGE
// ────────────────────────────────────────────────
(async () => {
  await loadLiveGraph();
  await loadSnapshotList();
  connectSSE();
})();
