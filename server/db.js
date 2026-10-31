'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { SKINS, DEFAULT_SKIN_ID, GODMAX_SKIN_ID } = require('./skins');
const { levelFromExp } = require('./progression');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'ball-arena.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PLAYER',
  avatar TEXT NOT NULL DEFAULT '🔵',
  bio TEXT NOT NULL DEFAULT '',
  coins INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0 CHECK (exp >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  flags INTEGER NOT NULL DEFAULT 0 CHECK (flags >= 0),
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  equipped_skin TEXT NOT NULL DEFAULT '${DEFAULT_SKIN_ID}',
  banned_until INTEGER,
  ban_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_skins (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'owned',
  obtained_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skin_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🔵',
  room TEXT NOT NULL DEFAULT 'global',
  text TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  is_owner INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_name TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boss_kills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  boss_id TEXT NOT NULL,
  level_at_kill INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_reports_resolved ON reports(resolved);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON reward_ledger(user_id, created_at);
`);

const DEFAULT_EXP = levelFromExp(0).expIntoLevel;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, hash] = parts;
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

const stmts = {
  byUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare(`INSERT INTO users (username, password_hash, role, avatar, equipped_skin, created_at)
                          VALUES (@username, @password_hash, @role, @avatar, @equipped_skin, @created_at)`),
  grantSkin: db.prepare(`INSERT OR IGNORE INTO player_skins (user_id, skin_id, source, obtained_at)
                         VALUES (?, ?, ?, ?)`),
  hasSkin: db.prepare('SELECT 1 FROM player_skins WHERE user_id = ? AND skin_id = ?'),
  listSkins: db.prepare('SELECT skin_id FROM player_skins WHERE user_id = ?'),
  setSkin: db.prepare('UPDATE users SET equipped_skin = ? WHERE id = ?'),
  addRewards: db.prepare(`UPDATE users SET coins = coins + ?, exp = exp + ?, flags = flags + ?,
                          level = ?, wins = wins + ?, losses = losses + ? WHERE id = ?`),
  insertLedger: db.prepare(`INSERT INTO reward_ledger (user_id, kind, amount, meta, created_at)
                            VALUES (?, ?, ?, ?, ?)`),
};

function ensureSkinRow(userId, skinId, source = 'starter') {
  stmts.grantSkin.run(userId, skinId, source, Date.now());
}

function grantAllSkins(userId, source = 'owner') {
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const skin of SKINS) stmts.grantSkin.run(userId, skin.id, source, now);
  });
  tx();
}

function computeLevel(exp) {
  return levelFromExp(exp).level;
}

/** Seeds the owner account server-side. Only the hash is ever persisted. */
function seedOwner() {
  const username = process.env.OWNER_USERNAME || 'riezqy';
  const password = process.env.OWNER_PASSWORD || 'karuniayusufriezqy123';
  const existing = stmts.byUsername.get(username);
  if (existing) {
    db.prepare("UPDATE users SET role = 'OWNER' WHERE id = ?").run(existing.id);
    if (!stmts.hasSkin.get(existing.id, GODMAX_SKIN_ID)) {
      grantAllSkins(existing.id, 'owner');
      stmts.setSkin.run(GODMAX_SKIN_ID, existing.id);
    }
    return { created: false, username };
  }
  const now = Date.now();
  const info = stmts.insertUser.run({
    username,
    password_hash: hashPassword(password),
    role: 'OWNER',
    avatar: '👑',
    equipped_skin: GODMAX_SKIN_ID,
    created_at: now,
  });
  const userId = info.lastInsertRowid;
  grantAllSkins(userId, 'owner');
  db.prepare('UPDATE users SET coins = 5000 WHERE id = ?').run(userId);
  db.prepare(`INSERT INTO audit_log (actor_id, action, target, detail, created_at)
              VALUES (?, 'OWNER_SEEDED', ?, 'Server-side secure owner initialization', ?)`)
    .run(userId, username, now);
  return { created: true, username };
}

function publicUser(row, { includePrivate = false } = {}) {
  if (!row) return null;
  const progress = levelFromExp(row.exp);
  const ownedSkins = stmts.listSkins.all(row.id).map((r) => r.skin_id);
  const base = {
    id: row.id,
    username: row.username,
    role: row.role,
    avatar: row.avatar,
    bio: row.bio,
    coins: row.coins,
    exp: row.exp,
    level: row.level,
    expIntoLevel: progress.expIntoLevel,
    expForNext: progress.expForNext,
    flags: row.flags,
    wins: row.wins,
    losses: row.losses,
    equippedSkin: row.equipped_skin,
    ownedSkins,
    createdAt: row.created_at,
    bannedUntil: row.banned_until || null,
    banReason: row.ban_reason || null,
    isBanned: !!(row.banned_until && row.banned_until > Date.now()),
    isOwner: row.role === 'OWNER',
  };
  if (includePrivate) base.email = undefined;
  return base;
}

/** Applies server-validated rewards exactly once per call, with ledger audit. */
function applyRewards(userId, { coins = 0, exp = 0, flags = 0, wins = 0, losses = 0, kind = 'gameplay', meta = null }) {
  coins = Math.max(0, Math.floor(Number(coins) || 0));
  exp = Math.max(0, Math.floor(Number(exp) || 0));
  flags = Math.max(0, Math.floor(Number(flags) || 0));
  if (coins > 100000 || exp > 200000 || flags > 500) {
    throw new Error('Reward exceeds server limits');
  }
  const tx = db.transaction(() => {
    const row = stmts.byId.get(userId);
    if (!row) throw new Error('User not found');
    const newExp = row.exp + exp;
    const newLevel = computeLevel(newExp);
    stmts.addRewards.run(coins, exp, flags, newLevel, wins, losses, userId);
    stmts.insertLedger.run(userId, kind, coins, JSON.stringify({ exp, flags, wins, losses, ...(meta || {}) }), Date.now());
    return stmts.byId.get(userId);
  });
  return tx();
}

function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

module.exports = {
  db,
  DB_PATH,
  DATA_DIR,
  UPLOAD_DIR,
  stmts,
  hashPassword,
  verifyPassword,
  ensureSkinRow,
  grantAllSkins,
  computeLevel,
  seedOwner,
  publicUser,
  applyRewards,
  cleanupSessions,
  DEFAULT_EXP,
};
