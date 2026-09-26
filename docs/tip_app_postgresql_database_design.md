# Tip App PostgreSQL Database Design

## Project Naming

PELOSI is the public customer-facing product name for the website and member
experience, as well as the internal software platform, repository and backend
name. Database object names, internal services, developer docs, public website
copy, page titles and customer/member UI should use PELOSI.

## Overview

The core architecture is:

```text
SOURCE DATA (TrueOdds / old DB)
        ↓
      teams
        ↓
     matches
        ↓
       tips           ← individual selections/legs
        ↓
    slip_tips         ← bridge
        ↓
      slips           ← actual 1-unit wagers + ROI/profit
```

The most important accounting rule is:

> A tip can win or lose, but money is won or lost at the slip level.

So `tips` track prediction results. `slips` track stake, return, profit and ROI.

---

# 1. `data_sources`

You said the data will come from your existing/TrueOdds database. I would not hard-code that assumption into every table.

```sql
CREATE TABLE data_sources (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);
```

Example:

| id | code | name |
|---:|---|---|
| 1 | trueodds | TrueOdds |

This means later you could theoretically import another provider without ID collisions.

---

# 2. `sports`

Even if you initially launch with football, I would make this multi-sport from day one.

```sql
CREATE TABLE sports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);
```

Example:

| id | code | name |
|---:|---|---|
| 1 | football | Football |
| 2 | basketball | Basketball |

---

# 3. `teams`

This is the team-ID idea you brought up.

```sql
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
```

Example:

| id | source_id | source_team_id | sport_id | name | country |
|---:|---:|---|---:|---|---|
| 1 | 1 | 1001 | 1 | Chelsea | England |
| 2 | 1 | 1002 | 1 | Arsenal | England |
| 3 | 1 | 1003 | 1 | Barcelona | Spain |

The distinction is important:

```text
id
= your tip application's ID

source_team_id
= TrueOdds / source database ID
```

---

# 4. `competitions`

Don't store `"Premier League"` repeatedly inside every match.

```sql
CREATE TABLE competitions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    source_id BIGINT NOT NULL,
    source_competition_id VARCHAR(100) NOT NULL,

    sport_id BIGINT NOT NULL,

    name VARCHAR(150) NOT NULL,
    country VARCHAR(100),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_comp_source
        FOREIGN KEY (source_id)
        REFERENCES data_sources(id),

    CONSTRAINT fk_comp_sport
        FOREIGN KEY (sport_id)
        REFERENCES sports(id),

    CONSTRAINT uq_source_competition
        UNIQUE (source_id, source_competition_id)
);
```

Example:

| id | source_competition_id | name | country |
|---:|---|---|---|
| 1 | 2001 | Premier League | England |
| 2 | 2002 | La Liga | Spain |
| 3 | 2003 | Serie A | Italy |

---

# 5. `matches`

Now we store the actual event.

```sql
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
        )
);
```

Example:

| id | source_match_id | home_team_id | away_team_id | competition_id | status |
|---:|---|---:|---:|---:|---|
| 1 | 845001 | 1 Chelsea | 2 Arsenal | 1 | scheduled |
| 2 | 845002 | 3 Barcelona | 4 Sevilla | 2 | scheduled |

Notice:

**No betting result exists here.**

The match itself doesn't win or lose.

---

# 6. `tips`

This is where a betting selection is created.

This table is extremely important.

```sql
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
```

Now you can represent markets properly.

Chelsea win:

```text
match_id       = 1
market_code    = MATCH_RESULT
selection_code = HOME
line           = NULL
odds           = 1.75
```

Over 2.5:

```text
market_code    = TOTAL_GOALS
selection_code = OVER
line           = 2.5
odds           = 1.60
```

Chelsea +1.5:

```text
market_code    = HANDICAP
selection_code = HOME
line           = 1.5
odds           = 1.40
```

This is cleaner than storing:

```text
OVER_2_5
HOME_PLUS_1_5
```

everywhere.

## Example `tips`

| id | match_id | market | selection | line | odds | result |
|---:|---:|---|---|---:|---:|---|
| 1 | 1 | MATCH_RESULT | HOME | NULL | 1.75 | pending |
| 2 | 2 | TOTAL_GOALS | OVER | 2.5 | 1.60 | pending |
| 3 | 3 | MATCH_RESULT | HOME | NULL | 1.55 | pending |
| 4 | 4 | MATCH_RESULT | HOME | NULL | 1.50 | pending |
| 5 | 5 | TOTAL_GOALS | OVER | 2.5 | 1.40 | pending |

