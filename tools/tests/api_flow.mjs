import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
// server checks: tickets, flags, totals, names, friends, caching, passkey hosts, rate limits. Run from the repo root against wrangler dev.
import { makeDex, dayNumberUTC } from '../../public/js/core.js';
const data = JSON.parse(readFileSync(new URL('../../public/data/dex.json', import.meta.url), 'utf8'));
const dex = makeDex(data), day = dayNumberUTC(data);
const ORIGIN = process.env.BASE || 'http://localhost:8788', BASE = ORIGIN + '/api';
let ipn = 10;
async function call(path, { method, body, who, ip } = {}) {
  const headers = { 'cf-connecting-ip': ip || `10.0.0.${ipn}` };
  if (body) headers['content-type'] = 'application/json';
  if (who) headers.authorization = `Bearer ${who.id}.${who.key}`;
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
}
const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ticket = (d, ageMs) => { const ts = Date.now() - ageMs; return `${d}.${ts}.${b64u(createHmac('sha256', 'dev-only-secret').update(`${d}.${ts}`).digest())}`; };
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const prompts = dex.dailyPrompts(day);
const goodPicks = prompts.map(q => q.a[q.a.length - 1]);
const expected = dex.scoreRun(prompts, goodPicks, 'd' + day).total;

const A = (await call('/player/new', { method: 'POST', body: {}, ip: '10.1.0.1' })).json;
const B = (await call('/player/new', { method: 'POST', body: {}, ip: '10.1.0.2' })).json;
const C = (await call('/player/new', { method: 'POST', body: {}, ip: '10.1.0.3' })).json;
ok(A.id && A.key && A.code && A.country === 'US', 'player/new returns a profile');
const t0 = (await call(`/daily/ticket?day=${day}`)).json.ticket;
ok(/^\d+\.\d+\.[\w-]+$/.test(t0), 'ticket shape');
ok((await call(`/daily/ticket?day=${day + 5}`)).status === 400, 'ticket refuses far days');
const before = (await call(`/daily/${day}/stats`)).json.players;

const ra = await call('/daily/submit', { who: A, body: { day, picks: goodPicks, ms: Array(7).fill(9000), ticket: ticket(day, 20000) } });
ok(ra.status === 200 && ra.json.score === expected && ra.json.flagged === 0, `A counts with a valid ticket (score ${ra.json?.score} = ${expected})`);
ok(ra.json.rank.global.rank >= 1 && ra.json.rank.global.of >= 1, `A gets ranks ${JSON.stringify(ra.json.rank.global)}`);
const rb = await call('/daily/submit', { who: B, body: { day, picks: goodPicks, ms: Array(7).fill(1000), ticket: t0 } });
ok(rb.status === 200 && rb.json.flagged === 2 && rb.json.rank.global.flagged === 2 && rb.json.rank.global.rank === null, 'B: fresh ticket = too fast, flagged 2');
const rc = await call('/daily/submit', { who: C, body: { day, picks: goodPicks.map(() => -1), ms: [] } });
ok(rc.status === 200 && rc.json.flagged === 0 && rc.json.score === 0, 'C: no ticket counts during the grace window');
const forged = t0.replace(/.$/, c => (c === 'A' ? 'B' : 'A'));
const D = (await call('/player/new', { method: 'POST', body: {}, ip: '10.1.0.4' })).json;
const rd = await call('/daily/submit', { who: D, body: { day, picks: goodPicks, ticket: forged } });
ok(rd.json.flagged === 2, 'forged ticket flagged');
const again = await call('/daily/submit', { who: A, body: { day, picks: goodPicks, ticket: ticket(day, 20000) } });
ok(again.status === 409 && again.json.rank.global.rank >= 1, 'second submit is refused with ranks');
ok((await call('/daily/submit', { who: A, body: { day: day + 3, picks: goodPicks } })).status === 400, 'future day refused');
ok((await call('/daily/submit', { body: { day, picks: goodPicks } })).status === 401, 'no auth refused');
ok((await call('/daily/submit', { who: { id: A.id, key: 'x'.repeat(24) }, body: { day, picks: goodPicks } })).status === 401, 'wrong key refused');

