import { resolve } from "node:path"
import { createApp } from "./app"
import { loadConfig } from "./config"
import { openDb } from "./db"

const secret = process.env.COMMA_SECRET ?? ""
if (secret.length < 32) {
  console.error("Set COMMA_SECRET to a random string of 32 or more characters. It signs session tokens.")
  process.exit(1)
}

const port = Number(process.env.PORT ?? 4000)
const config = await loadConfig(resolve(process.env.COMMA_CONFIG ?? "comma.config.ts"))
const db = openDb(process.env.COMMA_DB ?? "comma.sqlite")
const publicUrl = process.env.COMMA_URL || undefined
if (publicUrl && !/^https?:\/\/[^/]+\/?$/.test(publicUrl)) {
  console.error("Set COMMA_URL to the address of comma, for example https://comma.example.com")
  process.exit(1)
}
const app = createApp({ db, config, secret, publicUrl, widgetDir: resolve(import.meta.dir, "../../widget/dist") })

setInterval(app.cleanupFiles, 60 * 60 * 1000)
Bun.serve({ port, fetch: app.fetch, maxRequestBodySize: 6 * 1024 * 1024 })
console.log(`comma: http://localhost:${port}`)
