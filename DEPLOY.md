# Deploy comma

This file is for agents that deploy comma for a user. Read all of it before you start.

## Targets

| Target                                    | Database    | Images          | Files                                       |
| ----------------------------------------- | ----------- | --------------- | ------------------------------------------- |
| [Docker](#docker) (VPS)                   | SQLite file | in the database | `Dockerfile`, `compose.yaml`                |
| [AWS Lambda](#aws-lambda)                 | Turso       | S3 or Turso     | `template.yaml`, `scripts/deploy-lambda.sh` |
| [Cloudflare Workers](#cloudflare-workers) | Turso       | R2 (S3 API)     | `wrangler.jsonc`, `server/src/worker.ts`    |
| [Vercel](#vercel)                         | Turso       | S3 or R2        | `vercel.json`, `server.ts`                  |

If the user has no preference, use Docker. It is the simplest and has no request limits.

On serverless targets, images can be in S3, R2 or the Turso database. A 4 MB image in Turso works (tested on AWS Lambda).

Tested on this repo, on a local machine: the Docker image, the Worker (`wrangler dev`) and the Vercel function (on Node). Tested on AWS: `scripts/deploy-lambda.sh` with images in Turso (all checks, the cleanup, a second deploy). Not tested yet: images in S3 on AWS, and a real deploy on Cloudflare or Vercel. At the first real deploy, run all [checks](#checks) and tell the user the result.

## Before you start

Ask the user:

1. The target, and the address for comma (for example `https://comma.example.com`). Who controls the DNS?
2. The projects. For each: `id`, the `origins` (sites that use comma), and optional sign-in: app (`appSecret`, `userUrl`, `signInUrl`) or Slack (`slack`). See [README.md](README.md#sign-in-with-your-app).
3. Serverless only: the Turso database (or permission to create one), and the S3 bucket or R2 bucket (or permission to create one).

Secrets:

- Make new secrets with `openssl rand -hex 32`.
- Put them only in the platform secret store or in `.env` on the server. Never commit them. Do not write them in chat or in logs.
- Tell the user where each secret is stored. `COMMA_SECRET` is the same for the life of the install. If it changes, all users must sign in again.
- An `appSecret` is shared with the user's app. The user puts the same value in the app backend.

Turso (serverless targets):

```sh
turso db create comma --location <a location near the function>
turso db show comma --url        # COMMA_DB
turso db tokens create comma     # COMMA_DB_TOKEN (secret)
```

## Settings

All targets read the same env. See the table in [README.md](README.md#server-settings). Also:

- `<PROJECT>_SECRET`: one per project with app sign-in. The name is what `comma.config.ts` reads.
- `<PROJECT>_SLACK_SECRET`: one per project with Slack sign-in. The Slack app also needs the redirect URL `$COMMA_URL/auth/slack/callback`.
- On AWS Lambda, these secrets are one JSON object in `COMMA_PROJECT_SECRETS` (see [AWS Lambda](#aws-lambda)).
- `CRON_SECRET`: Vercel only (cleanup).

If a setting is missing or wrong, comma stops with a message that names the setting. Look at the logs.

## Projects

Projects are in `comma.config.ts`. To add, change or remove a project:

1. Edit `comma.config.ts`. Add the env for a new `appSecret`.
2. Docker: `docker compose restart`. Serverless: build and deploy again (the build includes the projects). The Lambda build reads `COMMA_CONFIG` too, so the projects can be in a file outside the repo.
3. Run the [checks](#checks) for that project.

Each site then adds one tag:

```html
<script src="https://comma.example.com/c.js" data-project="acme" defer></script>
```

## Move from SitePing

`scripts/siteping/import.ts` copies the feedback of one SitePing project into a comma project. It only reads SitePing. Make a backup of the SitePing database first (`turso db shell <db> .dump > siteping.sql`).

```sh
SITEPING_DB=libsql://… SITEPING_DB_TOKEN=… COMMA_DB=… [COMMA_DB_TOKEN, COMMA_FILES=s3 and its settings] \
[PREVIEW_AUTH=user:password] \
bun scripts/siteping/import.ts --from <SitePing project> --project <comma project> --origin https://www.acme.com
```

- Each feedback becomes a thread: the message is the first comment (the type, if not "other", is its first word), the replies follow, the screenshot is the thread's screenshot. Each author name becomes one guest.
- The pins: Chromium opens each page of the site (`PREVIEW_AUTH` for basic auth) and finds the element as SitePing did. If it is not sure, the thread is detached: it shows in the panel as "Element not found". Nobody can move it, because its author is an imported guest.
- A second run adds only what is new. Import into a test database first (`COMMA_DB=test.sqlite`), and check the report.

## Checks

Run this after each deploy, with a project and one of its origins:

```sh
bun scripts/check-deploy.ts https://comma.example.com --project acme --origin https://www.acme.com
```

It checks the widget files and their headers, the origin check, a session (database write), the threads (database read), and an image upload and download. It makes a user named "Deploy check" and one unused image. Cleanup deletes the image after 24 h.

A project without guests (see `guests` in README.md): give the check the project's app secret in `COMMA_APP_SECRET`. It then signs in as an app user.

Then in a browser, on a page of the site:

1. Press `C`, click an element, send a comment with an image.
2. Reload. The pin is on the same element. The image loads.
3. With popup sign-in: the app must accept `redirect_uri` = `$COMMA_URL/auth/callback`. Sign in with the popup.

If a check fails, look at the server logs before you change anything.

## Updates

comma does not update itself. To update an install, get the new code, then:

| Target  | Update                                                                                      |
| ------- | ------------------------------------------------------------------------------------------- |
| Docker  | Make a [backup](#backup), then `git pull && docker compose up -d --build`                   |
| Lambda  | `STACK=… AWS_REGION=… [COMMA_CONFIG=…] scripts/deploy-lambda.sh`                            |
| Workers | `bun install && bun run build && bun scripts/public.ts --cloudflare && npx wrangler deploy` |
| Vercel  | `vercel deploy --prod` (or a push, if the project is linked to Git)                         |

New tables and indexes come at start. Then run the [checks](#checks).

## Docker

For a VPS with Docker and a reverse proxy for HTTPS. The database is on a volume.

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

- Run **one** container. SQLite has one writer.
- Images in S3 are possible (`COMMA_FILES=s3`), but not needed on a VPS.
- Roll back: `git checkout <previous commit> && docker compose up -d --build`.

### Backup

Do not copy the database file while comma runs. Use `vacuum into`, which makes a consistent copy:

```sh
docker compose exec comma bun -e \
  "new (require('bun:sqlite').Database)('/data/comma.sqlite').exec(\"vacuum into '/data/backup.sqlite'\")"
docker compose cp comma:/data/backup.sqlite ./comma-$(date +%F).sqlite
docker compose exec comma rm /data/backup.sqlite
```

Run it every day (cron) and copy the file off the server. Or ask the user if they want [Litestream](https://litestream.io) to stream the database to S3.

## AWS Lambda

`scripts/deploy-lambda.sh` deploys with the AWS CLI only (no SAM CLI, no bucket for the code). It builds comma, makes or updates one CloudFormation stack from `template.yaml`, then uploads the code to the function. The stack has the function with a Function URL, an hourly cleanup schedule, and (with `UseS3=true`, the default) a private S3 bucket for images. Updates roll back on failure.

Before you start: `aws sts get-caller-identity` works, and `zip` is installed. Make the Turso database (see [Before you start](#before-you-start)).

1. Secrets in `comma.config.ts` (`appSecret`, Slack client secret) go into the parameter `ProjectSecrets`, as one JSON object. The config reads them at start:

   ```ts
   const secrets = JSON.parse(process.env.COMMA_PROJECT_SECRETS ?? "{}")
   export default { projects: [{ id: "acme", origins: ["https://www.acme.com"], appSecret: secrets.ACME_SECRET }] }
   ```

2. Write the parameters to a file outside the repo, readable only by the user (`chmod 600`). Leave out `PublicUrl` the first time.

   ```json
   ["CommaDb=libsql://…", "CommaDbToken=…", "CommaSecret=…", "UseS3=true", "ProjectSecrets={\"ACME_SECRET\":\"…\"}"]
   ```

3. Deploy. `COMMA_CONFIG` is optional: a projects file outside the repo.

   ```sh
   STACK=comma AWS_REGION=eu-central-1 COMMA_CONFIG=… scripts/deploy-lambda.sh \
     --parameter-overrides file:///path/to/parameters.json
   ```

   It prints the Function URL. Later deploys keep the parameters that are not given: `STACK=… AWS_REGION=… scripts/deploy-lambda.sh`.

4. Set `PublicUrl` to the Function URL or the custom domain: `… scripts/deploy-lambda.sh --parameter-overrides PublicUrl=https://…`. Only Slack sign-in needs it.
5. Custom domain: Function URLs do not take one. Put CloudFront in front, with an ACM certificate in `us-east-1`. Forward all headers except `Host`, and do not cache `/api/*`. Or use the Function URL as the address.
6. Run the [checks](#checks). Logs: `aws logs tail /aws/lambda/<function name> --follow` (the stack output `FunctionName`).

Notes:

- The secrets are Lambda env vars. AWS encrypts them at rest. People with `lambda:GetFunctionConfiguration` can read them.
- Requests and responses are up to 6 MB after base64. Images are up to 4 MB, so they fit.
- `UseS3=false` keeps images in Turso. A 4 MB image works (tested: about 4.5 s to write from Europe to `eu-north-1`, 0.2 s to read).
- A public Function URL needs `lambda:InvokeFunctionUrl` and, since October 2025, `lambda:InvokeFunction`. The template adds both. If `/c.js` gives 403, check the function's resource policy first.
- Remove: empty the S3 bucket (if any), then `aws cloudformation delete-stack --stack-name <stack>`, and the log group `/aws/lambda/<function name>`.

## Cloudflare Workers

The Worker runs the API. The widget files are static assets in `public/`, with headers in `public/_headers`.

Before you start: `npx wrangler whoami` works. Make the Turso database. For images in R2: `npx wrangler r2 bucket create comma-files`, and an R2 API token with read and write access to it.

1. In `wrangler.jsonc`: set `routes` (the custom domain needs the zone on the same account), and in `vars`: `COMMA_URL`, `COMMA_DB`. For R2, also `COMMA_FILES: "s3"`, `COMMA_S3_BUCKET` and `COMMA_S3_ENDPOINT: "https://<account id>.r2.cloudflarestorage.com"`.
2. Secrets: `npx wrangler secret put COMMA_SECRET`, and the same for `COMMA_DB_TOKEN`, the project secrets, and for R2 `COMMA_S3_ACCESS_KEY_ID` and `COMMA_S3_SECRET_ACCESS_KEY`.
3. `bun install && bun run build && bun scripts/public.ts --cloudflare && npx wrangler deploy`
4. Run the [checks](#checks). Logs: `npx wrangler tail`.

Notes:

- Local test: `npx wrangler dev --var COMMA_SECRET:<secret> --var COMMA_DB:<url>`. Add `--test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"` runs the cleanup.
- The free plan allows 10 ms CPU per request and 100,000 requests per day. If you see "exceeded CPU" errors, the user needs the paid plan.

## Vercel

`server.ts` is the function (Vercel finds a Hono app there). `vercel.json` builds the widget into `public/`, sets the widget headers, and runs the cleanup once a day.

Before you start: `vercel whoami` works. Make the Turso database, and an S3 or R2 bucket for images. The Hobby plan is for non-commercial use only. Tell the user.

1. `vercel link`
2. `vercel env add` (production): `COMMA_SECRET`, `COMMA_URL`, `COMMA_DB`, `COMMA_DB_TOKEN`, `CRON_SECRET` (`openssl rand -hex 32`), the project secrets, and `COMMA_FILES=s3` with the `COMMA_S3_*` settings.
3. `vercel deploy --prod`
4. `vercel domains add comma.example.com`, then set the DNS record that Vercel shows.
5. Run the [checks](#checks). Also `curl -sI https://comma.example.com/w/chunks/<a file in public/w/chunks>` must show `cache-control: public, max-age=31536000, immutable`. Logs: `vercel logs <deployment url>`.

Notes:

- Request and response bodies are up to 4.5 MB. Images are up to 4 MB, so they fit.
- On Hobby, a cron job runs at most once a day. This is enough for the cleanup.

## How the targets differ

- `server/src/settings.ts` reads and checks the env for all targets.
- Entry files: `server/src/index.ts` (Bun, Docker), `server/src/lambda.ts`, `server/src/worker.ts`, `server/src/vercel.ts` (with `server.ts`). The serverless entries share `server/src/serverless.ts`. It needs a remote database and bundles `comma.config.ts`.
- The database client is `@libsql/client` on Bun (files and remote) and `@libsql/client/web` on serverless (remote only, no native code). Writes go in one `batch`: one round trip, atomic.
- Cleanup of unused images: a timer on Bun, EventBridge on Lambda, a Cron Trigger on Workers, Vercel Cron.
- Each open tab polls every 15 s while a person uses the page, and stops after 5 minutes with no input. A team of 10 makes about 20,000 requests per workday. This is in the free tier of all three platforms.
