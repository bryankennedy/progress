// Wire types: the JSON-serialized shapes the API actually sends. Derived
// from the Drizzle row types (type-only import — no runtime ORM code reaches
// the client) with Date fields mapped to the ISO strings JSON produces.

import type {
  Activity,
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

// GET /api/workspace — the load-everything payload (SPEC §8.2, D20: comments
// and activity are excluded and load per issue page).
export type WorkspacePayload = {
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
