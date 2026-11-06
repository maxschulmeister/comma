import { resolve } from "node:path"
import { createApp } from "./app"

const port = Number(process.env.PORT ?? 4000)
const app = createApp({ widgetDir: resolve(import.meta.dir, "../../widget/dist") })

Bun.serve({ port, fetch: app.fetch })
console.log(`comma: http://localhost:${port}`)
