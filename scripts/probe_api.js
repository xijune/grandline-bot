/**
 * Probe API rapide — coller en console F12 (en jeu, authentifié)
 * Aide à tester les 6 systèmes avancés + dump d’état utile.
 *
 * Usage :
 *   Probe.negoce()
 *   Probe.craft()
 *   Probe.travel("ilusia")
 *   Probe.quests()
 *   Probe.shop("port")
 *   Probe.pvp(targetId)
 *   Probe.char()
 *   Probe.help()
 */
(async function () {
  "use strict";

  const API = "https://api.grandline-online.fr";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findToken() {
    if (window.__freshToken) return window.__freshToken;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const v = sessionStorage.getItem(sessionStorage.key(i));
        if (v && v.split(".").length === 3 && v.length > 100) {
          try {
            const p = JSON.parse(atob(v.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (p.exp > Date.now() / 1000) return v;
          } catch {}
        }
      }
    } catch {}
    return sessionStorage.getItem("grandline-token");
  }

  async function api(method, path, body) {
    const TOKEN = findToken();
    const r = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(TOKEN ? { authorization: "Bearer " + TOKEN } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, data };
  }

  async function ensureCharId() {
    let id =
      sessionStorage.getItem("__autoCharId") ||
      window.__grandlineScene?.character?.id;
    if (!id) {
      const r = await api("GET", "/api/characters");
      const list = r.data?.characters || r.data;
      id = Array.isArray(list) ? list[0]?.id : r.data?.id;
      if (id) sessionStorage.setItem("__autoCharId", id);
    }
    return id;
  }

  const Probe = {
    async char() {
      const id = await ensureCharId();
      const r = await api("GET", `/api/characters/${id}`);
      console.log("[Probe] character", r);
      return r.data;
    },

    async negoce() {
      const id = await ensureCharId();
      const comptoir = await api("GET", `/api/negoce/comptoir/${id}`);
      console.log("[Probe] negoceComptoir", comptoir);
      return comptoir.data;
    },

    async negoceVendre(marchandise, quantite = 1) {
      const id = await ensureCharId();
      const r = await api("POST", "/api/negoce/vendre", {
        characterId: id,
        marchandise,
        quantite
      });
      console.log("[Probe] negoceVendre", r);
      return r;
    },

    async negoceAcheter(marchandise, quantite = 1) {
      const id = await ensureCharId();
      const r = await api("POST", "/api/negoce/acheter", {
        characterId: id,
        marchandise,
        quantite
      });
      console.log("[Probe] negoceAcheter", r);
      return r;
    },

    async craft(recipeId, catalyseur = false) {
      const id = await ensureCharId();
      if (!recipeId) {
        const c = await this.char();
        console.log("[Probe] craft — donne un recipeId. aspiration =", c?.aspiration);
        console.log("  character.craft / queue / level métier visibles dans le char");
        return c;
      }
      const r = await api("POST", `/api/characters/${id}/craft`, {
        recipeId,
        catalyseur
      });
      console.log("[Probe] craft", r);
      return r;
    },

    async craftCollect() {
      const id = await ensureCharId();
      const r = await api("POST", `/api/characters/${id}/craft/collect`);
      console.log("[Probe] craftCollect", r);
      return r;
    },

    async travel(islandId) {
      const id = await ensureCharId();
      if (!islandId) {
        console.log('[Probe] travel("islandId") — ex: "ilusia"');
        return;
      }
      const r = await api("POST", "/api/world/travel", {
        characterId: id,
        islandId
      });
      console.log("[Probe] travel", r);
      return r;
    },

    async seaState() {
      const id = await ensureCharId();
      const r = await api("GET", `/api/sea/${id}`);
      console.log("[Probe] seaState", r);
      return r.data;
    },

    async seaDepart(islandId = null, mode = "navire") {
      const id = await ensureCharId();
      const body = { characterId: id, mode };
      if (islandId) body.islandId = islandId;
      const r = await api("POST", "/api/sea/depart", body);
      console.log("[Probe] seaDepart", r);
      return r;
    },

    async dock() {
      const id = await ensureCharId();
      const r = await api("GET", `/api/world/dock/${id}`);
      console.log("[Probe] dock", r);
      return r.data;
    },

    async quests() {
      const id = await ensureCharId();
      const r = await api("GET", `/api/characters/${id}/quest-objectives`);
      console.log("[Probe] quest-objectives", r);
      return r.data;
    },

    async questSearch(objectifId) {
      const id = await ensureCharId();
      if (!objectifId) {
        console.log("[Probe] questSearch(objectifId) — récupère d’abord Probe.quests()");
        return;
      }
      const r = await api("POST", `/api/characters/${id}/quest-search`, {
        objectifId
      });
      console.log("[Probe] questSearch", r);
      return r;
    },

    async shop(rayon = "port") {
      const id = await ensureCharId();
      const r = await api("GET", `/api/characters/${id}/shop/${encodeURIComponent(rayon)}`);
      console.log(`[Probe] shop(${rayon})`, r);
      return r.data;
    },

    async buy(itemId, shopId = "port") {
      const id = await ensureCharId();
      const r = await api("POST", `/api/characters/${id}/buy`, {
        itemId,
        shopId
      });
      console.log("[Probe] buy", r);
      return r;
    },

    async pvp(targetId) {
      const id = await ensureCharId();
      if (!targetId) {
        console.log("[Probe] pvp(targetId) — id du joueur cible");
        const scene = window.__grandlineScene;
        const pop = scene?.network?.population;
        console.log("population", pop);
        return;
      }
      const r = await api("POST", "/api/battles/pvp/challenge", {
        characterId: id,
        targetId
      });
      console.log("[Probe] pvp challenge", r);
      return r;
    },

    async restState() {
      const id = await ensureCharId();
      const r = await api("GET", `/api/world/rest/${id}`);
      console.log("[Probe] rest", r);
      return r.data;
    },

    help() {
      console.log(`
Probe API — commandes :
  Probe.char()
  Probe.negoce() / .negoceVendre(marchandise, qty) / .negoceAcheter(...)
  Probe.craft(recipeId?, catalyseur?) / .craftCollect()
  Probe.travel(islandId) / .seaState() / .seaDepart() / .dock()
  Probe.quests() / .questSearch(objectifId)
  Probe.shop(rayon="port") / .buy(itemId, shopId)
  Probe.pvp(targetId)
  Probe.restState()
  Probe.help()
`);
    }
  };

  window.Probe = Probe;
  console.log("%c[Probe] prêt — Probe.help()", "color:#4fc3f7;font-weight:bold");
})();
