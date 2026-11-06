// Bundles the AWS Lambda entry for Node.js into `dist/lambda/` (index.mjs and the widget). Run after `bun run build`.
import { cpSync, rmSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const out = join(root, "dist/lambda")

rmSync(out, { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [join(root, "server/src/lambda.ts")],
  outdir: out,
  naming: "index.mjs",
  target: "node",
  format: "esm",
  minify: true,
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
cpSync(join(root, "widget/dist"), join(out, "widget"), { recursive: true })
console.log(`dist/lambda: ${result.outputs.map((o) => `${(o.size / 1024).toFixed(0)} kB`).join(", ")}`)
