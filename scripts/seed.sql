-- Idempotent seed (INSERT OR IGNORE throughout — safe to re-run).
-- Fixture ids deliberately keep their pre-PROG-98 prefixes (ini_/prd_/iss_):
-- ids are opaque, and existing local databases already hold these exact rows —
-- re-minting them under new prefixes would duplicate instead of no-op.
-- Placeholder owner identity: the repo is public, so no real name/email here.
-- Update the row locally (or re-seed after editing) with real details if desired.
INSERT OR IGNORE INTO users (id, name, email, created_at)
VALUES ('usr_owner', 'Owner', 'owner@example.com', unixepoch());

-- Dogfood data: Progress's own v1 backlog (SPEC §7 — v1 is done when this
-- lives in Progress itself). All content is already public in docs/SPEC.md.

INSERT OR IGNORE INTO workspaces (id, name, description, creator_id, created_at, updated_at)
VALUES ('ini_tooling', 'Personal Tooling',
        'Tools that remove friction from building products.',
        'usr_owner', unixepoch(), unixepoch());

-- The focus optionally mirrors a git repo (PROG-102): git_url is the field
-- that replaced the former `repos` container. NULL = not connected.
INSERT OR IGNORE INTO focuses (id, workspace_id, name, description, git_url, key_prefix, next_action_number, creator_id, created_at, updated_at)
VALUES ('prd_progress', 'ini_tooling', 'Progress',
        'A personal product-development tracker — this very app.',
        NULL, 'PROG', 15, 'usr_owner', unixepoch(), unixepoch());

INSERT OR IGNORE INTO arcs (id, focus_id, name, description, creator_id, created_at, updated_at)
VALUES
  ('arc_v1core', 'prd_progress', 'v1 Core',
   'Schema, snapshot load, client store, and the views that make Progress usable day to day.',
   'usr_owner', unixepoch(), unixepoch()),
  ('arc_gitint', 'prd_progress', 'Git Integration',
   'GitHub webhook, magic-word linking, PR/commit display on actions.',
   'usr_owner', unixepoch(), unixepoch());

-- Actions. Keys derive as PROG-<number>. (Pre-PROG-102 this fixture put code
-- work at repo level; repos are gone now, so every action is focus-level.)
INSERT OR IGNORE INTO actions (id, focus_id, arc_id, number, title, description, status, priority, estimate, creator_id, assignee_id, created_at, updated_at, completed_at)
VALUES
  ('iss_prog1',  'prd_progress', 'arc_v1core', 1,
   'Scaffold single-app stack with walking skeleton',
   'Vite + React + Tailwind + Hono + D1/Drizzle in one app; end-to-end round trip verified (milestone 1).',
   'done', 'high', 3, 'usr_owner', 'usr_owner', unixepoch(), unixepoch(), unixepoch()),
  ('iss_prog2',  'prd_progress', 'arc_v1core', 2,
   'Full domain schema',
   'All SPEC §3 entities in Drizzle: workspaces, focuses, arcs, actions, tags, key aliases, comments, activity.',
   'in_progress', 'high', 3, 'usr_owner', 'usr_owner', unixepoch(), unixepoch(), NULL),
  ('iss_prog3',  'prd_progress', 'arc_v1core', 3,
   'Whole-snapshot load endpoint',
   'Single /api/snapshot payload with every container, action, and tag (SPEC §8.2 — load everything up front).',
   'todo', 'high', 2, 'usr_owner', 'usr_owner', unixepoch(), unixepoch(), NULL),
  ('iss_prog4',  'prd_progress', 'arc_v1core', 4,
   'Client store with optimistic mutations',
   'Decide store library with a latency spike (SPEC §9 #4), then render everything from memory; establish the optimistic-mutation template.',
   'todo', 'high', 5, 'usr_owner', 'usr_owner', unixepoch(), unixepoch(), NULL),
  ('iss_prog5',  'prd_progress', 'arc_v1core', 5,
   'Global "My Work" kanban board',
   'Fixed status columns, drag-and-drop, filters by workspace/focus/arc/tag/priority.',
   'backlog', 'medium', 5, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog6',  'prd_progress', 'arc_v1core', 6,
   'Container pages',
   'Workspace, focus, and arc pages: description on top, sortable/filterable action list below.',
   'backlog', 'medium', 3, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog7',  'prd_progress', 'arc_v1core', 7,
   'Action page with comments and activity',
   'Open-page view: Markdown description, field strip, interleaved comments + activity timeline.',
   'backlog', 'medium', 5, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog8',  'prd_progress', 'arc_v1core', 8,
   'Command palette (⌘K)',
   'Jump to anything, create an action from anywhere.',
   'backlog', 'low', 3, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog9',  'prd_progress', 'arc_v1core', 9,
   'Single-key actions on focused action',
   'Linear-style: s = status, p = priority; exact map decided during build.',
   'backlog', 'low', 2, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog10', 'prd_progress', 'arc_v1core', 10,
   'Action movement with key-alias redirects',
   'Move actions between focuses; cross-focus moves re-key and leave a permanent alias.',
   'backlog', 'medium', 3, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog11', 'prd_progress', 'arc_gitint', 11,
   'GitHub webhook with magic-word linking',
   'Push + PR events; action keys in branch/commit/PR text auto-link to the action. HMAC-verified, bypasses Access.',
   'backlog', 'medium', 5, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog12', 'prd_progress', NULL, 12,
   'Cloudflare Access in front of production',
   'Owner login via Access; no auth code in the app (SPEC §8.3).',
   'backlog', 'medium', 1, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog13', 'prd_progress', NULL, 13,
   'Production deploy',
   'Create the real D1 database, set its id in wrangler.jsonc, wrangler deploy.',
   'backlog', 'medium', 2, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL),
  ('iss_prog14', 'prd_progress', 'arc_v1core', 14,
   'Mobile responsive pass',
   'Board scrolls horizontally, action pages reflow; genuinely usable on a phone.',
   'backlog', 'low', 3, 'usr_owner', NULL, unixepoch(), unixepoch(), NULL);

