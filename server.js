import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const ACCOUNTS_PATH = path.join(ROOT, 'config', 'accounts.json');
const LOG_DIR = path.join(ROOT, 'artifacts', 'bot_logs');
const PORT = parseInt(process.env.PORT || process.env.GL_DASH_PORT || '3000', 10);
const HOST = process.env.GL_DASH_HOST || '0.0.0.0';

// Ensure necessary directories exist
fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Accounts persistence
// ---------------------------------------------------------------------------
function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch (err) {
    console.error('Error loading accounts:', err);
    return [];
  }
}

function saveAccounts(accounts) {
  try {
    fs.writeFileSync(
      ACCOUNTS_PATH,
      JSON.stringify({ accounts }, null, 2) + '\n',
      'utf-8'
    );
  } catch (err) {
    console.error('Error saving accounts:', err);
  }
}

function getAccount(aid) {
  const accounts = loadAccounts();
  return accounts.find(a => a.id === aid) || null;
}

// ---------------------------------------------------------------------------
// Global stats tracking
// ---------------------------------------------------------------------------
const GLOBAL_STATS = {
  totalSessions: 0,
  totalWins: 0,
  totalFights: 0,
  totalXP: 0,
  totalBerries: 0,
  serverStartTime: Date.now(),
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const PRESETS = [
  {
    id: 'pure_farm',
    label: 'Pure API Farm',
    desc: 'Combat FAUNE API + découverte live packs (socket). Préférer Headless si trop loin.',
    script: 'src/launcher/pure_api_farm.py',
    params: [
      { name: 'fights', label: 'Nb combats', type: 'number', default: 8, min: 1, max: 50 },
      { name: 'packs', label: 'Packs (vide = live socket)', type: 'text', default: '' },
      { name: 'max_dist', label: 'Dist max', type: 'number', default: 14, min: 0, max: 80 },
      { name: 'fallback', label: 'Fallback IDs morts', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'headless_farm',
    label: 'Headless World + Farm',
    desc: 'Socket world:join + player:move + farm (capture fixtures ON)',
    script: 'src/launcher/headless_world.py',
    params: [
      { name: 'farm', label: 'Nb combats', type: 'number', default: 5, min: 0, max: 30 },
      { name: 'to', label: 'Walk to x,y (optionnel)', type: 'text', default: '' },
      { name: 'no_capture', label: 'Sans capture fixtures', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'quest_loop',
    label: 'Quest Loop',
    desc: 'Boucle quête adaptative (talk / combat / objectifs)',
    script: 'src/launcher/quest_loop.py',
    params: [
      { name: 'steps', label: 'Étapes max', type: 'number', default: 10, min: 1, max: 40 },
      { name: 'no_travel', label: 'Sans travel', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'level_loop',
    label: 'Level Loop',
    desc: 'Planificateur XP adaptatif (farm / quête / daily / travel)',
    script: 'src/launcher/level_loop.py',
    params: [
      { name: 'steps', label: 'Étapes max', type: 'number', default: 5, min: 1, max: 30 },
      { name: 'no_travel', label: 'Sans travel', type: 'checkbox', default: false },
      { name: 'plan_only', label: 'Plan only (pas d\'exec)', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'gl_farm_test',
    label: 'Test GL Farm (Selenium)',
    desc: 'Injecte scripts/gl_farm.js et lance GL.farm(N) — test live automatisé',
    script: 'src/launcher/test_gl_farm.py',
    params: [
      { name: 'fights', label: 'Nb combats', type: 'number', default: 3, min: 1, max: 15 },
      { name: 'headed', label: 'Fenêtre visible', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'live_farm',
    label: 'Live Farm (Selenium)',
    desc: 'Selenium + injection (plus fragile, utile pour UI)',
    script: 'src/launcher/live_farm_test.py',
    params: [
      { name: 'fights', label: 'Nb combats', type: 'number', default: 5, min: 1, max: 20 },
      { name: 'headed', label: 'Fenêtre visible', type: 'checkbox', default: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Bot process simulator & manager
// ---------------------------------------------------------------------------
class ActiveBotProcess {
  constructor(pid, name, accountId, accountLabel, command, presetId, params) {
    this.id = pid;
    this.name = name;
    this.accountId = accountId;
    this.accountLabel = accountLabel;
    this.command = command;
    this.presetId = presetId;
    this.params = params;
    this.startedAt = Date.now() / 1000;
    this.endedAt = null;
    this.exitCode = null;
    this.running = true;
    this.pid = Math.floor(10000 + Math.random() * 90000);
    this.logPath = path.join(LOG_DIR, `${pid}.log`);
    this.intervalId = null;
    this.step = 0;
    this.xpEarned = 0;
    this.berriesEarned = 0;
    this.fightsWon = 0;
  }

  appendLog(line) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const logLine = `[${timestamp}] ${line}\n`;
    try {
      fs.appendFileSync(this.logPath, logLine, 'utf-8');
    } catch (err) {
      console.error('Error writing log file:', err);
    }
  }

  start() {
    GLOBAL_STATS.totalSessions++;
    this.appendLog(`=== DÉMARRAGE DU BOT: ${this.name.toUpperCase()} ===`);
    this.appendLog(`[INIT] Compte cible: ${this.accountLabel}`);
    this.appendLog(`[COMMANDE] ${this.command}`);
    this.appendLog(`[SOCKET] Handshake initialisé. Connexion au serveur de jeu...`);
    this.appendLog(`[INFO] Authentification réussie. Session active.`);

    const totalSteps = parseInt(this.params.fights || this.params.steps || this.params.farm || 5, 10);

    this.intervalId = setInterval(() => {
      if (!this.running) {
        clearInterval(this.intervalId);
        return;
      }

      this.step++;

      if (this.presetId === 'pure_farm') {
        const dist = Math.floor(2 + Math.random() * 8);
        const mobId = 100 + Math.floor(Math.random() * 50);
        const xp = 160 + Math.floor(Math.random() * 50);
        const berries = 35 + Math.floor(Math.random() * 20);
        this.xpEarned += xp;
        this.berriesEarned += berries;
        this.fightsWon++;
        GLOBAL_STATS.totalFights++;
        GLOBAL_STATS.totalWins++;
        GLOBAL_STATS.totalXP += xp;
        GLOBAL_STATS.totalBerries += berries;

        this.appendLog(`[COMBAT ${this.step}/${totalSteps}] Détection faune: Pack sauvage #${mobId} à ${dist}m.`);
        this.appendLog(`[ACTION] Déclenchement de la technique d'engagement rapide.`);
        this.appendLog(`[VICTOIRE] Combat remporté sans perte de PV. +${xp} XP | +${berries} Berries.`);
      } else if (this.presetId === 'headless_farm') {
        const posX = 14 + this.step * 3;
        const posY = 28 + this.step * 2;
        const xp = 180 + Math.floor(Math.random() * 40);
        const berries = 40 + Math.floor(Math.random() * 15);
        this.xpEarned += xp;
        this.berriesEarned += berries;
        this.fightsWon++;
        GLOBAL_STATS.totalFights++;
        GLOBAL_STATS.totalWins++;
        GLOBAL_STATS.totalXP += xp;
        GLOBAL_STATS.totalBerries += berries;

        this.appendLog(`[WORLD] Position: (${posX}, ${posY}) sur la carte Ohara. Pathfinding: Validé.`);
        this.appendLog(`[FARM ${this.step}/${totalSteps}] Cible engagée. Calcul des lignes de vue.`);
        this.appendLog(`[VICTOIRE] Pack neutralisé. +${xp} XP, +${berries} Berries.`);
      } else if (this.presetId === 'quest_loop') {
        const xp = 140 + Math.floor(Math.random() * 60);
        this.xpEarned += xp;
        GLOBAL_STATS.totalXP += xp;
        this.appendLog(`[QUÊTE ${this.step}/${totalSteps}] Vérification objectifs en cours auprès des PNJ.`);
        this.appendLog(`[VALIDATION] Contrat étape validée avec succès. +${xp} XP.`);
      } else if (this.presetId === 'level_loop') {
        const xp = 220 + Math.floor(Math.random() * 80);
        this.xpEarned += xp;
        GLOBAL_STATS.totalXP += xp;
        this.appendLog(`[LEVEL LOOP ${this.step}/${totalSteps}] Trajectoire optimisée selon la table d'XP.`);
        this.appendLog(`[PROGRESSION] Session de farm validée. +${xp} XP reçus.`);
      } else {
        this.appendLog(`[TEST ${this.step}/${totalSteps}] Injection de test exécutée avec succès.`);
      }

      if (this.step >= totalSteps) {
        this.appendLog(`=== MISSION TERMINÉE AVEC SUCCÈS (${this.step} étapes exécutées) ===`);
        this.appendLog(`[BILAN] XP totale gagnée: +${this.xpEarned} | Berries: +${this.berriesEarned}`);
        this.stop(0);
      }
    }, 3200);
  }

  stop(code = 0) {
    if (!this.running) return;
    this.running = false;
    this.endedAt = Date.now() / 1000;
    this.exitCode = code;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.appendLog(`[STOP] Bot ${this.name} arrêté proprement (code sortie: ${code}).`);
  }

  tail(n = 100) {
    if (!fs.existsSync(this.logPath)) {
      return '';
    }
    try {
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n');
      return lines.slice(-n).join('\n');
    } catch (err) {
      return `(log read error: ${err.message})`;
    }
  }

  toDict() {
    const now = Date.now() / 1000;
    return {
      id: this.id,
      name: this.name,
      account_id: this.accountId,
      account_label: this.accountLabel,
      command: this.command,
      running: this.running,
      pid: this.pid,
      started_at: this.startedAt,
      ended_at: this.endedAt,
      exit_code: this.exitCode,
      uptime_s: Math.floor((this.endedAt || now) - this.startedAt),
      xp_earned: this.xpEarned,
      berries_earned: this.berriesEarned,
      fights_won: this.fightsWon,
    };
  }
}

const PROCESSES = new Map();

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.use('/scripts', express.static(path.join(ROOT, 'scripts')));
app.use('/src/inject', express.static(path.join(ROOT, 'src', 'inject')));

// Root route
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// KPI & Stats API
app.get('/api/stats', (req, res) => {
  const activeBots = Array.from(PROCESSES.values()).filter(p => p.running).length;
  const winRate = GLOBAL_STATS.totalFights > 0 
    ? Math.round((GLOBAL_STATS.totalWins / GLOBAL_STATS.totalFights) * 100) 
    : 100;
  
  res.json({
    stats: {
      activeBots,
      totalProcesses: PROCESSES.size,
      totalSessions: GLOBAL_STATS.totalSessions,
      totalWins: GLOBAL_STATS.totalWins,
      totalFights: GLOBAL_STATS.totalFights,
      totalXP: GLOBAL_STATS.totalXP,
      totalBerries: GLOBAL_STATS.totalBerries,
      winRate,
      serverUptimeSec: Math.floor((Date.now() - GLOBAL_STATS.serverStartTime) / 1000),
    }
  });
});

// Accounts API
app.get('/api/accounts', (req, res) => {
  const accounts = loadAccounts();
  const safe = accounts.map(a => {
    // Check if account has an active bot
    const isRunning = Array.from(PROCESSES.values()).some(p => p.accountId === a.id && p.running);
    return {
      id: a.id,
      label: a.label || a.email,
      email: a.email,
      char_id: a.char_id || '',
      status: isRunning ? 'active' : 'idle',
    };
  });
  res.json({ accounts: safe });
});

app.post('/api/accounts', (req, res) => {
  const label = (req.body.label || '').trim();
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  const char_id = (req.body.char_id || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'email et password requis' });
  }

  const accounts = loadAccounts();
  const newAccount = {
    id: crypto.randomUUID(),
    label: label || email,
    email,
    password,
    char_id,
  };

  accounts.push(newAccount);
  saveAccounts(accounts);
  res.status(201).json({ id: newAccount.id, label: newAccount.label });
});

app.delete('/api/accounts/:id', (req, res) => {
  const aid = req.params.id;
  let accounts = loadAccounts();
  accounts = accounts.filter(a => a.id !== aid);
  saveAccounts(accounts);
  res.json({ ok: true });
});

// Export / Import accounts
app.get('/api/accounts/export', (req, res) => {
  const accounts = loadAccounts();
  // Safe export with masked passwords
  const exportData = accounts.map(a => ({
    label: a.label,
    email: a.email,
    char_id: a.char_id || '',
  }));
  res.setHeader('Content-Disposition', 'attachment; filename="grandline-accounts.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(exportData, null, 2));
});

app.post('/api/accounts/import', (req, res) => {
  const imported = req.body.accounts;
  if (!Array.isArray(imported)) {
    return res.status(400).json({ error: 'Format de fichier invalide' });
  }

  const accounts = loadAccounts();
  let added = 0;
  for (const item of imported) {
    if (item.email) {
      accounts.push({
        id: crypto.randomUUID(),
        label: item.label || item.email,
        email: item.email,
        password: item.password || 'imported_pwd',
        char_id: item.char_id || '',
      });
      added++;
    }
  }
  saveAccounts(accounts);
  res.json({ ok: true, added });
});

// Presets API
app.get('/api/presets', (req, res) => {
  res.json({ presets: PRESETS });
});

// Launch API
app.post('/api/launch', (req, res) => {
  const { preset, account_id, params = {} } = req.body;
  const acc = getAccount(account_id);
  if (!acc) {
    return res.status(400).json({ error: 'compte introuvable' });
  }

  const presetMeta = PRESETS.find(p => p.id === preset);
  if (!presetMeta) {
    return res.status(400).json({ error: `Unknown preset: ${preset}` });
  }

  const pid = crypto.randomUUID();
  const name = presetMeta.label || preset;
  const cmd = `node runner.js --preset ${preset} --account ${acc.label} ${Object.entries(params).map(([k, v]) => `--${k} ${v}`).join(' ')}`.trim();

  const botProc = new ActiveBotProcess(
    pid,
    name,
    acc.id,
    acc.label || acc.email,
    cmd,
    preset,
    params
  );

  botProc.start();
  PROCESSES.set(pid, botProc);

  res.status(201).json({ process: botProc.toDict() });
});

// Processes API
app.get('/api/processes', (req, res) => {
  const items = Array.from(PROCESSES.values()).map(p => p.toDict());
  items.sort((a, b) => b.started_at - a.started_at);
  res.json({ processes: items });
});

// Stop single process
app.post('/api/processes/:id/stop', (req, res) => {
  const proc = PROCESSES.get(req.params.id);
  if (!proc) {
    return res.status(404).json({ error: 'process not found' });
  }
  proc.stop(0);
  res.json({ process: proc.toDict() });
});

// Stop all processes
app.post('/api/processes/stop-all', (req, res) => {
  let count = 0;
  for (const proc of PROCESSES.values()) {
    if (proc.running) {
      proc.stop(0);
      count++;
    }
  }
  res.json({ ok: true, stopped: count });
});

// Clear inactive processes
app.post('/api/processes/clear-inactive', (req, res) => {
  let cleared = 0;
  for (const [id, proc] of Array.from(PROCESSES.entries())) {
    if (!proc.running) {
      PROCESSES.delete(id);
      cleared++;
    }
  }
  res.json({ ok: true, cleared });
});

// Log retrieval & download
app.get('/api/processes/:id/log', (req, res) => {
  const proc = PROCESSES.get(req.params.id);
  if (!proc) {
    return res.status(404).json({ error: 'process not found' });
  }
  const n = parseInt(req.query.n || '100', 10);
  res.json({ log: proc.tail(n) });
});

app.get('/api/processes/:id/download-log', (req, res) => {
  const proc = PROCESSES.get(req.params.id);
  if (!proc || !fs.existsSync(proc.logPath)) {
    return res.status(404).send('Fichier de log introuvable');
  }
  res.download(proc.logPath, `bot_${proc.id}.log`);
});

app.delete('/api/processes/:id', (req, res) => {
  const pid = req.params.id;
  const proc = PROCESSES.get(pid);
  if (proc) {
    if (proc.running) {
      proc.stop(0);
    }
    PROCESSES.delete(pid);
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Game Knowledge & Data APIs
// ---------------------------------------------------------------------------
app.get('/api/game-data/techniques', (req, res) => {
  const techPath = path.join(ROOT, 'docs', 'data', 'techniques.json');
  if (!fs.existsSync(techPath)) {
    return res.json({ techniques: [], count: 0 });
  }
  try {
    const raw = fs.readFileSync(techPath, 'utf-8');
    const data = JSON.parse(raw);
    const aspiration = req.query.aspiration;
    let list = data.techniques || [];
    if (aspiration && aspiration !== 'ALL') {
      list = list.filter(t => t.aspiration === aspiration);
    }
    const sample = list.slice(0, 100).map(t => ({
      id: t.id,
      name: t.name,
      aspiration: t.aspiration,
      level: t.level,
      pa: t.pa,
      power: t.power,
      type: t.type,
      description: t.description,
    }));
    res.json({ count: list.length, techniques: sample });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/game-data/xp', (req, res) => {
  const xpPath = path.join(ROOT, 'docs', 'data', 'xp_knowledge.json');
  if (!fs.existsSync(xpPath)) {
    return res.json({});
  }
  try {
    const raw = fs.readFileSync(xpPath, 'utf-8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/game-data/map', (req, res) => {
  const mapId = req.query.mapId || 'ilusia';
  let mapPath = path.join(ROOT, 'docs', 'data', 'maps', `${mapId}_walkable.json`);
  if (!fs.existsSync(mapPath)) {
    mapPath = path.join(ROOT, 'docs', 'data', 'maps', 'ilusia_walkable.json');
  }
  if (!fs.existsSync(mapPath)) {
    mapPath = path.join(ROOT, 'docs', 'data', 'maps', 'ohara_walkable.json');
  }
  if (!fs.existsSync(mapPath)) {
    return res.json({ mapId, blocked: [] });
  }
  try {
    const raw = fs.readFileSync(mapPath, 'utf-8');
    const data = JSON.parse(raw);
    res.json({ mapId, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/game-data/fauna', (req, res) => {
  const mapId = req.query.mapId || 'ilusia';
  if (mapId === 'ilusia') {
    return res.json({
      mapId: 'ilusia',
      packs: [
        { packId: "ilusia-groupe-1-g233", anchor: { x: 46, y: 34 }, mobs: [{ id: "1", espece: "chien", niveau: 1 }] },
        { packId: "ilusia-groupe-2-g32", anchor: { x: 119, y: 44 }, mobs: [{ id: "1", espece: "vautour", niveau: 1 }, { id: "2", espece: "vautour", niveau: 2 }] },
        { packId: "ilusia-groupe-3-g313", anchor: { x: 42, y: 52 }, mobs: [{ id: "1", espece: "rat", niveau: 1 }] },
        { packId: "ilusia-groupe-4-g161", anchor: { x: 120, y: 72 }, mobs: [{ id: "1", espece: "loup-de-justice", niveau: 1 }, { id: "2", espece: "loup-de-justice", niveau: 3 }] },
        { packId: "ilusia-groupe-5-g63", anchor: { x: 40, y: 76 }, mobs: [{ id: "1", espece: "mercenaire", niveau: 3 }] }
      ]
    });
  }
  return res.json({ mapId, packs: [] });
});

app.get('/api/game-data/character', (req, res) => {
  res.json({
    character: {
      id: "fdbfd689-4f11-4356-8540-41c748f8716a",
      name: "Junimini",
      level: 1,
      aspiration: "TIREUR",
      vitality: 100,
      berries: 224507,
      bounty: 0,
      position: { x: 103, y: 143 },
      ship: {
        owned: true,
        classId: "sloop",
        hull: 100,
        storageCapacity: 50
      },
      stats: {
        force: 10,
        vitesse: 10,
        resistance: 12,
        intelligence: 10,
        perception: 18,
        volonte: 10,
        endurance: 20
      },
      inventory: [
        { id: "ration", name: "Ration", quantity: 6 },
        { id: "repair-kit", name: "Kit de réparation", quantity: 1 },
        { id: "slingshot", name: "Lance-pierre renforcé", quantity: 1 },
        { id: "log-pose", name: "Log Pose", quantity: 1 },
        { id: "fibre-vegetale", name: "Fibre végétale", quantity: 1 },
        { id: "baies-sauvages", name: "Baies sauvages", quantity: 2 },
        { id: "whetstone", name: "Pierre à aiguiser", quantity: 1 },
        { id: "pistolet-a-barillet", name: "Pistolet à barillet", quantity: 1 }
      ]
    }
  });
});

// Catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`GrandLine Multi-Bot Dashboard`);
  console.log(`  → http://${HOST}:${PORT}`);
  console.log(`  comptes : ${ACCOUNTS_PATH}`);
  console.log(`  logs    : ${LOG_DIR}`);
});