**No `profit_units` here.**

That was the correction you identified.

---

# 7. `slips`

This is the financial/performance table.

```sql
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
        )
);
```

This is where your **1 unit** rule lives.

For normal bets:

```text
stake_units = 1
```

Example:

| id | total_odds | stake_units | result | return_units | profit_units |
|---:|---:|---:|---|---:|---:|
| 1 | 2.80 | 1.00 | won | 2.80 | +1.80 |
| 2 | 3.26 | 1.00 | lost | 0.00 | -1.00 |

That captures exactly what you described.

Slip 1:

```text
Stake = 1u
Odds = 2.80

Return = 2.80u
Profit = +1.80u
```

Slip 2:

```text
Stake = 1u
Lost

Return = 0
Profit = -1u
```

I deliberately keep `stake_units` even though currently every slip is `1u`.

Your application can enforce:

```js
stakeUnits = 1;
```

for every normal slip.

But the database isn't painted into a corner if your product changes later.

---

# 8. `slip_tips`

This is the bridge table.

I would improve our earlier version slightly.

We don't actually need another `id`.

```sql
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
```

The `leg_order` field is useful for displaying the slip in the same order you created it.

Example:

| slip_id | tip_id | leg_order |
|---:|---:|---:|
| 1 | 1 | 1 |
| 1 | 2 | 2 |
| 2 | 3 | 1 |
| 2 | 4 | 2 |
| 2 | 5 | 3 |

That produces:

```text
SLIP 1
──────

Tip 1
Chelsea Win @ 1.75

Tip 2
Barcelona Over 2.5 @ 1.60

Total odds = 2.80
Stake = 1u
```

And:

```text
SLIP 2
──────

Tip 3
Liverpool Win @ 1.55

Tip 4
Inter Win @ 1.50

Tip 5
Bayern Over 2.5 @ 1.40

Total odds = 3.255
Stake = 1u
```

---

# The complete relationship

```text
data_sources
     │
     ├─────────────┐
     ↓             ↓
   teams       competitions
     │             │
     └──────┬──────┘
            ↓
          matches
            │
            │ 1:N
            ↓
           tips
            │
            │ N:M
            ↓
       slip_tips
            │
            ↓
          slips
```

This is the core design I would actually build.

---

# How creating a manual slip works

Suppose in your admin interface you search:

```text
Chelsea
```

Your **source/TrueOdds database** returns:

```text
Chelsea vs Arsenal
Chelsea @ 1.75
Draw @ 3.60
Arsenal @ 4.40
Over 2.5 @ 1.60
...
```

You choose:

```text
Chelsea Win @ 1.75
```

Your backend should perform the operation in this order:

```text
TrueOdds
   ↓
Find/upsert Chelsea team
   ↓
Find/upsert Arsenal team
   ↓
Find/upsert competition
   ↓
Find/upsert match
   ↓
Create tip with odds snapshot 1.75
   ↓
Attach tip to slip
```

Then you search another match and repeat.

When finished:

```text
Slip 1
├── tip 1
└── tip 2
```

The backend calculates:

```text
1.75 × 1.60 = 2.80
```

and writes:

```text
slips.total_odds = 2.80
slips.stake_units = 1
```

---

# Publishing

Before publication:

```text
publication_status = draft
```

When you press:

```text
Publish Slip
```

the backend changes:

```text
publication_status = published
published_at = NOW()
```

I consider `published_at` very important for a public tip platform.

It gives followers an audit trail proving the tip existed before the match.

---

# Settling individual tips

Imagine:

```text
Chelsea 2-1 Arsenal
```

Your settlement code sees:

```text
market = MATCH_RESULT
selection = HOME
```

So:

```text
tips.result = won
tips.settled_at = NOW()
```

Barcelona finishes 3-1:

```text
TOTAL_GOALS
OVER
2.5
```

also:

```text
result = won
```

Then Slip 1 has:

```text
Tip 1 = won
Tip 2 = won
```

Therefore:

```text
slips.result = won
```

And because:

```text
stake = 1
odds = 2.80
```

the settlement becomes:

```text
return_units = 2.80
profit_units = 1.80
```

---

# If one selection loses

Suppose Slip 2 contains:

```text
Liverpool → WON
Inter → LOST
Bayern → WON
```

The slip becomes:

```text
result = lost
return_units = 0
profit_units = -1
```

That's why **profit belongs to the slip**, not the individual tips.

---

# ROI

You do **not need a performance table** for normal reporting.

Your slips are already the accounting ledger.

