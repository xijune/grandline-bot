# Craft & contrats

> Extrait consolidé depuis systems_advanced (01/11/2026). Preuves : `docs/sessions/`.

## 2. Craft (atelier / métier)

### Routes

| Méthode | Route | Body |
|---------|-------|------|
| POST | `/api/characters/${id}/craft` | `{ recipeId, catalyseur: boolean }` |
| POST | `/api/characters/${id}/craft/collect` | (vide / token) |

### Données client
- `character.aspiration` = métier (FORGERON, CHARPENTIER, …).
- Niveau de métier + XP + `busyUntil` + `queue[]` (file d’attente).
- Recettes = données client filtrées par aspiration + niveau (`Zj(aspiration)`).
- Catalyseur = « Poudre de maîtrise » (garantit réussite + chance de critique).
- Queue limitée (slots + registre comptoir de change max 2).
- Collect récupère les commandes `readyAt <= now`.

### Contraintes observées
- Atelier occupé → `busyUntil`.
- Certaines recettes (charpentier) exigent un **chantier naval** sur l’île.
- Niveau de métier minimum par recette.

### Notes
L’endpoint seul ne donne pas la liste des recettes : elle est côté client.  
Pour un bot : lire `character` (aspiration, queue, level) puis appeler craft avec un `recipeId` connu.

---


