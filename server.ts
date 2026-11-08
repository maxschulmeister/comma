// Entry: Vercel. Vercel finds a Hono app in `server.ts` in the root. The app is in `server/src/vercel.ts`.
import { Hono } from "hono"
import { vercelApp } from "./server/src/vercel"

export default new Hono().route("/", vercelApp)
