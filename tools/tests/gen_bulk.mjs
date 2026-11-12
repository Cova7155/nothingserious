// synthetic players + plays across days 7..9 with mixed countries/regions/flags, written as SQL
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
// usage (from the repo root): node tools/tests/gen_bulk.mjs, then load /tmp/dex-bulk.sql into the local D1 and run part 2 of the migration
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const geos = [['US', 'US-CA'], ['US', 'US-TX'], ['US', 'US-NY'], ['GB', 'GB-ENG'], ['GB', 'GB-SCT'], ['DE', 'DE-BE'], ['JP', 'JP-13'], [null, null]];
const players = [], plays = [];
const sql = [];
const sha = s => createHash('sha256').update(s).digest('hex');
for (let i = 0; i < 1300; i++) {
  const id = randomUUID(), key = 'k' + i.toString().padStart(23, '0');
  const g = pick(geos);
  const p = { id, key, code: 'Z' + i.toString(36).toUpperCase().padStart(5, '0'), name: rnd() < .7 ? `Bulk${i}` : null, country: g[0], region: g[1], total: 0, games: 0, best: 0 };
  for (const day of [7, 8, 9]) {
    if (rnd() < .25) continue;
    const score = Math.round(rnd() * 140) * 5, ms = 20000 + Math.floor(rnd() * 150000), flag = rnd() < .05 ? (rnd() < .5 ? 1 : 2) : 0;
    // players can travel: a few plays happen in another country
    const pg = rnd() < .08 ? pick(geos) : g;
    plays.push({ day, player: id, score, ms, flag, country: pg[0], region: pg[1] });
    if (!flag) { p.total += score; p.games++; p.best = Math.max(p.best, score); }
  }
  // the player's current country is the one of their latest play
  const last = plays.filter(x => x.player === id).pop();
  if (last) { p.country = last.country; p.region = last.region; }
  players.push(p);
}
const q = v => (v == null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`);
for (const p of players) sql.push(`INSERT INTO players (id, key_hash, name, code, country, region, region_name, created, last_seen, total, games, best, streak, best_streak, last_day) VALUES (${[p.id, sha(p.key), p.name, p.code, p.country, p.region, p.region ? 'R ' + p.region : null, Date.now(), Date.now(), p.total, p.games, p.best, 1, 1, 9].map(q).join(', ')});`);
for (const x of plays) sql.push(`INSERT INTO plays (day, player, score, tiers, picks, ms, country, region, created, flag) VALUES (${[x.day, x.player, x.score, '[0,0,0,0,0,0,0]', '[-1,-1,-1,-1,-1,-1,-1]', x.ms, x.country, x.region, Date.now(), x.flag].map(q).join(', ')});`);
writeFileSync('/tmp/dex-bulk.sql', sql.join('\n') + '\n');
writeFileSync('/tmp/dex-bulk.json', JSON.stringify({ players, plays }));
console.log('players', players.length, 'plays', plays.length, 'flagged', plays.filter(p => p.flag).length);
