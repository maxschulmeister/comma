// Server settings from env. All entry files (Bun, Lambda, Workers, Vercel) read them here.
import { z } from "zod"
import { type FileStore, s3Files } from "./files"

const Env = z.object({
  COMMA_SECRET: z.string().min(32, "Set COMMA_SECRET to a random string of 32 or more characters"),
  COMMA_URL: z
    .string()
    .regex(/^https?:\/\/[^/]+\/?$/, "Set COMMA_URL to the address of comma, for example https://comma.example.com")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  COMMA_DB: z.string().min(1).default("comma.sqlite"),
  COMMA_DB_TOKEN: z.string().optional(),
  COMMA_FILES: z.enum(["db", "s3"], "Set COMMA_FILES to db or s3").default("db"),
  COMMA_S3_BUCKET: z.string().optional(),
  COMMA_S3_REGION: z.string().optional(),
  COMMA_S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  COMMA_S3_ACCESS_KEY_ID: z.string().optional(),
  COMMA_S3_SECRET_ACCESS_KEY: z.string().optional(),
  // AWS Lambda sets these for the function role.
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SESSION_TOKEN: z.string().optional(),
  AWS_REGION: z.string().optional(),
})

export type Settings = {
  secret: string
  publicUrl?: string
  /** `local`: a file or `:memory:`. Only local databases need the native client. */
  db: { url: string; authToken?: string; local: boolean }
  files?: FileStore
}

/** Reads and checks the settings. Throws an error with a message for the person who deploys. */
export function readSettings(env: Record<string, string | undefined>): Settings {
  const parsed = Env.safeParse(env)
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("\n"))
  const e = parsed.data
  // A plain path is a file. Remote: libsql://, https://, http:// (local sqld).
  const url = /^(file:|:memory:$|[a-z]+:\/\/)/.test(e.COMMA_DB) ? e.COMMA_DB : `file:${e.COMMA_DB}`
  const local = url.startsWith("file:") || url === ":memory:"
  return {
    secret: e.COMMA_SECRET,
    publicUrl: e.COMMA_URL,
    db: { url, authToken: e.COMMA_DB_TOKEN, local },
    files: e.COMMA_FILES === "s3" ? s3(e) : undefined,
  }
}

function s3(e: z.infer<typeof Env>): FileStore {
  const own = !!e.COMMA_S3_ACCESS_KEY_ID
  const bucket = e.COMMA_S3_BUCKET
  const region = e.COMMA_S3_REGION ?? e.AWS_REGION ?? (e.COMMA_S3_ENDPOINT ? "auto" : undefined)
  const accessKeyId = own ? e.COMMA_S3_ACCESS_KEY_ID : e.AWS_ACCESS_KEY_ID
  const secretAccessKey = own ? e.COMMA_S3_SECRET_ACCESS_KEY : e.AWS_SECRET_ACCESS_KEY
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "With COMMA_FILES=s3, set COMMA_S3_BUCKET, COMMA_S3_REGION (or COMMA_S3_ENDPOINT), COMMA_S3_ACCESS_KEY_ID and COMMA_S3_SECRET_ACCESS_KEY",
    )
  }
  return s3Files({
    bucket,
    region,
    endpoint: e.COMMA_S3_ENDPOINT,
    accessKeyId,
    secretAccessKey,
    sessionToken: own ? undefined : e.AWS_SESSION_TOKEN,
  })
}
