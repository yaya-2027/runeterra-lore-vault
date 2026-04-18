const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const app = express();
const PORT = 3000;

// ── Résolution du dossier de notes ──────────────
// Ordre de priorité :
// 1. synweft.config.json  (config locale, non commitée)
// 2. ../League of Legand  (clone normal du repo)
// 3. ../../../../League of Legand (git worktree)
// 4. ./notes              (fallback)
function resolveNotesDir() {
  const configPath = path.join(__dirname, 'synweft.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.notesDir) {
        const resolved = path.resolve(__dirname, cfg.notesDir);
        if (fs.existsSync(resolved)) return resolved;
      }
    } catch {}
  }

  const candidates = [
    path.join(__dirname, '..', 'League of Legand'),
    path.join(__dirname, '..', '..', '..', '..', 'League of Legand'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return path.join(__dirname, 'notes');
}

const NOTES_DIR   = resolveNotesDir();
const HISTORY_DIR = path.join(__dirname, 'history');

console.log(`[config] Notes : ${NOTES_DIR}`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// Utilitaires — lecture et parsing des notes
// ─────────────────────────────────────────────

/**
 * Parcourt récursivement un dossier et retourne tous les fichiers .md trouvés.
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
 */
function extractLinks(content) {
  const regex = /\[\[(.*?)\]\]/g;
  const links = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].split('|')[0].trim();
    if (target) links.push(target);
  }
  return links;
}

/**
 * Extrait tous les #tags inline depuis le contenu Markdown.
 * Exclut les titres (# Titre ont un espace après #).
 * Exclut les blocs de code pour éviter les faux positifs.
 */
function extractTags(content) {
  // Supprimer les blocs de code fenced et inline
  const withoutCode = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');

  // #tag : # suivi directement d'une lettre, non précédé d'un autre #
  const regex = /(?<!#)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  const tags = new Set();
  let match;
  while ((match = regex.exec(withoutCode)) !== null) {
    tags.add(match[1].toLowerCase());
  }
  return Array.from(tags);
}

/**
 * Construit le graphe complet à partir des fichiers .md dans /notes.
 * Inclut les nœuds de notes, nœuds fantômes et nœuds de tags.
 */
function buildGraph() {
  const files = collectMarkdownFiles(NOTES_DIR);

  // Map : identifiant → données du nœud
  const nodeMap = new Map();
  // Liste brute des liens : { source, target }
  const rawEdges = [];

  // Première passe : enregistrer tous les nœuds réels
  for (const filePath of files) {
    const name = path.basename(filePath, '.md');
    nodeMap.set(name, { id: name, ghost: false, type: 'note' });
  }

  // Deuxième passe : extraire les liens [[wikilinks]] et les #tags
  for (const filePath of files) {
    const name = path.basename(filePath, '.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Liens entre notes
    const links = extractLinks(content);
    for (const target of links) {
      if (!nodeMap.has(target)) {
        nodeMap.set(target, { id: target, ghost: true, type: 'note' });
      }
      rawEdges.push({ source: name, target });
    }

    // Tags #hashtag → nœud de type "tag"
    const tags = extractTags(content);
    for (const tag of tags) {
      const tagId = `#${tag}`;
      if (!nodeMap.has(tagId)) {
        nodeMap.set(tagId, { id: tagId, ghost: false, type: 'tag' });
      }
      rawEdges.push({ source: name, target: tagId });
    }
  }

  // Étape 1 : dédupliquer les arêtes directionnelles identiques
  const directedSet = new Set();
  const directedEdges = [];
  for (const edge of rawEdges) {
    const key = `${edge.source}→${edge.target}`;
    if (!directedSet.has(key)) {
      directedSet.add(key);
      directedEdges.push(edge);
    }
  }

  // Étape 2 : fusionner A→B et B→A en une seule arête bidirectionnelle
  // Résultat : une seule ligne par paire de notes (comme Obsidian par défaut)
  const pairMap = new Map();
  for (const edge of directedEdges) {
    const pairKey = [edge.source, edge.target].sort().join('↔');
    if (pairMap.has(pairKey)) {
      // Les deux sens existent → bidirectionnel
      pairMap.get(pairKey).bidirectional = true;
    } else {
      pairMap.set(pairKey, { source: edge.source, target: edge.target, bidirectional: false });
    }
  }

  const edges = Array.from(pairMap.values()).map(e => ({ data: e }));

  const nodes = Array.from(nodeMap.values()).map(n => ({ data: n }));
  return { nodes, edges };
}

// ─────────────────────────────────────────────
// Endpoint : GET /graph
// ─────────────────────────────────────────────
app.get('/graph', (req, res) => {
  try {
    res.json(buildGraph());
  } catch (err) {
    console.error('Erreur lors de la construction du graphe :', err);
    res.status(500).json({ error: 'Impossible de construire le graphe.' });
  }
});

// ─────────────────────────────────────────────
// Endpoint : GET /notes/:name
// Retourne le contenu Markdown brut d'une note
// ─────────────────────────────────────────────
app.get('/notes/:name', (req, res) => {
  const name = path.basename(req.params.name); // sécurisation path traversal
  const files = collectMarkdownFiles(NOTES_DIR);
  const filePath = files.find(f => path.basename(f, '.md') === name);

  if (!filePath) {
    return res.status(404).json({ error: 'Note introuvable.' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ name, content });
  } catch (err) {
    console.error('Erreur lecture note :', err);
    res.status(500).json({ error: 'Impossible de lire la note.' });
  }
});

// ─────────────────────────────────────────────
// Endpoints : Historique (snapshots JSON)
// ─────────────────────────────────────────────

app.post('/history/save', (req, res) => {
  try {
    const graph = buildGraph();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `snapshot-${timestamp}.json`;
    const filePath = path.join(HISTORY_DIR, filename);

    fs.writeFileSync(filePath, JSON.stringify({ savedAt: new Date().toISOString(), graph }, null, 2));
    res.json({ success: true, filename });
  } catch (err) {
    console.error('Erreur sauvegarde snapshot :', err);
    res.status(500).json({ error: 'Impossible de sauvegarder le snapshot.' });
  }
});

app.get('/history', (req, res) => {
  try {
    if (!fs.existsSync(HISTORY_DIR)) return res.json([]);

    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(HISTORY_DIR, f));
        return { filename: f, createdAt: stat.birthtime };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Impossible de lire les snapshots.' });
  }
});

app.get('/history/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(HISTORY_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Snapshot introuvable.' });
  }

  try {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch (err) {
    res.status(500).json({ error: 'Impossible de lire le snapshot.' });
  }
});

