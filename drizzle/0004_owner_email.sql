-- PROG-34: repoint the seeded owner row to the real owner identity so that
-- Google sign-in (matched by email) resolves to the EXISTING user, preserving
-- all historical attribution instead of creating a duplicate. Data-only — no
-- schema change (the users table is already multi-user-ready, D13).
UPDATE `users` SET `email` = 'bryan@mysteryexperience.com', `name` = 'Bryan' WHERE `id` = 'usr_owner';
