import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Authentication and move receipts live only inside the server-side payload.
// Public responses are assembled explicitly in game/server.ts.
export const matches = sqliteTable(
  "matches",
  {
    code: text("code").primaryKey(),
    version: integer("version").notNull().default(1),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("matches_expires_at_idx").on(table.expiresAt)],
);
