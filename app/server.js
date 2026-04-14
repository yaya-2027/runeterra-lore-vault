const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const app = express();
const PORT = 3000;

const NOTES_DIR = path.join(__dirname, 'notes');
const HISTORY_DIR = path.join(__dirname, 'history');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// Utilitaires — lecture et parsing des notes
// ─────────────────────────────────────────────

/**
 * Parcourt récursivement un dossier et retourne tous les fichiers .md trouvés.
 * @param {string} dir - Chemin du dossier à explorer
 * @returns {string[]} - Liste de chemins absolus vers les fichiers .md
 */
function collectMarkdownFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extrait tous les liens [[noteName]] depuis le contenu d'un fichier Markdown.
 * @param {string} content - Contenu brut du fichier
 * @returns {string[]} - Liste des noms de notes liées
 */
function extractLinks(content) {
  const regex = /\[\[(.*?)\]\]/g;
  const links = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    // On retire l'alias éventuel (ex: [[note|alias]] → "note")
    const target = match[1].split('|')[0].trim();
    if (target) links.push(target);
  }
  return links;
}

/**
 * Construit le graphe complet à partir des fichiers .md dans /notes.
 * Retourne un objet { nodes, edges } compatible avec Cytoscape.js.
 */
function buildGraph() {
  const files = collectMarkdownFiles(NOTES_DIR);

  // Map : nom de note → { id, ghost }
  const nodeMap = new Map();
  // Liste brute des liens : { source, target }
  const rawEdges = [];

  // Première passe : enregistrer tous les nœuds réels
  for (const filePath of files) {
    const name = path.basename(filePath, '.md');
    nodeMap.set(name, { id: name, ghost: false });
  }

  // Deuxième passe : extraire les liens et détecter les nœuds fantômes
  for (const filePath of files) {
    const name = path.basename(filePath, '.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    const links = extractLinks(content);

    for (const target of links) {
      // Si la cible n'existe pas en tant que fichier réel → nœud fantôme
      if (!nodeMap.has(target)) {
        nodeMap.set(target, { id: target, ghost: true });
      }
      rawEdges.push({ source: name, target });
    }
  }

  // Supprimer les doublons d'arêtes
  const edgeSet = new Set();
  const edges = [];
  for (const edge of rawEdges) {
    const key = `${edge.source}→${edge.target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ data: edge });
    }
  }

  const nodes = Array.from(nodeMap.values()).map(n => ({ data: n }));
  return { nodes, edges };
}

// ─────────────────────────────────────────────
// Endpoint : GET /graph
// Retourne le graphe courant (nœuds + arêtes)
// ─────────────────────────────────────────────
app.get('/graph', (req, res) => {
  try {
    const graph = buildGraph();
    res.json(graph);
  } catch (err) {
    console.error('Erreur lors de la construction du graphe :', err);
    res.status(500).json({ error: 'Impossible de construire le graphe.' });
  }
});

// ─────────────────────────────────────────────
// Endpoints : Historique (snapshots JSON)
// ─────────────────────────────────────────────

/**
 * POST /history/save
 * Sauvegarde un snapshot horodaté du graphe courant dans /history.
 */
app.post('/history/save', (req, res) => {
  try {
    const graph = buildGraph();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `snapshot-${timestamp}.json`;
    const filePath = path.join(HISTORY_DIR, filename);

    fs.writeFileSync(filePath, JSON.stringify({ savedAt: new Date().toISOString(), graph }, null, 2));
    res.json({ success: true, filename });
  } catch (err) {
    console.error('Erreur lors de la sauvegarde du snapshot :', err);
    res.status(500).json({ error: 'Impossible de sauvegarder le snapshot.' });
  }
});

/**
 * GET /history
 * Retourne la liste des snapshots disponibles dans /history.
 */
app.get('/history', (req, res) => {
  try {
    if (!fs.existsSync(HISTORY_DIR)) return res.json([]);

    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(HISTORY_DIR, f);
        const stat = fs.statSync(filePath);
        return { filename: f, createdAt: stat.birthtime };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(files);
  } catch (err) {
    console.error('Erreur lors de la lecture des snapshots :', err);
    res.status(500).json({ error: 'Impossible de lire les snapshots.' });
  }
});

/**
 * GET /history/:filename
 * Retourne le contenu d'un snapshot précis.
 */
app.get('/history/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // sécurisation path traversal
  const filePath = path.join(HISTORY_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Snapshot introuvable.' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch (err) {
    console.error('Erreur lors de la lecture du snapshot :', err);
    res.status(500).json({ error: 'Impossible de lire le snapshot.' });
  }
});

// ─────────────────────────────────────────────
// SSE : GET /watch
// Notifie le frontend en temps réel via Server-Sent Events
// quand un fichier .md change dans /notes
// ─────────────────────────────────────────────

// Liste des clients SSE connectés
const sseClients = [];

app.get('/watch', (req, res) => {
  // Configuration des headers SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Envoi d'un ping initial pour confirmer la connexion
  res.write('event: connected\ndata: ok\n\n');

  // Enregistrement du client
  sseClients.push(res);

  // Nettoyage quand le client se déconnecte
  req.on('close', () => {
    const index = sseClients.indexOf(res);
    if (index !== -1) sseClients.splice(index, 1);
  });
});

/**
 * Notifie tous les clients SSE connectés qu'un changement a eu lieu.
 * @param {string} eventType - Type d'événement (change, add, unlink)
 * @param {string} filePath - Chemin du fichier concerné
 */
function notifyClients(eventType, filePath) {
  const filename = path.basename(filePath);
  const payload = JSON.stringify({ event: eventType, file: filename });
  for (const client of sseClients) {
    client.write(`event: change\ndata: ${payload}\n\n`);
  }
}

// Surveillance du dossier /notes avec chokidar
const watcher = chokidar.watch(NOTES_DIR, {
  ignored: /(^|[\/\\])\../, // ignorer les fichiers cachés
  persistent: true,
  ignoreInitial: true,
});

watcher
  .on('add', filePath => {
    console.log(`[watch] Fichier ajouté : ${path.basename(filePath)}`);
    notifyClients('add', filePath);
  })
  .on('change', filePath => {
    console.log(`[watch] Fichier modifié : ${path.basename(filePath)}`);
    notifyClients('change', filePath);
  })
  .on('unlink', filePath => {
    console.log(`[watch] Fichier supprimé : ${path.basename(filePath)}`);
    notifyClients('unlink', filePath);
  });

// ─────────────────────────────────────────────
// Démarrage du serveur
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`VaultGraph démarré sur http://localhost:${PORT}`);
  console.log(`Notes surveillées dans : ${NOTES_DIR}`);
});
