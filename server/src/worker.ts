// Entry: Cloudflare Workers. The widget files are static assets (`public/`, see `scripts/public.ts`).
// Settings come from `process.env` (needs `nodejs_compat`, see `wrangler.jsonc`).
import { createClient } from "@libsql/client/web"
import { lazyApp } from "./serverless"

const getApp = lazyApp(createClient)

type Context = { waitUntil(promise: Promise<unknown>): void }

export default {
  async fetch(request: Request) {
    return (await getApp()).fetch(request)
  },
  // The Cron Trigger: deletes images that no comment uses.
  async scheduled(_controller: unknown, _env: unknown, ctx: Context) {
    ctx.waitUntil(getApp().then((app) => app.cleanupFiles()))
  },
}
