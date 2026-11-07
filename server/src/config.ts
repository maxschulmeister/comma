import { z } from "zod"

// An origin, or a pattern with `*` as the first label of the host: `https://*.preview.example.com`.
const origin = z
  .url({ protocol: /^https?$/ })
  .transform((u) => new URL(u).origin)
  .refine((o) => !o.includes("*") || /^https?:\/\/\*\.[^*]+$/.test(o), "Use * only as the first label of the host")

export const ProjectSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lowercase letters, digits, - and _"),
    /** The name of the app, on the sign-in button: "Sign in with Acme". */
    name: z.string().trim().min(1).max(40).optional(),
    /** Sites that may use the project. `*` matches one subdomain label. */
    origins: z.array(origin).min(1),
    /** `origin`: each origin has its own comments (one per preview deploy). `project`: all origins share them. */
    scope: z.enum(["project", "origin"]).default("project"),
    /** App sign-in with a JWT that the app backend signs with this secret. */
    appSecret: z.string().min(1).optional(),
    /** App sign-in with the app's own access token: comma sends it to this URL, a 200 names the user. */
    userUrl: z.url({ protocol: /^https?$/ }).optional(),
    /** Reads the user from the answer of `userUrl`: `{ sub, name, email?, avatar?, admin? }`. Default: the answer. */
    // biome-ignore lint/suspicious/noExplicitAny: the shape of the app's answer is the app's.
    user: z.custom<(body: any) => unknown>((v) => typeof v === "function").optional(),
    signInUrl: z.url({ protocol: /^https?$/ }).optional(),
    /** Sign in with Slack, for the people of one workspace (`team`: its id, `T…`). */
    slack: z
      .object({
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        team: z.string().regex(/^T[A-Z0-9]+$/, "Set slack.team to the workspace id, for example T0123ABCD"),
      })
      .optional(),
    /** Guests sign in with only a name. Default: on without app sign-in, off with it. */
    guests: z.boolean().optional(),
    /** Limits per hour. Comments and images: per user. Guests: new guest sign-ins, for all people together. */
    limits: z
      .object({
        commentsPerHour: z.number().int().min(1).default(100),
        imagesPerHour: z.number().int().min(1).default(100),
        guestsPerHour: z.number().int().min(1).default(30),
      })
      .prefault({}),
    /** `signed-in`: visitors see no toolbar until they sign in (open the page with `?comma` to sign in). */
    toolbar: z.enum(["always", "signed-in"]).default("always"),
    /** Where a thread's details open: `panel` (a layer of the side panel) or `dialog` (over the page). */
    details: z.enum(["panel", "dialog"]).default("panel"),
    /** The default of the side panel: `overlay` floats over the page, `push` makes the page narrower. People toggle it. */
    panel: z.enum(["push", "overlay"]).default("overlay"),
  })
  .refine((p) => !(p.appSecret && p.userUrl), "Use appSecret or userUrl, not both")
  .transform((p) => ({
    ...p,
    appSignIn: !!(p.appSecret || p.userUrl),
    guests: p.guests ?? !(p.appSecret || p.userUrl),
  }))

export const ConfigSchema = z.object({ projects: z.array(ProjectSchema).min(1) })

export type Project = z.output<typeof ProjectSchema>
export type Config = z.input<typeof ConfigSchema>

export async function loadConfig(path: string) {
  const mod = await import(path)
  return ConfigSchema.parse(mod.default)
}

/** `*` matches one label: `https://*.example.com` matches `https://a.example.com`, not `https://a.b.example.com`. */
function matches(pattern: string, origin: string) {
  if (!pattern.includes("*")) return pattern === origin
  const [scheme, rest] = pattern.split("://*.")
  const m = /^(https?):\/\/[a-z0-9-]+\.(.+)$/.exec(origin)
  return !!m && m[1] === scheme && m[2] === rest
}

/** True if the origin (`https://www.acme.com`) is a site of the project. */
export const allowsOrigin = (project: Project, origin: string) => project.origins.some((o) => matches(o, origin))

/** True if the host (`www.acme.com`) is a site of the project, with any scheme. */
export const allowsHost = (project: Project, host: string) =>
  project.origins.some((o) => matches(o, `${o.split("://")[0]}://${host}`))
