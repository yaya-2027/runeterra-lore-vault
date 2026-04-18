# runeterra-lore-vault

A fan lore project for League of Legends / Runeterra, built in Obsidian.  
This repo also ships **Synweft** — a local knowledge-graph viewer that reads your Obsidian vault and renders it as an interactive WebGL graph.

> Fan work, not affiliated with Riot Games. See [DISCLAIMER.md](./DISCLAIMER.md)

---

## What this is

I've been writing structured lore notes about Runeterra in Obsidian for a while — champions, regions, events, timelines, original characters. The end goal is to contribute to (or inspire) a community-driven interactive map of Runeterra, similar to [Riot's official map](https://map.leagueoflegends.com) but deeper: lore layers, OC creation, faction relations, timeline scrubbing.

Synweft is the current step: a tool that makes the vault *navigable* and shows how notes connect.

---

## Synweft

A local graph viewer for Obsidian vaults. Reads `.md` files directly, extracts `[[wikilinks]]` and `#tags`, and renders an interactive force-directed graph using **sigma.js** (WebGL) and **graphology**.

### Features

- WebGL rendering via sigma.js v2 — handles 200+ nodes smoothly
- Detects ghost notes (linked but not yet written)
- Tag nodes as first-class graph citizens
- Hover / click / drag nodes
- Search, filter by type/degree
- Snapshots (manual + auto on file change)
- Live reload via SSE when you edit notes in Obsidian
- Node size scales with connection count

### Install & run

Requires Node.js 18+.

```bash
git clone https://github.com/yaya-2027/runeterra-lore-vault
cd runeterra-lore-vault/app
npm install
npm start
# → http://localhost:3000
```

### Point it at your vault

By default Synweft looks for a `League of Legand` folder next to the repo. To use your own vault, create `app/synweft.config.json`:

```json
{ "notesDir": "../path/to/your/vault" }
```

This file is gitignored — it stays local.

---

## Lore structure

| Folder | Content |
|---|---|
| `00_Accueil` | Introduction & overview |
| `01_Lore Officiel` | Official Runeterra lore |
| `02_Chronologie` | Timeline |
| `03_Évènements` | Key events |
| `04_Champions Officiels` | Official champions by region |
| `05_Personnages Originaux` | Original characters (WIP) |
| `06_Théories` | Fan theories |

Notes are in French. Connections between notes use Obsidian wikilinks `[[Note Name]]`.

---

## Roadmap

- [ ] Obsidian plugin (read vault without running a local server)
- [ ] Timeline view
- [ ] Region filter (Demacia, Noxus, Ionia…)
- [ ] Relation types (ally / enemy / neutral)
- [ ] Export graph as image

---

## Contributing

This is a personal project but collaboration is welcome — especially if you're into Runeterra lore, world-building, or data visualization. Open an issue or start a discussion.

---

> League of Legends and all related assets are property of Riot Games. This is a fan project with no commercial purpose.
