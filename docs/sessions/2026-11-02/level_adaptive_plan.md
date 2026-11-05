# Leveling adaptatif — plan validé méthodo — 2026-11-02

## Objectif

Script qui monte de niveau en choisissant **farm / quête / daily / travel** selon l’état, sans hardcoder le parcours.

## Méthodo

| Couche | Résultat |
|--------|----------|
| **A** | `docs/data/xp_knowledge.json` (mesures live XP) + fixture `tests/fixtures/level/bukima_stage134_no_obj.json` |
| **B** | `tools/level_core.py` |
| **C** | `pytest tests/test_level_core.py` → **10 passed** |
| **D** | `level_loop.py --plan-only` live → **travel toroa** (cohérent stage 134, obj vides) |

## Politique (`level_core.plan`)

```
HP bas → rest
daily calendrier non claim → daily_claim
objectifs soft (talk/fouille) → quest
objectifs combat underlevel (mob > lvl+2) → farm d’abord
objectifs combat OK → quest
pas d’objectifs + île découverte → travel
sinon → farm pack proche du niveau
```

## Live Bukima

```
lvl 11 · xp 5623 · ohara · campaign pw2-lucien stage 134
objectives []
discovered [ilusia, ohara, toroa]
→ plan: travel toroa
```

## Fichiers

- `tools/level_core.py`
- `src/launcher/level_loop.py`
- `docs/data/xp_knowledge.json`
- `tests/test_level_core.py`

## Next (boucle D plus profonde)

1. Exécuter travel Toroa bout-en-bout
2. Farm 1–N packs si `--no-travel` (mesure XP/min)
3. Enrichir table XP par île
