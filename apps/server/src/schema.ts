import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const memos = sqliteTable(
  "memos",
  {
    uuid: text("uuid").primaryKey(),
    number: integer("number").notNull().unique(),
    title: text("title").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull(),
    serverSeq: integer("server_seq").notNull(),
  },
  (t) => [index("idx_memos_server_seq").on(t.serverSeq)],
);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
