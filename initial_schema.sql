BEGIN;

CREATE TABLE data_sources (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    source_team_id VARCHAR(100) NOT NULL,
    sport_id BIGINT NOT NULL,
    name VARCHAR(150) NOT NULL,
    country VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_team_source
        FOREIGN KEY (source_id)
        REFERENCES data_sources(id),

    CONSTRAINT fk_team_sport
        FOREIGN KEY (sport_id)
        REFERENCES sports(id),

    CONSTRAINT uq_source_team
        UNIQUE (source_id, source_team_id)
);

CREATE TABLE competitions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    source_competition_id VARCHAR(100) NOT NULL,
    sport_id BIGINT NOT NULL,
    name VARCHAR(150) NOT NULL,
    country VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_comp_source
        FOREIGN KEY (source_id)
        REFERENCES data_sources(id),

    CONSTRAINT fk_comp_sport
        FOREIGN KEY (sport_id)
        REFERENCES sports(id),

    CONSTRAINT uq_source_competition
        UNIQUE (source_id, source_competition_id)
);

CREATE TABLE matches (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT NOT NULL,
    source_match_id VARCHAR(100) NOT NULL,
    sport_id BIGINT NOT NULL,
    competition_id BIGINT,
    home_team_id BIGINT NOT NULL,
    away_team_id BIGINT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_match_source
        FOREIGN KEY (source_id)
        REFERENCES data_sources(id),

    CONSTRAINT fk_match_sport
        FOREIGN KEY (sport_id)
        REFERENCES sports(id),

    CONSTRAINT fk_match_competition
        FOREIGN KEY (competition_id)
        REFERENCES competitions(id),

    CONSTRAINT fk_match_home_team
        FOREIGN KEY (home_team_id)
        REFERENCES teams(id),

    CONSTRAINT fk_match_away_team
        FOREIGN KEY (away_team_id)
        REFERENCES teams(id),

    CONSTRAINT uq_source_match
        UNIQUE (source_id, source_match_id),

    CONSTRAINT chk_different_teams
        CHECK (home_team_id <> away_team_id),

    CONSTRAINT chk_match_status
        CHECK (
            status IN (
                'scheduled',
                'live',
                'finished',
                'postponed',
                'cancelled'
            )
        ),

    CONSTRAINT chk_match_scores
        CHECK (
            (home_score IS NULL OR home_score >= 0)
            AND (away_score IS NULL OR away_score >= 0)
        )
);

CREATE TABLE tips (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    match_id BIGINT NOT NULL,
    source_odds_id VARCHAR(150),
    source_market_id VARCHAR(150),
    source_selection_id VARCHAR(150),
    market_code VARCHAR(100) NOT NULL,
    market_name VARCHAR(150),
    selection_code VARCHAR(100) NOT NULL,
    selection_name VARCHAR(150),
    line NUMERIC(10,3),
    odds NUMERIC(12,4) NOT NULL,
    result VARCHAR(20) NOT NULL DEFAULT 'pending',
    creation_type VARCHAR(20) NOT NULL DEFAULT 'manual',
    odds_captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_tip_match
        FOREIGN KEY (match_id)
        REFERENCES matches(id),

    CONSTRAINT chk_tip_odds
        CHECK (odds > 1),

    CONSTRAINT chk_tip_result
        CHECK (
            result IN (
                'pending',
                'won',
                'lost',
                'void'
            )
        ),

    CONSTRAINT chk_tip_creation
        CHECK (
            creation_type IN (
                'manual',
                'automatic'
            )
        )
);

