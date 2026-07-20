import {
  loginRequestSchema,
  memoCreateSchema,
  memoPatchSchema,
  syncPushRequestSchema,
  type SyncPullResponse,
  type SyncPushResponse,
} from "utils";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as v from "valibot";
import {
  createSession,
  destroySession,
  isValidSession,
  secretEquals,
  type Secrets,
} from "./auth.js";
import type { Db } from "./db.js";
import * as repo from "./repo.js";

const SESSION_COOKIE = "memo_session";

export interface LoginRateLimitOptions {
  maxAttempts: number;
  windowMs: number;
  now: () => number;
  clientKey: (c: Context) => string;
}

export interface AppOptions {
  loginFailureDelayMs?: number;
  loginRateLimit?: Partial<LoginRateLimitOptions>;
}

const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitOptions = {
  maxAttempts: 5,
  windowMs: 60_000,
  now: Date.now,
  clientKey: () => "global",
};

export function createApp(db: Db, secrets: Secrets, options: AppOptions = {}) {
  const app = new Hono();
  const loginRateLimit = { ...DEFAULT_LOGIN_RATE_LIMIT, ...options.loginRateLimit };
  const loginAttempts = new Map<string, { count: number; startedAt: number }>();

  const consumeLoginAttempt = (key: string): number | null => {
    const now = loginRateLimit.now();
    const current = loginAttempts.get(key);
    const entry =
      current === undefined || now - current.startedAt >= loginRateLimit.windowMs
        ? { count: 0, startedAt: now }
        : current;
    if (entry.count >= loginRateLimit.maxAttempts) {
      return Math.max(1, Math.ceil((entry.startedAt + loginRateLimit.windowMs - now) / 1000));
    }
    entry.count += 1;
    loginAttempts.set(key, entry);
    return null;
  };

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Only the login endpoint requires no authentication. Register it before the middleware to exclude it from the chain.
  app.post("/api/auth/login", async (c) => {
    const clientKey = loginRateLimit.clientKey(c);
    const retryAfter = consumeLoginAttempt(clientKey);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "too many login attempts" }, 429);
    }
    const parsed = v.safeParse(loginRequestSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    if (!secretEquals(parsed.output.password, secrets.password)) {
      await new Promise((resolve) => setTimeout(resolve, options.loginFailureDelayMs ?? 500));
      return c.json({ error: "wrong password" }, 401);
    }
    loginAttempts.delete(clientKey);
    const session = createSession(db);
    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor((session.expiresAt - Date.now()) / 1000),
      secure:
        new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https",
    });
    return c.json({ ok: true });
  });

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("authorization");
    if (header?.startsWith("Bearer ") && secretEquals(header.slice(7), secrets.apiToken)) {
      return next();
    }
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined && isValidSession(db, token)) return next();
    return c.json({ error: "unauthorized" }, 401);
  });

  app.get("/api/auth/me", (c) => c.json({ ok: true }));

  app.post("/api/auth/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) destroySession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/memos", (c) => {
    const tag = c.req.query("tag");
    const query = c.req.query("q");
    return c.json(repo.listMemos(db, { tag, query }));
  });

  app.post("/api/memos", async (c) => {
    const parsed = v.safeParse(memoCreateSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.issues }, 400);
    return c.json(repo.createMemo(db, parsed.output), 201);
  });

  const parseNumber = (raw: string): number | null => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  app.get("/api/memos/:number", (c) => {
    const number = parseNumber(c.req.param("number"));
    if (number === null) return c.json({ error: "invalid memo number" }, 400);
    const memo = repo.getMemoByNumber(db, number);
    return memo !== null ? c.json(memo) : c.json({ error: "not found" }, 404);
  });

  app.put("/api/memos/:number", async (c) => {
    const number = parseNumber(c.req.param("number"));
    if (number === null) return c.json({ error: "invalid memo number" }, 400);
    const parsed = v.safeParse(memoPatchSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.issues }, 400);
    const memo = repo.patchMemoByNumber(db, number, parsed.output);
    return memo !== null ? c.json(memo) : c.json({ error: "not found" }, 404);
  });

  app.delete("/api/memos/:number", (c) => {
    const number = parseNumber(c.req.param("number"));
    if (number === null) return c.json({ error: "invalid memo number" }, 400);
    return repo.deleteMemoByNumber(db, number)
      ? c.body(null, 204)
      : c.json({ error: "not found" }, 404);
  });

  app.post("/api/sync/push", async (c) => {
    const parsed = v.safeParse(syncPushRequestSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.issues }, 400);
    const numbers = repo.applyPush(db, parsed.output.changes);
    const res: SyncPushResponse = { numbers };
    return c.json(res);
  });

  app.get("/api/sync/pull", (c) => {
    const since = Number(c.req.query("since") ?? 0);
    if (!Number.isInteger(since) || since < 0) return c.json({ error: "invalid cursor" }, 400);
    const res: SyncPullResponse = repo.pullSince(db, since);
    return c.json(res);
  });

  return app;
}
