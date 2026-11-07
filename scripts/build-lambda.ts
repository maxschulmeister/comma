// Bundles the AWS Lambda entry for Node.js into `dist/lambda/` (index.mjs and the widget). Run after `bun run build`.
// The projects are in the bundle: `comma.config.ts`, or the file in COMMA_CONFIG (as for the server).
import { cpSync, existsSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

const root = join(import.meta.dir, "..")
const out = join(root, "dist/lambda")
const config = resolve(process.env.COMMA_CONFIG ?? join(root, "comma.config.ts"))
if (!existsSync(config)) {
  console.error(`No projects file: ${config}`)
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [join(root, "server/src/lambda.ts")],
  outdir: out,
  naming: "index.mjs",
  target: "node",
  format: "esm",
  minify: true,
  // serverless.ts imports `../../comma.config`.
  plugins: [
    {
      name: "comma-config",
      setup(b) {
        b.onResolve({ filter: /\/comma\.config$/ }, () => ({ path: config }))
      },
    },
  ],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
cpSync(join(root, "widget/dist"), join(out, "widget"), { recursive: true })
console.log(
  `dist/lambda: ${result.outputs.map((o) => `${(o.size / 1024).toFixed(0)} kB`).join(", ")}, projects from ${config}`,
)
