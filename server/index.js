'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const {
  db, stmts, DB_PATH, UPLOAD_DIR, hashPassword, verifyPassword,
  seedOwner, publicUser, applyRewards, ensureSkinRow, cleanupSessions,
} = require('./db');
const auth = require('./auth');
const { SKINS, RARITY_META, getSkin, DEFAULT_SKIN_ID, GODMAX_SKIN_ID } = require('./skins');
const { BOSSES, getBoss } = require('./bosses');
const { GameServer } = require('./game');
const { filterProfanity } = require('./filter');
const { saveImageDataUrl, removeUpload } = require('./upload');
const { expForNextLevel } = require('./progression');

const PORT = Number(process.env.PORT || 3000);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 2 * 1024 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000,
});

const game = new GameServer(io);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  next();
});
app.use(express.json({ limit: '3mb' }));
app.use(auth.attachUser);
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', extensions: ['html'] }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d', index: false }));

// ---------- helpers ----------
const usernameRe = /^[A-Za-z0-9_]{3,16}$/;
const attempts = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.reset) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now > v.reset) attempts.delete(k);
  cleanupSessions();
}, 60000).unref?.();

function sanitizeText(value, max = 300) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function mePayload(userRow) {
  if (!userRow) return null;
  return publicUser(userRow);
}

function broadcastOnline() {
  io.emit('online:update', { count: game.onlineList().length, players: game.onlineList().slice(0, 60) });
}

function emitToUser(userId, event, payload) {
  const entry = game.online.get(userId);
  if (!entry) return 0;
  let sent = 0;
  for (const socketId of entry.sockets) {
    const socket = io.of('/').sockets.get(socketId);
    if (socket) { socket.emit(event, payload); sent += 1; }
  }
  return sent;
}

// ---------- public API ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ball-arena-legends', uptime: Math.round(process.uptime()), online: game.onlineList().length });
});

app.get('/api/meta', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({
    version: '1.0.0',
    totalUsers,
    online: game.onlineList().length,
    onlinePlayers: game.onlineList().slice(0, 70),
    skins: SKINS.length,
    rarities: RARITY_META,
    bosses: BOSSES.map((b) => ({ id: b.id, name: b.name, reqLevel: b.reqLevel, reqFlags: b.reqFlags })),
  });
});

app.get('/api/skins', (req, res) => {
  const owned = new Set(req.user ? req.user.ownedSkins : []);
  const equipped = req.user ? req.user.equippedSkin : null;
  res.json({
    rarities: RARITY_META,
    skins: SKINS.map((s) => ({ ...s, owned: owned.has(s.id), equipped: equipped === s.id })),
    counts: Object.fromEntries(Object.keys(RARITY_META).map((r) => [r, SKINS.filter((s) => s.rarity === r).length])),
  });
});

app.get('/api/bosses', (req, res) => {
  const kills = req.user
    ? db.prepare('SELECT boss_id, COUNT(*) AS c FROM boss_kills WHERE user_id = ? GROUP BY boss_id')
      .all(req.user.id)
    : [];
  const killMap = new Map(kills.map((k) => [k.boss_id, k.c]));
  res.json({
    bosses: BOSSES.map((b) => ({
      ...b,
      clears: killMap.get(b.id) || 0,
      levelOk: req.user ? req.user.level >= b.reqLevel : false,
      flagsOk: req.user ? req.user.flags >= b.reqFlags : false,
      unlocked: req.user ? req.user.level >= b.reqLevel && req.user.flags >= b.reqFlags : false,
    })),
  });
});

app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare(`SELECT username, avatar, level, exp, coins, wins, losses, equipped_skin
                           FROM users WHERE role != 'OWNER' OR role IS NULL
                           ORDER BY level DESC, exp DESC, wins DESC LIMIT 20`).all();
  res.json({ players: rows.map((r) => ({ ...r, equipped_skin: r.equipped_skin })) });
});

app.get('/api/me', (req, res) => {
  if (!req.userRow) return res.json({ user: null, online: game.onlineList().length });
  res.json({ user: mePayload(stmts.byId.get(req.userRow.id)), online: game.onlineList().length });
});

