/* BALL ARENA LEGENDS — integration test
 * Boots a real server process on a temp database and exercises auth, shop,
 * multiplayer sockets, duels, chat moderation and owner permissions.
 * Run with: npm test
 */
'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = Number(process.env.TEST_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const OWNER_USER = 'riezqy';
const OWNER_PASS = 'karuniayusufriezqy123';

let server;
let dataDir;
let passed = 0;
const failures = [];

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function step(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

/* ---------------- cookie-aware http client ---------------- */
class Client {
  constructor() { this.cookies = new Map(); }
  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  store(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    const single = res.headers.get('set-cookie');
    if (single && !raw.length) {
      const [pair] = single.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  async request(method, url, body) {
    const headers = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.store(res);
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    return { status: res.status, data };
  }
  get(url) { return this.request('GET', url); }
  post(url, body) { return this.request('POST', url, body === undefined ? {} : body); }
  patch(url, body) { return this.request('PATCH', url, body === undefined ? {} : body); }
}

function connectSocket(client) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      transports: ['websocket'],
      extraHeaders: client.cookieHeader() ? { cookie: client.cookieHeader() } : {},
      reconnection: false,
      timeout: 8000,
    });
    const timer = setTimeout(() => { socket.close(); reject(new Error('socket connect timeout')); }, 10000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (err) => { clearTimeout(timer); reject(new Error(err.message)); });
  });
}

