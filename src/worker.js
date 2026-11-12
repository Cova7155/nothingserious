// Pokerarity API (by godpack.io): players, passkeys, server-checked daily scores, localized boards, friends, party rooms.
// Built to run untouched: edge-cached reads, rate limits, hourly cleanup and an optional daily Discord recap.
import data from '../public/data/dex.json';
import { makeDex, dayNumberUTC, dateOfDay, CARDS, SECONDS, cleanName, norm, rating } from '../public/js/core.js';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
export { Room } from './room.js';

const dex = makeDex(data);
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (obj, status = 200, extra) => new Response(JSON.stringify(obj), { status, headers: { ...HEADERS, ...extra } });
const fail = (error, status = 400) => json({ error }, status);
const DAY_MS = 86400000;
const CANONICAL = 'pokerarity.com';
const PASSKEY_HOSTS = ['pokerarity.com', 'localhost'];
// plays, answer counts and tallies older than this are pruned (all-time totals live on the player row and stay)
const KEEP_DAYS = 400;
// personal ranks past this point read as "1,000+" so a rank lookup never scans a whole board
const RANK_CAP = 1000;
// pages opened before start tickets existed can still post their score until this date
const NO_TICKET_GRACE = Date.UTC(2026, 10, 14);

/* ---------------- small helpers ---------------- */
const enc = new TextEncoder();
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const randToken = (n = 24) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const friendCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map(x => CODE_ABC[x % CODE_ABC.length]).join('');
const ROOM_ABC = 'BCDFGHJKLMNPQRSTVWXZ';
const roomCode = () => [...crypto.getRandomValues(new Uint8Array(4))].map(x => ROOM_ABC[x % ROOM_ABC.length]).join('');
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))));
}
const BAD = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'whore', 'slut', 'bitch', 'cock', 'dick', 'pussy', 'porn', 'sex', 'penis', 'vagina', 'tranny', 'kys', 'anal', 'cum', 'twat', 'wank', 'jizz', 'molest', 'pedo'];
const RESERVED = ['godpack', 'admin', 'moderator', 'official', 'support', 'staff', 'nintendo', 'pokemon'];
const leet = s => norm(s).replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/\$/g, 's');
const badName = s => { const n = leet(s); return BAD.some(w => n.includes(w)) || RESERVED.some(w => n.includes(w)); };

