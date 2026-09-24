BEGIN;

-- Pelosi admin users.
--
-- Passwords are stored as bcrypt hashes only; no plain-text passwords and no
-- seeded users live in this migration. Create the two trusted admins with
-- `npm run create-admin-user` inside apps/web.
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Emails are stored lowercase so the unique constraint is effectively
    -- case-insensitive and login lookup is deterministic.
    CONSTRAINT chk_users_email_lowercase
        CHECK (email = LOWER(email)),

    CONSTRAINT chk_users_email_format
        CHECK (position('@' IN email) > 1),

    CONSTRAINT chk_users_password_hash
        CHECK (length(password_hash) > 0)
);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Server-side session storage used by express-session through
-- connect-pg-simple. This is the store's default schema (`session` table with
-- sid/sess/expire) so sessions survive server restarts and are never kept in
-- process memory.
CREATE TABLE session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,

    CONSTRAINT session_pkey
        PRIMARY KEY (sid)
        NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX idx_session_expire
ON session (expire);

COMMIT;

