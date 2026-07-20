import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { ensureSecrets } from "./auth.js";
import { createDb } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.MEMO_DB_PATH ?? path.join(here, "../data/memo.db");
const port = Number(process.env.PORT ?? 8787);
const webDist = process.env.MEMO_WEB_DIST ?? path.join(here, "../../web/dist");

const db = createDb(dbPath);
const secrets = ensureSecrets(db, process.env);
const trustProxy = process.env.MEMO_TRUST_PROXY === "true";
const app = createApp(db, secrets, {
  loginRateLimit: {
    clientKey: (c) => {
      if (trustProxy) {
        const forwarded = c.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
        if (forwarded !== undefined && forwarded !== "") return forwarded;
      }
      return getConnInfo(c).remote.address ?? "unknown";
    },
  },
});

const rootRel = path.relative(process.cwd(), webDist) || ".";
app.use("*", serveStatic({ root: rootRel }));
app.get("*", serveStatic({ root: rootRel, path: "index.html" }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[memo] listening on http://localhost:${info.port}`);
});