app.get('/api/chat/history', (req, res) => {
  const room = req.query.room === 'global' || !req.query.room ? 'global' : sanitizeText(req.query.room, 80);
  if (room !== 'global' && !room.startsWith('arena:') && !room.startsWith('duel:') && !room.startsWith('solo:') && !room.startsWith('boss:')) {
    return res.status(400).json({ error: 'Invalid room' });
  }
  const rows = db.prepare(`SELECT id, username, avatar, room, text, image_url, is_owner, deleted, created_at
                           FROM messages WHERE room = ? ORDER BY id DESC LIMIT 60`).all(room).reverse();
  res.json({
    messages: rows.map((m) => ({
      id: m.id, username: m.username, avatar: m.avatar, room: m.room,
      text: m.deleted ? '[removed by moderator]' : m.text,
      imageUrl: m.deleted ? null : m.image_url,
      isOwner: !!m.is_owner, deleted: !!m.deleted, createdAt: m.created_at,
    })),
  });
});

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!rateLimit(`reg:${ip}`, 12, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirmPassword || '');
  if (!usernameRe.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-16 characters (letters, numbers, underscore).' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
  if (username.toLowerCase() === 'riezqy') return res.status(400).json({ error: 'That username is reserved.' });
  if (stmts.byUsername.get(username)) return res.status(409).json({ error: 'Username is already taken.' });
  let info;
  try {
    info = stmts.insertUser.run({
      username,
      password_hash: hashPassword(password), // scrypt hash, never plaintext
      role: 'PLAYER',
      avatar: '🔵',
      equipped_skin: DEFAULT_SKIN_ID,
      created_at: Date.now(),
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Username is already taken.' });
    console.error('Register failed', err);
    return res.status(500).json({ error: 'Registration failed.' });
  }
  const userId = info.lastInsertRowid;
  ensureSkinRow(userId, DEFAULT_SKIN_ID, 'starter');
  const token = auth.createSession(userId);
  auth.setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(stmts.byId.get(userId)), message: 'Account created. Welcome to the arena!' });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!rateLimit(`login:${ip}`, 25, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  const result = auth.login(req.body.username, req.body.password);
  if (result.error) return res.status(result.banned ? 403 : 401).json({ error: result.error });
  const token = auth.createSession(result.user.id);
  auth.setSessionCookie(res, token);
  res.json({ user: publicUser(result.user), message: 'Welcome back, legend.' });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- profile & inventory ----------
app.patch('/api/profile', auth.requireAuth, (req, res) => {
  const bio = sanitizeText(req.body.bio, 240);
  const avatar = sanitizeText(req.body.avatar, 200);
  if (bio.length > 240) return res.status(400).json({ error: 'Bio too long.' });
  const cleanBio = filterProfanity(bio);
  let finalAvatar = req.user.avatar;
  if (avatar) {
    const isEmoji = [...avatar].length <= 4;
    const isUpload = /^\/uploads\/avatar_[A-Za-z0-9_.-]+$/.test(avatar);
    if (!isEmoji && !isUpload) return res.status(400).json({ error: 'Invalid avatar.' });
    finalAvatar = avatar;
  }
  db.prepare('UPDATE users SET bio = ?, avatar = ? WHERE id = ?').run(cleanBio, finalAvatar, req.user.id);
  res.json({ user: publicUser(stmts.byId.get(req.user.id)) });
});

app.post('/api/profile/avatar', auth.requireAuth, (req, res) => {
  try {
    const saved = saveImageDataUrl(req.body.dataUrl, { maxBytes: 400 * 1024, prefix: 'avatar' });
    const old = req.user.avatar;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(saved.url, req.user.id);
    if (old && old.startsWith('/uploads/')) removeUpload(old);
    res.json({ user: publicUser(stmts.byId.get(req.user.id)), avatar: saved.url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/profile/skin', auth.requireAuth, (req, res) => {
  const skinId = req.body.skinId === null ? DEFAULT_SKIN_ID : String(req.body.skinId || '');
  const skin = getSkin(skinId);
  if (!skin) return res.status(404).json({ error: 'Unknown skin.' });
  if (!req.user.ownedSkins.includes(skinId)) return res.status(403).json({ error: 'You do not own this skin.' });
  stmts.setSkin.run(skinId, req.user.id);
  res.json({ user: publicUser(stmts.byId.get(req.user.id)) });
});

app.post('/api/shop/buy', auth.requireAuth, (req, res) => {
  const skin = getSkin(String(req.body.skinId || ''));
  if (!skin) return res.status(404).json({ error: 'Unknown skin.' });
  if (skin.grantOnly) return res.status(403).json({ error: 'This skin cannot be purchased. It is earned or granted.' });
  if (req.user.ownedSkins.includes(skin.id)) return res.status(400).json({ error: 'Skin already owned.' });
  if (req.user.level < skin.minLevel) return res.status(400).json({ error: `Requires level ${skin.minLevel}.` });
  if (req.user.coins < skin.price) return res.status(400).json({ error: `Not enough coins. Need ${skin.price}.` });
  const tx = db.transaction(() => {
    const fresh = stmts.byId.get(req.user.id);
    if (fresh.coins < skin.price) throw new Error('Not enough coins.');
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(skin.price, req.user.id);
    stmts.grantSkin.run(req.user.id, skin.id, 'purchase', Date.now());
    db.prepare(`INSERT INTO reward_ledger (user_id, kind, amount, meta, created_at) VALUES (?, 'skin_purchase', ?, ?, ?)`)
      .run(req.user.id, -skin.price, JSON.stringify({ skinId: skin.id }), Date.now());
    return stmts.byId.get(req.user.id);
  });
  try {
    const updated = tx();
    res.json({ user: publicUser(updated), message: `${skin.name} unlocked!` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/chat/report', auth.requireAuth, (req, res) => {
  if (!rateLimit(`report:${req.user.id}`, 10, 5 * 60 * 1000)) return res.status(429).json({ error: 'Too many reports.' });
  const messageId = Number(req.body.messageId);
  const reason = sanitizeText(req.body.reason, 200) || 'Inappropriate content';
  const msg = db.prepare('SELECT id FROM messages WHERE id = ? AND deleted = 0').get(messageId);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  const existing = db.prepare('SELECT id FROM reports WHERE message_id = ? AND reporter_id = ? AND resolved = 0').get(messageId, req.user.id);
  if (existing) return res.status(400).json({ error: 'You already reported this message.' });
  db.prepare(`INSERT INTO reports (message_id, reporter_id, reporter_name, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(messageId, req.user.id, req.user.username, filterProfanity(reason), Date.now());
  res.json({ ok: true, message: 'Report sent to the Owner.' });
});

app.get('/api/reports/mine', auth.requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, message_id, reason, resolved, created_at FROM reports WHERE reporter_id = ? ORDER BY id DESC LIMIT 20').all(req.user.id);
  res.json({ reports: rows });
});

// ---------- owner ----------
app.get('/api/owner/overview', auth.requireOwner, (req, res) => {
  const totals = db.prepare(`SELECT COUNT(*) AS users,
    SUM(CASE WHEN coins > 0 THEN 1 ELSE 0 END) AS holders,
    COALESCE(SUM(coins),0) AS coins, COALESCE(SUM(exp),0) AS exp,
    COALESCE(SUM(wins),0) AS wins, COALESCE(SUM(flags),0) AS flags FROM users`).get();
  const online = game.onlineList();
  const reports = db.prepare(`SELECT r.id, r.reason, r.created_at, r.reporter_name, r.resolved,
    m.id AS message_id, m.username, m.text, m.room, m.image_url
    FROM reports r JOIN messages m ON m.id = r.message_id
    WHERE r.resolved = 0 ORDER BY r.id DESC LIMIT 25`).all();
  const bossKills = db.prepare('SELECT COUNT(*) AS c FROM boss_kills').get().c;
  const recentUsers = db.prepare(`SELECT id, username, avatar, level, coins, flags, role, created_at, banned_until
    FROM users ORDER BY id DESC LIMIT 12`).all();
  res.json({
    totals: { ...totals, bossKills },
    online,
    rooms: game.roomStats(),
    reports,
    recentUsers,
    rarities: RARITY_META,
    skins: SKINS.map((s) => ({ id: s.id, name: s.name, rarity: s.rarity })),
  });
});

app.get('/api/owner/players', auth.requireOwner, (req, res) => {
  const q = sanitizeText(req.query.q, 40);
  const rows = q
    ? db.prepare(`SELECT * FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 50`).all(`%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 50').all();
  res.json({ players: rows.map((r) => publicUser(r)) });
});

app.get('/api/owner/messages', auth.requireOwner, (req, res) => {
  const room = sanitizeText(req.query.room, 80) || 'global';
  const rows = db.prepare(`SELECT id, username, avatar, room, text, image_url, is_owner, deleted, created_at
    FROM messages WHERE room = ? ORDER BY id DESC LIMIT 80`).all(room).reverse();
  res.json({
    messages: rows.map((m) => ({
      id: m.id, username: m.username, avatar: m.avatar, room: m.room, text: m.text,
      imageUrl: m.image_url, isOwner: !!m.is_owner, deleted: !!m.deleted, createdAt: m.created_at,
    })),
  });
});

app.post('/api/owner/grant', auth.requireOwner, (req, res) => {
  const username = sanitizeText(req.body.username, 32);
  const target = stmts.byUsername.get(username);
  if (!target) return res.status(404).json({ error: 'Player not found.' });
  const coins = Math.max(0, Math.min(100000, Math.floor(Number(req.body.coins) || 0)));
  const exp = Math.max(0, Math.min(500000, Math.floor(Number(req.body.exp) || 0)));
  const levels = Math.max(0, Math.min(100, Math.floor(Number(req.body.levels) || 0)));
  const skinId = req.body.skinId ? String(req.body.skinId) : null;
  const grantGodmax = !!req.body.godmax;
  let expTotal = exp;
  if (levels > 0) {
    const cur = publicUser(target);
    for (let i = 0; i < levels; i += 1) expTotal += expForNextLevel(cur.level + i);
  }
  expTotal = Math.min(200000, expTotal);
  if (skinId && !getSkin(skinId)) return res.status(404).json({ error: 'Unknown skin.' });
  try {
    if (coins || expTotal) {
      applyRewards(target.id, { coins, exp: expTotal, kind: 'owner_grant', meta: { by: req.user.username } });
    }
    if (grantGodmax) stmts.grantSkin.run(target.id, GODMAX_SKIN_ID, 'owner_grant', Date.now());
    if (skinId) stmts.grantSkin.run(target.id, skinId, 'owner_grant', Date.now());
    db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, 'GRANT', username, JSON.stringify({ coins, exp: expTotal, levels, skinId, grantGodmax }), Date.now());
    const fresh = publicUser(stmts.byId.get(target.id));
    io.emit('profile:update', { username: fresh.username, level: fresh.level, equippedSkin: fresh.equippedSkin });
    emitToUser(target.id, 'wallet:update', { user: fresh });
    res.json({ ok: true, user: fresh, message: 'Grant applied.' });
  } catch (err) {
    console.error('grant failed', err);
    res.status(500).json({ error: 'Grant failed.' });
  }
});

app.post('/api/owner/ban', auth.requireOwner, (req, res) => {
  const username = sanitizeText(req.body.username, 32);
  const target = stmts.byUsername.get(username);
  if (!target) return res.status(404).json({ error: 'Player not found.' });
  if (target.role === 'OWNER') return res.status(403).json({ error: 'Owner accounts cannot be banned.' });
  const hours = Number(req.body.hours);
  const reason = sanitizeText(req.body.reason, 160) || 'Violation of arena rules';
  const duration = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 365) : 24 * 365;
  const until = Date.now() + duration * 3600 * 1000;
  db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?').run(until, reason, target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, 'BAN', username, JSON.stringify({ hours: duration, reason }), Date.now());
  emitToUser(target.id, 'banned', { reason, until });
  const entry = game.online.get(target.id);
  if (entry) {
    for (const sid of entry.sockets) {
      const s = io.of('/').sockets.get(sid);
      if (s) setTimeout(() => s.disconnect(true), 400);
    }
  }
  res.json({ ok: true, message: `${username} banned for ${duration}h`, until });
});

app.post('/api/owner/unban', auth.requireOwner, (req, res) => {
  const username = sanitizeText(req.body.username, 32);
  const target = stmts.byUsername.get(username);
  if (!target) return res.status(404).json({ error: 'Player not found.' });
  db.prepare('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?').run(target.id);
  db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, 'UNBAN', username, '', Date.now());
  res.json({ ok: true, message: `${username} unbanned.` });
});

app.post('/api/owner/messages/:id/delete', auth.requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(id);
  db.prepare('UPDATE reports SET resolved = 1 WHERE message_id = ?').run(id);
  db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, 'DELETE_MESSAGE', msg.username, String(id), Date.now());
  if (msg.image_url) removeUpload(msg.image_url);
  io.emit('chat:delete', { id, room: msg.room });
  res.json({ ok: true });
});

app.post('/api/owner/chat-image', auth.requireOwner, (req, res) => {
  let saved;
  try {
    saved = saveImageDataUrl(req.body.dataUrl, { maxBytes: 1.5 * 1024 * 1024, prefix: 'chat' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const text = filterProfanity(sanitizeText(req.body.text, 300));
  const now = Date.now();
  const info = db.prepare(`INSERT INTO messages (user_id, username, avatar, room, text, image_url, is_owner, created_at)
    VALUES (?, ?, ?, 'global', ?, ?, 1, ?)`).run(req.user.id, req.user.username, req.user.avatar, text, saved.url, now);
  const message = {
    id: Number(info.lastInsertRowid), username: req.user.username, avatar: req.user.avatar,
    room: 'global', text, imageUrl: saved.url, isOwner: true, deleted: false, createdAt: now,
  };
  io.emit('chat:message', message);
  res.json({ ok: true, message });
});

app.post('/api/owner/password', auth.requireOwner, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  if (next.length < 10 || next.length > 128) return res.status(400).json({ error: 'New password must be at least 10 characters.' });
  const row = stmts.byId.get(req.user.id);
  if (!verifyPassword(current, row.password_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .run(req.user.id, auth.hashToken(req.sessionToken));
  db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, 'PASSWORD_CHANGE', req.user.username, '', Date.now());
  res.json({ ok: true, message: 'Owner password updated.' });
});

// ---------- sockets ----------
io.use((socket, next) => {
  try {
    const cookies = auth.parseCookies(socket.handshake.headers.cookie || '');
    const token = cookies[auth.COOKIE_NAME];
    const row = auth.sessionUser(token);
    if (!row) return next(new Error('unauthorized'));
    if (row.banned_until && row.banned_until > Date.now()) return next(new Error('banned'));
    socket.data.user = publicUser(row);
    socket.data.userId = row.id;
    return next();
  } catch (err) {
    return next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  if (!user) return socket.disconnect(true);
  game.markOnline(user, socket);
  broadcastOnline();
  socket.emit('ready', { user, online: game.onlineList().length });
  socket.join('authenticated');

  const refreshUser = () => publicUser(stmts.byId.get(user.id));

  socket.on('arena:join', (payload, ack) => {
    const mode = String(payload && payload.mode);
    const fresh = refreshUser();
    if (!fresh) return socket.disconnect(true);
    if (fresh.isBanned) { socket.emit('banned', { reason: fresh.banReason }); return socket.disconnect(true); }
    const result = game.join(socket, fresh, mode, { bossId: payload && payload.bossId });
    if (result.error) {
      if (typeof ack === 'function') ack({ error: result.error });
      else socket.emit('arena:error', { error: result.error });
      return;
    }
    socket.emit('arena:joined', result.payload);
    if (typeof ack === 'function') ack({ ok: true, roomId: result.room.id });
  });

  socket.on('arena:leave', () => {
    game.leaveRoom(socket);
    socket.emit('wallet:update', { user: refreshUser() });
  });

  socket.on('input', (data) => {
    game.input(socket, data);
  });

  socket.on('duel:queue', () => {
    const fresh = refreshUser();
    if (!fresh || fresh.isBanned) return;
    const result = game.queueDuel(socket, fresh);
    socket.emit('duel:queue', {
      status: result.matched ? 'matched' : 'waiting',
      queueSize: game.queue.length,
      roomId: result.roomId || null,
    });
  });

  socket.on('duel:cancel', () => {
    game.cancelQueue(socket, user.id);
    socket.emit('duel:queue', { status: 'idle', queueSize: game.queue.length });
  });

  const chatTimes = [];
  socket.on('chat:send', (payload, ack) => {
    const now = Date.now();
    while (chatTimes.length && now - chatTimes[0] > 8000) chatTimes.shift();
    if (chatTimes.length >= 8) {
      if (typeof ack === 'function') ack({ error: 'Slow down a little.' });
      return;
    }
    const text = sanitizeText(payload && payload.text, 300);
    if (!text) return;
    const rawRoom = String((payload && payload.room) || 'global');
    const roomId = game.socketRooms.get(socket.id);
    let room = 'global';
    if (rawRoom !== 'global') {
      if (!roomId || rawRoom !== roomId) {
        if (typeof ack === 'function') ack({ error: 'You are not in that room.' });
        return;
      }
      room = roomId;
    }
    chatTimes.push(now);
    const clean = filterProfanity(text);
    const fresh = refreshUser();
    const info = db.prepare(`INSERT INTO messages (user_id, username, avatar, room, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(user.id, fresh.username, fresh.avatar, room, clean, now);
    const message = {
      id: Number(info.lastInsertRowid), username: fresh.username, avatar: fresh.avatar,
      room, text: clean, imageUrl: null, isOwner: fresh.isOwner, deleted: false, createdAt: now,
    };
    if (room === 'global') io.to('authenticated').emit('chat:message', message);
    else io.to(`room:${room}`).emit('chat:message', message);
    if (typeof ack === 'function') ack({ ok: true, message });
  });

  socket.on('disconnect', () => {
    game.cancelQueue(socket, user.id);
    game.leaveRoom(socket, { silent: true });
    game.markOffline(user.id, socket.id);
    broadcastOnline();
  });
});

// ---------- boot ----------
const ownerInfo = seedOwner();
if (ownerInfo.created) {
  console.log(`Owner account "${ownerInfo.username}" initialized securely (hashed credentials).`);
}

// demo economy sanity: nothing seeded for normal players; everyone starts at 0 coins.

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Request error', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ball Arena Legends listening on 0.0.0.0:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});

module.exports = { app, server, io, game };
