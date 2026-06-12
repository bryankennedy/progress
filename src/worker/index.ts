import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  activity,
  arcs,
  comments,
  initiatives,
  ISSUE_ESTIMATES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  issueKeyAliases,
  issues,
  issueTags,
  products,
  repos,
  tags,
  users,
  type IssuePriority,
  type IssueStatus,
} from "../db/schema";
import { tagColor } from "../shared/constants";

type Bindings = {
  DB: D1Database;
};

// Single-user v1: every write is attributed to the owner row the seed
// guarantees (D13). Replaced by real auth context when multi-user lands.
const OWNER_ID = "usr_owner";

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// The single "load everything" endpoint that feeds the client store
// (SPEC §8.2: fetch the full workspace up front, render from memory after).
// Comments and activity are deliberately excluded — they're the only
// unbounded-growth data and aren't needed to render boards/lists; the issue
// page loads them per issue.
app.get("/api/workspace", async (c) => {
  const db = drizzle(c.env.DB);
  const [
    allUsers,
    allInitiatives,
    allProducts,
    allRepos,
    allArcs,
    allIssues,
    allTags,
    allIssueTags,
    allKeyAliases,
  ] = await db.batch([
    db.select().from(users),
    db.select().from(initiatives),
    db.select().from(products),
    db.select().from(repos),
    db.select().from(arcs),
    db.select().from(issues),
    db.select().from(tags),
    db.select().from(issueTags),
    db.select().from(issueKeyAliases),
  ]);
  return c.json({
    users: allUsers,
    initiatives: allInitiatives,
    products: allProducts,
    repos: allRepos,
    arcs: allArcs,
    issues: allIssues,
    tags: allTags,
    issueTags: allIssueTags,
    issueKeyAliases: allKeyAliases,
  });
});

// ---------- container CRUD (D26) ----------

type ContainerBody = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  initiativeId?: unknown;
  productId?: unknown;
  keyPrefix?: unknown;
  gitUrl?: unknown;
  archived?: unknown;
};

// Letters only: a digit in the prefix would break PREFIX-n key parsing.
const KEY_PREFIX_RE = /^[A-Z]{2,8}$/;

const badName = (name: unknown) => typeof name !== "string" || name.trim() === "";

// Container ids may be client-generated (D26: the store creates the row
// optimistically and navigates to /type/:id immediately, so the id must not
// change on reconcile). Anything malformed falls back to a server id.
const idOr = (id: unknown, prefix: string) =>
  typeof id === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id) ? id : newId(prefix);

// Shared PATCH fields for all four container types; archive/unarchive is the
// `archived` boolean mapped onto archivedAt (SPEC §3: no hard deletes).
function containerPatchSet(body: ContainerBody): { set: Record<string, unknown>; error?: string } {
  const set: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (badName(body.name)) return { set, error: "name must be a non-empty string" };
    set.name = (body.name as string).trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return { set, error: "description must be a string" };
    set.description = body.description;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") return { set, error: "archived must be a boolean" };
    set.archivedAt = body.archived ? new Date() : null;
  }
  return { set };
}

