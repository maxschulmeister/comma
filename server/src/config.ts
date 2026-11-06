import { z } from "zod"

const origin = z.url({ protocol: /^https?$/ }).transform((u) => new URL(u).origin)

export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lowercase letters, digits, - and _"),
  origins: z.array(origin).min(1),
  appSecret: z.string().min(1).optional(),
  signInUrl: z.url({ protocol: /^https?$/ }).optional(),
})

export const ConfigSchema = z.object({ projects: z.array(ProjectSchema).min(1) })

export type Project = z.infer<typeof ProjectSchema>
export type Config = z.input<typeof ConfigSchema>

export async function loadConfig(path: string) {
  const mod = await import(path)
  return ConfigSchema.parse(mod.default)
}
