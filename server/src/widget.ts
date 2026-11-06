import { join, normalize } from "node:path"
import { Hono } from "hono"

const types: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
}

// Serves the built widget: /c.js (the script tag) and /w/* (modules, chunks, fonts).
// Any site can load these files, so they allow all origins.
export function widgetRoutes(dir: string) {
  const app = new Hono()
  const send = async (path: string, cache: string) => {
    const file = Bun.file(join(dir, path))
    if (!(await file.exists())) return new Response("Not found", { status: 404 })
    const ext = path.slice(path.lastIndexOf("."))
    return new Response(file, {
      headers: {
        "content-type": types[ext] ?? "application/octet-stream",
        "cache-control": cache,
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      },
    })
  }
  app.get("/c.js", () => send("c.js", "public, max-age=300"))
  app.get("/w/*", (c) => {
    const path = normalize(c.req.path.slice("/w/".length))
    if (path.startsWith("..") || path.startsWith("/")) return c.notFound()
    const hashed = path.startsWith("chunks/") || path.startsWith("assets/") || path.startsWith("fonts/")
    return send(path, hashed ? "public, max-age=31536000, immutable" : "public, max-age=300")
  })
  return app
}
