import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// compares every board and rank with a brute-force answer over the synthetic data from gen_bulk.mjs
const BASE = (process.env.BASE || 'http://localhost:8788') + '/api';
const { players, plays } = JSON.parse(readFileSync('/tmp/dex-bulk.json', 'utf8'));
const byId = new Map(players.map(p => [p.id, p]));
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
const disp = p => p.name || `Trainer ${p.code.slice(0, 4)}`;
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; if (fails < 25) console.log('FAIL', msg); } };
const get = async (path, p) => { const r = await fetch(BASE + path, { headers: p ? { authorization: `Bearer ${p.id}.${p.key}` } : {} }); return r.json(); };
const inScope = (x, sc, val) => sc === 'global' || x[sc] === val;

// brute force rows for a period/scope
function brute(period, day, sc, val) {
  if (period === 'day') {
    return plays.filter(x => x.day === day && !x.flag && inScope(x, sc, val)).sort((a, b) => b.score - a.score || a.ms - b.ms).map(x => ({ id: x.player, score: x.score, ms: x.ms }));
  }
  if (period === 'month') {
    const m = new Map();
    for (const x of plays) if (!x.flag) { const e = m.get(x.player) || { id: x.player, score: 0, best: 0 }; e.score += x.score; e.best = Math.max(e.best, x.score); m.set(x.player, e); }
    return [...m.values()].filter(e => inScope(byId.get(e.id), sc, val)).sort((a, b) => b.score - a.score || b.best - a.best);
  }
  return players.filter(p => p.games > 0 && inScope(p, sc, val)).map(p => ({ id: p.id, score: p.total, best: p.best })).sort((a, b) => b.score - a.score || b.best - a.best);
}
function bruteRank(period, day, sc, val, p) {
  const all = brute(period, day, sc, val);
  if (period === 'day') {
    const mine = plays.find(x => x.day === day && x.player === p.id);
    if (!mine) return null;
    if (mine.flag) return { flagged: mine.flag };
    if (sc !== 'global' && mine[sc] !== val) return null;
    return { rank: 1 + all.filter(x => x.score > mine.score || (x.score === mine.score && x.ms < mine.ms)).length, score: mine.score };
  }
  const mine = all.find(x => x.id === p.id);
  if (!mine) return null;
  const n = all.filter(x => x.score > mine.score || (x.score === mine.score && x.best > mine.best)).length;
  return { rank: Math.min(n, 1000) + 1, score: mine.score, capped: n >= 1000 };
}

// 1) public top-50 boards
const scopes = [['global', ''], ['country', 'US'], ['country', 'GB'], ['region', 'US-CA'], ['region', 'JP-13']];
for (const period of ['day', 'month', 'all']) for (const day of period === 'day' ? [7, 8, 9] : [9]) for (const [sc, val] of scopes) {
  const q = `/board?period=${period}&scope=${sc}&day=${day}&cc=${sc === 'country' ? val : ''}&rg=${sc === 'region' ? val : ''}`;
  const r = await get(q);
  const exp = brute(period, day, sc, val).slice(0, 50);
  ok(r.rows.length === exp.length, `${q} length ${r.rows.length} vs ${exp.length}`);
  r.rows.forEach((row, i) => {
    ok(row.score === exp[i]?.score, `${q} row ${i} score ${row.score} vs ${exp[i]?.score}`);
    if (period !== 'day' || i === r.rows.length - 1 || exp[i].score !== exp[i + 1]?.score || exp[i].ms !== exp[i + 1]?.ms) {
      // exact identity where the order is fully determined
      const strict = period === 'day' ? !(exp.filter(x => x.score === exp[i].score && x.ms === exp[i].ms).length > 1) : !(exp.filter(x => x.score === exp[i].score && x.best === exp[i].best).length > 1);
      if (strict) ok(row.h === sha(exp[i].id), `${q} row ${i} id mismatch`);
    }
    ok(row.rank === i + 1, `${q} rank field`);
  });
}

// 2) personal ranks for a sample of players across every period/scope
const sample = players.filter((_, i) => i % 9 === 0);
for (const p of sample) {
  for (const period of ['day', 'month', 'all']) for (const day of period === 'day' ? [8, 9] : [9]) for (const sc of ['global', 'country', 'region']) {
    const val = sc === 'global' ? '' : p[sc];
    const r = await get(`/board/me?period=${period}&scope=${sc}&day=${day}`, p);
    if (sc !== 'global' && !val) { ok(r.me === null, `no-geo ${p.id} ${period} ${sc} expected null got ${JSON.stringify(r.me)}`); continue; }
    const exp = bruteRank(period, day, sc, val, p);
    if (!exp) { ok(r.me === null, `${p.id.slice(0, 6)} ${period}/${day}/${sc} expected null got ${JSON.stringify(r.me)}`); continue; }
    if (exp.flagged) { ok(r.me && r.me.flagged === exp.flagged && r.me.rank === null, `${p.id.slice(0, 6)} flagged ${JSON.stringify(r.me)} vs ${exp.flagged}`); continue; }
    ok(r.me && r.me.rank === exp.rank && r.me.score === exp.score && !!r.me.capped === !!exp.capped, `${p.id.slice(0, 6)} ${period}/${day}/${sc}=${val} got ${JSON.stringify(r.me)} want ${JSON.stringify(exp)}`);
  }
}
// 3) ranks summary on the results screen (/rank) with "of" counts
for (const p of sample.slice(0, 40)) {
  const r = await get('/rank?day=9', p);
  const mine = plays.find(x => x.day === 9 && x.player === p.id);
  if (!mine) { ok(r.rank === null, 'rank null when not played'); continue; }
  const of = sc => plays.filter(x => x.day === 9 && !x.flag && (sc === 'global' || x[sc] === mine[sc])).length;
  const g = r.rank.global;
  if (mine.flag) { ok(g.flagged === mine.flag && g.rank === null, 'rank flagged'); continue; }
  ok(g.rank === bruteRank('day', 9, 'global', '', p).rank && g.of === of('global'), `/rank global ${JSON.stringify(g)}`);
  if (mine.country) ok(r.rank.country.rank === bruteRank('day', 9, 'country', mine.country, p).rank && r.rank.country.of === of('country'), `/rank country ${JSON.stringify(r.rank.country)}`);
  if (mine.region) ok(r.rank.region.rank === bruteRank('day', 9, 'region', mine.region, p).rank && r.rank.region.of === of('region'), `/rank region`);
}
// 4) stats head
const st = await get('/daily/9/stats');
const d9 = plays.filter(x => x.day === 9 && !x.flag);
ok(st.players === d9.length && st.avg === Math.round(d9.reduce((a, x) => a + x.score, 0) / d9.length), `stats ${st.players}/${st.avg} vs ${d9.length}`);
console.log(`checks ${checks} fails ${fails}`);
