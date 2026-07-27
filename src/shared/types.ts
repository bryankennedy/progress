// Wire types: the JSON-serialized shapes the API actually sends. Derived
// from the Drizzle row types (type-only import — no runtime ORM code reaches
// the client) with Date fields mapped to the ISO strings JSON produces.

import type {
  Activity,
  AllowedEmail,
  Arc,
  Comment,
  CommitLink,
  Workspace,
  Action,
  ActionKeyAlias,
  ActionTag,
  PrLink,
  Focus,
  Tag,
  User,
} from "../db/schema";

export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

export type WireUser = Serialized<User>;
export type WireWorkspace = Serialized<Workspace>;
export type WireFocus = Serialized<Focus>;
export type WireArc = Serialized<Arc>;
export type WireAction = Serialized<Action>;
export type WireActionKeyAlias = Serialized<ActionKeyAlias>;
export type WireTag = Serialized<Tag>;
export type WireActionTag = Serialized<ActionTag>;
export type WireComment = Serialized<Comment>;
export type WireActivity = Serialized<Activity>;
export type WirePrLink = Serialized<PrLink>;
export type WireCommitLink = Serialized<CommitLink>;
export type WireAllowedEmail = Serialized<AllowedEmail>;

// Change cursors for background sync (PROG-128). Two opaque strings the client
// compares for equality — never parses. `snapshot` covers every table in the
// snapshot payload (row counts + max updated_at, so creates, edits, and
// deletes all move it); `timeline` covers the per-action data (comments,
// activity, PR/commit links). Served by GET /api/snapshot/version and embedded
// in the snapshot payload itself as the client's baseline.
export type SyncCursors = {
  snapshot: string;
  timeline: string;
};

// GET /api/snapshot — the load-everything payload (SPEC §8.2, D20: comments
// and activity are excluded and load per action page).
export type SnapshotPayload = {
  // The signed-in user (PROG-34). Null only in the unconfigured local-dev
  // path where the owner row may not be loaded; the client treats null as the
  // dev owner.
  me: WireUser | null;
  // Whether `me` may manage the sign-in allowlist (D44). Gates the Admin
  // nav link + page client-side; the API enforces independently.
  isSuperAdmin: boolean;
  // The runtime sign-in allowlist — populated only for super-admins; an empty
  // array for everyone else (the list is never shipped to non-admins).
  allowedEmails: WireAllowedEmail[];
  users: WireUser[];
  workspaces: WireWorkspace[];
  focuses: WireFocus[];
  arcs: WireArc[];
  actions: WireAction[];
  tags: WireTag[];
  actionTags: WireActionTag[];
  actionKeyAliases: WireActionKeyAlias[];
  // Baseline change cursors for background sync (PROG-128). Computed BEFORE
  // the table reads, so a write that lands mid-request makes the data newer
  // than the cursor — the next version poll then refetches (harmless) instead
  // of missing the change. Optional only for fixtures/older payload shapes.
  syncCursors?: SyncCursors;
};

// GET /api/search?q= — comment full-text search (PROG-130). Comments are the
// only searchable text NOT in the snapshot payload (D20), so they need a
// server round-trip; title/description search runs client-side over the store.
// A hit carries just the ids + a snippet — the client already holds the action,
// so it resolves the key/title/container itself.
export type CommentSearchHit = {
  commentId: string;
  actionId: string;
  // A window of the comment body around the first matched term, with leading/
  // trailing ellipses when truncated. The matched terms are highlighted on the
  // client (it knows the query); the server only frames the window.
  snippet: string;
};

export type CommentSearchResponse = {
  hits: CommentSearchHit[];
  // True when more matches exist beyond this page — the client may fetch the
  // next page with ?offset= (PROG-78) or say "more matches" (the `/` modal).
  truncated: boolean;
};
