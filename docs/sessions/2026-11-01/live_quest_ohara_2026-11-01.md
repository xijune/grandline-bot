# Quêtes + voyage Ohara — live 01/11/2026

## Progression campagne

| Step | ID | XP | Notes |
|------|-----|-----|-------|
| vivres | pw1-vivres | +80 | FETCH ration×3 → Lin |
| barque | pw1-barque | +100 | discover **ohara**, ship reward |
| cap | pw2-cap | +60 | voyage ilusia→ohara auto à l’accostage |
| **stage** | **127** | **xp 725** | Acte II · Les livres du lac |

## Travel inter-îles VALIDÉ

```
1. discover via quête (rewards.discover: ["ohara"])
2. Walk ponton 104,139
3. POST /sea/depart { mode:"navire", sortie }
4. POST /sea/cap { islandId:"ohara" } → plan.tiles[]
5. POST /sea/position { col,row,x,y } (attendre rate-limit)
6. POST /sea/dock { islandId:"ohara" }
   → cost tax+wage, campaign step pw2-cap
   → mapId ohara (76,147)
```

Coût live : tax 80 + wage 150 = 230 berries, hull −5, 1 ration, ~28s

## Ohara NPCs (entities)

| id | nom | x,y |
|----|-----|-----|
| npc-lieutenant-vasseur | Lieutenant Vasseur | 42,104 |
| npc-robin | Noémi | 80,75 |
| npc-olvia | Maëlle | 117,104 |
| npc-saul | Doran | 80,123 |
| npc-tobie-le-repecheur | Tobie | 33,82 |
| npc-hortense-la-cuisiniere | Hortense | 58,118 |
| npc-lucien-le-pelerin | Lucien | 49,42 |
| npc-severin-hauteclaire-a-ohara | Séverin | 69,32 |
| quete-nolwen-astier | Nolwen | 100,118 |

## Quête UI active

Acte II — « Le poste où il ne se passe rien »  
→ Présente-toi au lieutenant Vasseur (42,104)

## FETCH type

`campaign/talk` consomme auto les items si quantity OK (ration 3) — pas d’endpoint deliver séparé.
stage 131 xp 890 ohara quest progress documented