function geo(req) {
  const cf = req.cf || {};
  const cc = String(cf.country || '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(cc) && cc !== 'XX' && cc !== 'T1' ? cc : null;
  const rc = String(cf.regionCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return { country, region: country && rc ? `${country}-${rc}` : null, regionName: country && rc && cf.region ? String(cf.region).slice(0, 60) : null };
}
const display = p => p.name || `Trainer ${String(p.code || '').slice(0, 4)}`;
const ip = req => req.headers.get('cf-connecting-ip') || 'local';
async function limited(env, binding, key) {
  try { const rl = env[binding]; if (!rl) return false; const { success } = await rl.limit({ key }); return !success; } catch { return false; }
}
const okDay = d => { const n = dayNumberUTC(data); return Number.isInteger(d) && d >= 1 && d >= n - 1 && d <= n + 1; };
const clampDay = v => { const t = dayNumberUTC(data), d = Math.floor(Number(v)) || t; return Math.max(1, Math.min(t + 1, d)); };
// calendar month a pack belongs to, like 202611
const monthKey = day => { const d = dateOfDay(data, day); return d.getFullYear() * 100 + d.getMonth() + 1; };
async function body(req) { try { const t = await req.text(); if (t.length > 20000) return null; return t ? JSON.parse(t) : {}; } catch { return null; } }
function monthRange(day) {
  const d = dateOfDay(data, day), first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const n0 = day - Math.round((d - first) / DAY_MS), n1 = day + Math.round((last - d) / DAY_MS);
  return [Math.max(1, n0), n1, d.toLocaleString('en', { month: 'long' })];
}

/* ---------------- identity ---------------- */
async function auth(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer ([0-9a-f-]{36})\.([\w-]{20,64})$/);
  if (!m) return null;
  const row = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(m[1]).first();
  if (!row) return null;
  const h = await sha256(m[2]);
  if (row.key_hash === h) return row;
  const s = await env.DB.prepare('SELECT last_seen FROM sessions WHERE token_hash = ? AND player = ?').bind(h, row.id).first();
  if (!s) return null;
  if (Date.now() - s.last_seen > DAY_MS) await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(Date.now(), h).run();
  return row;
}
async function profileOut(env, p, extra = {}) {
  const pk = await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE player = ?').bind(p.id).first();
  return { id: p.id, name: p.name, display: display(p), code: p.code, country: p.country, region: p.region, regionName: p.region_name, total: p.total, games: p.games, best: p.best, streak: p.streak, bestStreak: p.best_streak, lastDay: p.last_day, passkeys: pk.n, ...extra };
}
async function history(env, id) {
  const rows = (await env.DB.prepare('SELECT day, score, tiers, picks FROM plays WHERE player = ? ORDER BY day DESC LIMIT 400').bind(id).all()).results;
  return rows.map(h => ({ day: h.day, score: h.score, tiers: JSON.parse(h.tiers), picks: JSON.parse(h.picks) }));
}
// streaks from the rows we still keep (best streak never goes down)
async function restreak(env, id, floor) {
  const rows = (await env.DB.prepare('SELECT day FROM plays WHERE player = ? ORDER BY day ASC').bind(id).all()).results;
  let run = 0, best = floor || 0, prev = -9;
  for (const r of rows) { run = r.day === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = r.day; }
  await env.DB.prepare('UPDATE players SET streak = ?, best_streak = MAX(best_streak, ?), last_day = MAX(last_day, ?) WHERE id = ?').bind(run, best, rows.length ? prev : 0, id).run();
}
// this month's board row, rebuilt from plays
async function rebuildMonth(env, id) {
  const t = dayNumberUTC(data), [a, b] = monthRange(t), mk = monthKey(t);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM monthly WHERE player = ? AND month = ?').bind(id, mk),
    env.DB.prepare(`INSERT INTO monthly (month, player, score, best, games, country, region)
      SELECT ?, p.player, SUM(p.score), MAX(p.score), COUNT(*), pl.country, pl.region FROM plays p JOIN players pl ON pl.id = p.player
      WHERE p.player = ? AND p.day BETWEEN ? AND ? AND p.flag = 0 GROUP BY p.player`).bind(mk, id, a, b)
  ]);
}
const tallyKeys = p => ['*', ...(p.country ? ['c:' + p.country] : []), ...(p.region ? ['r:' + p.region] : [])];
// fold a guest profile into an account (their scores, friends and name come along; same-day clashes keep the account's)
async function mergePlayers(env, from, to) {
  if (!from || from.id === to.id) return;
  if (await env.DB.prepare('SELECT 1 FROM passkeys WHERE player = ?').bind(from.id).first()) return;
  const clash = (await env.DB.prepare('SELECT g.day, g.score, g.flag, g.country, g.region FROM plays g JOIN plays a ON a.day = g.day AND a.player = ?2 WHERE g.player = ?1').bind(from.id, to.id).all()).results;
  const moved = (await env.DB.prepare('SELECT score, flag FROM plays WHERE player = ?1 AND day NOT IN (SELECT day FROM plays WHERE player = ?2)').bind(from.id, to.id).all()).results;
  const lost = clash.filter(c => !c.flag), keep = moved.filter(m => !m.flag);
  const addTotal = Math.max(0, from.total - lost.reduce((a, c) => a + c.score, 0)), addGames = Math.max(0, from.games - lost.length);
  const a = [from.id, to.id];
  await env.DB.batch([
    // the guest's clashing plays go, so they leave the day tallies too
    ...lost.flatMap(c => tallyKeys(c).map(k => env.DB.prepare('UPDATE tally SET n = MAX(0, n - 1) WHERE day = ? AND scope = ? AND score = ?').bind(c.day, k, c.score))),
    env.DB.prepare('UPDATE OR IGNORE plays SET player = ?2 WHERE player = ?1').bind(...a),
    env.DB.prepare('DELETE FROM plays WHERE player = ?1').bind(from.id),
    env.DB.prepare('UPDATE OR IGNORE friends SET player = ?2 WHERE player = ?1').bind(...a),
    env.DB.prepare('UPDATE OR IGNORE friends SET friend = ?2 WHERE friend = ?1').bind(...a),
    env.DB.prepare('DELETE FROM friends WHERE player = ?1 OR friend = ?1 OR player = friend').bind(from.id),
    env.DB.prepare('DELETE FROM sessions WHERE player = ?1').bind(from.id),
    env.DB.prepare('DELETE FROM monthly WHERE player = ?1').bind(from.id),
    env.DB.prepare('UPDATE players SET name = COALESCE(name, ?2), total = total + ?3, games = games + ?4, best = MAX(best, ?5) WHERE id = ?1')
      .bind(to.id, from.name, addTotal, addGames, keep.reduce((m, x) => Math.max(m, x.score), 0)),
    env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(from.id)
  ]);
  await restreak(env, to.id, Math.max(to.best_streak || 0, from.best_streak || 0));
  await rebuildMonth(env, to.id);
}
function rp(url) {
  const host = url.hostname;
  if (!PASSKEY_HOSTS.includes(host)) return null;
  return { rpID: host, origin: url.origin };
}