app.post("/api/initiatives", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  const now = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .insert(initiatives)
    .values({
      id: idOr(body.id, "ini"),
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      creatorId: OWNER_ID,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.post("/api/products", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  if (typeof body.keyPrefix !== "string" || !KEY_PREFIX_RE.test(body.keyPrefix.toUpperCase()))
    return c.json({ error: "keyPrefix must be 2–8 letters" }, 400);
  const keyPrefix = body.keyPrefix.toUpperCase();
  if (typeof body.initiativeId !== "string")
    return c.json({ error: "initiativeId is required" }, 400);

  const db = drizzle(c.env.DB);
  const [initiative] = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.id, body.initiativeId))
    .limit(1);
  if (!initiative) return c.json({ error: "initiative not found" }, 400);
  const [clash] = await db.select().from(products).where(eq(products.keyPrefix, keyPrefix)).limit(1);
  if (clash) return c.json({ error: `key prefix ${keyPrefix} is already in use` }, 409);

  const now = new Date();
  const [container] = await db
    .insert(products)
    .values({
      id: idOr(body.id, "prd"),
      initiativeId: body.initiativeId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      keyPrefix,
      creatorId: OWNER_ID,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.post("/api/repos", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  if (typeof body.productId !== "string") return c.json({ error: "productId is required" }, 400);
  const gitUrl = body.gitUrl ?? null;
  if (gitUrl !== null && typeof gitUrl !== "string")
    return c.json({ error: "gitUrl must be a string or null" }, 400);

  const db = drizzle(c.env.DB);
  const [product] = await db.select().from(products).where(eq(products.id, body.productId)).limit(1);
  if (!product) return c.json({ error: "product not found" }, 400);

  const now = new Date();
  const [container] = await db
    .insert(repos)
    .values({
      id: idOr(body.id, "rep"),
      productId: body.productId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      gitUrl,
      creatorId: OWNER_ID,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.post("/api/arcs", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  if (typeof body.productId !== "string") return c.json({ error: "productId is required" }, 400);

  const db = drizzle(c.env.DB);
  const [product] = await db.select().from(products).where(eq(products.id, body.productId)).limit(1);
  if (!product) return c.json({ error: "product not found" }, 400);

  const now = new Date();
  const [container] = await db
    .insert(arcs)
    .values({
      id: idOr(body.id, "arc"),
      productId: body.productId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      creatorId: OWNER_ID,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.patch("/api/initiatives/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .update(initiatives)
    .set(set)
    .where(eq(initiatives.id, c.req.param("id")))
    .returning();
  if (!container) return c.json({ error: "initiative not found" }, 404);
  return c.json({ container });
});

app.patch("/api/products/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  const db = drizzle(c.env.DB);
  if (body.keyPrefix !== undefined) {
    if (typeof body.keyPrefix !== "string" || !KEY_PREFIX_RE.test(body.keyPrefix.toUpperCase()))
      return c.json({ error: "keyPrefix must be 2–8 letters" }, 400);
    const keyPrefix = body.keyPrefix.toUpperCase();
    const [clash] = await db.select().from(products).where(eq(products.keyPrefix, keyPrefix)).limit(1);
    if (clash && clash.id !== id) return c.json({ error: `key prefix ${keyPrefix} is already in use` }, 409);
    // Safe rename: issue keys are derived from the prefix, never stored (D18).
    set.keyPrefix = keyPrefix;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const [container] = await db.update(products).set(set).where(eq(products.id, id)).returning();
  if (!container) return c.json({ error: "product not found" }, 404);
  return c.json({ container });
});

app.patch("/api/repos/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  if (body.gitUrl !== undefined) {
    if (body.gitUrl !== null && typeof body.gitUrl !== "string")
      return c.json({ error: "gitUrl must be a string or null" }, 400);
    set.gitUrl = body.gitUrl;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .update(repos)
    .set(set)
    .where(eq(repos.id, c.req.param("id")))
    .returning();
  if (!container) return c.json({ error: "repo not found" }, 404);
  return c.json({ container });
});

app.patch("/api/arcs/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .update(arcs)
    .set(set)
    .where(eq(arcs.id, c.req.param("id")))
    .returning();
  if (!container) return c.json({ error: "arc not found" }, 404);
  return c.json({ container });
});

// ---------- tags (D27) ----------

// Assign a tag: by tagId for an existing tag, or by name (create-or-get,
// then assign) so the client's "create tag and add it" is one atomic call.
app.post("/api/issues/:id/tags", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { tagId?: unknown; name?: unknown; id?: unknown };
  const db = drizzle(c.env.DB);
  const [issue] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, id)).limit(1);
  if (!issue) return c.json({ error: "issue not found" }, 404);

  let tag;
  if (typeof body.tagId === "string") {
    [tag] = await db.select().from(tags).where(eq(tags.id, body.tagId)).limit(1);
    if (!tag) return c.json({ error: "tag not found" }, 400);
  } else if (typeof body.name === "string" && body.name.trim() !== "") {
    const name = body.name.trim();
    [tag] = await db.select().from(tags).where(eq(tags.name, name)).limit(1);
    if (!tag) {
      [tag] = await db
        .insert(tags)
        .values({ id: idOr(body.id, "tag"), name, color: tagColor(name), createdAt: new Date() })
        .returning();
    }
  } else {
    return c.json({ error: "tagId or name is required" }, 400);
  }

  await db.insert(issueTags).values({ issueId: id, tagId: tag!.id }).onConflictDoNothing();
  return c.json({ tag, link: { issueId: id, tagId: tag!.id } }, 201);
});

app.delete("/api/issues/:id/tags/:tagId", async (c) => {
  const db = drizzle(c.env.DB);
  await db
    .delete(issueTags)
    .where(
      and(eq(issueTags.issueId, c.req.param("id")), eq(issueTags.tagId, c.req.param("tagId"))),
    );
  return c.json({ ok: true });
});

type IssueCreateBody = {
  title?: unknown;
  productId?: unknown;
  repoId?: unknown;
  arcId?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  estimate?: unknown;
};

// Issue creation (SPEC §3): the issue number comes from the product's
// next_issue_number sequence (D18), allocated with an atomic increment. A
// crash between allocation and insert leaves a number gap, which is harmless.
app.post("/api/issues", async (c) => {
  const body = (await c.req.json()) as IssueCreateBody;
  if (typeof body.title !== "string" || body.title.trim() === "")
    return c.json({ error: "title must be a non-empty string" }, 400);
  if (typeof body.productId !== "string")
    return c.json({ error: "productId is required" }, 400);
  const repoId = body.repoId ?? null;
  if (repoId !== null && typeof repoId !== "string")
    return c.json({ error: "repoId must be a string or null" }, 400);
  const arcId = body.arcId ?? null;
  if (arcId !== null && typeof arcId !== "string")
    return c.json({ error: "arcId must be a string or null" }, 400);
  const description = body.description ?? "";
  if (typeof description !== "string")
    return c.json({ error: "description must be a string" }, 400);
  const status = (body.status ?? "backlog") as IssueStatus;
  if (!ISSUE_STATUSES.includes(status))
    return c.json({ error: `invalid status: ${String(body.status)}` }, 400);
  const priority = (body.priority ?? "none") as IssuePriority;
  if (!ISSUE_PRIORITIES.includes(priority))
    return c.json({ error: `invalid priority: ${String(body.priority)}` }, 400);
  const estimate = (body.estimate ?? null) as number | null;
  if (estimate !== null && !(ISSUE_ESTIMATES as readonly number[]).includes(estimate))
    return c.json({ error: `invalid estimate: ${String(body.estimate)}` }, 400);

  const db = drizzle(c.env.DB);
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, body.productId))
    .limit(1);
  if (!product) return c.json({ error: "product not found" }, 400);
  // The invariants SQLite can't express (D17): repo and arc must belong to
  // the issue's product.
  if (repoId !== null) {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (!repo || repo.productId !== product.id)
      return c.json({ error: "repo not found in that product" }, 400);
  }
  if (arcId !== null) {
    const [arc] = await db.select().from(arcs).where(eq(arcs.id, arcId)).limit(1);
    if (!arc || arc.productId !== product.id)
      return c.json({ error: "arc not found in that product" }, 400);
  }

  const [seq] = await db
    .update(products)
    .set({ nextIssueNumber: sql`${products.nextIssueNumber} + 1` })
    .where(eq(products.id, product.id))
    .returning({ next: products.nextIssueNumber });
  const now = new Date();
  const [issue] = await db
    .insert(issues)
    .values({
      id: newId("iss"),
      productId: product.id,
      repoId,
      arcId,
      number: seq!.next - 1,
      title: body.title.trim(),
      description,
      status,
      priority,
      estimate,
      creatorId: OWNER_ID,
      assigneeId: OWNER_ID,
      createdAt: now,
      updatedAt: now,
      completedAt: status === "done" ? now : null,
    })
    .returning();
  return c.json({ issue }, 201);
});

type IssueMoveBody = { productId?: unknown; repoId?: unknown };

// Issue movement (SPEC §3): within a product the key (and arc) survive; a
// cross-product move re-keys from the target's sequence, clears the arc, and
// retires the old key into issue_key_aliases as a permanent redirect (D18).
app.post("/api/issues/:id/move", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as IssueMoveBody;
  if (typeof body.productId !== "string")
    return c.json({ error: "productId is required" }, 400);
  const repoId = body.repoId ?? null;
  if (repoId !== null && typeof repoId !== "string")
    return c.json({ error: "repoId must be a string or null" }, 400);

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
  if (!existing) return c.json({ error: "issue not found" }, 404);
  const [target] = await db
    .select()
    .from(products)
    .where(eq(products.id, body.productId))
    .limit(1);
  if (!target) return c.json({ error: "product not found" }, 400);
  if (repoId !== null) {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (!repo || repo.productId !== target.id)
      return c.json({ error: "repo not found in that product" }, 400);
  }
  if (existing.productId === target.id && existing.repoId === repoId)
    return c.json({ error: "issue is already in that container" }, 400);

  const now = new Date();
  const moveData = {
    fromProductId: existing.productId,
    fromRepoId: existing.repoId,
    toProductId: target.id,
    toRepoId: repoId,
  };

  if (existing.productId === target.id) {
    // Within-product move: key and arc are kept.
    const [updated] = await db.batch([
      db.update(issues).set({ repoId, updatedAt: now }).where(eq(issues.id, id)).returning(),
      db.insert(activity).values({
        id: newId("act"),
        issueId: id,
        actorId: OWNER_ID,
        type: "moved",
        data: moveData,
        createdAt: now,
      }),
    ]);
    return c.json({ issue: updated[0] });
  }

  const [oldProduct] = await db
    .select()
    .from(products)
    .where(eq(products.id, existing.productId))
    .limit(1);
  const oldKey = `${oldProduct!.keyPrefix}-${existing.number}`;
  const [seq] = await db
    .update(products)
    .set({ nextIssueNumber: sql`${products.nextIssueNumber} + 1` })
    .where(eq(products.id, target.id))
    .returning({ next: products.nextIssueNumber });
  const number = seq!.next - 1;
  const [updated] = await db.batch([
    db
      .update(issues)
      .set({ productId: target.id, repoId, arcId: null, number, updatedAt: now })
      .where(eq(issues.id, id))
      .returning(),
    db.insert(issueKeyAliases).values({ key: oldKey, issueId: id, createdAt: now }),
    db.insert(activity).values({
      id: newId("act"),
      issueId: id,
      actorId: OWNER_ID,
      type: "moved",
      data: { ...moveData, fromKey: oldKey, toKey: `${target.keyPrefix}-${number}` },
      createdAt: now,
    }),
  ]);
  return c.json({ issue: updated[0] });
});

type IssuePatchBody = Partial<{
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  estimate: number | null;
  arcId: string | null;
}>;

// Generalized issue field update — the server side of the optimistic-mutation
// template. Validates per field; a status change also appends an activity
// event (the issue page's timeline interleaves these with comments).
app.patch("/api/issues/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as IssuePatchBody;
  const set: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim() === "")
      return c.json({ error: "title must be a non-empty string" }, 400);
    set.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string")
      return c.json({ error: "description must be a string" }, 400);
    set.description = body.description;
  }
  if (body.status !== undefined && !ISSUE_STATUSES.includes(body.status))
    return c.json({ error: `invalid status: ${String(body.status)}` }, 400);
  if (body.priority !== undefined) {
    if (!ISSUE_PRIORITIES.includes(body.priority))
      return c.json({ error: `invalid priority: ${String(body.priority)}` }, 400);
    set.priority = body.priority;
  }
  if (body.estimate !== undefined) {
    if (body.estimate !== null && !(ISSUE_ESTIMATES as readonly number[]).includes(body.estimate))
      return c.json({ error: `invalid estimate: ${String(body.estimate)}` }, 400);
    set.estimate = body.estimate;
  }

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
  if (!existing) return c.json({ error: "issue not found" }, 404);

  // Arc must belong to the issue's product (SPEC §3) — validated against the
  // loaded row, hence after the existence check.
  if (body.arcId !== undefined) {
    if (body.arcId !== null) {
      if (typeof body.arcId !== "string") return c.json({ error: "arcId must be a string or null" }, 400);
      const [arc] = await db.select().from(arcs).where(eq(arcs.id, body.arcId)).limit(1);
      if (!arc || arc.productId !== existing.productId)
        return c.json({ error: "arc not found in this issue's product" }, 400);
    }
    set.arcId = body.arcId;
  }

  const now = new Date();
  const statusChanged = body.status !== undefined && body.status !== existing.status;
  if (body.status !== undefined) {
    set.status = body.status;
    set.completedAt = body.status === "done" ? now : null;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = now;

  const update = db.update(issues).set(set).where(eq(issues.id, id)).returning();
  if (statusChanged) {
    const [updated] = await db.batch([
      update,
      db.insert(activity).values({
        id: newId("act"),
        issueId: id,
        actorId: OWNER_ID,
        type: "status_changed",
        data: { from: existing.status, to: body.status },
        createdAt: now,
      }),
    ]);
    return c.json({ issue: updated[0] });
  }
  const [updated] = await update;
  return c.json({ issue: updated });
});

// Per-issue timeline (D20: not part of the workspace payload).
app.get("/api/issues/:id/timeline", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const [issueComments, issueActivity] = await db.batch([
    db.select().from(comments).where(eq(comments.issueId, id)).orderBy(asc(comments.createdAt)),
    db.select().from(activity).where(eq(activity.issueId, id)).orderBy(asc(activity.createdAt)),
  ]);
  return c.json({ comments: issueComments, activity: issueActivity });
});

app.post("/api/issues/:id/comments", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { body?: string };
  if (typeof body.body !== "string" || body.body.trim() === "")
    return c.json({ error: "comment body must be a non-empty string" }, 400);

  const db = drizzle(c.env.DB);
  const [existing] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(eq(issues.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "issue not found" }, 404);

  const now = new Date();
  const [comment] = await db
    .insert(comments)
    .values({
      id: newId("cmt"),
      issueId: id,
      authorId: OWNER_ID,
      body: body.body,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ comment }, 201);
});

export default app;
