import { Hono } from "hono"
import { widgetRoutes } from "./widget"

export type AppOptions = {
  widgetDir: string
}

export function createApp(options: AppOptions) {
  const app = new Hono()
  app.route("/", widgetRoutes(options.widgetDir))
  return app
}
