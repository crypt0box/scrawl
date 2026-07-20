import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Db } from "./db.js";
import { meta, sessions } from "./schema.js";

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface Secrets {
  password: string;
  apiToken: string;
}

function getOrCreateMeta(
  db: Db,
  key: string,
  generate: () => string,
): { value: string; generated: boolean } {
  const row = db.select().from(meta).where(eq(meta.key, key)).get();
  if (row !== undefined) return { value: row.value, generated: false };
  const value = generate();
  db.insert(meta).values({ key, value }).run();
  return { value, generated: true };
}

/**
 * Reads authentication credentials from environment variables. If they are not set,
 * they are generated during the initial startup, saved to the database,
 * and displayed in the console only once.
 */
export function ensureSecrets(
  db: Db,
  env: NodeJS.ProcessEnv,
  log: (msg: string) => void = console.log,
): Secrets {
  let password = env.MEMO_PASSWORD;
  if (password === undefined || password === "") {
    const r = getOrCreateMeta(db, "generated_password", () => randomBytes(9).toString("base64url"));
    password = r.value;
    if (r.generated)
      log(`[memo] Generated web UI password: ${password} (override with MEMO_PASSWORD)`);
  }
  let apiToken = env.MEMO_API_TOKEN;
  if (apiToken === undefined || apiToken === "") {
    const r = getOrCreateMeta(db, "generated_api_token", () =>
      randomBytes(24).toString("base64url"),
    );
    apiToken = r.value;
    if (r.generated)
      log(`[memo] Generated API token for the CLI: ${apiToken} (override with MEMO_API_TOKEN)`);
  }
  return { password, apiToken };
}

export function secretEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function createSession(db: Db): { token: string; expiresAt: number } {
  const now = Date.now();
  // Clean up expired session
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  const token = randomBytes(32).toString("hex");
  const expiresAt = now + SESSION_TTL_MS;
  db.insert(sessions).values({ token, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
}

export function isValidSession(db: Db, token: string): boolean {
  const row = db.select().from(sessions).where(eq(sessions.token, token)).get();
  return row !== undefined && row.expiresAt > Date.now();
}

export function destroySession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}
