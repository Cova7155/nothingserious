-- Run once, statement by statement, on databases created before Nov 12 2026:
--   npx wrangler d1 execute godpack-dex --remote --command "<statement>"
-- Part 1 (before deploying the new worker): additive changes only, the old worker keeps working.
ALTER TABLE plays ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_seen INTEGER;
UPDATE players SET last_seen = created WHERE last_seen IS NULL;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, player TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player);
CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, player TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT, created INTEGER NOT NULL, last_used INTEGER);
CREATE INDEX IF NOT EXISTS passkeys_player ON passkeys(player);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, player TEXT, kind TEXT NOT NULL, expires INTEGER NOT NULL);
DROP INDEX IF EXISTS plays_day_score;
DROP INDEX IF EXISTS plays_day_country;
DROP INDEX IF EXISTS plays_day_region;
CREATE INDEX IF NOT EXISTS plays_day_flag_score ON plays(day, flag, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_day_flag_country ON plays(day, flag, country, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_day_flag_region ON plays(day, flag, region, score DESC, ms ASC);
CREATE TABLE IF NOT EXISTS tally (day INTEGER NOT NULL, scope TEXT NOT NULL, score INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope, score));
CREATE TABLE IF NOT EXISTS monthly (month INTEGER NOT NULL, player TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0, games INTEGER NOT NULL DEFAULT 0, country TEXT, region TEXT, PRIMARY KEY (month, player));
CREATE INDEX IF NOT EXISTS monthly_score ON monthly(month, score DESC, best DESC);
CREATE INDEX IF NOT EXISTS monthly_country ON monthly(month, country, score DESC, best DESC);
CREATE INDEX IF NOT EXISTS monthly_region ON monthly(month, region, score DESC, best DESC);
-- Part 2 (after deploying): rebuild the tallies and month totals from plays, then drop the old table.
DELETE FROM tally;
DELETE FROM monthly;
INSERT OR IGNORE INTO tally (day, scope, score, n) SELECT day, '*', score, COUNT(*) FROM plays WHERE flag = 0 GROUP BY day, score;
INSERT OR IGNORE INTO tally (day, scope, score, n) SELECT day, 'c:' || country, score, COUNT(*) FROM plays WHERE flag = 0 AND country IS NOT NULL GROUP BY day, country, score;
INSERT OR IGNORE INTO tally (day, scope, score, n) SELECT day, 'r:' || region, score, COUNT(*) FROM plays WHERE flag = 0 AND region IS NOT NULL GROUP BY day, region, score;
INSERT OR IGNORE INTO monthly (month, player, score, best, games, country, region) SELECT CAST(strftime('%Y%m', '2026-11-04', '+' || (p.day - 1) || ' days') AS INTEGER) AS mk, p.player, SUM(p.score), MAX(p.score), COUNT(*), pl.country, pl.region FROM plays p JOIN players pl ON pl.id = p.player WHERE p.flag = 0 GROUP BY mk, p.player;
DROP TABLE IF EXISTS starts;
