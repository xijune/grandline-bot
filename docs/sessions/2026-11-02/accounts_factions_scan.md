# Scan multi-comptes factions — 02/11/2026

## Tableau des comptes

| Login | Perso | ID | Faction | Niveau | ฿ | Prime | canHunt | Notes |
|-------|-------|-----|---------|--------|---|-------|---------|-------|
| junymine4 | Bukima | `37762d71-bf5c-48ec-8092-de390221be4e` | PIRATE | 3+ | ~62k | 127 (hist.) | ? | Cible potentielle mais **niv < 30** |
| junymine6 | Julifa | `2b531757-a7f8-4d32-847b-0e409c65e176` | **MARINE** | 1 | 5500 | 0 | **false** | Rank RECRUE · FORGERON · MINK |
| junymine7 | Hankir | `4bf9c159-2830-46fe-9c2c-4e19eb4d8c76` | **REVOLUTIONNAIRE** | 1 | 5500 | 0 | **false** | MUSICIEN · GEANT |
| junymine8 | Porgas | `928cae40-c243-4470-849e-bf7db7c83791` | **CHASSEUR** | 1 | 5500 | 0 | **true** | NAVIGATEUR · HUMAIN |

Tous sur **ilusia** spawn ~60–61, 84–85.

## Chasse — preuves live

### Seul CHASSEUR a `canHunt: true`
Marine et Révolutionnaire : `canHunt: false`.

### Guilde chasse (Porgas)
- Rang Apprenti, plafond prime **100000**
- 3 chasses → Pisteur
- flairChasses: 3, flairReleveMin: 5

### Declare sur Bukima
```
POST /api/world/hunt/declare
→ 409 Bukima n'a pas encore le niveau 30 : un débutant ne se chasse pas.
```

**Règle** : proie **niveau ≥ 30**.

## Marine — Julifa
- RECRUE, Fleet Admiral Therael Lycan 104
- Treasury globale ~**97.8M ฿**, dailyPayroll ~1.18M
- Pas de crédit wallet perso à la lecture treasury

## Implications
1. Pas de farm prime entre alts niv < 30
2. Seul CHASSEUR déclare
3. Payout réel nécessite proie ≥ 30
