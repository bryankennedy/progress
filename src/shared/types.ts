// Wire types: the JSON-serialized shapes the API actually sends. Derived
// from the Drizzle row types (type-only import — no runtime ORM code reaches
// the client) with Date fields mapped to the ISO strings JSON produces.

import type {
  Activity,
  AllowedEmail,
  Arc,
  Comment,
  CommitLink,
  Initiative,
  Issue,
  IssueKeyAlias,
  IssueTag,
  PrLink,
  Product,
  Repo,
  Tag,
  User,
} from "../db/schema";

export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

export type WireUser = Serialized<User>;
export type WireInitiative = Serialized<Initiative>;
export type WireProduct = Serialized<Product>;
export type WireRepo = Serialized<Repo>;
export type WireArc = Serialized<Arc>;
export type WireIssue = Serialized<Issue>;
export type WireIssueKeyAlias = Serialized<IssueKeyAlias>;
export type WireTag = Serialized<Tag>;
export type WireIssueTag = Serialized<IssueTag>;
export type WireComment = Serialized<Comment>;
export type WireActivity = Serialized<Activity>;
export type WirePrLink = Serialized<PrLink>;
export type WireCommitLink = Serialized<CommitLink>;
export type WireAllowedEmail = Serialized<AllowedEmail>;

// GET /api/workspace — the load-everything payload (SPEC §8.2, D20: comments
// and activity are excluded and load per issue page).
export type WorkspacePayload = {
  // The signed-in user (PROG-34). Null only in the unconfigured local-dev
  // path where the owner row may not be loaded; the client treats null as the
  // dev owner.
  me: WireUser | null;
  // Whether `me` may manage the sign-in allowlist (D43). Gates the Admin
  // nav link + page client-side; the API enforces independently.
  isSuperAdmin: boolean;
  // The runtime sign-in allowlist — populated only for super-admins; an empty
  // array for everyone else (the list is never shipped to non-admins).
  allowedEmails: WireAllowedEmail[];
  users: WireUser[];
  initiatives: WireInitiative[];
  products: WireProduct[];
  repos: WireRepo[];
  arcs: WireArc[];
  issues: WireIssue[];
  tags: WireTag[];
  issueTags: WireIssueTag[];
  issueKeyAliases: WireIssueKeyAlias[];
};
