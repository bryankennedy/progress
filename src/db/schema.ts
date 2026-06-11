import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Multi-user-ready from day one (SPEC §8.4, D13): one row in v1, but
// creator/assignee/author foreign keys will point here as entities land.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type User = typeof users.$inferSelect;
