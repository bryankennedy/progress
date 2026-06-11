import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  arcs,
  initiatives,
  ISSUE_STATUSES,
  issueKeyAliases,
  issues,
  issueTags,
  products,
  repos,
  tags,
  users,
  type IssueStatus,
} from "../db/schema";

type Bindings = {
  DB: D1Database;
};

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

// First mutation endpoint — the optimistic-update template case (SPEC §8.2).
app.patch("/api/issues/:id/status", async (c) => {
  const body = (await c.req.json()) as { status?: string };
  if (!ISSUE_STATUSES.includes(body.status as IssueStatus)) {
    return c.json({ error: `invalid status: ${String(body.status)}` }, 400);
  }
  const status = body.status as IssueStatus;
  const now = new Date();
  const db = drizzle(c.env.DB);
  const [updated] = await db
    .update(issues)
    .set({
      status,
      updatedAt: now,
      completedAt: status === "done" ? now : null,
    })
    .where(eq(issues.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "issue not found" }, 404);
  return c.json({ issue: updated });
});

export default app;
