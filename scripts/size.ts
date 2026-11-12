// Checks the gzip size of the built widget against the budget. Run after `bun run build`.
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { gzipSync } from "node:zlib"

const dist = join(import.meta.dir, "../widget/dist")
const gzip = (file: string) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
// The file and the chunks it imports statically: they load with it. Not `import()`: those load on demand.
const withImports = (file: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(file)) return seen
  seen.add(file)
  for (const [, path] of readFileSync(join(dist, file), "utf8").matchAll(/(?:from|import)\s*"(\.\/[^"]+)"/g)) {
    withImports(join(dirname(file), path as string), seen)
  }
  return seen
}
const sum = (files: Iterable<string>) => [...files].reduce((total, file) => total + gzip(file), 0)
const chunk = (prefix: string) => {
  const name = readdirSync(join(dist, "chunks")).find((f) => f.startsWith(prefix))
  if (!name) throw new Error(`No chunk ${prefix}`)
  return gzip(`chunks/${name}`)
}

const KB = 1024
const checks = [
  // comma runs on previews and staging, not for site visitors: a larger widget is fine.
  {
    name: "c.js + main.js and its chunks (loads on every page)",
    size: gzip("c.js") + sum(withImports("main.js")),
    budget: 150 * KB,
  },
  { name: "editor chunk (loads on demand)", size: chunk("editor-"), budget: 135 * KB },
  { name: "emoji picker chunk (loads on demand)", size: chunk("emoji-picker-"), budget: 15 * KB },
  { name: "screenshot chunk (loads on demand)", size: chunk("screenshot-"), budget: 15 * KB },
  { name: "details chunk (loads on demand)", size: chunk("details-"), budget: 10 * KB },
]

let failed = false
for (const { name, size, budget } of checks) {
  const ok = size <= budget
  failed ||= !ok
  console.log(`${ok ? "ok  " : "OVER"} ${name}: ${(size / KB).toFixed(1)} kB gzip (budget ${budget / KB} kB)`)
}
process.exit(failed ? 1 : 0)