/* ---------------- boards ----------------
   Every lookup stays small however big the game gets:
   - day boards read the top 50 off an index, and ranks come from a per-day score tally (at most 141 scores) plus ties
   - month boards read a per-month total kept up to date on every submit
   - personal month and all-time ranks stop counting at RANK_CAP */
const SCOPE_COL = { country: 'country', region: 'region' };
const tallyScope = sc => (sc.kind === 'global' ? '*' : `${sc.kind === 'country' ? 'c' : 'r'}:${sc.val}`);
const marks = ids => ids.map(() => '?').join(',');
async function friendIds(env, me) { return [me.id, ...(await env.DB.prepare('SELECT friend FROM friends WHERE player = ? LIMIT 200').bind(me.id).all()).results.map(r => r.friend)]; }
// sc = { kind: 'global' | 'country' | 'region' | 'friends', val, ids }
function filterFor(sc, col) {
  if (SCOPE_COL[sc.kind]) return { sql: ` AND ${col.prefix}${SCOPE_COL[sc.kind]} = ?`, args: [sc.val] };
  if (sc.kind === 'friends') return { sql: ` AND ${col.id} IN (${marks(sc.ids)})`, args: sc.ids };
  return { sql: '', args: [] };
}
async function boardRows(env, period, day, sc) {
  if (period === 'day') {
    const f = filterFor(sc, { prefix: 'p.', id: 'p.player' });
    return (await env.DB.prepare(`SELECT p.score, p.country AS cc, p.player, pl.name, pl.code FROM plays p JOIN players pl ON pl.id = p.player WHERE p.day = ? AND p.flag = 0${f.sql} ORDER BY p.score DESC, p.ms ASC LIMIT 50`).bind(day, ...f.args).all()).results;
  }
  if (period === 'month') {
    const f = filterFor(sc, { prefix: 'm.', id: 'm.player' });
    return (await env.DB.prepare(`SELECT m.score, m.country AS cc, m.player, pl.name, pl.code FROM monthly m JOIN players pl ON pl.id = m.player WHERE m.month = ?${f.sql} ORDER BY m.score DESC, m.best DESC LIMIT 50`).bind(monthKey(day), ...f.args).all()).results;
  }
  const f = filterFor(sc, { prefix: '', id: 'id' });
  return (await env.DB.prepare(`SELECT total AS score, country AS cc, id AS player, name, code FROM players WHERE games > 0${f.sql} ORDER BY total DESC, best DESC LIMIT 50`).bind(...f.args).all()).results;
}
const publicRows = rows => Promise.all(rows.map(async (r, i) => ({ rank: i + 1, name: display(r), cc: r.cc || '', score: r.score, h: (await sha256(r.player)).slice(0, 12) })));
async function rankIn(env, period, day, sc, me) {
  const col = SCOPE_COL[sc.kind];
  if (period === 'day') {
    const mine = await env.DB.prepare('SELECT score, ms, flag, country, region FROM plays WHERE day = ? AND player = ?').bind(day, me.id).first();
    if (!mine) return null;
    if (mine.flag) return { rank: null, score: mine.score, flagged: mine.flag };
    if (col && mine[col] !== sc.val) return null;
    if (sc.kind === 'friends') {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM plays WHERE day = ? AND flag = 0 AND player IN (${marks(sc.ids)}) AND (score > ? OR (score = ? AND ms < ?))`).bind(day, ...sc.ids, mine.score, mine.score, mine.ms).first();
      return { rank: r.n + 1, score: mine.score };
    }
    const above = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM tally WHERE day = ? AND scope = ? AND score > ?').bind(day, tallyScope(sc), mine.score).first();
    const ties = await env.DB.prepare(`SELECT COUNT(*) AS n FROM plays WHERE day = ? AND flag = 0${col ? ` AND ${col} = ?` : ''} AND score = ? AND ms < ?`).bind(day, ...(col ? [sc.val] : []), mine.score, mine.ms).first();
    return { rank: above.n + ties.n + 1, score: mine.score };
  }
  if (period === 'month') {
    const mk = monthKey(day);
    const mine = await env.DB.prepare('SELECT score, best, country, region FROM monthly WHERE month = ? AND player = ?').bind(mk, me.id).first();
    if (!mine || (col && mine[col] !== sc.val)) return null;
    const f = filterFor(sc, { prefix: '', id: 'player' });
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM monthly WHERE month = ?${f.sql} AND score >= ? AND (score > ? OR best > ?) LIMIT ${RANK_CAP})`).bind(mk, ...f.args, mine.score, mine.score, mine.best).first();
    return { rank: r.n + 1, score: mine.score, capped: r.n >= RANK_CAP };
  }
  if (!me.games || (col && me[col] !== sc.val)) return null;
  const f = filterFor(sc, { prefix: '', id: 'id' });
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM players WHERE total >= ? AND games > 0${f.sql} AND (total > ? OR best > ?) LIMIT ${RANK_CAP})`).bind(me.total, ...f.args, me.total, me.best).first();
  return { rank: r.n + 1, score: me.total, capped: r.n >= RANK_CAP };
}
async function ranksFor(env, me, day) {
  const play = await env.DB.prepare('SELECT country, region FROM plays WHERE day = ? AND player = ?').bind(day, me.id).first();
  if (!play) return null;
  const one = async sc => {
    const r = await rankIn(env, 'day', day, sc, me);
    if (!r) return null;
    const of = await env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM tally WHERE day = ? AND scope = ?').bind(day, tallyScope(sc)).first();
    return { rank: r.rank, of: of.n, flagged: r.flagged || 0 };
  };
  return {
    global: await one({ kind: 'global' }),
    country: play.country ? await one({ kind: 'country', val: play.country }) : null,
    region: play.region ? await one({ kind: 'region', val: play.region }) : null
  };
}

/* edge cache for public reads (works on the custom domain) */
async function cached(ctx, key, ttl, make) {
  const cache = caches.default, req = new Request(key);
  const hit = await cache.match(req).catch(() => null);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) {
    const out = new Response(res.body, res); out.headers.set('cache-control', `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(req, out.clone()).catch(() => {}));
    return out;
  }
  return res;
}

