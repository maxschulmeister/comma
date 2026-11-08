// Shared start of the serverless entries (Lambda, Workers, Vercel). The projects are bundled into the build.
// The app starts on the first request and stays for the life of the instance.
import type { Client, Config as ClientConfig } from "@libsql/client"
import config from "../../comma.config"
import { createApp } from "./app"
import { migrate } from "./db"
import { readSettings } from "./settings"

export type App = ReturnType<typeof createApp>

export function lazyApp(createClient: (c: ClientConfig) => Client, options: { widgetDir?: string } = {}) {
  let app: Promise<App> | undefined
  const start = async () => {
    const settings = readSettings(process.env)
    if (settings.db.local)
      throw new Error("Set COMMA_DB to a remote database (libsql:// or https://). There is no disk.")
    const db = await migrate(createClient(settings.db), false)
    return createApp({ ...settings, db, config, widgetDir: options.widgetDir })
  }
  // A failed start (for example, the database is down) tries again on the next request.
  return () =>
    (app ??= start().catch((error) => {
      app = undefined
      throw error
    }))
}
