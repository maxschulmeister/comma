// Checks a deployed comma server from outside. Run after each deploy:
//   bun scripts/check-deploy.ts https://comma.example.com --project acme --origin https://www.acme.com
// It signs in a user named "Deploy check" and uploads one small image. Cleanup deletes the image after 24 h.
// A project without guests: set COMMA_APP_SECRET to the project's appSecret. The check signs in as an app user.
import { parseArgs } from "node:util"
import { sign } from "hono/jwt"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { project: { type: "string" }, origin: { type: "string" } },
})
const url = positionals[0]?.replace(/\/$/, "")
const { project, origin } = values
if (!url || !project || !origin) {
  console.error("Usage: bun scripts/check-deploy.ts <comma URL> --project <id> --origin <a registered origin>")
  process.exit(2)
}

// A 2×3 PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DwnwEIGHEIAD0KBf+0cY5MAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
)

let failed = false
async function check(name: string, run: () => Promise<string | undefined>) {
  const problem = await run().catch((error: Error) => error.message)
  console.log(`${problem ? "FAIL" : "ok  "} ${name}${problem ? `: ${problem}` : ""}`)
  if (problem) failed = true
}
const expectStatus = (res: Response, status: number) =>
  res.status === status ? undefined : `status ${res.status}, expected ${status}`

await check("widget script /c.js", async () => {
  const res = await fetch(`${url}/c.js`)
  if (res.status !== 200) return `status ${res.status}`
  if (res.headers.get("access-control-allow-origin") !== "*") return "no access-control-allow-origin: *"
  if (!res.headers.get("cache-control")?.includes("max-age=300"))
    return `cache-control ${res.headers.get("cache-control")}`
})
await check("widget module /w/main.js", async () => expectStatus(await fetch(`${url}/w/main.js`), 200))
let guests = true
await check(`project ${project} from ${origin}`, async () => {
  const res = await fetch(`${url}/api/projects/${project}`, { headers: { origin } })
  const problem = expectStatus(res, 200)
  if (problem) return problem
  const info = await res.json()
  guests = info.guests !== false
  return info.id === project ? undefined : "wrong project"
})
await check("project from an origin that is not registered: 403", async () =>
  expectStatus(
    await fetch(`${url}/api/projects/${project}`, { headers: { origin: "https://not-registered.invalid" } }),
    403,
  ),
)

let token = ""
await check(`${guests ? "guest" : "app"} session (database write)`, async () => {
  const post = (path: string, body: object) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ project, ...body }),
    })
  let res: Response
  if (guests) res = await post("/api/session/guest", { name: "Deploy check" })
  else {
    const secret = process.env.COMMA_APP_SECRET
    if (!secret) return "guests are off for this project: set COMMA_APP_SECRET to its appSecret"
    const exp = Math.floor(Date.now() / 1000) + 120
    res = await post("/api/session/app", {
      appToken: await sign({ sub: "comma-deploy-check", name: "Deploy check", exp }, secret, "HS256"),
    })
  }
  if (res.status !== 200) return `status ${res.status}: ${await res.text()}`
  token = (await res.json()).token
})
const auth = { origin, authorization: `Bearer ${token}` }
await check("threads (database read)", async () =>
  expectStatus(await fetch(`${url}/api/threads`, { headers: auth }), 200),
)
await check("image upload and download", async () => {
  const form = new FormData()
  form.set("file", new File([PNG], "check.png", { type: "image/png" }))
  const res = await fetch(`${url}/api/files`, { method: "POST", headers: auth, body: form })
  if (res.status !== 200) return `upload status ${res.status}: ${await res.text()}`
  const file = await fetch(`${url}${(await res.json()).url}`)
  if (file.status !== 200) return `download status ${file.status}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  return bytes.length === PNG.length && bytes.every((b, i) => b === PNG[i]) ? undefined : "the image changed"
})

process.exit(failed ? 1 : 0)
