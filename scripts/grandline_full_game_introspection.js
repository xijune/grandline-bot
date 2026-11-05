/**
 * GrandLine Online - Script d'Introspection Approfondie des Mécaniques de Jeu
 * 
 * Ce script est 100% passif (lecture seule, aucune action destructive).
 * À coller dans la console F12 de votre navigateur connecté sur https://grandline-online.fr/
 * 
 * Il extrait l'ensemble des règles réelles du client :
 * 1. Propriétés complètes et descriptions de TOUS les items du sac (types, usages, effets réels).
 * 2. Mécaniques réelles de récupération des PV et de la Forme (repos, régénération, soins).
 * 3. Utilisation exacte des Rations, Baies, Kits de réparation et Log Pose.
 * 4. Caractéristiques et portées de la classe Tireur et des armes équipées.
 * 5. Données du navire (Sloop), consommation de voyage et réparations.
 * 6. Mécaniques de combat, PA/PM, et catalogue global des objets si exposé.
 */

(async function () {
  "use strict";

  console.log("%c🔍 [GL-Introspection] Démarrage de l'analyse complète du moteur de jeu...", "color:#38bdf8;font-weight:bold;font-size:14px;");

  const scene = window.__grandlineScene;
  const token = sessionStorage.getItem("grandline-token") || localStorage.getItem("grandline-token") || window.__freshToken || "";
  const API_BASE = "https://api.grandline-online.fr";

  async function apiFetch(endpoint) {
    if (!token) return { error: "No token" };
    try {
      const res = await fetch(API_BASE + endpoint, {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        },
        credentials: "include"
      });
      return await res.json().catch(() => ({ status: res.status }));
    } catch (e) {
      return { error: e.message };
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    character: {},
    inventoryAnalysis: [],
    gameStaticCatalog: {},
    healingAndRestMechanics: {},
    shipAndTravelMechanics: {},
    combatAndShooterMechanics: {},
    clientSceneOverview: {}
  };

  // -------------------------------------------------------------
  // 1. Analyse détaillée du personnage et de ses caractéristiques
  // -------------------------------------------------------------
  if (scene?.character) {
    const c = scene.character;
    report.character = {
      id: c.id,
      name: c.name,
      level: c.level,
      aspiration: c.aspiration || c.classe || c.job,
      currentHp: c.currentHp ?? c.hp,
      maxHp: c.maxHp ?? c.stats?.maxHp,
      vitality: c.vitality ?? c.hpVitality,
      forme: c.forme,
      berries: c.berries,
      bounty: c.bounty,
      stats: c.stats,
      equipped: c.equipped || c.equipment || c.stuff || {},
      statusEffects: c.status || c.effects || [],
      position: { x: c.x, y: c.y }
    };
  }

  // -------------------------------------------------------------
  // 2. Analyse détaillée des objets de l'inventaire
  // -------------------------------------------------------------
  const invItems = scene?.character?.inventory?.items || [];
  console.log(`%c📦 Analyse de ${invItems.length} objets dans l'inventaire...`, "color:#fbbf24;font-weight:bold;");

  for (const item of invItems) {
    const itemDetail = {
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      rawProperties: { ...item }
    };

    // Tenter de récupérer la fiche officielle de l'item via l'API de jeu
    try {
      const apiItem = await apiFetch(`/api/items/${item.id}`);
      if (apiItem && !apiItem.error) {
        itemDetail.apiData = apiItem;
      }
    } catch (_) {}

    report.inventoryAnalysis.push(itemDetail);
  }

  // Chercher si le client possède une base de données statique d'items en cache
  const potentialCatalogs = [
    scene?.items,
    scene?.itemsData,
    scene?.gameData?.items,
    scene?.staticData?.items,
    scene?.database?.items,
    window.__ITEMS__,
    window.gameData?.items
  ];
  for (const cat of potentialCatalogs) {
    if (cat && typeof cat === "object") {
      report.gameStaticCatalog = Object.keys(cat).slice(0, 30);
      break;
    }
  }

  // -------------------------------------------------------------
  // 3. Analyse du système de Soin, Récupération de PV et Forme
  // -------------------------------------------------------------
  const restButtons = Array.from(document.querySelectorAll("button[data-rest]")).map(b => ({
    kind: b.getAttribute("data-rest"),
    text: b.innerText.trim(),
    disabled: b.disabled,
    title: b.title || b.getAttribute("aria-label")
  }));

  const domRestInfo = document.querySelector(".rest-system, .panel-repos, .modal-repos")?.innerText || "";

  report.healingAndRestMechanics = {
    availableRestButtonsInDom: restButtons,
    restPanelTextSnapshot: domRestInfo.slice(0, 500),
    knownRestCooldowns: {
      belleEtoileCooldown: scene?.belleEtoileCooldown || scene?.character?.lastBelleEtoile,
      navireAvailable: !!scene?.character?.ship?.owned
    },
    healingMethodsFoundInScene: Object.keys(scene || {}).filter(k => /heal|soin|repos|rest|vitality|forme/i.test(k)),
    playerVitalityRaw: scene?.character?.vitality,
    playerHpVitalityRaw: scene?.character?.hpVitality
  };

  // -------------------------------------------------------------
  // 4. Analyse du Navire et de la Navigation (Rôle des rations & kits)
  // -------------------------------------------------------------
  if (scene?.character?.ship) {
    const s = scene.character.ship;
    report.shipAndTravelMechanics = {
      owned: s.owned,
      classId: s.classId,
      name: s.name,
      hull: s.hull,
      storageCapacity: s.storageCapacity,
      storageItems: s.storageItems,
      pieces: s.pieces,
      canons: s.canons,
      travelData: scene?.travel || scene?.navigation || scene?.voyage || null
    };
  }

  // -------------------------------------------------------------
  // 5. Analyse des Techniques et Spécificités de l'Aspiration Tireur
  // -------------------------------------------------------------
  report.combatAndShooterMechanics = {
    techniquesKnown: scene?.character?.techniques || scene?.techniques || [],
    learnedSkills: scene?.character?.skills || [],
    hasRangedWeapon: !!scene?.character?.armeDeTir,
    weaponDetails: scene?.character?.equipped?.weapon || scene?.character?.weapon || null,
    combatMethodsFoundInScene: Object.keys(scene || {}).filter(k => /combat|attack|target|range|tir/i.test(k)),
    tacticsProperties: scene?.combatState?.tactics ? Object.keys(scene.combatState.tactics) : []
  };

  // -------------------------------------------------------------
  // 6. Vue d'ensemble des modules du moteur client
  // -------------------------------------------------------------
  report.clientSceneOverview = {
    sceneKeys: Object.keys(scene || {}).slice(0, 80),
    networkKeys: Object.keys(scene?.network || {}),
    systemsKeys: Object.keys(scene?.systems || {}),
    hasSocket: !!scene?.network?.socket
  };

  // -------------------------------------------------------------
  // 7. Envoi direct et téléchargement du JSON
  // -------------------------------------------------------------
  console.log("%c✅ [GL-Introspection] Analyse terminée avec succès !", "color:#10b981;font-weight:bold;font-size:14px;");
  console.log("Rapport extrait :", report);

  // Téléchargement automatique du JSON
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(report, null, 2));
  const dlAnchor = document.createElement("a");
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `grandline_game_mechanics_${Date.now()}.json`);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();

  // Création d'une modale avec textarea pour copier-coller instantané
  const existingModal = document.getElementById("gl-introspection-modal");
  if (existingModal) existingModal.remove();

  const modal = document.createElement("div");
  modal.id = "gl-introspection-modal";
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 650px;
    max-width: 90vw;
    max-height: 85vh;
    background: #0f172a;
    color: #f8fafc;
    border: 2px solid #38bdf8;
    border-radius: 12px;
    padding: 20px;
    z-index: 999999;
    box-shadow: 0 20px 50px rgba(0,0,0,0.8);
    font-family: monospace;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h3 style="margin:0;font-size:1.1rem;color:#38bdf8;">📋 GrandLine - Rapport d'Introspection Moteur</h3>
      <button id="gl-close-modal" style="background:#ef4444;border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:bold;">Fermer ✕</button>
    </div>
    <p style="margin:0;font-size:0.8rem;color:#94a3b8;">
      Le fichier JSON a été téléchargé automatiquement. Vous pouvez également cliquer ci-dessous pour copier le contenu et le coller dans la discussion.
    </p>
    <textarea id="gl-json-textarea" readonly style="width:100%;height:320px;background:#020617;color:#a5f3fc;border:1px solid #334155;border-radius:8px;padding:10px;font-size:0.75rem;resize:vertical;"></textarea>
    <button id="gl-copy-btn" style="background:#0284c7;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:bold;cursor:pointer;">📋 Copier dans le presse-papiers</button>
  `;

  document.body.appendChild(modal);

  const ta = document.getElementById("gl-json-textarea");
  ta.value = JSON.stringify(report, null, 2);

  document.getElementById("gl-copy-btn").addEventListener("click", () => {
    ta.select();
    navigator.clipboard.writeText(ta.value).then(() => {
      document.getElementById("gl-copy-btn").innerText = "✅ Copié !";
      setTimeout(() => {
        document.getElementById("gl-copy-btn").innerText = "📋 Copier dans le presse-papiers";
      }, 2500);
    });
  });

  document.getElementById("gl-close-modal").addEventListener("click", () => {
    modal.remove();
  });

  return report;
})();
