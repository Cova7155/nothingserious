// godpack DEX API: players, server-checked daily scores, localized boards, friends, party rooms.
import data from '../public/data/dex.json';
import { makeDex, dayNumberUTC, CARDS, SECONDS, TIERS, cleanName, norm } from '../public/js/core.js';
export { Room } from './room.js';

const dex = makeDex(data);
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const fail = (error, status = 400) => json({ error }, status);

const enc = new TextEncoder();
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function randToken(n = 24) { const b = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function friendCode() { const b = crypto.getRandomValues(new Uint8Array(6)); return [...b].map(x => CODE_ABC[x % CODE_ABC.length]).join(''); }
const ROOM_ABC = 'BCDFGHJKLMNPQRSTVWXZ';
function roomCode() { const b = crypto.getRandomValues(new Uint8Array(4)); return [...b].map(x => ROOM_ABC[x % ROOM_ABC.length]).join(''); }

const BAD = ['fuck', 'shit', 'cunt', 'nigg', 'nigga', 'fag', 'faggot', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'whore', 'slut', 'bitch', 'cock', 'dick', 'pussy', 'porn', 'sex', 'penis', 'vagina', 'tranny', 'kys'];
const badName = s => { const n = norm(s).replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't'); return BAD.some(w => n.includes(w)); };

function geo(req) {
  const cf = req.cf || {};
  const cc = String(cf.country || '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(cc) && cc !== 'XX' && cc !== 'T1' ? cc : null;
  const rc = String(cf.regionCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return { country, region: country && rc ? `${country}-${rc}` : null, regionName: country && rc && cf.region ? String(cf.region).slice(0, 60) : null };
}
const display = p => p.name || `Trainer ${String(p.code || '').slice(0, 4)}`;

async function auth(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer ([0-9a-f-]{36})\.([\w-]{20,64})$/);
  if (!m) return null;
  const row = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(m[1]).first();
  if (!row || row.key_hash !== await sha256(m[2])) return null;
  return row;
}
const okDay = d => { const n = dayNumberUTC(data); return Number.isInteger(d) && d >= 1 && d >= n - 1 && d <= n + 1; };
async function body(req) { try { const t = await req.text(); if (t.length > 4000) return null; return t ? JSON.parse(t) : {}; } catch { return null; } }

async function ranksFor(env, me, day) {
  const play = await env.DB.prepare('SELECT score, ms, country, region FROM plays WHERE day = ? AND player = ?').bind(day, me.id).first();
  if (!play) return null;
  const better = 'day = ? AND (score > ? OR (score = ? AND ms < ?))';
  const args = [day, play.score, play.score, play.ms];
  const q = async (extra, extraArgs) => {
    const [a, b] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS n FROM plays WHERE ${better}${extra}`).bind(...args, ...extraArgs).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM plays WHERE day = ?${extra}`).bind(day, ...extraArgs).first()
    ]);
    return { rank: a.n + 1, of: b.n };
  };
  return {
    global: await q('', []),
    country: play.country ? await q(' AND country = ?', [play.country]) : null,
    region: play.region ? await q(' AND region = ?', [play.region]) : null
  };
}