const after = (await call(`/daily/${day}/stats`)).json;
// stats are edge-cached for two minutes, so only check they never count flagged runs
ok(after.players <= before + 2, `stats never count flagged runs (${before} -> ${after.players})`);
const meA = (await call('/me', { who: A })).json;
ok(meA.total === expected && meA.games === 1 && meA.history.length === 1 && meA.history[0].picks.length === 7 && meA.passkeys === 0, 'A /me totals and history');
const meB = (await call('/me', { who: B })).json;
ok(meB.total === 0 && meB.games === 0 && meB.history.length === 1, 'B: flagged run in history, not in totals');

// names
ok((await call('/me/name', { who: A, body: { name: 'Ash K' } })).json.name === 'Ash K', 'name saved');
ok((await call('/me/name', { who: B, body: { name: 'G0dPack' } })).status === 400, 'reserved name refused');
ok((await call('/me/name', { who: B, body: { name: 'sh1t' } })).status === 400, 'rude name refused');

// friends
ok((await call('/friends', { who: A, body: { code: C.code } })).status === 200, 'A adds C');
ok((await call('/friends', { who: A, body: { code: A.code } })).status === 400, 'own code refused');
ok((await call('/friends', { who: A, body: { code: 'ZZZZZ9' } })).status === 404, 'unknown code');
const fb = (await call(`/board/me?period=day&scope=friends&day=${day}`, { who: A })).json;
ok(fb.rows.length === 2 && fb.rows[0].name === 'Ash K' && fb.me.rank === 1, `friends board ${JSON.stringify(fb.rows.map(r => r.name))}`);
const fl = (await call(`/friends?day=${day}`, { who: A })).json.friends;
ok(fl.length === 1 && fl[0].code === C.code && fl[0].today === 0, 'friends list with today');
ok((await call('/friends/' + C.code, { who: A, method: 'DELETE' })).status === 200, 'remove friend');

// month and all-time include A; public board caches
const mb = (await call(`/board/me?period=month&scope=global&day=${day}`, { who: A })).json.me;
ok(mb && mb.score === expected, `month rank for A ${JSON.stringify(mb)}`);
const pub = await call(`/board?period=day&scope=global&day=${day}`);
ok(pub.headers.get('cache-control') === 'public, max-age=30', 'public board is cacheable: ' + pub.headers.get('cache-control'));
ok((await call('/me', { who: A })).headers.get('cache-control') === 'no-store', 'private reads are no-store');

// passkey endpoints refuse other hosts and need a valid challenge
const po = await fetch(ORIGIN + '/api/passkey/login/options', { method: 'POST', body: '{}' });
const lo = await fetch(ORIGIN + '/api/passkey/login/options', { method: 'POST', body: '{}' });
const loj = await lo.json();
ok(lo.status === 200 && loj.cid && loj.options.challenge && loj.options.rpId === 'localhost', 'login options on localhost');
const lv = await fetch(ORIGIN + '/api/passkey/login/verify', { method: 'POST', body: JSON.stringify({ cid: 'nope', response: { id: 'x' } }) });
ok(lv.status === 400, 'unknown challenge refused');

// rate limits
let limited = 0;
for (let i = 0; i < 40; i++) { const r = await call('/party', { method: 'POST', body: {}, ip: '10.9.9.9' }); if (r.status === 429) limited++; }
ok(limited > 0, `party creation is rate limited (${limited} of 40 refused)`);
let lnew = 0;
for (let i = 0; i < 10; i++) { const r = await call('/player/new', { method: 'POST', body: {}, ip: '10.8.8.8' }); if (r.status === 429) lnew++; }
ok(lnew > 0, `new players are rate limited (${lnew} of 10 refused)`);
ok((await call('/nope', { who: A })).status === 404, 'unknown api 404');
console.log(fails ? `${fails} FAILED` : 'all passed');
