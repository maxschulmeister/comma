// Static widget files for Cloudflare Workers and Vercel: `public/c.js` and `public/w/*`, the same paths the Bun
// server uses (server/src/widget.ts). Run after `bun run build`.
// `--cloudflare` also writes `public/_headers` (Vercel sets the headers in vercel.json).
import { cpSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const dist = join(root, "widget/dist")
const out = join(root, "public")

rmSync(out, { recursive: true, force: true })
cpSync(dist, join(out, "w"), { recursive: true })
cpSync(join(dist, "c.js"), join(out, "c.js"))

if (process.argv.includes("--cloudflare")) {
  // Names with a hash never change. Each path gets one Cache-Control: Cloudflare joins the values of rules that match.
  const hashed = new Set(["chunks", "assets", "fonts"])
  const SHORT = "public, max-age=300"
  const LONG = "public, max-age=31536000, immutable"
  const CORS = "  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin"
  const rules = [`/c.js\n  Cache-Control: ${SHORT}\n${CORS}`, `/w/*\n${CORS}`]
  for (const name of readdirSync(dist)) {
    const dir = statSync(join(dist, name)).isDirectory()
    rules.push(`/w/${name}${dir ? "/*" : ""}\n  Cache-Control: ${hashed.has(name) ? LONG : SHORT}`)
  }
  writeFileSync(join(out, "_headers"), `${rules.join("\n")}\n`)
}
