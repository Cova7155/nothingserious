// Pokerarity core: shared by the browser and the Cloudflare Worker (no DOM in here).

export const CARDS = 7;
export const SECONDS = 25;
export const TIERS = [
  { key: 'common', name: 'Common', pts: 10, sq: '⬜' },
  { key: 'uncommon', name: 'Uncommon', pts: 20, sq: '🟩' },
  { key: 'rare', name: 'Rare', pts: 35, sq: '🟦' },
  { key: 'holo', name: 'Holo', pts: 55, sq: '🟪' },
  { key: 'ultra', name: 'Ultra', pts: 80, sq: '🟨' },
  { key: 'god', name: 'God Pull', pts: 100, sq: '🌈' }
];
export const MISS_SQ = '⬛';
export const MAX_SCORE = CARDS * TIERS[TIERS.length - 1].pts;
export const RATINGS = [
  [700, 'God Pack'], [600, 'Grail Hunter'], [450, 'Master Set'], [300, 'Collector'], [150, 'Booster'], [0, 'Starter Deck']
];
export const rating = score => RATINGS.find(([min]) => score >= min)[1];
export const GROUPS = {
  type: 'Types', region: 'Regions', name: 'Names', stats: 'Stats', body: 'Looks & size', evo: 'Evolution', lore: 'Lore'
};
export const PACKS = [
  { id: 'type', name: 'Type Clash', blurb: 'Types, dual types and the type chart', groups: ['type'] },
  { id: 'region', name: 'Region Run', blurb: 'Gens, regions and who lives where', groups: ['region'] },
  { id: 'name', name: 'Name Game', blurb: 'Letters, lengths and Pokédex categories', groups: ['name'] },
  { id: 'stats', name: 'Stat Nerds', blurb: 'Base stats, totals and extremes', groups: ['stats'] },
  { id: 'body', name: 'Big & Small', blurb: 'Height, weight and colors', groups: ['body'] },
  { id: 'evo', name: 'Evolution Lab', blurb: 'Stones, trades, stages and forms', groups: ['evo'] },
  { id: 'lore', name: 'Legends & Lore', blurb: 'Legendaries, abilities, gender, Dex numbers', groups: ['lore'] },
  { id: 'kanto', name: 'Kanto Classic', blurb: 'Every answer from the original 151', groups: null }
];

/* ---------------- seeded randomness ---------------- */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* ---------------- days ---------------- */
// Pack #1 is the epoch date. Everyone on the same calendar date gets the same pack (like Wordle).
export function dayNumber(data, date = new Date()) {
  const [y, m, d] = data.epoch.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((b - a) / 86400000) + 1;
}
export function dayNumberUTC(data, date = new Date()) {
  const [y, m, d] = data.epoch.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((b - a) / 86400000) + 1;
}
export function dateOfDay(data, n) {
  const [y, m, d] = data.epoch.split('-').map(Number);
  return new Date(y, m - 1, d + n - 1);
}

/* ---------------- names and matching ---------------- */
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/♀/g, 'f').replace(/♂/g, 'm').replace(/[^a-z0-9]/g, '');

const ALIAS = {
  nidoran: ['nidoranf', 'nidoranm'], nidoranfemale: ['nidoranf'], nidoranmale: ['nidoranm'], nidoranboy: ['nidoranm'], nidorangirl: ['nidoranf'],
  farfetched: ['farfetchd'], sirfetched: ['sirfetchd'], mrmine: ['mrmime'], mimejunior: ['mimejr'], porygontwo: ['porygon2'], porygon2: ['porygon2'],
  typenull: ['typenull'], flabebe: ['flabebe'], hooh: ['hooh'], jangmoo: ['jangmoo'], hakamoo: ['hakamoo'], kommoo: ['kommoo']
};

function osa(a, b, max) {
  // optimal string alignment distance with an early exit
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[lb];
}