function waitFor(socket, event, predicate, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    function handler(payload) {
      if (predicate && !predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function emitAck(socket, event, payload, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ack for ${event}`)), ms);
    socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
  });
}

async function waitForHealth(tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch (err) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ---------------- test suite ---------------- */
async function main() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bal-test-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d.toString(); });
  server.stderr.on('data', (d) => { log += d.toString(); });
  server.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`server exited with ${code}\n${log}`);
  });

  const up = await waitForHealth();
  if (!up) {
    console.error('Server did not become healthy.\n' + log);
    process.exit(1);
  }

  const alice = new Client();
  const bob = new Client();
  const owner = new Client();
  let aliceUser = null;

  await step('health + meta endpoints respond', async () => {
    const health = await alice.get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    const meta = await alice.get('/api/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.data.skins, 96, 'expected 95 tier skins + GODMAX');
    assert.equal(typeof meta.data.onlinePlayers, 'object');
  });

  await step('skin catalog matches required tier counts', async () => {
    const res = await alice.get('/api/skins');
    assert.equal(res.status, 200);
    const counts = res.data.counts;
    assert.deepEqual(
      [counts.COMMON, counts.UNCOMMON, counts.RARE, counts.EPIC, counts.LEGEND, counts.MYTHIC, counts.SECRET, counts.GODLY, counts.ULTIMAX],
      [20, 18, 16, 14, 12, 8, 4, 2, 1],
    );
    const godmax = res.data.skins.find((s) => s.id === 'skin_096');
    assert.ok(godmax, 'GODMAX skin exists');
    assert.equal(godmax.pattern, 'rainbow');
    assert.ok(godmax.grantOnly, 'GODMAX is grant-only');
  });

  await step('registration hashes password, starts at 0 coins, role PLAYER', async () => {
    const res = await alice.post('/api/register', {
      username: 'alice_legend', password: 'supersecret1', confirmPassword: 'supersecret1',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    aliceUser = res.data.user;
    assert.equal(aliceUser.username, 'alice_legend');
    assert.equal(aliceUser.role, 'PLAYER');
    assert.equal(aliceUser.coins, 0);
    assert.equal(aliceUser.level, 1);
    assert.equal(aliceUser.exp, 0);
    assert.ok(!('password' in aliceUser) && !('password_hash' in aliceUser));
  });

  await step('plaintext password is never stored (scrypt hash on disk)', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dataDir, 'ball-arena.db'), { readonly: true });
    const row = db.prepare('SELECT password_hash, role FROM users WHERE username = ?').get('alice_legend');
    db.close();
    assert.match(row.password_hash, /^scrypt\$/, 'hash format scrypt$salt$hash');
    assert.ok(!row.password_hash.includes('supersecret1'));
    assert.equal(row.role, 'PLAYER');
  });

  await step('duplicate username rejected and reserved owner name blocked', async () => {
    const dup = await bob.post('/api/register', {
      username: 'alice_legend', password: 'anotherpass1', confirmPassword: 'anotherpass1',
    });
    assert.equal(dup.status, 409);
    const reserved = await bob.post('/api/register', {
      username: OWNER_USER, password: 'anotherpass1', confirmPassword: 'anotherpass1',
    });
    assert.equal(reserved.status, 400);
  });

  await step('second player registers and /api/me reflects session cookie', async () => {
    const res = await bob.post('/api/register', {
      username: 'bob_baller', password: 'bobsecret12', confirmPassword: 'bobsecret12',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const me = await bob.get('/api/me');
    assert.equal(me.data.user.username, 'bob_baller');
  });

  await step('logout clears session and /api/me returns null', async () => {
    const out = await bob.post('/api/logout');
    assert.equal(out.status, 200);
    const me = await bob.get('/api/me');
    assert.equal(me.data.user, null);
    const relog = await bob.post('/api/login', { username: 'bob_baller', password: 'bobsecret12' });
    assert.equal(relog.status, 200);
    assert.equal(relog.data.user.username, 'bob_baller');
  });

  await step('owner login works and owner APIs are owner-only', async () => {
    const res = await owner.post('/api/login', { username: OWNER_USER, password: OWNER_PASS });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.user.isOwner, true);
    assert.equal(res.data.user.role, 'OWNER');

    const denied = await alice.get('/api/owner/overview');
    assert.equal(denied.status, 403, 'players must not read owner data');
    const deniedGrant = await alice.post('/api/owner/grant', { username: 'alice_legend', coins: 999999 });
    assert.equal(deniedGrant.status, 403);

    const overview = await owner.get('/api/owner/overview');
    assert.equal(overview.status, 200);
    assert.ok(overview.data.totals.users >= 2);
  });

  await step('player cannot register or self-assign OWNER role', async () => {
    const sneak = new Client();
    const res = await sneak.post('/api/register', {
      username: 'sneaky_owner', password: 'sneakyowner1', confirmPassword: 'sneakyowner1', role: 'OWNER',
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.user.role, 'PLAYER');
    const denied = await sneak.get('/api/owner/overview');
    assert.equal(denied.status, 403);
  });

  await step('shop purchase is rejected without enough coins', async () => {
    const res = await alice.post('/api/shop/buy', { skinId: 'skin_005' });
    assert.equal(res.status, 400, JSON.stringify(res.data));
    assert.match(String(res.data.error), /coin/i);
  });

  await step('owner grant credits coins/EXP server-side and shop then succeeds', async () => {
    const grant = await owner.post('/api/owner/grant', { username: 'alice_legend', coins: 5000, exp: 120, levels: 0 });
    assert.equal(grant.status, 200, JSON.stringify(grant.data));
    const me = await alice.get('/api/me');
    assert.equal(me.data.user.coins, 5000);
    assert.ok(me.data.user.exp >= 120);

    const buy = await alice.post('/api/shop/buy', { skinId: 'skin_005' });
    assert.equal(buy.status, 200, JSON.stringify(buy.data));
    assert.ok(buy.data.user.ownedSkins.includes('skin_005'));
    assert.ok(buy.data.user.coins < 5000, 'coins were deducted');
  });

  await step('equipping a non-owned skin is rejected; owned skin equips', async () => {
    const denied = await alice.post('/api/profile/skin', { skinId: 'skin_040' });
    assert.equal(denied.status, 400);
    const equipped = await alice.post('/api/profile/skin', { skinId: 'skin_005' });
    assert.equal(equipped.status, 200);
    assert.equal(equipped.data.user.equippedSkin, 'skin_005');
  });

  await step('bosses are gated on level and flags', async () => {
    const res = await alice.get('/api/bosses');
    assert.equal(res.status, 200);
    assert.equal(res.data.bosses.length, 8);
    const first = res.data.bosses[0];
    assert.equal(first.unlocked, false, 'level 1 player has locked bosses');
    const boss = await alice.get('/api/owner/overview');
    assert.equal(boss.status, 403);
  });

  await step('unauthenticated clients cannot join an arena', async () => {
    const anon = new Client();
    const socket = await connectSocket(anon);
    const res = await emitAck(socket, 'arena:join', { mode: 'multi' });
    socket.close();
    assert.ok(res && res.error, 'expected an auth error');
  });

  await step('two authenticated players sync in the same multiplayer arena', async () => {
    const s1 = await connectSocket(alice);
    const s2 = await connectSocket(bob);

    const joined1 = await emitAck(s1, 'arena:join', { mode: 'multi' });
    assert.ok(!joined1.error, JSON.stringify(joined1));
    const joined2 = await emitAck(s2, 'arena:join', { mode: 'multi' });
    assert.ok(!joined2.error, JSON.stringify(joined2));

    const both = await waitFor(s1, 'state', (p) => p && p.players && p.players.some((x) => x.username === 'bob_baller'));
    const names = both.players.map((p) => p.username);
    assert.ok(names.includes('alice_legend') && names.includes('bob_baller'), `players: ${names.join(',')}`);

    // movement propagates: send input from bob and expect his position to change
    const before = both.players.find((p) => p.username === 'bob_baller');
    s2.emit('input', { x: 1, y: 0, dash: false });
    const moved = await waitFor(s1, 'state', (p) => {
      const me = p.players.find((x) => x.username === 'bob_baller');
      return me && Math.abs(me.x - before.x) > 1;
    }, 6000);
    assert.ok(moved, 'opponent position updated');

    s1.close();
    s2.close();
  });

  await step('1v1 matchmaking pairs two queued players', async () => {
    const s1 = await connectSocket(alice);
    const s2 = await connectSocket(bob);
    const matched1 = waitFor(s1, 'duel:queue', (p) => p && p.status === 'matched', 10000);
    const matched2 = waitFor(s2, 'duel:queue', (p) => p && p.status === 'matched', 10000);
    s1.emit('duel:queue');
    await new Promise((r) => setTimeout(r, 300));
    s2.emit('duel:queue');
    const [m1, m2] = await Promise.all([matched1, matched2]);
    assert.ok(m1 && m2, 'both players matched');
    s1.close();
    s2.close();
  });

  await step('chat filters profanity, persists history, and supports reporting', async () => {
    const s1 = await connectSocket(alice);
    const got = waitFor(s1, 'chat:message', (m) => m && m.username === 'alice_legend');
    s1.emit('chat:send', { text: 'you fucking idiot', room: 'global' });
    const msg = await got;
    assert.ok(msg.text.includes('$#@%$'), `filtered text was: ${msg.text}`);
    assert.ok(!msg.text.includes('fucking'));

    const history = await alice.get('/api/chat/history?room=global');
    assert.ok(history.data.messages.some((m) => m.id === msg.id), 'message stored');

    const report = await bob.post('/api/chat/report', { messageId: msg.id, reason: 'abuse' });
    assert.equal(report.status, 200, JSON.stringify(report.data));
    const mine = await bob.get('/api/reports/mine');
    assert.ok(Array.isArray(mine.data.reports));
    s1.close();
  });

  await step('owner can moderate chat and read reports', async () => {
    const history = await owner.get('/api/chat/history?room=global');
    const target = history.data.messages[history.data.messages.length - 1];
    const del = await owner.post(`/api/owner/messages/${target.id}/delete`);
    assert.equal(del.status, 200, JSON.stringify(del.data));
    const again = await alice.get('/api/chat/history?room=global');
    const removed = again.data.messages.find((m) => m.id === target.id);
    assert.equal(removed.text, '[removed by moderator]');

    const overview = await owner.get('/api/owner/overview');
    assert.ok(Array.isArray(overview.data.reports));
  });

  await step('owner grants GODMAX and it becomes ownable/equippable', async () => {
    const grant = await owner.post('/api/owner/grant', { username: 'alice_legend', godmax: true });
    assert.equal(grant.status, 200, JSON.stringify(grant.data));
    const me = await alice.get('/api/me');
    assert.ok(me.data.user.ownedSkins.includes('skin_096'), 'GODMAX owned');
  });

  await step('owner can ban and unban a player', async () => {
    const ban = await owner.post('/api/owner/ban', { username: 'bob_baller', hours: 1, reason: 'test ban' });
    assert.equal(ban.status, 200, JSON.stringify(ban.data));
    const bannedMe = await bob.get('/api/me');
    assert.equal(bannedMe.data.user.isBanned, true);
    const blockedLogin = await new Client().post('/api/login', { username: 'bob_baller', password: 'bobsecret12' });
    assert.equal(blockedLogin.status, 403, 'banned user cannot log in');

    const unban = await owner.post('/api/owner/unban', { username: 'bob_baller' });
    assert.equal(unban.status, 200);
    const back = new Client().post('/api/login', { username: 'bob_baller', password: 'bobsecret12' });
    assert.equal((await back).status, 200);
  });

  await step('owner password change requires current password and enforces length', async () => {
    const wrong = await owner.post('/api/owner/password', { currentPassword: 'nope', newPassword: 'averylongpassword' });
    assert.equal(wrong.status, 400);
    const short = await owner.post('/api/owner/password', { currentPassword: OWNER_PASS, newPassword: 'short' });
    assert.equal(short.status, 400);
  });

  await step('static client assets and page shell are served', async () => {
    for (const file of ['/', '/js/app.js', '/js/game.js', '/js/ball.js', '/css/style.css']) {
      const res = await fetch(`${BASE}${file}`);
      assert.equal(res.status, 200, `${file} -> ${res.status}`);
      const body = await res.text();
      assert.ok(body.length > 100, `${file} has content`);
    }
    const page = await (await fetch(`${BASE}/`)).text();
    assert.ok(page.includes('BALL ARENA'));
    assert.ok(!page.includes(OWNER_PASS), 'owner password must never appear in HTML');
  });
}

main()
  .then(() => {
    console.log(`\n${passed} checks passed, ${failures.length} failed`);
    if (server) server.kill('SIGKILL');
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    if (failures.length) {
      console.error('\nFailures:\n' + failures.map((f) => ` - ${f}`).join('\n'));
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal:', err);
    if (server) server.kill('SIGKILL');
    process.exit(1);
  });
