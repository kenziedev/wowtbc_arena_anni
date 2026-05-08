BEGIN;

ALTER TABLE rating_snapshots
  ADD COLUMN IF NOT EXISTS season_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_snapshots_char_season_bracket
  ON rating_snapshots(character_id, season_id, bracket);

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

GRANT SELECT ON rating_snapshots_latest TO anon;

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

COMMIT;
