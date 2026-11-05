# Travel autonome Ohara → Toroa + loop leveling — 2026-11-02

## Preuve live bout-en-bout

| Étape | Résultat |
|-------|----------|
| Walk ponton (45,145) | OK |
| `POST /sea/depart` mode navire | 200 atSea west |
| `GET /sea/caps` | **ilusia + toroa** |
| `POST /sea/cap` toroa | plan 5 tiles, distanceCases ~242 |
| Positions interpolées entry→arrival | OK (rate-limit ~2.4s si credit) |
| Sac plein | sell `economy/sell` loot farm |
| Achat ration | `POST .../buy {itemId:ration, shopId:port}` |
| `POST /sea/dock` toroa | **200** |
| Campaign | stage 134→**135**, `pw3-cap`, +70 XP (5623→5693) |
| map | **toroa** (53,129) |

## Coût traversée live
tax 120 + wage 300 + toll 3900 = **4320฿**, hullWear 4, **1 ration**, ~26s serveur

## Pas de « faille XP » magique trouvée

Sources classées (mesures existantes) :

| Source | XP typique | Notes |
|--------|------------|-------|
| Combat quête | 85–473 | Meilleur burst + unlock |
| Contrat livraison | **126–180** | + temps mer |
| Talk majeur | 150 | Lucien |
| Cap voyage | 60–70 | pw2/pw3-cap |
| Daily tâche | ~100 | si progressive |
| Sea hunt ROI | 60 | opportuniste en mer |
| Farm solo | 9–15 / fight | filler |

Optimisation réelle = **enchaîner quête pour unlock îles** + farm packs niveau-adéquats + vendre loot + rations, pas un bypass serveur.

## Code

- `tools/sea_travel.py` — waypoints + ensure_travel_ready (sell + ration)
- `docs/data/docks.json` — pontons
- `src/launcher/level_loop.py` — travel mer réel dans la loop
- `tools/level_core.py` — travel seulement vers îles **non visitées**

## Run autonome

```bash
export GL_EMAIL=... GL_PASSWORD=...
python src/launcher/level_loop.py --steps 10
```
