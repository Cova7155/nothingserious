CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  name TEXT,
  code TEXT NOT NULL UNIQUE,
  country TEXT,
  region TEXT,
  region_name TEXT,
  created INTEGER NOT NULL,
  last_seen INTEGER,
  total INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_day INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_total ON players(total DESC);
CREATE INDEX IF NOT EXISTS players_country_total ON players(country, total DESC);
CREATE INDEX IF NOT EXISTS players_region_total ON players(region, total DESC);

-- flag = 1 keeps a play off the public boards (e.g. a scripted run with no valid start ticket)
CREATE TABLE IF NOT EXISTS plays (
  day INTEGER NOT NULL,
  player TEXT NOT NULL,
  score INTEGER NOT NULL,
  tiers TEXT NOT NULL,
  picks TEXT NOT NULL,
  ms INTEGER NOT NULL,
  country TEXT,
  region TEXT,
  created INTEGER NOT NULL,
  flag INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, player)
);
-- flag sits in the board indexes so top-50 reads and tie counts never touch the table
CREATE INDEX IF NOT EXISTS plays_day_flag_score ON plays(day, flag, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_day_flag_country ON plays(day, flag, country, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_day_flag_region ON plays(day, flag, region, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_player ON plays(player, day DESC);

-- how many counted plays scored each score on each day, per scope ('*', 'c:US', 'r:US-CA'); ranks are a sum over at most 141 rows
CREATE TABLE IF NOT EXISTS tally (
  day INTEGER NOT NULL,
  scope TEXT NOT NULL,
  score INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope, score)
);

-- running totals for the month board (month like 202611)
CREATE TABLE IF NOT EXISTS monthly (
  month INTEGER NOT NULL,
  player TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  country TEXT,
  region TEXT,
  PRIMARY KEY (month, player)
);
CREATE INDEX IF NOT EXISTS monthly_score ON monthly(month, score DESC, best DESC);
CREATE INDEX IF NOT EXISTS monthly_country ON monthly(month, country, score DESC, best DESC);
CREATE INDEX IF NOT EXISTS monthly_region ON monthly(month, region, score DESC, best DESC);

CREATE TABLE IF NOT EXISTS answers (
  day INTEGER NOT NULL,
  card INTEGER NOT NULL,
  sp INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, card, sp)
);

CREATE TABLE IF NOT EXISTS friends (
  player TEXT NOT NULL,
  friend TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (player, friend)
);

-- extra device sign-ins created by passkey logins
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created INTEGER NOT NULL,
  last_used INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_player ON passkeys(player);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  player TEXT,
  kind TEXT NOT NULL,
  expires INTEGER NOT NULL
);
