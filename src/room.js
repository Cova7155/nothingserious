// Hot Pack party room: one Durable Object per room code, players over hibernatable WebSockets.
// The pack is passed by naming a valid, unused Pokémon. A hidden fuse (10-30s) keeps running across passes;
// a pass with under 8s left resets it to 8s. Whoever holds the pack when it pops loses a life.
import data from '../public/data/dex.json';
import { makeDex, cleanName } from '../public/js/core.js';

const dex = makeDex(data);
const FUSE_MIN = 10000, FUSE_MAX = 30000, FUSE_FLOOR = 8000, MAX_PLAYERS = 8, IDLE_WIPE = 2 * 3600e3;
const PARTY_POOL = data.pool.map((q, i) => i).filter(i => data.pool[i].a.length >= 40 && data.pool[i].a.length <= 220);
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.s = null;
    ctx.blockConcurrencyWhile(async () => { this.s = (await ctx.storage.get('s')) || null; });
  }

  fresh(code) {
    return { code, phase: 'lobby', players: [], settings: { lives: 3 }, turn: null, prompt: -1, used: [], fuseEnd: 0, roundStart: 0, winner: null, round: 0, recent: [], touched: Date.now() };
  }
  async persist() { this.s.touched = Date.now(); await this.ctx.storage.put('s', this.s); }

  async fetch(req) {
    const code = new URL(req.url).pathname.slice(1, 5).toUpperCase();
    if (!this.s || Date.now() - (this.s.touched || 0) > 6 * 3600e3) { this.s = this.fresh(code); await this.persist(); }
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  view() {
    const s = this.s, q = s.prompt >= 0 ? data.pool[s.prompt] : null;
    return {
      code: s.code, phase: s.phase, settings: s.settings, turn: s.turn, winner: s.winner, round: s.round,
      heat: s.phase === 'play' ? Math.min(1, (Date.now() - s.roundStart) / FUSE_MAX) : 0,
      players: s.players.map(p => ({ pid: p.pid, name: p.name, lives: p.lives, alive: p.alive, host: p.host, online: p.online })),
      prompt: q ? { k: q.k, gp: q.gp, lead: q.lead, key: q.key, tail: q.tail } : null,
      used: s.used.slice(-40)
    };
  }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch { /* gone */ } }
  broadcast(m, except) { const msg = JSON.stringify(m); for (const ws of this.ctx.getWebSockets()) { if (ws === except) continue; try { ws.send(msg); } catch { /* gone */ } } }
  pushState() { this.broadcast({ t: 'state', s: this.view() }); }

  alive() { return this.s.players.filter(p => p.alive); }
  nextAlive(fromPid) {
    const ps = this.s.players, i = ps.findIndex(p => p.pid === fromPid);
    for (let k = 1; k <= ps.length; k++) { const p = ps[(i + k + ps.length) % ps.length]; if (p.alive) return p.pid; }
    return null;
  }
  newPrompt() {
    const s = this.s;
    let pick = -1;
    for (let tries = 0; tries < 30; tries++) { const i = PARTY_POOL[rand(0, PARTY_POOL.length - 1)]; if (!s.recent.includes(i)) { pick = i; break; } }
    if (pick < 0) pick = PARTY_POOL[rand(0, PARTY_POOL.length - 1)];
    s.prompt = pick; s.used = []; s.recent = [...s.recent.slice(-20), pick];
  }
  async armFuse(ms) { this.s.fuseEnd = Date.now() + ms; await this.ctx.storage.setAlarm(this.s.fuseEnd); }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 500) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    const s = this.s; if (!s) return;
    const att = ws.deserializeAttachment() || {};
    const me = att.pid ? s.players.find(p => p.pid === att.pid) : null;

    if (m.t === 'hello') {
      const pid = String(m.pid || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || crypto.randomUUID().slice(0, 8);
      const name = cleanName(m.name) || 'Trainer';
      let p = s.players.find(x => x.pid === pid);
      if (!p) {
        if (s.players.length >= MAX_PLAYERS) { this.send(ws, { t: 'err', msg: 'This room is full.', fatal: true }); ws.close(4000, 'full'); return; }
        p = { pid, name, lives: 0, alive: false, host: !s.players.some(x => x.host), online: true };
        s.players.push(p);
      }
      p.name = name; p.online = true; s.idleSince = 0;
      ws.serializeAttachment({ pid });
      if (!s.players.some(x => x.host && x.online)) { s.players.forEach(x => (x.host = false)); p.host = true; }
      await this.persist();
      this.pushState();
      return;
    }
    if (!me) return;

    if (m.t === 'settings' && me.host && s.phase !== 'play') {
      const lives = Math.max(1, Math.min(5, Math.round(Number(m.lives) || 3)));
      s.settings.lives = lives; await this.persist(); this.pushState(); return;
    }

    if (m.t === 'start' && me.host && s.phase !== 'play') {
      s.players = s.players.filter(p => p.online);
      if (s.players.length < 2) { this.send(ws, { t: 'err', msg: 'You need at least 2 players.' }); return; }
      s.players.forEach(p => { p.lives = s.settings.lives; p.alive = true; });
      s.phase = 'play'; s.winner = null; s.round = 1; s.recent = [];
      this.newPrompt();
      s.turn = s.players[rand(0, s.players.length - 1)].pid;
      s.roundStart = Date.now();
      await this.armFuse(rand(FUSE_MIN, FUSE_MAX));
      await this.persist(); this.pushState(); return;
    }

    if (m.t === 'typing' && s.phase === 'play' && s.turn === me.pid) {
      this.broadcast({ t: 'typing', pid: me.pid, text: String(m.text || '').slice(0, 24) }, ws); return;
    }

    if (m.t === 'answer' && s.phase === 'play' && s.turn === me.pid) {
      if (Date.now() >= s.fuseEnd) return; // the pop is already on its way
      const q = data.pool[s.prompt], valid = new Set(q.a);
      const hit = dex.match(String(m.text || '').slice(0, 30), valid);
      if (!hit) { this.send(ws, { t: 'reject', reason: 'unknown' }); return; }
      const name = dex.S[hit.i].n;
      if (!valid.has(hit.i)) { this.send(ws, { t: 'reject', reason: 'invalid', name }); return; }
      if (s.used.some(u => u.i === hit.i)) { this.send(ws, { t: 'reject', reason: 'used', name }); return; }
      s.used.push({ i: hit.i, by: me.pid, t: dex.tierOf(q, hit.i) });
      s.turn = this.nextAlive(me.pid);
      const left = s.fuseEnd - Date.now();
      if (left < FUSE_FLOOR) await this.armFuse(FUSE_FLOOR);
      if (s.used.length >= Math.floor(q.a.length * .6)) { this.newPrompt(); }
      await this.persist();
      this.broadcast({ t: 'pass', by: me.pid, i: hit.i });
      this.pushState();
    }
  }

  async alarm() {
    const s = this.s;
    if (!s) return;
    // nobody connected: once a room has sat empty for a while, wipe it so storage never piles up
    if (!this.ctx.getWebSockets().length) {
      const due = (s.idleSince || Date.now()) + IDLE_WIPE;
      if (Date.now() >= due) { await this.ctx.storage.deleteAll(); this.s = null; } else await this.ctx.storage.setAlarm(due);
      return;
    }
    if (s.phase !== 'play') return;
    if (Date.now() < s.fuseEnd - 50) { await this.ctx.storage.setAlarm(s.fuseEnd); return; }
    const holder = s.players.find(p => p.pid === s.turn);
    if (holder) {
      holder.lives = Math.max(0, holder.lives - 1);
      if (!holder.lives) holder.alive = false;
      this.broadcast({ t: 'pop', pid: holder.pid, name: holder.name, lives: holder.lives });
    }
    const alive = this.alive();
    if (alive.length <= 1 || !s.players.some(p => p.online)) {
      s.phase = 'over'; s.winner = alive[0] ? alive[0].pid : null; s.turn = null;
      await this.persist(); this.pushState(); return;
    }
    s.round++;
    this.newPrompt();
    s.turn = holder && holder.alive ? this.nextAlive(holder.pid) : this.nextAlive(s.turn) || alive[0].pid;
    s.roundStart = Date.now();
    await this.armFuse(rand(FUSE_MIN, FUSE_MAX));
    await this.persist(); this.pushState();
  }

  async webSocketClose(ws) { await this.leave(ws); }
  async webSocketError(ws) { await this.leave(ws); }
  async leave(ws) {
    const s = this.s; if (!s) return;
    const att = ws.deserializeAttachment() || {};
    const p = att.pid && s.players.find(x => x.pid === att.pid);
    if (!p) return;
    const stillHere = this.ctx.getWebSockets().some(o => o !== ws && (o.deserializeAttachment() || {}).pid === p.pid);
    if (stillHere) return;
    p.online = false;
    if (s.phase === 'lobby' || s.phase === 'over') s.players = s.players.filter(x => x.online || x.pid !== p.pid);
    if (p.host || !s.players.some(x => x.host)) { s.players.forEach(x => (x.host = false)); const h = s.players.find(x => x.online); if (h) h.host = true; }
    const anyoneLeft = this.ctx.getWebSockets().some(o => o !== ws);
    if (!anyoneLeft) { s.idleSince = Date.now(); if (s.phase === 'play') { s.phase = 'over'; s.turn = null; } await this.ctx.storage.setAlarm(s.idleSince + IDLE_WIPE); }
    await this.persist();
    this.pushState();
  }
}
