# Boucle quête optimale — validée live 01/11/2026

## Algo minimal (le plus rapide)

```
1. GET  /characters/{id}/quest-objectives
2. Selon objectifs[] :
   - kind "fouille"  → walkTo(x,y) → POST quest-search { objectifId }
   - kind "combat"   → walkTo(x,y) → POST /battles/start { characterId, objectifId }
   - vide            → si campaign en cours, PNJ via POST campaign/talk { npc }
3. Répéter jusqu'à objectifs vides + talk résolu null
```

## Routes exactes (live)

| Action | Méthode | Body | Note |
|--------|---------|------|------|
| Objectifs | GET `.../quest-objectives` | — | id **complet** `campagne:pw1-affiches` |
| Talk | POST `.../campaign/talk` | `{ "npc": "npc-…" }` | 409 si trop loin |
| Fouille | POST `.../quest-search` | `{ "objectifId": "campagne:pw1-affiches" }` | id court → 409 même sur place |
| Combat quête | POST `/battles/start` | `{ characterId, objectifId: "campagne:pw1-miliciens" }` | OK live |

## Pathfinder optimal (live)

- Source : `scene.movementBlocked`
- BFS 4-dir → chunks de **20** cases (`mapData.maxSteps`)
- Cible bloquée (PNJ) → `nearestWalkable` rayon 1–2
- `moveLocal(path, null, {courir:true, redresser:true})`
- Poll `!entity.moving` ~200 ms

## Prologue West Blue ilusia — progression live

| # | Étape | Méthode | Pos | XP |
|---|-------|---------|-----|-----|
| 1 | Lin talk `pw1-lin` | campaign/talk | 79,92 | +15 |
| 2 | Ganza talk `pw1-ganza` | campaign/talk | 99,66 | +15 |
| 3 | Affiches fouille | quest-search | 64,88 | → xp 380 |
| 4 | Miliciens combat | battles/start | 78,48 | battle `8e96d408-…` démarré |

Campaign après affiches : `stage:122, accomplies:3, dernier:pw1-affiches`

## Anti-patterns (lents / faux)

- ❌ objectifId court `pw1-affiches` → 409
- ❌ chunks 4–8 → trop d’allers-retours
- ❌ ligne X-puis-Y sans BFS → stuck
- ❌ talk sans proximité → 409

## Combat quête — findings live 01/11/2026

### Start OK
POST /battles/start { characterId, objectifId: "campagne:pw1-miliciens" }
POST /battles/{id}/engage { characterId }

### Positions
tactics.positions[fighterId] = {x,y}
Sans ca -> targetCell null -> 400

### Rest
POST /world/rest { characterId, kind: "BELLE_ETOILE" }
hpRecovered 202, vitality 50

### Action + move
POST /battles/{id}/action { characterId, kind, id, targetId, targetCell }
POST /battles/{id}/move { characterId, cell }  // tactics.reachable
tir-1 hors portee -> 409 sans move

### Etat
2 defaites faute de move initial. Objectif miliciens toujours actif.

## Combat miliciens — VICTOIRE live 01/11/2026

Winner: **ALLIE** · HP fin 203/203 · XP 380 → 465

Séquence:
1. MOVE {x:75,y:48} cost 3 → dist 6
2. tir-1 ×3 sur milicien 2
3. endturn
4. tir-1 ×3 sur milicien 1
5. FIN

Campaign après: stage 123, accomplies 4, dernier pw1-miliciens
objectifs: []

GLCombat v2.1 fix yourTurn top-level + move puis cast = clé de la victoire.

## Talk Aliss pw1-aliss — live 01/11/2026

Pos: 120,93 · status 200
resolved id: pw1-aliss · +20 XP (465→485)
campaign: stage 124, accomplies 5, dernier pw1-aliss
objectifs: []

PNJ positions ilusia (entities):
- Aliss 120,93
- Lin 79,93
- Berthe 99,93
- Pip 59,67
- Sœur Agathe 59,94
- Oscar 119,66
- Gaspard 39,94
