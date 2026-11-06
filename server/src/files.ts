// Where image bytes live, if not in the database: S3 or an S3 API (Cloudflare R2, MinIO).
// The `files` table keeps the metadata in both cases.
import { AwsClient } from "aws4fetch"

export type FileStore = {
  put(id: string, data: Uint8Array<ArrayBuffer>, mime: string): Promise<void>
  get(id: string): Promise<Uint8Array<ArrayBuffer> | null>
  delete(ids: string[]): Promise<void>
}

export type S3Options = {
  bucket: string
  region: string
  /** R2, MinIO and others. Default: AWS S3. */
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  /** Temporary credentials, for example of a Lambda role. */
  sessionToken?: string
}

export function s3Files(o: S3Options): FileStore {
  const aws = new AwsClient({
    accessKeyId: o.accessKeyId,
    secretAccessKey: o.secretAccessKey,
    sessionToken: o.sessionToken,
    service: "s3",
    region: o.region,
    retries: 2,
  })
  // With an endpoint: path-style URLs (R2 and MinIO need them). AWS: the bucket host.
  const base = o.endpoint
    ? `${o.endpoint.replace(/\/$/, "")}/${o.bucket}`
    : `https://${o.bucket}.s3.${o.region}.amazonaws.com`
  const url = (id: string) => `${base}/files/${encodeURIComponent(id)}`
  const check = async (res: Response, action: string) => {
    if (!res.ok) throw new Error(`S3 ${action} failed: ${res.status} ${await res.text()}`)
  }
  return {
    async put(id, data, mime) {
      await check(await aws.fetch(url(id), { method: "PUT", body: data, headers: { "content-type": mime } }), "put")
    },
    async get(id) {
      const res = await aws.fetch(url(id), { method: "GET" })
      if (res.status === 404) return null
      await check(res, "get")
      return new Uint8Array(await res.arrayBuffer())
    },
    async delete(ids) {
      await Promise.all(
        ids.map(async (id) => {
          const res = await aws.fetch(url(id), { method: "DELETE" })
          if (res.status !== 404) await check(res, "delete")
        }),
      )
    },
  }
}
