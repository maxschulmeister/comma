import { HTTPException } from "hono/http-exception"
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

/** Starts a session: a row the server can end (sign-out), and a token that names it. */
export async function startSession(db: Db, secret: string, user: UserRow, now: number) {
  const id = newId()
  const days = SESSION_DAYS[user.kind]
  await run(
    db,
    "insert into sessions (id, user_id, created_at, expires_at) values (?, ?, ?, ?)",
    id,
    user.id,
    now,
    now + days * 86_400_000,
  )
  const iat = Math.floor(Date.now() / 1000)
  return sign({ sub: user.id, sid: id, prj: user.project, iat, exp: iat + days * 86_400 }, secret, "HS256")
}

export async function verifySession(secret: string, token: string) {
  try {
    const payload = await verify(token, secret, "HS256")
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.prj !== "string")
      return null
    return { userId: payload.sub, sessionId: payload.sid, project: payload.prj }
  } catch {
    return null
  }
}

/** The user of a session that has not ended. */
export function getSessionUser(db: Db, session: { userId: string; sessionId: string }, now: number) {
  return get<UserRow>(
    db,
    `select u.* from sessions s join users u on u.id = s.user_id
     where s.id = ? and s.user_id = ? and s.expires_at > ?`,
    session.sessionId,
    session.userId,
    now,
  )
}

const UserClaims = z.object({
  // Apps often use number ids.
  sub: z.union([z.string().min(1).max(200), z.number().int().transform(String)]),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200).optional(),
  avatar: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .optional(),
  admin: z.boolean().optional(),
})
const AppClaims = UserClaims.extend({ exp: z.number() })
type Claims = z.infer<typeof UserClaims>

const USER_URL_TIMEOUT_MS = 5000

/** The app user of a token: a JWT signed with `appSecret`, or the app's access token checked at `userUrl`. */
export function appUserClaims(project: Project, token: string) {
  return project.userUrl ? fetchUser(project, project.userUrl, token) : verifyAppToken(project, token)
}

// The app answers 200 with the user, or 4xx for a token it refuses. Other answers: comma cannot tell, so 502.
async function fetchUser(project: Project, url: string, token: string): Promise<Claims | null> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(USER_URL_TIMEOUT_MS),
    })
  } catch {
    throw new HTTPException(502, { message: "Could not check the sign-in. Try again." })
  }
  if (res.status >= 400 && res.status < 500) return null
  if (!res.ok) throw new HTTPException(502, { message: "Could not check the sign-in. Try again." })
  try {
    const body = await res.json()
    const claims = UserClaims.safeParse(project.user ? project.user(body) : body)
    return claims.success ? claims.data : null
  } catch {
    return null // Not JSON, or `user` could not read it.
  }
}

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
export async function upsertAppUser(db: Db, project: Project, claims: Claims, now: number) {
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