async function handle(req, env, url) {
  const p = url.pathname, method = req.method;

  if (p === '/api/health') return json({ ok: true, day: dayNumberUTC(data) });

  if (p === '/api/player/new' && method === 'POST') {
    const g = geo(req), id = crypto.randomUUID(), key = randToken(24), now = Date.now();
    for (let tries = 0; tries < 6; tries++) {
      const code = friendCode();
      try {
        await env.DB.prepare('INSERT INTO players (id, key_hash, name, code, country, region, region_name, created) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
          .bind(id, await sha256(key), code, g.country, g.region, g.regionName, now).run();
        return json({ id, key, code, name: null, country: g.country, region: g.region, regionName: g.regionName });
      } catch (e) { if (!/UNIQUE/i.test(String(e))) throw e; }
    }
    return fail('Could not create a player, try again', 500);
  }

  if (p === '/api/party' && method === 'POST') return json({ code: roomCode() });
  const pm = p.match(/^\/api\/party\/([A-Za-z]{4})\/ws$/);
  if (pm) {
    if (req.headers.get('Upgrade') !== 'websocket') return fail('Expected a websocket', 426);
    const code = pm[1].toUpperCase();
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://room/${code}`, req));
  }

  const sm = p.match(/^\/api\/daily\/(\d+)\/stats$/);
  if (sm && method === 'GET') {
    const day = +sm[1];
    const head = await env.DB.prepare('SELECT COUNT(*) AS players, AVG(score) AS avg FROM plays WHERE day = ?').bind(day).first();
    const rows = (await env.DB.prepare('SELECT card, sp, n FROM answers WHERE day = ? AND sp >= 0 ORDER BY card ASC, n DESC').bind(day).all()).results;
    const cards = Array.from({ length: CARDS }, () => ({ top: [] }));
    for (const r of rows) if (cards[r.card] && cards[r.card].top.length < 10) cards[r.card].top.push({ i: r.sp, pct: head.players ? Math.round(100 * r.n / head.players) : 0 });
    return json({ players: head.players, avg: head.avg ? Math.round(head.avg) : 0, cards });
  }

  if (p === '/api/board' && method === 'GET') {
    const me = await auth(req, env);
    const period = url.searchParams.get('period') === 'all' ? 'all' : 'day';
    const scope = ['global', 'country', 'region', 'friends'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'global';
    const day = Number(url.searchParams.get('day')) || dayNumberUTC(data);
    if ((scope !== 'global') && !me) return json({ rows: [], me: null });
    const friendIds = scope === 'friends' ? [me.id, ...(await env.DB.prepare('SELECT friend FROM friends WHERE player = ?').bind(me.id).all()).results.map(r => r.friend)] : [];
    const inList = ids => ids.map(() => '?').join(',');
    let rows = [], mine = null;
    if (period === 'day') {
      let where = 'p.day = ?', args = [day];
      const myPlay = me ? await env.DB.prepare('SELECT score, ms, country, region FROM plays WHERE day = ? AND player = ?').bind(day, me.id).first() : null;
      if (scope === 'country') { const cc = myPlay?.country || me.country; if (!cc) return json({ rows: [], me: null }); where += ' AND p.country = ?'; args.push(cc); }
      if (scope === 'region') { const rg = myPlay?.region || me.region; if (!rg) return json({ rows: [], me: null }); where += ' AND p.region = ?'; args.push(rg); }
      if (scope === 'friends') { where += ` AND p.player IN (${inList(friendIds)})`; args.push(...friendIds); }
      rows = (await env.DB.prepare(`SELECT p.score, p.ms, p.country AS cc, p.player, pl.name, pl.code FROM plays p JOIN players pl ON pl.id = p.player WHERE ${where} ORDER BY p.score DESC, p.ms ASC LIMIT 50`).bind(...args).all()).results;
      if (myPlay) {
        const a = await env.DB.prepare(`SELECT COUNT(*) AS n FROM plays p WHERE ${where} AND (p.score > ? OR (p.score = ? AND p.ms < ?))`).bind(...args, myPlay.score, myPlay.score, myPlay.ms).first();
        mine = { rank: a.n + 1, score: myPlay.score };
      }
    } else {
      let where = 'games > 0', args = [];
      if (scope === 'country') { if (!me.country) return json({ rows: [], me: null }); where += ' AND country = ?'; args.push(me.country); }
      if (scope === 'region') { if (!me.region) return json({ rows: [], me: null }); where += ' AND region = ?'; args.push(me.region); }
      if (scope === 'friends') { where += ` AND id IN (${inList(friendIds)})`; args.push(...friendIds); }
      rows = (await env.DB.prepare(`SELECT total AS score, best, country AS cc, id AS player, name, code FROM players WHERE ${where} ORDER BY total DESC, best DESC LIMIT 50`).bind(...args).all()).results;
      if (me && me.games > 0) {
        const a = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${where} AND (total > ? OR (total = ? AND best > ?))`).bind(...args, me.total, me.total, me.best).first();
        mine = { rank: a.n + 1, score: me.total };
      }
    }
    return json({ rows: rows.map((r, i) => ({ rank: i + 1, name: display(r), cc: r.cc || '', score: r.score, me: !!me && r.player === me.id })), me: mine });
  }

  // everything below needs a player
  const me = await auth(req, env);
  if (!me) return fail('Unknown player', 401);

  if (p === '/api/me' && method === 'GET') {
    const hist = (await env.DB.prepare('SELECT day, score, tiers, picks FROM plays WHERE player = ? ORDER BY day DESC LIMIT 90').bind(me.id).all()).results;
    return json({ id: me.id, name: me.name, display: display(me), code: me.code, country: me.country, region: me.region, regionName: me.region_name, total: me.total, games: me.games, best: me.best, streak: me.streak, bestStreak: me.best_streak, lastDay: me.last_day, history: hist.map(h => ({ day: h.day, score: h.score, tiers: JSON.parse(h.tiers), picks: JSON.parse(h.picks) })) });
  }

  if (p === '/api/me/name' && method === 'POST') {
    const b = await body(req); if (!b) return fail('Bad request');
    const name = cleanName(b.name);
    if (name.length < 2) return fail('Use at least 2 letters');
    if (badName(name)) return fail('Pick a different name');
    await env.DB.prepare('UPDATE players SET name = ? WHERE id = ?').bind(name, me.id).run();
    return json({ name });
  }

  if (p === '/api/daily/start' && method === 'POST') {
    const b = await body(req); if (!b || !okDay(b.day)) return fail('Bad day');
    await env.DB.prepare('INSERT OR IGNORE INTO starts (day, player, at) VALUES (?, ?, ?)').bind(b.day, me.id, Date.now()).run();
    return json({ ok: true });
  }

  if (p === '/api/daily/submit' && method === 'POST') {
    const b = await body(req); if (!b) return fail('Bad request');
    const day = b.day;
    if (!okDay(day)) return fail('That pack isn’t open right now');
    const picks = Array.isArray(b.picks) ? b.picks.slice(0, CARDS).map(x => (Number.isInteger(x) && x >= 0 && x < dex.S.length ? x : -1)) : null;
    if (!picks || picks.length !== CARDS) return fail('Bad picks');
    const ms = Array.from({ length: CARDS }, (_, i) => Math.max(0, Math.min(SECONDS * 1000, Math.round(Number(b.ms?.[i]) || SECONDS * 1000))));
    const exists = await env.DB.prepare('SELECT 1 FROM plays WHERE day = ? AND player = ?').bind(day, me.id).first();
    if (exists) return json({ error: 'Already played', rank: await ranksFor(env, me, day) }, 409);
    const prompts = dex.dailyPrompts(day);
    const res = dex.scoreRun(prompts, picks, 'd' + day);
    const g = geo(req), now = Date.now();
    const country = g.country || me.country, region = g.region || me.region, regionName = g.regionName || me.region_name;
    const streak = me.last_day === day - 1 ? me.streak + 1 : me.last_day === day ? me.streak : 1;
    const stmts = [
      env.DB.prepare('INSERT INTO plays (day, player, score, tiers, picks, ms, country, region, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(day, me.id, res.total, JSON.stringify(res.cards.map(c => c.t)), JSON.stringify(res.cards.map(c => c.i)), ms.reduce((a, x) => a + x, 0), country, region, now),
      env.DB.prepare('UPDATE players SET total = total + ?, games = games + 1, best = MAX(best, ?), streak = ?, best_streak = MAX(best_streak, ?), last_day = MAX(last_day, ?), country = ?, region = ?, region_name = ? WHERE id = ?')
        .bind(res.total, res.total, streak, streak, day, country, region, regionName, me.id),
      ...res.cards.map((c, k) => env.DB.prepare('INSERT INTO answers (day, card, sp, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, card, sp) DO UPDATE SET n = n + 1').bind(day, k, c.i))
    ];
    try { await env.DB.batch(stmts); }
    catch (e) { if (/UNIQUE|PRIMARY/i.test(String(e))) return json({ error: 'Already played', rank: await ranksFor(env, me, day) }, 409); throw e; }
    const fresh = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(me.id).first();
    return json({ score: res.total, cards: res.cards.map(c => ({ t: c.t, pts: c.pts, hitChase: c.hitChase })), rank: await ranksFor(env, fresh, day), me: { total: fresh.total, games: fresh.games, best: fresh.best, streak: fresh.streak, bestStreak: fresh.best_streak } });
  }

  if (p === '/api/rank' && method === 'GET') {
    const day = Number(url.searchParams.get('day')) || dayNumberUTC(data);
    return json({ rank: await ranksFor(env, me, day) });
  }

  if (p === '/api/friends' && method === 'GET') {
    const day = Number(url.searchParams.get('day')) || dayNumberUTC(data);
    const rows = (await env.DB.prepare('SELECT pl.id, pl.name, pl.code, pl.country, pl.total, (SELECT score FROM plays WHERE day = ? AND player = pl.id) AS today FROM friends f JOIN players pl ON pl.id = f.friend WHERE f.player = ? ORDER BY f.created DESC LIMIT 200').bind(day, me.id).all()).results;
    return json({ friends: rows.map(r => ({ name: display(r), code: r.code, cc: r.country || '', total: r.total, today: r.today })) });
  }
  if (p === '/api/friends' && method === 'POST') {
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

  return fail('Not found', 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handle(req, env, url); }
      catch (e) { console.error('api error', url.pathname, e && e.stack || e); return fail('Something went wrong', 500); }
    }
    return env.ASSETS.fetch(req);
  }
};