CREATE TABLE slips (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(150),
    slip_date DATE NOT NULL,
    total_odds NUMERIC(12,4) NOT NULL,
    stake_units NUMERIC(12,4) NOT NULL DEFAULT 1.0000,
    result VARCHAR(20) NOT NULL DEFAULT 'pending',
    return_units NUMERIC(14,4),
    profit_units NUMERIC(14,4),
    creation_type VARCHAR(20) NOT NULL DEFAULT 'manual',
    publication_status VARCHAR(20) NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_slip_odds
        CHECK (total_odds > 1),

    CONSTRAINT chk_stake_units
        CHECK (stake_units > 0),

    CONSTRAINT chk_slip_result
        CHECK (
            result IN (
                'pending',
                'won',
                'lost',
                'void'
            )
        ),

    CONSTRAINT chk_slip_creation
        CHECK (
            creation_type IN (
                'manual',
                'automatic'
            )
        ),

    CONSTRAINT chk_publication_status
        CHECK (
            publication_status IN (
                'draft',
                'published',
                'hidden'
            )
        ),

    CONSTRAINT chk_slip_money_by_result
        CHECK (
            (
                result = 'pending'
                AND return_units IS NULL
                AND profit_units IS NULL
                AND settled_at IS NULL
            )
            OR (
                result = 'won'
                AND return_units IS NOT NULL
                AND profit_units IS NOT NULL
                AND return_units > 0
            )
            OR (
                result = 'lost'
                AND return_units = 0
                AND profit_units = -stake_units
            )
            OR (
                result = 'void'
                AND return_units = stake_units
                AND profit_units = 0
            )
        )
);

CREATE TABLE slip_tips (
    slip_id BIGINT NOT NULL,
    tip_id BIGINT NOT NULL,
    leg_order SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (slip_id, tip_id),

    CONSTRAINT fk_slip_tip_slip
        FOREIGN KEY (slip_id)
        REFERENCES slips(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_slip_tip_tip
        FOREIGN KEY (tip_id)
        REFERENCES tips(id),

    CONSTRAINT uq_slip_leg_order
        UNIQUE (slip_id, leg_order),

    CONSTRAINT chk_leg_order
        CHECK (leg_order > 0)
);

CREATE INDEX idx_teams_source_sport_name
ON teams(source_id, sport_id, name);

CREATE INDEX idx_competitions_source_sport_name
ON competitions(source_id, sport_id, name);

CREATE INDEX idx_matches_starts_at
ON matches(starts_at);

CREATE INDEX idx_matches_competition
ON matches(competition_id);

CREATE INDEX idx_matches_home_team
ON matches(home_team_id);

CREATE INDEX idx_matches_away_team
ON matches(away_team_id);

CREATE INDEX idx_matches_status
ON matches(status);

CREATE INDEX idx_tips_match
ON tips(match_id);

CREATE INDEX idx_tips_result
ON tips(result);

CREATE INDEX idx_tips_market
ON tips(market_code);

CREATE INDEX idx_tips_published
ON tips(published_at);

CREATE INDEX idx_tips_creation_type
ON tips(creation_type);

CREATE INDEX idx_slips_result
ON slips(result);

CREATE INDEX idx_slips_slip_date
ON slips(slip_date);

CREATE INDEX idx_slips_published
ON slips(published_at);

CREATE INDEX idx_slips_publication_status
ON slips(publication_status);

CREATE INDEX idx_slips_creation_type
ON slips(creation_type);

CREATE INDEX idx_slip_tips_tip
ON slip_tips(tip_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_data_sources_updated_at
BEFORE UPDATE ON data_sources
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sports_updated_at
BEFORE UPDATE ON sports
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_teams_updated_at
BEFORE UPDATE ON teams
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_competitions_updated_at
BEFORE UPDATE ON competitions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_matches_updated_at
BEFORE UPDATE ON matches
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tips_updated_at
BEFORE UPDATE ON tips
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_slips_updated_at
BEFORE UPDATE ON slips
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO data_sources (code, name)
VALUES ('trueodds', 'TrueOdds')
ON CONFLICT (code) DO NOTHING;

INSERT INTO sports (code, name)
VALUES ('football', 'Football')
ON CONFLICT (code) DO NOTHING;

COMMIT;
