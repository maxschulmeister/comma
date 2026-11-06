import { createClient } from "@libsql/client"
import { sign } from "hono/jwt"
import { createApp } from "../src/app"
import type { Config } from "../src/config"
import { migrate } from "../src/db"
import type { FileStore } from "../src/files"

export const ACME = "https://acme.test"
export const OTHER = "https://other.test"
export const CLOSED = "https://closed.test"
export const OPEN = "https://open.test"

export const config: Config = {
  projects: [
    {
      id: "acme",
      origins: [ACME, "http://localhost:3000"],
      appSecret: "acme-secret",
      signInUrl: "https://app.acme.test/comma",
      name: "Acme",
      guests: true,
    },
    { id: "other", origins: [OTHER], appSecret: "other-secret", guests: true },
    // App sign-in without a guest option: guests are off.
    { id: "closed", origins: [CLOSED], appSecret: "closed-secret", toolbar: "signed-in" },
    // No app sign-in: guests are on.
    { id: "open", origins: [OPEN] },
  ],
}

// biome-ignore lint/suspicious/noExplicitAny: tests read nested JSON from responses.
export type Json = Record<string, any>

export async function setup(options: { now?: () => number; publicUrl?: string; files?: FileStore } = {}) {
  const db = await migrate(createClient({ url: ":memory:" }), true)
  const app = createApp({
    db,
    config,
    secret: "server-secret",
    widgetDir: "/nonexistent",
    now: options.now,
    publicUrl: options.publicUrl,
    files: options.files,
  })

  async function request(
    method: string,
    path: string,
    init: { token?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {},
  ) {
    // `origin: null`: no Origin header (a browser sends none on same-origin GET requests).
    const headers: Record<string, string> = {
      ...(init.origin === null ? {} : { origin: init.origin ?? ACME }),
      ...init.headers,
    }
    if (init.token) headers.authorization = `Bearer ${init.token}`
    let body: BodyInit | undefined
    if (init.body instanceof FormData) body = init.body
    else if (init.body !== undefined) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(init.body)
    }
    const res = await app.fetch(new Request(`http://comma.test${path}`, { method, headers, body }))
    const text = await res.text()
    let json: Json = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {}
    return { status: res.status, json, text, headers: res.headers }
  }

  async function guest(name = "Guest", origin = ACME, project = "acme") {
    const res = await request("POST", "/api/session/guest", { origin, body: { project, name } })
    if (res.status !== 200) throw new Error(`guest session failed: ${res.status} ${res.text}`)
    return res.json as { token: string; user: Json }
  }

  async function appUser(claims: Json, project = "acme", secret = "acme-secret") {
    const appToken = await appToken_(claims, secret)
    const res = await request("POST", "/api/session/app", {
      origin: project === "acme" ? ACME : OTHER,
      body: { project, appToken },
    })
    if (res.status !== 200) throw new Error(`app session failed: ${res.status} ${res.text}`)
    return res.json as { token: string; user: Json }
  }

  return { app, db, request, guest, appUser }
}

export function appToken_(claims: Json, secret = "acme-secret") {
  return sign({ exp: Math.floor(Date.now() / 1000) + 120, ...claims }, secret, "HS256")
}

export const text = (s: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: s }] }],
})

export const anchor = {
  selectors: { css: "body > main > h2" },
  tag: "h2",
  text: "Pricing",
  context: "",
  point: { x: 10, y: 50 },
  viewport: 1280,
}
