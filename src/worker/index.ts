import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../db/schema";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Walking-skeleton workspace load. Milestone 2 grows this into the single
// "load everything" endpoint that feeds the client store (SPEC §8.2).
app.get("/api/workspace", async (c) => {
  const db = drizzle(c.env.DB);
  const allUsers = await db.select().from(users).all();
  return c.json({ users: allUsers });
});

export default app;