/* ---------------- routes ---------------- */
async function handle(req, env, ctx, url) {
  const p = url.pathname, method = req.method;
  const secret = env.TICKET_SECRET || 'dev-only-secret';

  if (p === '/api/health') return json({ ok: true, day: dayNumberUTC(data) });

  if (p === '/api/player/new' && method === 'POST') {
    if (await limited(env, 'RL_NEW', 'new:' + ip(req))) return fail('Slow down a little', 429);
    const g = geo(req), id = crypto.randomUUID(), key = randToken(24), now = Date.now();
    for (let tries = 0; tries < 6; tries++) {
      const code = friendCode();
      try {
        await env.DB.prepare('INSERT INTO players (id, key_hash, name, code, country, region, region_name, created, last_seen) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)')
          .bind(id, await sha256(key), code, g.country, g.region, g.regionName, now, now).run();
        return json({ id, key, code, name: null, country: g.country, region: g.region, regionName: g.regionName, passkeys: 0 });
      } catch (e) { if (!/UNIQUE/i.test(String(e))) throw e; }
    }
    return fail('Could not create a player, try again', 500);
  }

  if (p === '/api/geo' && method === 'GET') return json(geo(req));

  if (p === '/api/party' && method === 'POST') {
    if (await limited(env, 'RL', 'party:' + ip(req))) return fail('Slow down a little', 429);
    return json({ code: roomCode() });
  }
  const pm = p.match(/^\/api\/party\/([A-Za-z]{4})\/ws$/);
  if (pm) {
    if (req.headers.get('Upgrade') !== 'websocket') return fail('Expected a websocket', 426);
    const code = pm[1].toUpperCase();
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://room/${code}`, req));
  }

  const sm = p.match(/^\/api\/daily\/(\d+)\/stats$/);
  if (sm && method === 'GET') {
    const day = +sm[1];
    if (day > dayNumberUTC(data) + 1) return json({ players: 0, avg: 0, cards: Array.from({ length: CARDS }, () => ({ top: [] })) });
    return cached(ctx, `${url.origin}/api/daily/${day}/stats`, day < dayNumberUTC(data) - 1 ? 3600 : 120, async () => {
      const head = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS players, COALESCE(SUM(score * n), 0) AS pts FROM tally WHERE day = ? AND scope = '*'").bind(day).first();
      const rows = (await env.DB.prepare('SELECT card, sp, n FROM answers WHERE day = ? AND sp >= 0 ORDER BY card ASC, n DESC').bind(day).all()).results;
      const cards = Array.from({ length: CARDS }, () => ({ top: [] }));
      for (const r of rows) if (cards[r.card] && cards[r.card].top.length < 10) cards[r.card].top.push({ i: r.sp, pct: head.players ? Math.min(100, Math.round(100 * r.n / head.players)) : 0 });
      return json({ players: head.players, avg: head.players ? Math.round(head.pts / head.players) : 0, cards });
    });
  }

  if (p === '/api/daily/ticket' && method === 'GET') {
    const day = Number(url.searchParams.get('day'));
    if (!okDay(day)) return fail('Bad day');
    const ts = Date.now();
    return json({ ticket: `${day}.${ts}.${await hmac(secret, `${day}.${ts}`)}` });
  }

  if (p === '/api/board' && method === 'GET') {
    const period = ['day', 'month', 'all'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'day';
    const scope = ['global', 'country', 'region'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'global';
    const day = clampDay(url.searchParams.get('day'));
    const g = geo(req);
    const cc = (url.searchParams.get('cc') || g.country || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || null;
    const rg = (url.searchParams.get('rg') || g.region || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9) || null;
    const sc = scope === 'global' ? { kind: 'global' } : scope === 'country' ? cc && { kind: 'country', val: cc } : rg && { kind: 'region', val: rg };
    if (!sc) return json({ rows: [] });
    // month boards group by calendar month, so every day of a month shares one cache entry
    const when = period === 'day' ? `d${day}` : period === 'month' ? `m${monthKey(day)}` : 'all';
    const key = `${url.origin}/api/board?v=2&period=${period}&when=${when}&scope=${scope}&val=${sc.val || ''}`;
    return cached(ctx, key, period === 'day' ? 30 : 120, async () => json({ rows: await publicRows(await boardRows(env, period, day, sc)) }));
  }

  if (p === '/api/passkey/login/options' && method === 'POST') {
    const r = rp(url); if (!r) return fail(`Passkeys work on ${CANONICAL}`);
    if (await limited(env, 'RL', 'pk:' + ip(req))) return fail('Slow down a little', 429);
    const options = await generateAuthenticationOptions({ rpID: r.rpID, userVerification: 'preferred', allowCredentials: [] });
    const cid = randToken(12);
    await env.DB.prepare('INSERT INTO challenges (id, challenge, player, kind, expires) VALUES (?, ?, NULL, ?, ?)').bind(cid, options.challenge, 'auth', Date.now() + 5 * 60000).run();
    return json({ cid, options });
  }
  if (p === '/api/passkey/login/verify' && method === 'POST') {
    const r = rp(url); if (!r) return fail(`Passkeys work on ${CANONICAL}`);
    const b = await body(req); if (!b || !b.response || !b.cid) return fail('Bad request');
    const ch = await env.DB.prepare('SELECT * FROM challenges WHERE id = ? AND kind = ?').bind(String(b.cid), 'auth').first();
    if (!ch || ch.expires < Date.now()) return fail('That took too long. Try again.');
    await env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(ch.id).run();
    const cred = await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(String(b.response.id || '')).first();
    if (!cred) return fail('That passkey isn’t saved here. It may belong to another account or site.', 404);
    let v;
    try {
      v = await verifyAuthenticationResponse({ response: b.response, expectedChallenge: ch.challenge, expectedOrigin: r.origin, expectedRPID: r.rpID, requireUserVerification: false, credential: { id: cred.id, publicKey: fromB64u(cred.public_key), counter: cred.counter, transports: cred.transports ? JSON.parse(cred.transports) : undefined } });
    } catch { return fail('That passkey didn’t check out. Try again.'); }
    if (!v.verified) return fail('That passkey didn’t check out. Try again.');
    await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?').bind(v.authenticationInfo.newCounter, Date.now(), cred.id).run();
    const account = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(cred.player).first();
    if (!account) return fail('That account no longer exists', 404);
    const guest = await auth(req, env);
    if (guest && guest.id !== account.id) await mergePlayers(env, guest, account);
    const token = randToken(24), now = Date.now();
    await env.DB.prepare('INSERT INTO sessions (token_hash, player, created, last_seen) VALUES (?, ?, ?, ?)').bind(await sha256(token), account.id, now, now).run();
    const fresh = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(account.id).first();
    return json(await profileOut(env, fresh, { key: token, history: await history(env, account.id) }));
  }

  // everything below needs a player
  const me = await auth(req, env);
  const isBoardMe = p === '/api/board/me';
  if (!me) return fail('Unknown player', 401);

  if (isBoardMe && method === 'GET') {
    const period = ['day', 'month', 'all'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'day';
    const scope = ['global', 'country', 'region', 'friends'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'global';
    const day = clampDay(url.searchParams.get('day'));
    const sc = scope === 'global' ? { kind: 'global' } : scope === 'friends' ? { kind: 'friends', ids: await friendIds(env, me) }
      : scope === 'country' ? me.country && { kind: 'country', val: me.country } : me.region && { kind: 'region', val: me.region };
    if (!sc) return json({ me: null, rows: [] });
    const mine = await rankIn(env, period, day, sc, me);
    // the friends board is personal, so it comes back with its rows
    return json({ me: mine, rows: sc.kind === 'friends' ? await publicRows(await boardRows(env, period, day, sc)) : undefined });
  }

  if (p === '/api/me' && method === 'GET') {
    if (Date.now() - (me.last_seen || 0) > DAY_MS) await env.DB.prepare('UPDATE players SET last_seen = ? WHERE id = ?').bind(Date.now(), me.id).run();
    return json(await profileOut(env, me, { history: await history(env, me.id) }));
  }

  if (p === '/api/me/name' && method === 'POST') {
    if (await limited(env, 'RL', 'w:' + me.id)) return fail('Slow down a little', 429);
    const b = await body(req); if (!b) return fail('Bad request');
    const name = cleanName(b.name);
    if (name.length < 2) return fail('Use at least 2 letters');
    if (badName(name)) return fail('Pick a different name');
    await env.DB.prepare('UPDATE players SET name = ? WHERE id = ?').bind(name, me.id).run();
    return json({ name });
  }

  if (p === '/api/daily/submit' && method === 'POST') {
    if (await limited(env, 'RL', 'w:' + me.id)) return fail('Slow down a little', 429);
    const b = await body(req); if (!b) return fail('Bad request');
    const day = b.day;
    if (!okDay(day)) return fail('That pack isn’t open right now');
    const picks = Array.isArray(b.picks) ? b.picks.slice(0, CARDS).map(x => (Number.isInteger(x) && x >= 0 && x < dex.S.length ? x : -1)) : null;
    if (!picks || picks.length !== CARDS) return fail('Bad picks');
    const ms = Array.from({ length: CARDS }, (_, i) => Math.max(0, Math.min(SECONDS * 1000, Math.round(Number(b.ms?.[i]) || SECONDS * 1000))));
    const exists = await env.DB.prepare('SELECT 1 FROM plays WHERE day = ? AND player = ?').bind(day, me.id).first();
    if (exists) return json({ error: 'Already played', rank: await ranksFor(env, me, day) }, 409);
    // a ticket from when the pack was ripped keeps instant scripted runs off the public boards.
    // flag 1 = no ticket (played offline, or a script), 2 = a ticket that's forged, stale or impossibly fast
    let flag = 0;
    if (!b.ticket) flag = Date.now() < NO_TICKET_GRACE ? 0 : 1;
    else {
      const [td, tts, tsig] = String(b.ticket).split('.'), age = Date.now() - +tts;
      if (+td !== day || !tsig || tsig !== await hmac(secret, `${td}.${tts}`) || !(age >= 14000 && age <= 36 * 3600e3)) flag = 2;
    }
    const prompts = dex.dailyPrompts(day);
    const res = dex.scoreRun(prompts, picks, 'd' + day);
    const g = geo(req), now = Date.now();
    const country = g.country || me.country, region = g.region || me.region, regionName = g.regionName || me.region_name;
    const streak = me.last_day === day - 1 ? me.streak + 1 : me.last_day === day ? me.streak : 1;
    const counts = flag ? 0 : 1, pts = flag ? 0 : res.total;
    const stmts = [
      env.DB.prepare('INSERT INTO plays (day, player, score, tiers, picks, ms, country, region, created, flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(day, me.id, res.total, JSON.stringify(res.cards.map(c => c.t)), JSON.stringify(res.cards.map(c => c.i)), ms.reduce((a, x) => a + x, 0), country, region, now, flag),
      env.DB.prepare('UPDATE players SET total = total + ?, games = games + ?, best = MAX(best, ?), streak = ?, best_streak = MAX(best_streak, ?), last_day = MAX(last_day, ?), country = ?, region = ?, region_name = ?, last_seen = ? WHERE id = ?')
        .bind(pts, counts, pts, streak, streak, day, country, region, regionName, now, me.id),
      ...(flag ? [] : [
        ...res.cards.map((c, k) => env.DB.prepare('INSERT INTO answers (day, card, sp, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, card, sp) DO UPDATE SET n = n + 1').bind(day, k, c.i)),
        ...tallyKeys({ country, region }).map(k => env.DB.prepare('INSERT INTO tally (day, scope, score, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, scope, score) DO UPDATE SET n = n + 1').bind(day, k, res.total)),
        env.DB.prepare(`INSERT INTO monthly (month, player, score, best, games, country, region) VALUES (?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(month, player) DO UPDATE SET score = score + excluded.score, best = MAX(best, excluded.best), games = games + 1, country = excluded.country, region = excluded.region`)
          .bind(monthKey(day), me.id, res.total, res.total, country, region)
      ])
    ];
    try { await env.DB.batch(stmts); }
    catch (e) { if (/UNIQUE|PRIMARY/i.test(String(e))) return json({ error: 'Already played', rank: await ranksFor(env, me, day) }, 409); throw e; }
    const fresh = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(me.id).first();
    return json({ score: res.total, flagged: flag, cards: res.cards.map(c => ({ t: c.t, pts: c.pts, hitChase: c.hitChase })), rank: await ranksFor(env, fresh, day), me: { total: fresh.total, games: fresh.games, best: fresh.best, streak: fresh.streak, bestStreak: fresh.best_streak } });
  }

  if (p === '/api/rank' && method === 'GET') {
    const day = clampDay(url.searchParams.get('day'));
    return json({ rank: await ranksFor(env, me, day) });
  }

  if (p === '/api/friends' && method === 'GET') {
    const day = Number(url.searchParams.get('day')) || dayNumberUTC(data);
    const rows = (await env.DB.prepare('SELECT pl.id, pl.name, pl.code, pl.country, pl.total, (SELECT score FROM plays WHERE day = ? AND player = pl.id) AS today FROM friends f JOIN players pl ON pl.id = f.friend WHERE f.player = ? ORDER BY f.created DESC LIMIT 200').bind(day, me.id).all()).results;
    return json({ friends: rows.map(r => ({ name: display(r), code: r.code, cc: r.country || '', total: r.total, today: r.today })) });
  }
  if (p === '/api/friends' && method === 'POST') {
    if (await limited(env, 'RL', 'w:' + me.id)) return fail('Slow down a little', 429);
    const b = await body(req); const code = String(b?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) return fail('Friend codes have 6 characters');
    if (code === me.code) return fail('That’s your own code');
    const f = await env.DB.prepare('SELECT id, name, code FROM players WHERE code = ?').bind(code).first();
    if (!f) return fail('No trainer with that code', 404);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM friends WHERE player = ?').bind(me.id).first();
    if (count.n >= 200) return fail('Friend list is full');
    await env.DB.prepare('INSERT OR IGNORE INTO friends (player, friend, created) VALUES (?, ?, ?)').bind(me.id, f.id, Date.now()).run();
    return json({ ok: true, friend: { name: display(f), code: f.code } });
  }
  const fm = p.match(/^\/api\/friends\/([A-Z0-9]{6})$/i);
  if (fm && method === 'DELETE') {
    const f = await env.DB.prepare('SELECT id FROM players WHERE code = ?').bind(fm[1].toUpperCase()).first();
    if (f) await env.DB.prepare('DELETE FROM friends WHERE player = ? AND friend = ?').bind(me.id, f.id).run();
    return json({ ok: true });
  }

  if (p === '/api/passkey/register/options' && method === 'POST') {
    const r = rp(url); if (!r) return fail(`Passkeys work on ${CANONICAL}`);
    if (await limited(env, 'RL', 'pk:' + me.id)) return fail('Slow down a little', 429);
    const existing = (await env.DB.prepare('SELECT id, transports FROM passkeys WHERE player = ?').bind(me.id).all()).results;
    const options = await generateRegistrationOptions({
      rpName: 'Pokerarity', rpID: r.rpID, userID: enc.encode(me.id), userName: me.name ? `${me.name} (${me.code})` : `Trainer ${me.code}`, userDisplayName: me.name || `Trainer ${me.code}`,
      attestationType: 'none', excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
    });
    const cid = randToken(12);
    await env.DB.prepare('INSERT INTO challenges (id, challenge, player, kind, expires) VALUES (?, ?, ?, ?, ?)').bind(cid, options.challenge, me.id, 'reg', Date.now() + 5 * 60000).run();
    return json({ cid, options });
  }
  if (p === '/api/passkey/register/verify' && method === 'POST') {
    const r = rp(url); if (!r) return fail(`Passkeys work on ${CANONICAL}`);
    const b = await body(req); if (!b || !b.response || !b.cid) return fail('Bad request');
    const ch = await env.DB.prepare('SELECT * FROM challenges WHERE id = ? AND kind = ? AND player = ?').bind(String(b.cid), 'reg', me.id).first();
    if (!ch || ch.expires < Date.now()) return fail('That took too long. Try again.');
    await env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(ch.id).run();
    let v;
    try { v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: ch.challenge, expectedOrigin: r.origin, expectedRPID: r.rpID, requireUserVerification: false }); }
    catch { return fail('Couldn’t save that passkey. Try again.'); }
    if (!v.verified || !v.registrationInfo) return fail('Couldn’t save that passkey. Try again.');
    const c = v.registrationInfo.credential;
    await env.DB.prepare('INSERT OR REPLACE INTO passkeys (id, player, public_key, counter, transports, created, last_used) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(c.id, me.id, b64u(c.publicKey), c.counter || 0, JSON.stringify(c.transports || b.response.response?.transports || []), Date.now(), Date.now()).run();
    return json(await profileOut(env, me));
  }

  if (p === '/api/signout' && method === 'POST') {
    const m = (req.headers.get('authorization') || '').match(/\.([\w-]{20,64})$/);
    if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
    return json({ ok: true });
  }

  return fail('Not found', 404);
}

/* ---------------- housekeeping (runs on its own from the cron trigger) ---------------- */
async function hourly(env) {
  await env.DB.prepare('DELETE FROM challenges WHERE expires < ?').bind(Date.now()).run();
}
async function nightly(env) {
  const now = Date.now(), cut = dayNumberUTC(data) - KEEP_DAYS;
  await env.DB.batch([
    // guests that never scored, named themselves, made friends or saved a passkey, and haven't been back for 30 days
    env.DB.prepare(`DELETE FROM players WHERE games = 0 AND name IS NULL AND last_seen < ?
      AND NOT EXISTS (SELECT 1 FROM plays WHERE plays.player = players.id) AND NOT EXISTS (SELECT 1 FROM passkeys WHERE passkeys.player = players.id)
      AND NOT EXISTS (SELECT 1 FROM friends WHERE friends.player = players.id OR friends.friend = players.id)`).bind(now - 30 * DAY_MS),
    env.DB.prepare('DELETE FROM sessions WHERE last_seen < ?').bind(now - 400 * DAY_MS)
  ]);
  if (cut > 1) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM plays WHERE day < ?').bind(cut),
      env.DB.prepare('DELETE FROM answers WHERE day < ?').bind(cut),
      env.DB.prepare('DELETE FROM tally WHERE day < ?').bind(cut),
      env.DB.prepare('DELETE FROM monthly WHERE month < ?').bind(monthKey(cut))
    ]);
  }
}
async function discordRecap(env) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const day = dayNumberUTC(data) - 1; if (day < 1) return;
  const head = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n, COALESCE(SUM(score * n), 0) AS pts FROM tally WHERE day = ? AND scope = '*'").bind(day).first();
  if (!head.n) return;
  head.avg = head.pts / head.n;
  const top = (await env.DB.prepare('SELECT p.score, pl.name, pl.code, p.country FROM plays p JOIN players pl ON pl.id = p.player WHERE p.day = ? AND p.flag = 0 ORDER BY p.score DESC, p.ms ASC LIMIT 3').bind(day).all()).results;
  const medal = ['1st', '2nd', '3rd'];
  const lines = top.map((t, i) => `**${medal[i]}** ${display(t).replace(/[*_`~|>]/g, '')}${t.country ? ` (${t.country})` : ''}: ${t.score}/700 · ${rating(t.score)}`);
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Pokerarity', embeds: [{ title: `Daily pack #${day} results`, description: `${lines.join('\n')}\n\n${head.n} trainer${head.n === 1 ? '' : 's'} played · average ${Math.round(head.avg)}\nToday’s pack is open: https://${CANONICAL}`, color: 0xea669c }] })
  }).catch(() => {});
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // one address for search engines: www goes to the bare domain (the app forwards deep links too)
    if (url.hostname === 'www.' + CANONICAL) return Response.redirect(`https://${CANONICAL}${url.pathname}${url.search}`, 301);
    if (url.pathname.startsWith('/api/')) {
      try { return await handle(req, env, ctx, url); }
      catch (e) { console.error('api error', url.pathname, e && e.stack || e); return fail('Something went wrong', 500); }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    const h = new Date(event.scheduledTime).getUTCHours();
    ctx.waitUntil(hourly(env).catch(e => console.error('cleanup', e)));
    if (h === 3) ctx.waitUntil(nightly(env).catch(e => console.error('nightly', e)));
    if (h === 14) ctx.waitUntil(discordRecap(env).catch(e => console.error('recap', e)));
  }
};
