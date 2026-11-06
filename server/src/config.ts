import { z } from "zod"

const origin = z.url({ protocol: /^https?$/ }).transform((u) => new URL(u).origin)

export const ProjectSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lowercase letters, digits, - and _"),
    /** The name of the app, on the sign-in button: "Sign in with Acme". */
    name: z.string().trim().min(1).max(40).optional(),
    origins: z.array(origin).min(1),
    appSecret: z.string().min(1).optional(),
    signInUrl: z.url({ protocol: /^https?$/ }).optional(),
    /** Guests sign in with only a name. Default: on without app sign-in, off with it. */
    guests: z.boolean().optional(),
    /** `signed-in`: visitors see no toolbar until they sign in (open the page with `?comma` to sign in). */
    toolbar: z.enum(["always", "signed-in"]).default("always"),
  })
  .transform((p) => ({ ...p, guests: p.guests ?? !p.appSecret }))

export const ConfigSchema = z.object({ projects: z.array(ProjectSchema).min(1) })

export type Project = z.output<typeof ProjectSchema>
export type Config = z.input<typeof ConfigSchema>

export async function loadConfig(path: string) {
  const mod = await import(path)
  return ConfigSchema.parse(mod.default)
}
