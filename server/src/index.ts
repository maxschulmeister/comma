// Entry: Bun (Docker, a VPS, local development).
import { resolve } from "node:path"
import { createClient } from "@libsql/client"
import { createApp } from "./app"
import { loadConfig } from "./config"
import { migrate } from "./db"
import { readSettings, type Settings } from "./settings"

let settings: Settings
try {
  settings = readSettings(process.env)
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

const port = Number(process.env.PORT ?? 4000)
const config = await loadConfig(resolve(process.env.COMMA_CONFIG ?? "comma.config.ts"))
const db = await migrate(createClient(settings.db), settings.db.local)
const app = createApp({ ...settings, db, config, widgetDir: resolve(import.meta.dir, "../../widget/dist") })

setInterval(() => app.cleanupFiles().catch(console.error), 60 * 60 * 1000)
Bun.serve({ port, fetch: app.fetch, maxRequestBodySize: 6 * 1024 * 1024 })
console.log(`comma: http://localhost:${port}`)
