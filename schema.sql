CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  name TEXT,
  code TEXT NOT NULL UNIQUE,
  country TEXT,
  region TEXT,
  region_name TEXT,
  created INTEGER NOT NULL,
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
  PRIMARY KEY (day, player)
);
CREATE INDEX IF NOT EXISTS plays_day_score ON plays(day, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_day_country ON plays(day, country, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_day_region ON plays(day, region, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS plays_player ON plays(player, day DESC);

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

CREATE TABLE IF NOT EXISTS starts (
  day INTEGER NOT NULL,
  player TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (day, player)
);
