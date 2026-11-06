import { sign, verify } from "hono/jwt"
import { z } from "zod"
import type { Project } from "./config"
import { type Db, get, run } from "./db"

export type UserRow = {
  id: string
  project: string
  kind: "guest" | "app"
  external_id: string | null
  name: string
  email: string | null
  avatar_url: string | null
  is_admin: number
  reads_version: number
  created_at: number
}

export type User = { id: string; name: string; kind: "guest" | "app"; avatarUrl: string | null; isAdmin: boolean }

export const publicUser = (u: UserRow): User => ({
  id: u.id,
  name: u.name,
  kind: u.kind,
  avatarUrl: u.avatar_url,
  isAdmin: u.is_admin === 1,
})

// A guest has no account that can be closed. An app user's access ends a week after the last sign-in: someone who
// left the team cannot sign in to the app again. In the app, `identify` signs in again on each page load.
const SESSION_DAYS = { guest: 90, app: 7 }
const APP_TOKEN_MAX_SECONDS = 5 * 60
const CLOCK_SKEW_SECONDS = 30

export const newId = () => crypto.randomUUID()

export function signSession(secret: string, user: UserRow) {
  const iat = Math.floor(Date.now() / 1000)
  return sign({ sub: user.id, prj: user.project, iat, exp: iat + SESSION_DAYS[user.kind] * 86_400 }, secret, "HS256")
}

export async function verifySession(secret: string, token: string) {
  try {
    const payload = await verify(token, secret, "HS256")
    if (typeof payload.sub !== "string" || typeof payload.prj !== "string") return null
    return { userId: payload.sub, project: payload.prj }
  } catch {
    return null
  }
}

const AppClaims = z.object({
  sub: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200).optional(),
  avatar: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .optional(),
  admin: z.boolean().optional(),
  exp: z.number(),
})

// App token: a short JWT signed by the app backend with the project secret.
export async function verifyAppToken(project: Project, token: string) {
  if (!project.appSecret) return null
  try {
    const payload = await verify(token, project.appSecret, "HS256")
    const claims = AppClaims.safeParse(payload)
    if (!claims.success) return null
    const now = Math.floor(Date.now() / 1000)
    if (claims.data.exp > now + APP_TOKEN_MAX_SECONDS + CLOCK_SKEW_SECONDS) return null
    return claims.data
  } catch {
    return null
  }
}

/** `changed`: the public profile (name, avatar, admin) of an existing user changed. */
export async function upsertAppUser(db: Db, project: Project, claims: z.infer<typeof AppClaims>, now: number) {
  const find = () =>
    get<UserRow>(
      db,
      "select * from users where project = ? and kind = 'app' and external_id = ?",
      project.id,
      claims.sub,
    )
  const existing = await find()
  if (existing) {
    const changed =
      existing.name !== claims.name ||
      existing.avatar_url !== (claims.avatar ?? null) ||
      existing.is_admin !== (claims.admin ? 1 : 0)
    if (!changed && existing.email === (claims.email ?? null)) return { user: existing, changed }
    const user = await get<UserRow>(
      db,
      "update users set name = ?, email = ?, avatar_url = ?, is_admin = ? where id = ? returning *",
      claims.name,
      claims.email ?? null,
      claims.avatar ?? null,
      claims.admin ? 1 : 0,
      existing.id,
    )
    return { user: user as UserRow, changed }
  }
  // Two first sign-ins at the same time: one inserts, both read the same user.
  await run(
    db,
    `insert into users (id, project, kind, external_id, name, email, avatar_url, is_admin, created_at)
     values (?, ?, 'app', ?, ?, ?, ?, ?, ?) on conflict (project, external_id) where kind = 'app' do nothing`,
    newId(),
    project.id,
    claims.sub,
    claims.name,
    claims.email ?? null,
    claims.avatar ?? null,
    claims.admin ? 1 : 0,
    now,
  )
  return { user: (await find()) as UserRow, changed: false }
}

export async function createGuest(db: Db, project: Project, name: string, now: number) {
  const user = await get<UserRow>(
    db,
    "insert into users (id, project, kind, name, created_at) values (?, ?, 'guest', ?, ?) returning *",
    newId(),
    project.id,
    name,
    now,
  )
  return user as UserRow
}

export function getUser(db: Db, id: string) {
  return get<UserRow>(db, "select * from users where id = ?", id)
}
