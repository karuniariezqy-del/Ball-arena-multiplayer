'use strict';

const crypto = require('crypto');
const { db, stmts, publicUser, verifyPassword } = require('./db');

const COOKIE_NAME = 'bal_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
    }
  }
  return out;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s
                          JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires_at > ?`)
    .get(hashToken(token), Date.now());
  if (!row) return null;
  return row;
}

function attachUser(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  req.sessionToken = req.cookies[COOKIE_NAME] || null;
  const row = sessionUser(req.sessionToken);
  req.userRow = row;
  req.user = row ? publicUser(row) : null;
  next();
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.isBanned) return res.status(403).json({ error: `Banned: ${req.user.banReason || 'policy violation'}` });
  next();
}

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!req.user.isOwner) return res.status(403).json({ error: 'Owner access only' });
  next();
}

function login(username, password) {
  const row = stmts.byUsername.get(String(username || '').trim());
  if (!row) return { error: 'Invalid username or password' };
  if (!verifyPassword(password, row.password_hash)) {
    return { error: 'Invalid username or password' };
  }
  if (row.banned_until && row.banned_until > Date.now()) {
    return { error: `Account banned: ${row.ban_reason || 'policy violation'}`, banned: true };
  }
  return { user: row };
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  hashToken,
  createSession,
  destroySession,
  sessionUser,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireOwner,
  login,
  SESSION_TTL_MS,
};
