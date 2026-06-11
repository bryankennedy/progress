import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
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

type IssuePatchBody = Partial<{
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  estimate: number | null;
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