// ─────────────────────────────────────────────
// SSE : GET /watch — notifications temps réel
// ─────────────────────────────────────────────
const sseClients = [];

app.get('/watch', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: connected\ndata: ok\n\n');

  sseClients.push(res);
  req.on('close', () => {
    const i = sseClients.indexOf(res);
    if (i !== -1) sseClients.splice(i, 1);
  });
});

function notifyClients(eventType, filePath) {
  const payload = JSON.stringify({ event: eventType, file: path.basename(filePath) });
  for (const client of sseClients) {
    client.write(`event: change\ndata: ${payload}\n\n`);
  }
}

// Auto-snapshot : sauvegarde automatique 3s après chaque modification
let autoSnapshotTimer = null;
function scheduleAutoSnapshot() {
  if (autoSnapshotTimer) clearTimeout(autoSnapshotTimer);
  autoSnapshotTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename  = `snapshot-${timestamp}.json`;
      const graph     = buildGraph();
      fs.writeFileSync(
        path.join(HISTORY_DIR, filename),
        JSON.stringify({ savedAt: new Date().toISOString(), graph }, null, 2)
      );
      console.log(`[auto-snapshot] ${filename}`);
    } catch (err) {
      console.error('[auto-snapshot] erreur :', err);
    }
  }, 3000);
}

const watcher = chokidar.watch(NOTES_DIR, {
  ignored: /(^|[\/\\])\../,
  persistent: true,
  ignoreInitial: true,
});

watcher
  .on('add',    f => { console.log(`[watch] ajouté : ${path.basename(f)}`);    notifyClients('add', f);    scheduleAutoSnapshot(); })
  .on('change', f => { console.log(`[watch] modifié : ${path.basename(f)}`);   notifyClients('change', f); scheduleAutoSnapshot(); })
  .on('unlink', f => { console.log(`[watch] supprimé : ${path.basename(f)}`);  notifyClients('unlink', f); scheduleAutoSnapshot(); });

// ─────────────────────────────────────────────
// Démarrage
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Synweft démarré sur http://localhost:${PORT}`);
  console.log(`Notes surveillées dans : ${NOTES_DIR}`);
});
