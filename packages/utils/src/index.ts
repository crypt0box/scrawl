import * as v from "valibot";

export const tagSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100));

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function tagsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export const memoSchema = v.object({
  uuid: v.pipe(v.string(), v.uuid()),
  number: v.nullable(v.pipe(v.number(), v.integer(), v.gtValue(0))),
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
  tags: v.pipe(v.array(tagSchema), v.maxLength(50)),
  body: v.pipe(v.string(), v.maxLength(1_000_000)),
  createdAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
  updatedAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export type Memo = v.InferOutput<typeof memoSchema>;

export const memoCreateSchema = v.object({
  title: memoSchema.entries.title,
  tags: v.optional(memoSchema.entries.tags, []),
  body: v.optional(memoSchema.entries.body, ""),
});

export type MemoCreate = v.InferOutput<typeof memoCreateSchema>;

export const memoPatchSchema = v.object({
  title: v.optional(memoSchema.entries.title),
  tags: v.optional(memoSchema.entries.tags),
  body: v.optional(memoSchema.entries.body),
});

export type MemoPatch = v.InferOutput<typeof memoPatchSchema>;

export const memoListItemSchema = v.pick(memoSchema, [
  "uuid",
  "number",
  "title",
  "tags",
  "updatedAt",
  "createdAt",
]);

export type MemoListItem = v.InferOutput<typeof memoListItemSchema>;

export const syncChangeSchema = v.pipe(
  v.object({
    uuid: v.pipe(v.string(), v.uuid()),
    title: v.pipe(v.string(), v.trim(), v.maxLength(500)),
    tags: v.pipe(v.array(tagSchema), v.maxLength(50)),
    body: memoSchema.entries.body,
    createdAt: memoSchema.entries.createdAt,
    updatedAt: memoSchema.entries.updatedAt,
    deleted: v.boolean(),
  }),
  v.check(
    (c) => c.deleted || c.title.length > 0,
    "title is required unless the change is a tombstone",
  ),
);
export type SyncChange = v.InferOutput<typeof syncChangeSchema>;

export const SYNC_PUSH_BATCH_SIZE = 1000;

export const syncPushRequestSchema = v.object({
  changes: v.pipe(v.array(syncChangeSchema), v.maxLength(SYNC_PUSH_BATCH_SIZE)),
});
export type SyncPushRequest = v.InferOutput<typeof syncPushRequestSchema>;

export const syncPushResponseSchema = v.object({
  numbers: v.record(v.string(), v.pipe(v.number(), v.integer(), v.gtValue(0))),
});
export type SyncPushResponse = v.InferOutput<typeof syncPushResponseSchema>;

export const serverChangeSchema = v.object({
  uuid: v.pipe(v.string(), v.uuid()),
  number: v.pipe(v.number(), v.integer(), v.gtValue(0)),
  title: v.string(),
  tags: v.array(v.string()),
  body: v.string(),
  createdAt: v.pipe(v.number(), v.integer()),
  updatedAt: v.pipe(v.number(), v.integer()),
  deleted: v.boolean(),
  serverSeq: v.pipe(v.number(), v.integer()),
});

export type ServerChange = v.InferOutput<typeof serverChangeSchema>;

export const syncPullResponseSchema = v.object({
  changes: v.array(serverChangeSchema),
  cursor: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export type SyncPullResponse = v.InferOutput<typeof syncPullResponseSchema>;

export const loginRequestSchema = v.object({
  password: v.pipe(v.string(), v.minLength(1)),
});

export type LoginRequest = v.InferOutput<typeof loginRequestSchema>;

export const okResponseSchema = v.object({ ok: v.literal(true) });

export type OkResponse = v.InferOutput<typeof okResponseSchema>;
