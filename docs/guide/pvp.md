# PvP

> Extrait consolidé depuis systems_advanced (01/11/2026). Preuves : `docs/sessions/`.

## 5. PvP (challenge / accept)

### Challenge
```
POST /api/battles/pvp/challenge
{ characterId, targetId }
```
→ retourne un battle (id).

### Variantes UI
- « Duel amical »
- « Duel à mort » (`deadly: true` côté client, même endpoint pour l’instant)
- Agression / hunt (chasseurs)

### Accept / Join
- `POST /api/battles/${battleId}/join` (déjà catalogué)
- Sockets : `battle:opened` / `battle:closed` (combats joinables sur la map, flag `pvp`)
- Contraintes client : pas de combat en cours, mode en ligne, etc.

Une fois le battle ouvert, le flux combat standard (`engage`, `move`, `action`, `end-turn`) s’applique (même module GLCombat possible avec adaptations).

---


