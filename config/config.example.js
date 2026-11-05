/**
 * Configuration exemple — copier vers config.js (gitignored) si besoin.
 * Les scripts injectés lisent surtout window.__glCombatCfg / options runtime.
 */
module.exports = {
  // Compte (launcher Selenium uniquement — préférer variables d'env GL_EMAIL / GL_PASSWORD)
  // email: "",
  // password: "",

  combat: {
    FLEE_HP_PCT: 0.18,
    GUARD_HP_PCT: 0.28,
    KITE_MELEE_ENABLED: true,
    PREFER_KILL_COUNT: true,
    AVOID_HAZARDS: true,
    LOS_CHECK: true,
    AUTO_REST: true,
    VERBOSE: true
  },

  farm: {
    skipEngaged: true,
    skipRespawning: true,
    freeFightDelaySec: 90,
    preferSingleMob: false,
    autoPickup: false,
    autoHarvest: false
  },

  api: {
    baseUrl: "https://api.grandline-online.fr"
  }
};
