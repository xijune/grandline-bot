# Contrat livraison bout-en-bout — live 01/11/2026

## Flux validé

1. `POST /economy/contracts/accept { characterId, contractId }`
2. Walk ponton exact (Ohara quai0: **45,141–146**, berth 45,147)
3. `POST /sea/depart { mode:"navire", sortie }`
4. `POST /sea/cap { islandId: "ilusia" }`
5. `POST /sea/position` le long du plan
6. `POST /sea/dock { islandId: "ilusia" }`
   → `contract.paid: 740` · current null

## Résultat live

| | |
|--|--|
| Contrat | ohara-498208-0 LIVRAISON → Ilusia |
| Reward | **740** ฿ + **144** XP |
| Coût voyage | tax 240 + wage 150 = **390** |
| Net berries | 1416 → **1766** (+350) |
| XP | 925 → **1069** |
| Hull wear | 7 |

## Ponton Ohara

`cityMap.port.docks[0].cells` = (45,141)…(45,146)

## Ilusia ponton (rappel)

(104,139)


## PvP (partiel)

```
POST /api/battles/pvp/challenge { characterId, targetId }
→ 409 si pas même île (route vivante)
```
Accept/decline paths 404 (noms exacts à confirmer)
