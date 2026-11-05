# Quêtes

> Extrait consolidé depuis systems_advanced (01/11/2026). Preuves : `docs/sessions/`.

## 4. Quêtes (objectifId → search → complete)

### Routes principales

| Méthode | Route | Body / Notes |
|---------|-------|--------------|
| GET | `/api/characters/${id}/quest-objectives` | → `{ mapId, objectifs[] }` |
| POST | `/api/characters/${id}/quest-search` | `{ objectifId }` (fouille / search) |
| POST | `/api/characters/${id}/faction-quest/complete` | (vide) |
| POST | `/api/characters/${id}/side-quests` | `{ npc, … }` |
| POST | `/api/characters/${id}/objective/follow` | `{ mode }` |
| POST | `/api/characters/${id}/objective/suivies` | `{ suivies }` |
| POST | `/api/characters/${id}/campaign/talk` | talk campagne |

### Flux observé côté client
1. `loadQuestObjectives()` → charge les repères de la map courante.
2. Objectifs apparaissent sur la carte (ennemis de quête, fouilles, etc.).
3. **Fouille** : `questSearch(objectifId)`.
4. **Combat de quête** : `startBattle({ objectifId })` ou `{ sideQuest: true, sideQuestId, ennemi }`.
5. Completion faction : `completeQuest`.
6. Side-quests via PNJ (`side-quests` + `campaign/talk`).

Les objectifs sont liés à la map (`mapId`). Hors marqueur / mauvaise map → liste vide.

---




---

## Bot quête adaptatif — validé 2026-11-02

Voir `docs/sessions/2026-11-02/quest_adaptive_validation.md`.

```bash
pytest tests/test_quest_core.py -q
python src/launcher/quest_loop.py --steps 8
```

Politique (`tools/quest_core.plan`) : objectifs serveur → combat/fouille ; sinon talk PNJ locaux (rayon 35) ; sinon travel_hint île découverte ; sinon idle.
