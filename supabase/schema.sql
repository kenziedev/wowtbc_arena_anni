-- Characters table
CREATE TABLE IF NOT EXISTS characters (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  realm TEXT NOT NULL,
  class TEXT,
  race TEXT,
  faction TEXT,
  guild TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, realm)
);

-- Rating snapshots (history)
CREATE TABLE IF NOT EXISTS rating_snapshots (
  id BIGSERIAL PRIMARY KEY,
  character_id BIGINT REFERENCES characters(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL DEFAULT 1,
  bracket TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rating_snapshots
  ADD COLUMN IF NOT EXISTS season_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_snapshots_char_bracket
  ON rating_snapshots(character_id, bracket);
CREATE INDEX IF NOT EXISTS idx_snapshots_char_season_bracket
  ON rating_snapshots(character_id, season_id, bracket);
CREATE INDEX IF NOT EXISTS idx_snapshots_recorded
  ON rating_snapshots(recorded_at);

-- Latest snapshot per character/bracket/season (for efficient sync reads via PostgREST)
DROP VIEW IF EXISTS rating_snapshots_latest;
CREATE VIEW rating_snapshots_latest AS
SELECT DISTINCT ON (character_id, bracket, season_id)
  character_id,
  season_id,
  bracket,
  rating,
  won,
  lost,
  played,
  recorded_at
FROM rating_snapshots
ORDER BY character_id, bracket, season_id, recorded_at DESC;

-- RLS: public read, service-role write
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rating_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read characters"
  ON characters FOR SELECT TO anon USING (true);

CREATE POLICY "Public read snapshots"
  ON rating_snapshots FOR SELECT TO anon USING (true);

GRANT SELECT ON rating_snapshots_latest TO anon;

CREATE POLICY "Service insert characters"
  ON characters FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service update characters"
  ON characters FOR UPDATE TO service_role USING (true);

CREATE POLICY "Service insert snapshots"
  ON rating_snapshots FOR INSERT TO service_role WITH CHECK (true);

-- View: latest rating per character per bracket
DROP VIEW IF EXISTS leaderboard_latest;
CREATE VIEW leaderboard_latest AS
SELECT
  c.id AS character_id,
  c.name,
  c.realm,
  c.class,
  c.race,
  c.faction,
  c.guild,
  rs.season_id,
  rs.bracket,
  rs.rating,
  rs.won,
  rs.lost,
  rs.played,
  rs.recorded_at
FROM characters c
JOIN rating_snapshots rs ON rs.character_id = c.id
WHERE rs.id = (
  SELECT rs2.id
  FROM rating_snapshots rs2
  WHERE rs2.character_id = c.id
    AND rs2.bracket = rs.bracket
    AND rs2.season_id = rs.season_id
  ORDER BY rs2.recorded_at DESC
  LIMIT 1
);