-- Board ranks (PROG-43): the inserts above leave `rank` at its "" default;
-- assign canonical fractional-index keys by action number, exactly as migration
-- 0005 backfills production. Width-12 decimal, offset +1 so a key never ends in
-- "0". Idempotent: only fills rows still at the default.
UPDATE actions SET rank = printf('%012d', number * 1000 + 1) WHERE rank = '';

-- Tags (colors from the standard palette).
INSERT OR IGNORE INTO tags (id, name, color, created_at)
VALUES
  ('tag_infra', 'infra', '#546EB4', unixepoch()),
  ('tag_ux',    'ux',    '#F08B23', unixepoch()),
  ('tag_speed', 'speed', '#06A7E0', unixepoch());

INSERT OR IGNORE INTO action_tags (action_id, tag_id)
VALUES
  ('iss_prog1',  'tag_infra'),
  ('iss_prog2',  'tag_infra'),
  ('iss_prog4',  'tag_speed'),
  ('iss_prog5',  'tag_ux'),
  ('iss_prog7',  'tag_ux'),
  ('iss_prog12', 'tag_infra'),
  ('iss_prog13', 'tag_infra'),
  ('iss_prog14', 'tag_ux');

INSERT OR IGNORE INTO comments (id, action_id, author_id, body, created_at, updated_at)
VALUES
  ('cmt_1', 'iss_prog1', 'usr_owner',
   'Round trip verified: D1 → Drizzle → Hono → React on one dev server. See docs/SETUP.md.',
   unixepoch(), unixepoch()),
  ('cmt_2', 'iss_prog2', 'usr_owner',
   'Container model decided: focus_id is the sole container; a focus optionally carries a git_url (PROG-102). See DECISIONS.md.',
   unixepoch(), unixepoch());

INSERT OR IGNORE INTO activity (id, action_id, actor_id, type, data, created_at)
VALUES
  ('act_1', 'iss_prog1', 'usr_owner', 'status_changed',
   '{"from":"in_progress","to":"done"}', unixepoch()),
  ('act_2', 'iss_prog2', 'usr_owner', 'status_changed',
   '{"from":"todo","to":"in_progress"}', unixepoch());
