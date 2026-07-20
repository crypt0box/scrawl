import { randomUUID } from "node:crypto";
import {
  normalizeTags,
  tagsMatch,
  type Memo,
  type MemoCreate,
  type MemoListItem,
  type MemoPatch,
  type ServerChange,
  type SyncChange,
} from "utils";
import { asc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "./db.js";
import { memos } from "./schema.js";

type MemoRow = typeof memos.$inferSelect;

function toMemo(row: MemoRow): Memo {
  return {
    uuid: row.uuid,
    number: row.number,
    title: row.title,
    tags: row.tags,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function nextNumber(tx: Tx): number {
  const row = tx
    .select({ max: sql<number>`coalesce(max(${memos.number}), 0)` })
    .from(memos)
    .get();
  return (row?.max ?? 0) + 1;
}

function nextSeq(tx: Tx): number {
  const row = tx
    .select({ max: sql<number>`coalesce(max(${memos.serverSeq}), 0)` })
    .from(memos)
    .get();
  return (row?.max ?? 0) + 1;
}

export function listMemos(db: Db, filter: { tag?: string; query?: string }): MemoListItem[] {
  const rows = db.select().from(memos).where(eq(memos.deleted, false)).all();
  const q = filter.query?.toLowerCase();
  return rows
    .filter((row) => {
      if (filter.tag !== undefined && !row.tags.some((t) => tagsMatch(t, filter.tag!))) {
        return false;
      }
      if (
        q !== undefined &&
        !row.title.toLowerCase().includes(q) &&
        !row.body.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((row) => {
      const { body: _body, ...item } = toMemo(row);
      return item;
    });
}

export function getMemoByNumber(db: Db, number: number): Memo | null {
  const row = db.select().from(memos).where(eq(memos.number, number)).get();
  if (row === undefined || row.deleted) return null;
  return toMemo(row);
}

export function createMemo(db: Db, input: MemoCreate): Memo {
  const now = Date.now();
  return db.transaction((tx) => {
    const row: MemoRow = {
      uuid: randomUUID(),
      number: nextNumber(tx),
      title: input.title,
      tags: normalizeTags(input.tags),
      body: input.body,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      serverSeq: nextSeq(tx),
    };
    tx.insert(memos).values(row).run();
    return toMemo(row);
  });
}

export function patchMemoByNumber(db: Db, number: number, patch: MemoPatch): Memo | null {
  return db.transaction((tx) => {
    const row = tx.select().from(memos).where(eq(memos.number, number)).get();
    if (row === undefined || row.deleted) return null;
    const updated: MemoRow = {
      ...row,
      title: patch.title ?? row.title,
      tags: patch.tags !== undefined ? normalizeTags(patch.tags) : row.tags,
      body: patch.body ?? row.body,
      updatedAt: Date.now(),
      serverSeq: nextSeq(tx),
    };
    tx.update(memos).set(updated).where(eq(memos.uuid, row.uuid)).run();
    return toMemo(updated);
  });
}

// NOTE: Apparent physical deletion. The row is internally kept as a tombstone for synchronization purposes.
export function deleteMemoByNumber(db: Db, number: number): boolean {
  return db.transaction((tx) => {
    const row = tx.select().from(memos).where(eq(memos.number, number)).get();
    if (row === undefined || row.deleted) return false;
    tx.update(memos)
      .set({
        title: "",
        tags: [],
        body: "",
        deleted: true,
        updatedAt: Date.now(),
        serverSeq: nextSeq(tx),
      })
      .where(eq(memos.uuid, row.uuid))
      .run();
    return true;
  });
}

export function applyPush(db: Db, changes: SyncChange[]): Record<string, number> {
  return db.transaction((tx) => {
    const numbers: Record<string, number> = {};
    for (const change of changes) {
      const existing = tx.select().from(memos).where(eq(memos.uuid, change.uuid)).get();
      if (existing === undefined) {
        if (change.deleted) continue;
        const number = nextNumber(tx);
        tx.insert(memos)
          .values({
            uuid: change.uuid,
            number,
            title: change.title,
            tags: normalizeTags(change.tags),
            body: change.body,
            createdAt: change.createdAt,
            updatedAt: change.updatedAt,
            deleted: false,
            serverSeq: nextSeq(tx),
          })
          .run();
        numbers[change.uuid] = number;
        continue;
      }
      numbers[change.uuid] = existing.number;
      tx.update(memos)
        .set({
          title: change.deleted ? "" : change.title,
          tags: change.deleted ? [] : normalizeTags(change.tags),
          body: change.deleted ? "" : change.body,
          updatedAt: change.updatedAt,
          deleted: change.deleted,
          serverSeq: nextSeq(tx),
        })
        .where(eq(memos.uuid, change.uuid))
        .run();
    }
    return numbers;
  });
}

export function pullSince(db: Db, since: number): { changes: ServerChange[]; cursor: number } {
  const rows = db
    .select()
    .from(memos)
    .where(gt(memos.serverSeq, since))
    .orderBy(asc(memos.serverSeq))
    .all();
  const changes: ServerChange[] = rows.map((row) => ({
    uuid: row.uuid,
    number: row.number,
    title: row.title,
    tags: row.tags,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
    serverSeq: row.serverSeq,
  }));
  const last = changes.at(-1);
  return { changes, cursor: last !== undefined ? last.serverSeq : since };
}
