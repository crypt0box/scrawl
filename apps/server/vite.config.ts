import build from "@hono/vite-build/node";
import devServer from "@hono/vite-dev-server";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    devServer({
      entry: "src/index.ts",
    }),
    build({
      entry: "src/index.ts",
    }),
  ],
});