export function makeDex(data) {
  const S = data.species;
  const names = new Map();
  const put = (k, i) => { if (!k) return; const arr = names.get(k) || []; if (!arr.includes(i)) arr.push(i); names.set(k, arr); };
  S.forEach((p, i) => { put(norm(p.n), i); put(p.id, i); });
  const byId = new Map(S.map((p, i) => [p.id, i]));
  for (const [k, ids] of Object.entries(ALIAS)) ids.forEach(id => byId.has(id) && put(k, byId.get(id)));
  const keys = [...names.keys()];
  const tierCache = new Map();

  function match(text, valid) {
    const q = norm(text);
    if (q.length < 2) return null;
    const pick = list => (valid ? list.find(i => valid.has(i)) : undefined) ?? list[0];
    if (names.has(q)) return { i: pick(names.get(q)), exact: true };
    const max = q.length <= 4 ? 0 : q.length <= 7 ? 1 : 2;
    if (!max) return null;
    let best = null, bestD = max + 1, bestValid = false;
    for (const k of keys) {
      const d = osa(q, k, max);
      if (d > max) continue;
      const list = names.get(k), i = pick(list), ok = valid ? valid.has(i) : false;
      if (d < bestD || (d === bestD && ok && !bestValid)) { best = i; bestD = d; bestValid = ok; }
    }
    return best === null ? null : { i: best, exact: false };
  }

  // rarity: blend of how familiar an answer is relative to the other valid answers, and overall
  function tiers(q) {
    const key = q.k + ':' + q.a.length;
    if (tierCache.has(key)) return tierCache.get(key);
    const N = q.a.length;
    const byFam = [...q.a].sort((x, y) => S[y].f - S[x].f || S[x].d - S[y].d);
    const obs = new Map(byFam.map((i, r) => [i, .75 * (N > 1 ? r / (N - 1) : .5) + .25 * (1 - S[i].f / 100)]));
    // every prompt gets the full ladder: tiers come from where an answer sits among that prompt's answers
    const sorted = [...q.a].sort((x, y) => obs.get(x) - obs.get(y) || S[x].d - S[y].d);
    const CUT = [.12, .28, .46, .64, .84];
    const out = new Map();
    sorted.forEach((i, r) => {
      const pos = N > 1 ? r / N : .5;
      let t = CUT.filter(c => pos >= c).length;
      if (S[i].f >= 96) t = Math.min(t, 1);
      out.set(i, { t, o: obs.get(i) });
    });
    const res = { map: out, sorted };
    tierCache.set(key, res);
    return res;
  }
  const tierOf = (q, i) => (tiers(q).map.get(i) || { t: -1 }).t;

  // the chase card: a rare-but-gettable answer, picked per prompt and pack
  function chase(q, seed) {
    const { map, sorted } = tiers(q);
    let cand = sorted.filter(i => map.get(i).t === 5);
    if (!cand.length) cand = sorted.filter(i => map.get(i).t === 4);
    if (!cand.length) cand = sorted.slice(-1);
    cand.sort((x, y) => map.get(x).o - map.get(y).o);
    const half = cand.slice(0, Math.max(1, Math.ceil(cand.length * .6)));
    return half[hashStr(q.k + '|' + seed) % half.length];
  }

  const promptText = q => [q.lead, q.key, q.tail].filter(Boolean).join(' ');

  function dailyPrompts(n) {
    const days = data.days;
    const row = days[((n - 1) % days.length + days.length) % days.length];
    return row.map(i => ({ ...data.pool[i], pi: i }));
  }

  function randomPrompts(seed, groups) {
    const r = rng(seed);
    const pool = data.pool.map((q, i) => ({ ...q, pi: i }));
    if (!groups) {
      const by = {};
      pool.forEach(q => (by[q.gp] = by[q.gp] || []).push(q));
      const gs = Object.keys(GROUPS);
      const out = gs.map(g => by[g][Math.floor(r() * by[g].length)]);
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return out;
    }
    const cand = pool.filter(q => groups.includes(q.gp));
    const out = [], used = new Set();
    while (out.length < CARDS && used.size < cand.length) {
      const q = cand[Math.floor(r() * cand.length)];
      if (used.has(q.k)) continue;
      used.add(q.k); out.push(q);
    }
    return out;
  }

  function kantoPrompts(seed) {
    const r = rng(seed);
    const cand = data.pool.map((q, i) => ({ ...q, pi: i, a: q.a.filter(j => S[j].g === 1) }))
      .filter(q => q.gp !== 'region' && q.a.length >= 8 && !/^gen/.test(q.k))
      .map(q => ({ ...q, k: 'kanto:' + q.k, tail: (q.tail ? q.tail + ' ' : '') + '· Gen 1 only' }));
    const out = [], used = new Set();
    while (out.length < CARDS && used.size < cand.length) {
      const q = cand[Math.floor(r() * cand.length)];
      if (used.has(q.k) || out.some(o => o.gp === q.gp && out.filter(x => x.gp === q.gp).length >= 2)) { used.add(q.k); continue; }
      used.add(q.k); out.push(q);
    }
    return out;
  }

  function partyPrompt(seed, exclude = []) {
    const r = rng(seed);
    const cand = data.pool.map((q, i) => ({ ...q, pi: i })).filter(q => q.a.length >= 40 && q.a.length <= 220 && !exclude.includes(q.k));
    return cand[Math.floor(r() * cand.length)];
  }

  // score a run: picks are species indexes (or -1 for a miss), one per prompt
  function scoreRun(prompts, picks, seed) {
    let total = 0;
    const cards = prompts.map((q, n) => {
      const i = picks[n];
      const valid = i >= 0 && q.a.includes(i);
      const t = valid ? tierOf(q, i) : -1;
      const pts = t >= 0 ? TIERS[t].pts : 0;
      const ch = chase(q, seed + ':' + n);
      total += pts;
      return { i: valid ? i : -1, t, pts, chase: ch, hitChase: valid && i === ch };
    });
    return { total, cards };
  }

  return { data, S, match, tiers, tierOf, chase, promptText, dailyPrompts, randomPrompts, kantoPrompts, partyPrompt, scoreRun, names };
}

export function shareText({ label, score, cards, url }) {
  const sq = cards.map(c => (c.t >= 0 ? TIERS[c.t].sq : MISS_SQ)).join('');
  const chases = cards.filter(c => c.hitChase).length;
  return `${label} · ${score}/${MAX_SCORE} · ${rating(score)}\n${sq}${chases ? `\n${chases} chase card${chases > 1 ? 's' : ''} pulled` : ''}\n${url}`;
}

export function cleanName(s) {
  return String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
