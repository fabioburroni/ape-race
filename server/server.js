// Ape Race – server di gioco
// Serve i file del gioco (cartella client/) e gestisce le partite online via WebSocket su /ws.
// Il server fa da "regista leggero": crea le stanze con un codice, tiene l'elenco dei giocatori,
// sincronizza la partenza e inoltra le posizioni. La guida di ogni Ape resta calcolata nel browser del giocatore.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const MAX_PLAYERS = 8;
const STATE_HZ_LIMIT = 20;          // massimo di aggiornamenti al secondo accettati da un giocatore
const RESULTS_WAIT_MS = 90 * 1000;  // dopo il primo arrivato, quanto si aspettano gli altri

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// ---------- file statici ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(CLIENT_DIR, p));
  if (!file.startsWith(CLIENT_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Non trovato'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

// ---------- stanze ----------
const rooms = new Map(); // codice -> stanza
let nextId = 1;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)]; if (!rooms.has(c)) return c; }
}
const clean = (s, n) => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, n);
function cleanCfg(c) {
  c = c && typeof c === 'object' ? c : {};
  const col = v => /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
  const out = { name: clean(c.name, 12) || 'Pilota', num: Math.max(1, Math.min(99, parseInt(c.num) || 1)) };
  for (const k of ['body', 'roof', 'bed', 'rims']) { const v = col(c[k]); if (v) out[k] = v; }
  if (['hay', 'barrels', 'grapes', 'melons', 'crates', 'olives', 'none'].includes(c.load)) out.load = c.load;
  for (const k of ['cross', 'flag', 'beacon', 'stripes', 'exhaust', 'horn']) out[k] = !!c[k];
  return out;
}
function playersOf(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.cfg.name, cfg: p.cfg, ready: p.ready }));
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, except) { const s = JSON.stringify(msg); for (const p of room.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); }
function roomInfo(room) { broadcast(room, { t: 'room', code: room.code, host: room.host, players: playersOf(room), setup: room.setup, phase: room.phase }); }

function leave(p) {
  const room = p.room; if (!room) return;
  room.players.delete(p.id); p.room = null;
  if (room.players.size === 0) { clearTimeout(room.resultsTimer); rooms.delete(room.code); return; }
  if (room.host === p.id) room.host = room.players.keys().next().value; // passa la regia al primo rimasto
  broadcast(room, { t: 'left', id: p.id });
  roomInfo(room);
  maybeResults(room);
}
function maybeResults(room, force) {
  if (room.phase !== 'race') return;
  const all = [...room.players.values()];
  const done = all.filter(p => p.finish);
  if (!force && done.length < all.length) {
    if (done.length && !room.resultsTimer) room.resultsTimer = setTimeout(() => maybeResults(room, true), RESULTS_WAIT_MS);
    return;
  }
  clearTimeout(room.resultsTimer); room.resultsTimer = null;
  const list = all.map(p => ({ id: p.id, name: p.cfg.name, col: p.cfg.body || '#4fb3d9', time: p.finish ? p.finish.time : null, lost: p.finish ? p.finish.lost : 0 }))
    .sort((a, b) => (a.time == null) - (b.time == null) || a.time - b.time);
  room.phase = 'lobby';
  for (const p of all) { p.finish = null; p.ready = false; }
  broadcast(room, { t: 'results', list });
  roomInfo(room);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  const p = { id: nextId++, ws, room: null, cfg: cleanCfg({}), ready: false, lastState: 0, finish: null };
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = p.room;
    switch (m.t) {
      case 'ping': return send(ws, { t: 'pong', c: m.c, s: Date.now() });
      case 'create': {
        if (room) leave(p);
        p.cfg = cleanCfg(m.cfg); p.ready = false;
        const r = { code: newCode(), host: p.id, players: new Map([[p.id, p]]), phase: 'lobby', setup: { town: 'Asciano', routeIdx: 0, diff: 1 }, resultsTimer: null };
        rooms.set(r.code, r); p.room = r;
        send(ws, { t: 'joined', code: r.code, you: p.id });
        return roomInfo(r);
      }
      case 'join': {
        const code = clean(m.code, 8).toUpperCase(); const r = rooms.get(code);
        if (!r) return send(ws, { t: 'error', msg: 'Nessuna partita con il codice ' + code + '.' });
        if (r.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'La partita è piena (massimo ' + MAX_PLAYERS + ' giocatori).' });
        if (room) leave(p);
        p.cfg = cleanCfg(m.cfg); p.ready = false; p.room = r; r.players.set(p.id, p);
        send(ws, { t: 'joined', code: r.code, you: p.id });
        broadcast(r, { t: 'hello', id: p.id, name: p.cfg.name }, p);
        return roomInfo(r);
      }
      case 'cfg': if (room) { p.cfg = cleanCfg(m.cfg); roomInfo(room); } return;
      case 'ready': if (room && room.phase === 'lobby') { p.ready = !!m.ready; roomInfo(room); } return;
      case 'setup': if (room && room.host === p.id && room.phase === 'lobby') {
        room.setup = { town: clean(m.town, 40) || 'Asciano', routeIdx: Math.max(0, Math.min(20, parseInt(m.routeIdx) || 0)), diff: Math.max(0, Math.min(2, parseInt(m.diff) || 0)) };
        roomInfo(room);
      } return;
      case 'start': if (room && room.host === p.id && room.phase === 'lobby') {
        room.phase = 'race';
        for (const q of room.players.values()) q.finish = null;
        const startAt = Date.now() + 4500;
        broadcast(room, { t: 'start', startAt, seed: Math.floor(Math.random() * 2 ** 31), setup: room.setup, players: playersOf(room) });
      } return;
      case 'state': if (room && room.phase === 'race') {
        const now = Date.now(); if (now - p.lastState < 1000 / STATE_HZ_LIMIT) return; p.lastState = now;
        const n = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : 0);
        broadcast(room, { t: 'state', id: p.id, ts: now, x: n(m.x), y: n(m.y), a: n(m.a), v: n(m.v), tilt: n(m.tilt), r: n(m.r), cp: n(m.cp) | 0, lost: n(m.lost) | 0, b: !!m.b }, p);
      } return;
      case 'push': if (room && room.phase === 'race') {
        const target = room.players.get(m.target); if (!target) return;
        const n = v => (typeof v === 'number' && isFinite(v) ? Math.max(-30, Math.min(30, v)) : 0);
        send(target.ws, { t: 'push', from: p.id, fx: n(m.fx), fy: n(m.fy), tilt: n(m.tilt) });
      } return;
      case 'finish': if (room && room.phase === 'race' && !p.finish) {
        const time = Number(m.time); if (!(time > 0 && time < 3600)) return;
        p.finish = { time: Math.round(time * 10) / 10, lost: Math.max(0, Math.min(20, parseInt(m.lost) || 0)) };
        broadcast(room, { t: 'finish', id: p.id, time: p.finish.time, lost: p.finish.lost });
        maybeResults(room);
      } return;
      case 'emoji': if (room) broadcast(room, { t: 'emoji', id: p.id, e: clean(m.e, 4) }); return;
      case 'leave': return leave(p);
    }
  });
  ws.on('close', () => leave(p));
  ws.on('error', () => {});
});

// ping periodico per tenere viva la connessione dietro i proxy degli hosting
setInterval(() => { for (const ws of wss.clients) { if (ws.readyState === 1) ws.ping(); } }, 25000);

server.listen(PORT, () => console.log('Ape Race in ascolto sulla porta ' + PORT));
