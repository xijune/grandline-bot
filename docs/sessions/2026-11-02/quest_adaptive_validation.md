# Validation méthodo — bot quête adaptatif — 2026-11-02

## Objectif validé

Un planificateur qui **ne hardcode aucun ID de quête** et s’adapte aux observables serveur :
objectifs map → combat/fouille ; sinon talk PNJ locaux ; sinon `travel_hint`.

## Méthodo appliquée

| Couche | Travail | Résultat |
|--------|---------|----------|
| **A — Capture** | Fixture `tests/fixtures/quests/ohara_receleurs_objective.json` | OK |
| **B — Analyse** | `tools/quest_core.plan` sur fixture + état live | OK |
| **C — Régression** | `pytest tests/test_quest_core.py` → **8 passed** | OK |
| **D — Live** | plan sur character réel Bukima stage 134 + trace adaptative | OK |

Preuve combat quête live (même journée) :
- `campagne:pw2-receleurs` → ALLIE, **hpDelta 0**, stage 132→133
- talk `npc-lucien-le-pelerin` → `pw2-lucien`, stage 133→134, discover toroa

## Couche C

```
pytest tests/test_quest_core.py -v
# 8 passed
```

## Couche D — état live

```
char Bukima ohara
campaign stage 134 · accomplies 15 · dernier pw2-lucien
discovered [ilusia, ohara, toroa]
objectives []
→ plan se termine par travel_hint toroa
```

Artifact : `artifacts/quest_adaptive_validation_2026-11-02.json`

## Fichiers

| Fichier | Rôle |
|---------|------|
| `tools/quest_core.py` | plan pure |
| `src/launcher/quest_loop.py` | runner live |
| `docs/data/npcs.json` | catalogue PNJ |
| `tests/test_quest_core.py` | régression |
| `tests/fixtures/quests/ohara_receleurs_objective.json` | golden |

## Verdict

**Étape bot quête adaptatif : VALIDÉE.**  
Next : travel Toroa + catalogue PNJ Toroa.
