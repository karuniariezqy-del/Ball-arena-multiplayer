'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = 4111;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bal-repro-'));

class C {
  constructor() { this.cookies = new Map(); }
  hdr() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, url, body) {
    const headers = {};
    const c = this.hdr(); if (c) headers.cookie = c;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) { const [p] = line.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) {}
    return { status: res.status, data };
  }
}

(async () => {
  const srv = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => console.log('[srv]', d.toString().trim().slice(0, 400)));
  srv.stderr.on('data', (d) => console.log('[srv:err]', d.toString().trim().slice(0, 2000)));

  const up = async () => {
    for (let i = 0; i < 60; i += 1) {
      try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch (e) {}
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  if (!await up()) { console.log('no server'); process.exit(1); }

  const a = new C(); const b = new C();
  console.log('reg a', (await a.req('POST', '/api/register', { username: 'repro_a', password: 'supersecret1', confirmPassword: 'supersecret1' })).status);
  console.log('reg b', (await b.req('POST', '/api/register', { username: 'repro_b', password: 'supersecret2', confirmPassword: 'supersecret2' })).status);

  const conn = (c) => new Promise((res, rej) => {
    const s = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: c.hdr() }, reconnection: false });
    s.on('connect', () => res(s));
    s.on('connect_error', (e) => rej(e));
  });

  const sa = await conn(a); const sb = await conn(b);
  sa.on('state', () => {});
  const ack = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
  console.log('join a', await ack(sa, 'arena:join', { mode: 'multi' }));
  console.log('join b', await ack(sb, 'arena:join', { mode: 'multi' }));
  sa.on('state', (p) => console.log('state a players=', p.players.map((x) => x.username).join(',')));
  await new Promise((r) => setTimeout(r, 2500));
  console.log('queue a'); sa.emit('duel:queue');
  await new Promise((r) => setTimeout(r, 300));
  sa.on('duel:queue', (p) => console.log('a duel:queue', JSON.stringify(p)));
  sb.on('duel:queue', (p) => console.log('b duel:queue', JSON.stringify(p)));
  sa.on('duel:found', (p) => console.log('a duel:found ok'));
  sb.on('duel:found', (p) => console.log('b duel:found ok'));
  console.log('queue b'); sb.emit('duel:queue');
  await new Promise((r) => setTimeout(r, 3000));
  console.log('chat');
  sa.on('chat:message', (m) => console.log('chat', m.text));
  sa.emit('chat:send', { text: 'you fucking idiot', room: 'global' });
  await new Promise((r) => setTimeout(r, 2000));
  console.log('server alive?', srv.exitCode === null);
  sa.close(); sb.close(); srv.kill('SIGKILL');
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})();
