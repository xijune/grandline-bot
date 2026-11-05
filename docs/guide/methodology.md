# Méthodologie R&D — projet entier

**But :** avant d’avoir « un bot qui marche », avoir les **méthodes** pour tester, analyser et chercher sur **tous** les systèmes (combat, map, quêtes, éco, mer, world, PvP…).

Dernière MAJ : 2026-11-02

---

## 1. Principe unique

```text
Capturer le réel  →  Analyser hors-ligne  →  Régresser  →  Valider live
     (rare)              (quotidien)         (CI locale)     (preuve)
```

| Couche | Travail | Réseau ? | Exemples d’outils |
|--------|---------|----------|-------------------|
| **A — Capture** | Protocole, états, UI | Oui (1 session) | Console socket, dumps API |
| **B — Analyse** | Comprendre / comparer | Non | Scripts sur JSON, diffs |
| **C — Régression** | « On n’a pas cassé X » | Non | `tests/`, goldens, fixtures |
| **D — Validation live** | Preuve serveur actuel | Oui | headless_world, pure_api_farm, inject |

**Règle :** on ne *cherche* pas en live (trop lent / bruité). Le live *confirme*. L’offline *cherche*.  
Exception : découverte de protocole encore jamais capturé → live instrumenté **puis** dump.

---

## 2. Cartographie des systèmes

| Système | Guide | Canal live | Capture type | Fixtures |
|---------|-------|------------|--------------|----------|
| Combat FAUNE | combat.md | API + socket join | turns GET /battles/:id | Haute |
| Map / path | farm.md | Socket player:move | path ack + pos | Haute |
| Monde (rest, daily, harvest) | world.md | REST | réponses endpoints | Moyenne |
| Quêtes | quests.md | REST | séquence objectifs | Haute |
| Économie | economy.md | REST près PNJ | list/buy/sell | Moyenne |
| Mer / travel | sea.md | REST | legs voyage | Moyenne |
| PvP | pvp.md | REST | états duel | Basse |
| Craft | craft.md | REST | recettes / claim | Basse |
| Factions / primes | factions-bounty.md | REST | listes | Basse |

Chaque système vise : **guide** + **fixtures** + **runner live minimal** + **ligne ici**.

---

## 3. Meilleur outil selon la question

| Question | Mauvaise approche | Bonne approche |
|----------|-------------------|----------------|
| Pourquoi ça marche plus ? | Rejouer au hasard | Rejouer fixture / golden |
| Quelle est la bonne requête ? | Deviner le body | 1× capture Network/socket |
| Heuristique meilleure ? | 50 runs live | Métrique offline + 1 farm live |
| Path map faux ? | Spam move | Table path → ack + blockers |
| Quête bloquée où ? | Cliquer partout | Log séquence API + objectifId |
| Gain farm (berries/XP) ? | Impression | Rapport JSON agrégé |

---

## 4. Contrats de données

### Session live — `docs/sessions/YYYY-MM-DD/`
README + dumps ; **aucun** secret.

### Fixture — `tests/fixtures/<system>/`
```json
{
  "meta": {
    "system": "combat|map|quest|world|economy|sea|pvp|craft",
    "capturedAt": "ISO-8601",
    "source": "live|manual|synthetic",
    "characterId": "…"
  },
  "request": { "method": "POST", "path": "/api/…", "body": {} },
  "response": {},
  "notes": "optional"
}
```
Combat (turns) : `state` = GET battle + `decision` annotée.

### Golden — `tests/golden/<system>/`
Sortie attendue d’une fonction pure (decide, nextQuestStep, chooseSell…).

### Socket log — `*.jsonl`
`{ t, dir, ev, payload, result? }` — script `tools/capture_browser_socket.js`.

---

## 5. Outils repo

### Présents
| Outil | Système | Couche |
|-------|---------|--------|
| tools/decide_core.py | combat | B/C |
| tools/replay_decide.py | combat | B |
| tools/capture_battle_turns.py | combat | A |
| tools/capture_browser_socket.js | map/world/combat | A |
| tools/capture_rest_session.py | multi | A |
| tools/map_path.py | map | B/C |
| tools/map_walkable_dump.md | map | A |
| tests/test_decide_smoke.py | combat | C |
| src/launcher/pure_api_farm.py | combat | D |
| src/launcher/headless_world.py | map+combat | D |
| src/inject/combat-module.js | combat | D client |
| src/inject/glbot.js | map/farm | D client |

### Cibles
| Outil | Système |
|-------|---------|
| tools/map_walkable_dump.py | map |
| tools/replay_quest.py | quêtes |
| tests/test_path_ack.py | map |
| tests/test_quest_flow.py | quêtes |
| CLI glbot | tous |

---

## 6. Workflows

### Rechercher (nouveau comportement)
1. Capture A minimale (1 flux)
2. `docs/sessions/YYYY-MM-DD/`
3. Contrat → guide + api/
4. 1 fixture
5. Automatiser

### Analyser (heuristique)
1. Fixtures succès + échecs
2. Métriques offline
3. Patch fonction pure
4. Goldens + tests
5. Live court

### Tester
```bash
python -m pytest tests/ -q
python src/launcher/headless_world.py --farm 3
```

### Release bot
- pytest vert
- farm headless ≥ 3 wins, hpDelta = 0 (seuil doc)
- smoke world si touché
- CHANGELOG + session si découverte

---

## 7. Besoins pour travailler au max (humain ou IA)

| Besoin | Pourquoi |
|--------|----------|
| Fixtures par système | Évite de re-RE en live |
| Guide à jour / système | Vérité gameplay |
| Sessions datées | Continuité entre agents |
| Fonctions pures testables | decide, choosePack, nextQuestStep hors I/O |
| Credentials en env | GL_EMAIL / GL_PASSWORD jamais git |

### Gaps actuels
| Gap | Impact |
|-----|--------|
| Peu de fixtures hors combat | Quête/éco/mer encore live-only |
| Double IA combat JS + Python | Divergence possible |
| ~~Pas de dump walkable stable~~ | **ohara** fixture + map_path (2026-11-02) |
| Pas de CLI unique | Friction |
| Capture REST encore jeune | Logs hétérogènes |

**Combler ces gaps = priorité avant grossir les features bot.**

---

## 8. Anti-patterns
- Feature sans fixture ni guide
- Selenium headless comme outil de recherche principal
- Logs chat non transformés en fixture
- Optimiser sans métrique
- Secrets dans le git

---

## 9. Roadmap méthodes (pas features)

| P | Livrable |
|---|----------|
| P0 | methodology + testing + sessions |
| P0 | Combat fixtures + decide_core + tests |
| P1 | Capture REST générique + fixtures multi-systèmes |
| P1 | Map walkable dump + tests path |
| P2 | Quête fixtures + replay offline |
| P2 | Une source de vérité decide |
| P3 | CLI glbot + critères release |

---

## 10. Index
| Doc | Rôle |
|-----|------|
| **methodology.md** | Comment on travaille sur **tout** le projet |
| testing.md | Canaux live combat/map |
| START.md | Entrée |
| ARCHITECTURE.md | Composants |
| sessions/ | Preuves |
| tools/ | Capture + offline |
| tests/ | Régression |

**En une phrase :** d’abord une usine à **prouver** (capture → offline → golden → live), ensuite un bot qui enchaîne les systèmes.
