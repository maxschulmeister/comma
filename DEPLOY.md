# Deploy comma

This file is for agents that deploy comma for a user. Read all of it before you start.

## Targets

| Target | Database | Images | Status |
| --- | --- | --- | --- |
| [Docker](#docker) (VPS) | SQLite file | in the database | Ready |
| [AWS Lambda](#aws-lambda) | Turso | database or S3 | Needs [serverless support](#serverless-support) |
| [Cloudflare Workers](#cloudflare-workers) | Turso | database or R2 | Needs [serverless support](#serverless-support) |
| [Vercel](#vercel) | Turso | database or S3 | Needs [serverless support](#serverless-support) |

Do not deploy to a target that is not ready. Tell the user, and offer to implement [serverless support](#serverless-support) first.

If the user has no preference, use Docker. It is the simplest and has no request limits.

## Before you start

Ask the user:

1. The target, and the address for comma (for example `https://comma.example.com`). Who controls the DNS?
2. The projects. For each: `id`, the `origins` (sites that use comma), and optional app sign-in (`appSecret`, `signInUrl`). See [README.md](README.md#sign-in-with-your-app).
3. Serverless only: the Turso database (or permission to create one), and images in the database or in S3/R2.

Secrets:

- Make new secrets with `openssl rand -hex 32`.
- Put them only in the platform secret store or in `.env` on the server. Never commit them. Do not write them in chat or in logs.
- Tell the user where each secret is stored. `COMMA_SECRET` is the same for the life of the install. If it changes, all users must sign in again.
- An `appSecret` is shared with the user's app. The user puts the same value in the app backend.

## Settings

| Env | Default | |
| --- | --- | --- |
| `COMMA_SECRET` | (required) | Signs session tokens. 32 or more random characters. |
| `COMMA_DB` | `comma.sqlite` | SQLite file. |
| `COMMA_CONFIG` | `comma.config.ts` | Projects. |
| `PORT` | `4000` | |
| `COMMA_URL` | (the request) | Public address, for example `https://comma.example.com`. Always set it in production. |
| `<PROJECT>_SECRET` | | One per project with app sign-in. The name is what `comma.config.ts` reads. |

Planned with [serverless support](#serverless-support): `COMMA_DB` also takes `libsql://` and `https://` URLs, plus `COMMA_DB_TOKEN`, `COMMA_FILES` (`db` or `s3`) and `COMMA_S3_*`.

## Projects

Projects are in `comma.config.ts`. To add, change or remove a project:

1. Edit `comma.config.ts`. Add the env for a new `appSecret`.
2. Restart (Docker) or redeploy (serverless).
3. Run the [checks](#checks) for that project.

Each site then adds one tag:

```html
<script src="https://comma.example.com/c.js" data-project="acme" defer></script>
```

## Checks

Run these after each deploy. Replace the address, project and origin.

```sh
URL=https://comma.example.com
# 1. Widget: 200, cache-control "public, max-age=300", access-control-allow-origin "*"
curl -sI "$URL/c.js"
# 2. Project, from a registered origin: {"id":"acme",...}
curl -s -H "Origin: https://www.acme.com" "$URL/api/projects/acme"
# 3. Project, from another origin: 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://not-registered.example" "$URL/api/projects/acme"
```

Then in a browser, on a page of the site:

1. Press `C`, click an element, send a comment with an image.
2. Reload. The pin is on the same element. The image loads.
3. With popup sign-in: the app must accept `redirect_uri` = `$COMMA_URL/auth/callback`. Sign in with the popup.

If a check fails, look at the server logs before you change anything.

## Docker

For a VPS with Docker and a reverse proxy for HTTPS. The server keeps the database on a volume.

The repo has no `Dockerfile` yet. Add these files once, and commit them:

`Dockerfile`:

```dockerfile
FROM oven/bun:1.3
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build
RUN mkdir /data && chown bun:bun /data
USER bun
ENV COMMA_DB=/data/comma.sqlite PORT=4000
VOLUME /data
EXPOSE 4000
CMD ["bun", "run", "start"]
```

`.dockerignore`:

```
.git
**/node_modules
widget/dist
*.sqlite*
.env
test-results
playwright-report
```

`compose.yaml`:

```yaml
services:
  comma:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - comma-data:/data
      - ./comma.config.ts:/app/comma.config.ts:ro
    ports:
      - "127.0.0.1:4000:4000"
volumes:
  comma-data:
```

On the server:

1. Point DNS for the comma address to the server.
2. Clone the repo. Edit `comma.config.ts`.
3. Write `.env` with `COMMA_SECRET`, `COMMA_URL` and the project secrets. `chmod 600 .env`.
4. `docker compose up -d --build`
5. Proxy HTTPS to `127.0.0.1:4000`. With Caddy:

   ```
   comma.example.com {
     reverse_proxy 127.0.0.1:4000
   }
   ```

   With nginx, set `client_max_body_size 6m`. If the proxy changes the `Host` header, it must send `X-Forwarded-Host`.

6. Run the [checks](#checks).

Rules:

- Run **one** container. The rate limit is in memory, and SQLite has one writer.
- Projects: edit `comma.config.ts`, then `docker compose restart`. No rebuild.
- Update: `git pull && docker compose up -d --build`. Before you update, make a backup.
- Roll back: `git checkout <previous commit> && docker compose up -d --build`.

Backup. Do not copy the database file while comma runs. Use `vacuum into`, which makes a consistent copy:

```sh
docker compose exec comma bun -e \
  "new (require('bun:sqlite').Database)('/data/comma.sqlite').exec(\"vacuum into '/data/backup.sqlite'\")"
docker compose cp comma:/data/backup.sqlite ./comma-$(date +%F).sqlite
docker compose exec comma rm /data/backup.sqlite
```

Run it every day (cron) and copy the file off the server. Or ask the user if they want [Litestream](https://litestream.io) to stream the database to S3.

## Serverless support

AWS Lambda, Cloudflare Workers and Vercel need these code changes first. Do them on a branch, with tests. Ask the user before you start: it changes every database call.

1. **Database: libSQL.** Replace `bun:sqlite` with `@libsql/client` (on Workers: `@libsql/client/web`).
   - `COMMA_DB` takes `file:comma.sqlite`, `libsql://…` (Turso) or `https://…` (own `sqld`). `COMMA_DB_TOKEN` is the auth token.
   - All queries become async. Transactions use `batch` or `transaction`.
   - Set the `pragma`s only for `file:` URLs.
   - Run the schema at start. It uses `if not exists`, so a cold start can run it.
   - Each query is a network round trip to Turso. The poll (`GET /api/threads` with `ETag`) must stay at one query when nothing changed.
2. **No Bun APIs in the app.** `createApp` gets all it needs as arguments. One entry file per target: `server/src/entry/bun.ts` (now `index.ts`), `lambda.ts`, `worker.ts`, `vercel.ts`. Each entry checks `COMMA_SECRET` and `COMMA_URL`, as `index.ts` does now. On Lambda, secrets come from one Secrets Manager value (`COMMA_SECRETS_ARN`, JSON). The entry reads it at cold start and sets `process.env` before it loads the config.
3. **Widget files.** `widgetRoutes` reads with `Bun.file`. Give it a `read(path)` function. Keep the same headers on all targets (CORS `*`, cache rules). Bun and Lambda read `widget/dist` from disk. Workers use the assets binding.
4. **Config.** Bundle `comma.config.ts` into the build. Workers cannot import a path at runtime.
5. **Images.** Add a file store with two implementations:
   - `db`: as now.
   - `s3`: AWS S3, Cloudflare R2 or MinIO (`COMMA_S3_BUCKET`, `COMMA_S3_REGION`, `COMMA_S3_ENDPOINT`, `COMMA_S3_ACCESS_KEY_ID`, `COMMA_S3_SECRET_ACCESS_KEY`). On Lambda, use the function role, not keys. `GET /files/:id` redirects to a short presigned URL.
   - Request limits: Lambda allows 6 MB **after** base64, so about 4.4 MB of image. Vercel allows 4.5 MB. So the image limit is 4 MB on all targets. Before the upload, the widget makes large images smaller (see PLAN.md, "Images"), so real uploads are much smaller.
6. **Cleanup.** `setInterval` does not run on serverless. Run `cleanupFiles` from a schedule: EventBridge (Lambda), a Cron Trigger (Workers), Vercel Cron (a route that checks `Authorization: Bearer $CRON_SECRET`).
7. **Rate limit.** It is in memory, so on serverless each instance counts alone. This is acceptable for v1. Tell the user.

Costs: the widget polls every 15 s while a person uses the page, about 1,900 requests in 8 hours of use. It stops after 5 minutes with no input (see PLAN.md, "Unread and updates"). A team of 10 makes about 20,000 requests per workday. This is in the free tier of all three platforms.

## AWS Lambda

Use AWS SAM. It makes one CloudFormation stack, so updates roll back on failure and `sam delete` removes everything.

Before you start:

- `aws sts get-caller-identity` works. `sam --version` works.
- Turso: `turso db create comma --location <near the AWS region>`, then `turso db show comma --url` and `turso db tokens create comma`.

Build: bundle `server/src/entry/lambda.ts` for Node with `bun build --target=node`, into `dist/lambda/`. Copy `widget/dist` next to it.

`template.yaml`:

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Parameters:
  PublicUrl: { Type: String }
  CommaDb: { Type: String }
  UseS3: { Type: String, AllowedValues: ["true", "false"], Default: "false" }
Conditions:
  WithS3: !Equals [!Ref UseS3, "true"]
Resources:
  Files:
    Type: AWS::S3::Bucket
    Condition: WithS3
    Properties:
      PublicAccessBlockConfiguration:
        { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }
  Comma:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: dist/lambda
      Handler: index.handler
      Runtime: nodejs22.x
      Architectures: [arm64]
      MemorySize: 512
      Timeout: 15
      FunctionUrlConfig: { AuthType: NONE }
      Environment:
        Variables:
          COMMA_URL: !Ref PublicUrl
          COMMA_DB: !Ref CommaDb
          COMMA_FILES: !If [WithS3, s3, db]
          COMMA_S3_BUCKET: !If [WithS3, !Ref Files, ""]
          COMMA_SECRETS_ARN: !Ref Secrets
      Policies:
        - AWSSecretsManagerGetSecretValuePolicy: { SecretArn: !Ref Secrets }
        - !If [WithS3, { S3CrudPolicy: { BucketName: !Ref Files } }, !Ref AWS::NoValue]
      Events:
        Cleanup: { Type: ScheduleV2, Properties: { ScheduleExpression: rate(1 hour) } }
  Secrets:
    Type: AWS::SecretsManager::Secret
    Properties:
      Description: COMMA_SECRET, COMMA_DB_TOKEN and project secrets, as JSON
Outputs:
  Url: { Value: !GetAtt CommaUrl.FunctionUrl }
```

Steps:

1. `sam build && sam deploy --guided`. The first time `PublicUrl` is not known yet: use the Function URL, then deploy again with the real address.
2. Put the secrets as one JSON value: `aws secretsmanager put-secret-value --secret-id <arn> --secret-string file://secrets.json`. Delete `secrets.json`. The entry reads them at cold start.
3. Custom domain: Function URLs do not take one. Put CloudFront in front, with an ACM certificate in `us-east-1`. Forward all headers except `Host`, and do not cache `/api/*`. Or use the Function URL as the address.
4. Run the [checks](#checks). Logs: `sam logs --tail`.

Update: `sam build && sam deploy`. Remove: `sam delete` (the S3 bucket must be empty).

## Cloudflare Workers

Before you start: `npx wrangler whoami` works. Turso as for Lambda. For images in R2: `npx wrangler r2 bucket create comma-files`, and an R2 API token for the S3 API.

`wrangler.jsonc`:

```jsonc
{
  "name": "comma",
  "main": "server/src/entry/worker.ts",
  "compatibility_date": "2025-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "widget/dist", "binding": "ASSETS", "run_worker_first": true },
  "triggers": { "crons": ["0 * * * *"] },
  "routes": [{ "pattern": "comma.example.com", "custom_domain": true }],
  "vars": { "COMMA_URL": "https://comma.example.com", "COMMA_DB": "libsql://…turso.io" }
}
```

- `run_worker_first`: the Worker serves the widget files through `ASSETS`, with the comma headers. Without it, Cloudflare serves them with no CORS header.
- `nodejs_compat` and a date from 2025-04-01 fill `process.env` from vars and secrets. `comma.config.ts` reads `process.env`. Check that it gets the values.
- The entry exports `fetch` and `scheduled` (cleanup).

Steps:

1. `bun run build`
2. `npx wrangler secret put COMMA_SECRET` (and `COMMA_DB_TOKEN`, project secrets, R2 keys).
3. `npx wrangler deploy`. The custom domain needs the zone on the same Cloudflare account.
4. Run the [checks](#checks). Logs: `npx wrangler tail`.

Limits: the free plan allows 10 ms CPU per request and 100,000 requests per day. If you see "exceeded CPU" errors, the user needs the paid plan.

## Vercel

Before you start: `vercel whoami` works. Turso as for Lambda. The Hobby plan is for non-commercial use only. Tell the user.

- Use the current Hono on Vercel guide for the entry (`server/src/entry/vercel.ts`). Use the Node.js runtime.
- Include `widget/dist` in the function files, so the app serves the widget with its own headers.
- Cleanup: add a cron in `vercel.json` that calls the cleanup route. Set `CRON_SECRET`. Vercel sends it as `Authorization: Bearer …`. On Hobby, a cron runs at most once a day. This is enough for cleanup.

Steps:

1. `vercel link`
2. `vercel env add` for `COMMA_SECRET`, `COMMA_URL`, `COMMA_DB`, `COMMA_DB_TOKEN`, `CRON_SECRET`, project secrets and S3 keys (production).
3. `vercel deploy --prod`
4. `vercel domains add comma.example.com`, then set the DNS record that Vercel shows.
5. Run the [checks](#checks). Logs: `vercel logs <deployment url>`.

Limits: request and response bodies are up to 4.5 MB (see [images](#serverless-support)).
