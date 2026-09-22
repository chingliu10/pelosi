BEGIN;

-- A TrueOdds selection is identified by the local match plus the stable
-- `tips.source_odds_id` (TrueOdds `event_odds_id` / v1 `sourceOddsId`).
-- Importing the same selection again must not create a second tip row.
--
-- The index is partial because two legacy dev tips have no source_odds_id and
-- those rows must stay valid.
--
-- Verified before adding: no (match_id, source_odds_id) group had more than one
-- row at migration time.
CREATE UNIQUE INDEX uq_tips_match_source_odds
ON tips (match_id, source_odds_id)
WHERE source_odds_id IS NOT NULL;

COMMIT;
