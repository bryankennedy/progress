-- Idempotent seed: the single owner user (D13 — multi-user-ready schema, one row in v1).
-- Placeholder identity: the repo is public, so no real name/email here. Update
-- the row locally (or re-seed after editing) with real details if desired.
INSERT OR IGNORE INTO users (id, name, email, created_at)
VALUES ('usr_owner', 'Owner', 'owner@example.com', unixepoch());
