// Entry: Vercel (see `server.ts` in the root). The widget files are static (`public/`, see `scripts/public.ts`).
import { createClient } from "@libsql/client/web"
import { Hono } from "hono"
import { lazyApp } from "./serverless"

const getApp = lazyApp(createClient)

export const vercelApp = new Hono()

// Vercel Cron (vercel.json) sends `Authorization: Bearer $CRON_SECRET`.
vercelApp.get("/cron/cleanup", async (c) => {
  const secret = process.env.CRON_SECRET
  if (!secret || c.req.header("authorization") !== `Bearer ${secret}`) return c.json({ error: "Not allowed" }, 401)
  return c.json(await (await getApp()).cleanup())
})
vercelApp.all("*", async (c) => (await getApp()).fetch(c.req.raw))