Suppose after 100 settled slips:

```text
Total stake = 100u
Profit = +14.30u
```

Then:

```text
ROI = profit / stake × 100

ROI = 14.30 / 100 × 100

ROI = 14.30%
```

PostgreSQL:

```sql
SELECT
    COUNT(*) AS total_bets,

    COUNT(*) FILTER (
        WHERE result = 'won'
    ) AS wins,

    COUNT(*) FILTER (
        WHERE result = 'lost'
    ) AS losses,

    SUM(stake_units) FILTER (
        WHERE result IN ('won', 'lost')
    ) AS units_staked,

    SUM(profit_units) FILTER (
        WHERE result IN ('won', 'lost')
    ) AS profit_units,

    ROUND(
        (
            SUM(profit_units) FILTER (
                WHERE result IN ('won', 'lost')
            )
            /
            NULLIF(
                SUM(stake_units) FILTER (
                    WHERE result IN ('won', 'lost')
                ),
                0
            )
        ) * 100,
        2
    ) AS roi_percentage

FROM slips
WHERE publication_status = 'published';
```

That aggregate is implemented today in
`apps/web/src/repositories/performance-repository.js` and exposed as
`GET /api/v1/performance`. Only published slips with `result IN ('won', 'lost')`
are counted, so drafts, hidden slips, pending slips and void slips stay out of
the financial metrics. See
[`slip_publication_and_performance.md`](./slip_publication_and_performance.md).

Your follower dashboard could then show:

```text
PERFORMANCE

Slips             100
Won                48
Lost               52

Units staked      100u
Profit          +14.30u

ROI              +14.30%
```

Notice something important:

**48% win rate can still make money.**

If the average winning odds are sufficiently high, ROI can remain positive.

Therefore both should be shown:

```text
Win rate
ROI
Profit units
Average odds
Number of bets
```

---

# Tip performance vs financial performance

There are actually **two different types of performance** in your app.

For the tips you can measure prediction accuracy:

```text
500 selections

340 won
160 lost

Tip accuracy = 68%
```

You can analyze:

```text
Over 2.5 accuracy
BTTS accuracy
Home win accuracy
Premier League accuracy
Automatic vs manual accuracy
```

But the actual **financial ROI** should come from:

```text
slips
```

because that is where the 1-unit stake exists.

That distinction is very important.

---

# Useful PostgreSQL indexes

Once the tables exist, I would add:

```sql
CREATE INDEX idx_matches_starts_at
ON matches(starts_at);

CREATE INDEX idx_matches_competition
ON matches(competition_id);

CREATE INDEX idx_matches_home_team
ON matches(home_team_id);

CREATE INDEX idx_matches_away_team
ON matches(away_team_id);

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

CREATE INDEX idx_slips_creation_type
ON slips(creation_type);

CREATE INDEX idx_slip_tips_tip
ON slip_tips(tip_id);
```

---

# One important rule for your odds

Once a tip is published:

```text
Chelsea @ 1.85
```

**never change that `1.85`.**

Even if TrueOdds later changes to:

```text
Chelsea @ 1.62
```

your database must retain:

```text
tips.odds = 1.85
```

because that is the price your follower was given and the price used for your published performance.

Your TrueOdds database can continue recording the full odds movement separately.

Your tip database only needs the **snapshot used by the published tip**.

---

# Final core database

So the version I would use is:

| Table | Purpose |
|---|---|
| `data_sources` | Identifies TrueOdds or future data sources |
| `sports` | Football, basketball, etc. |
| `teams` | Team identity |
| `competitions` | Premier League, La Liga, etc. |
| `matches` | Actual sporting events |
| `tips` | Individual betting selections |
| `slips` | Actual bets, stake, profit and performance |
| `slip_tips` | Connects selections to slips |

I would **not** create these as separate stored tables:

```text
ROI
performance
win_rate
total_wins
total_losses
```

Those should be calculated from your historical `slips` and `tips`. That prevents performance statistics from drifting out of sync with the underlying betting history.

And the architectural distinction I would preserve throughout the application is:

```text
MATCH
What happened in the sporting event?

TIP
Did this particular selection win?

SLIP
Did the actual 1-unit wager win, and how much did it make?

PERFORMANCE
What do all historical slips tell us about ROI and profitability?
```

That gives you a clean PostgreSQL foundation for the app you described, including both **manual and automatic creation**, reliable historical odds snapshots, public performance tracking, 1-unit accounting, and enough flexibility to extend the staking model later without rebuilding the match/tip/slip structure.
