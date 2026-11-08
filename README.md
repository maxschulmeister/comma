# comma

Comments pinned to any website. One script tag. Your own service.

- Press `C`, click an element, write a comment. Drag to comment on a region.
- Threads with replies, reactions, mentions, images, screenshots of the page, assignees, resolve (with undo) and unread state.
- Each new thread keeps a screenshot of its element (or region).
- Each thread keeps where it was made: the page title and URL, the scroll position, the window size, the browser, the system, the theme, the language and the time zone.
- Details in the side panel: the screenshot at full size and all of the above. Go through the threads with them open. Copy them as a bug report.
- Unsent comments stay on their pin, also after a reload.
- A panel with all comments of the site. Search, filters, keyboard navigation.
- Pins stay on their element when the page changes. If comma cannot find the element, the thread says "Element not found" and what it was on. It never moves to a wrong element.

## Run it

Requires [Bun](https://bun.sh) 1.3 or later.

```sh
bun install
cp .env.example .env   # set COMMA_SECRET and EXAMPLE_APP_SECRET (openssl rand -hex 32)
bun run build          # builds the widget
bun run start          # comma on http://localhost:4000
bun example/app.ts     # the example site on http://localhost:4100
```

`bun run dev` rebuilds the widget and restarts both servers when files change.

### Server settings

| Env                          | Default           |                                                                                                      |
| ---------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `COMMA_SECRET`               | (required)        | Signs session tokens. 32 or more random characters.                                                  |
| `COMMA_DB`                   | `comma.sqlite`    | SQLite file (back it up), or a remote libSQL database: `libsql://…` (Turso), `https://…` (own sqld). |
| `COMMA_DB_TOKEN`             |                   | Auth token of the remote database.                                                                   |
| `COMMA_CONFIG`               | `comma.config.ts` | Projects (see below).                                                                                |
| `PORT`                       | `4000`            |                                                                                                      |
| `COMMA_URL`                  | (the request)     | Address of comma, behind a proxy: `https://comma.example.com`. Popup sign-in sends it to your app.   |
| `COMMA_FILES`                | `db`              | Where images are: `db` (in the database) or `s3`.                                                    |
| `COMMA_S3_BUCKET`            |                   | With `s3`.                                                                                           |
| `COMMA_S3_REGION`            |                   | With `s3`. Not needed with an endpoint.                                                              |
| `COMMA_S3_ENDPOINT`          | (AWS S3)          | Another S3 API: Cloudflare R2, MinIO.                                                                |
| `COMMA_S3_ACCESS_KEY_ID`     | (the AWS role)    | With `s3`. On AWS Lambda, comma uses the function role.                                              |
| `COMMA_S3_SECRET_ACCESS_KEY` | (the AWS role)    |                                                                                                      |

To deploy, see [DEPLOY.md](DEPLOY.md).

## Add comma to a site

1. Add the project to `comma.config.ts`. `origins` are the sites that may use it.

   ```ts
   export default {
     projects: [{ id: "acme", origins: ["https://www.acme.com", "http://localhost:3000"] }],
   }
   ```

2. Add the script tag to the pages:

   ```html
   <script src="https://comma.example.com/c.js" data-project="acme" defer></script>
   ```

People sign in as guests with a name. To use the accounts of your app, see below.

### Project settings

| Setting     |                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | Required. Lowercase letters, digits, `-` and `_`.                                                                                                                                                                |
| `origins`   | Required. The sites that may use the project. `*` matches one subdomain label: `https://*.preview.acme.com`.                                                                                                     |
| `scope`     | `"project"` (default): all origins share the comments. `"origin"`: each origin has its own comments, for example one per preview deploy.                                                                         |
| `name`      | The name of your app, on the sign-in button: "Sign in with Acme".                                                                                                                                                |
| `appSecret` | Sign in with your app: your backend signs a token (see below).                                                                                                                                                   |
| `userUrl`   | Sign in with your app: comma checks your app's own access token with your API (see below). Use `appSecret` or `userUrl`, not both.                                                                               |
| `user`      | With `userUrl`: a function that reads the user from the answer. Default: the answer itself.                                                                                                                      |
| `appUrl`    | Sign-in through your app, on sites outside it: a page of your app that runs comma with `identify()` (see below).                                                                                                 |
| `signInUrl` | Popup sign-in on sites outside your app (see below).                                                                                                                                                             |
| `slack`     | Sign in with Slack, for the people of one workspace (see below).                                                                                                                                                 |
| `guests`    | `true`: people can sign in as guests with only a name. Anyone can use any name. Default: `true` without app sign-in, `false` with it. Guests show as "Guest" next to their name.                                 |
| `limits`    | Per hour. `commentsPerHour` (default `100`) and `imagesPerHour` (default `100`) per user, `guestsPerHour` (default `30`): new guest sign-ins for all people together. Example: `limits: { guestsPerHour: 100 }`. |
| `toolbar`   | `"always"` (default) or `"signed-in"`: visitors see no toolbar until they sign in. To sign in, open a page with `?comma` in the URL (`https://www.acme.com/?comma`). Links to a thread also ask to sign in.      |
| `details`   | Default place of a thread's details (screenshot, page, device): `"panel"` (default, a layer of the side panel) or `"dialog"` (a window over the page). Each person can change it in the panel's view menu.       |
| `panel`     | Default of the side panel: `"overlay"` (default) floats over the page and keeps its width; `"push"` makes the page narrower and covers nothing. Each person can change it in the panel's view menu.              |

`guests` is a change for projects with `appSecret` that used guests before: set `guests: true` to keep them.

### Script tag settings

| Attribute         |                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-project`    | Required. The project id.                                                                                                                                       |
| `data-shortcut`   | The key for comment mode, one letter. Default: `c`. `none`: no shortcut, for apps that use the letter themselves.                                               |
| `data-token-key`  | With `data-token-from`: the storage key of your app's token. comma signs out when your app removes it.                                                          |
| `data-token-from` | With `userUrl`: the address of your API (`https://api.acme.com`). comma signs in with the token of your app's own requests to it, with no app code (see below). |

comma can run behind a proxy, also on the same origin as the site. Set `COMMA_URL` to its public address. If the proxy changes the `Host` header, it must send `X-Forwarded-Host`.

Add `data-comment-anchor="pricing"` to an element to give it a very stable anchor. Comments on it find it again, also when its text changes or it moves.

## Sign in with your app

Two ways. Both use `comma.identify(token)` on the page:

- **Your app's API** (`userUrl`): comma sends the access token your app already has to an endpoint of your API. No backend change.
- **A signed token** (`appSecret`): your backend signs a short token for comma.

### With your app's API: `userUrl`

Most apps have an endpoint that returns the signed-in user, for example `GET /api/me`. comma calls it with `Authorization: Bearer <token>`:

- `200`: comma reads the user with `user` and signs them in.
- `4xx`: the sign-in fails.
- Other answers, or no answer in 5 s: the sign-in fails with `502`. Try again.

```ts
{
  id: "acme",
  origins: ["https://*.preview.acme.com"],
  scope: "origin",
  userUrl: "https://api.acme.com/me",
  // The fields of the signed token below: sub and name are required.
  user: (body) => ({ sub: body.id, name: body.full_name, email: body.email }),
}
```

On the page, give comma the access token when the user is signed in:

```js
window.comma.identify(accessToken)
```

comma does not keep the access token. Use HTTPS for `userUrl`.

#### Without app code: `data-token-from`

If you cannot change the app's code (for example, comma only on preview builds, added to the HTML at build time), comma can take the token from the app's own requests:

```html
<script src="https://comma.example.com/c.js" data-project="acme" data-token-from="https://api.acme.com"></script>
```

- comma reads the `Authorization: Bearer` header of the app's `fetch` and `XMLHttpRequest` calls to that address. It never changes a request, and sends the token only to the comma server, which checks it with `userUrl`.
- It signs in with the first token on each page load, and again when a token comes after requests without one (another person may have signed in). Requests without a token for 5 s: comma signs out.
- Many apps sign out with no request after it: they only remove the token from storage. Add `data-token-key` with the `localStorage` or `sessionStorage` key of the token. comma then signs out when the app removes it (also in another tab), and at page load when it is missing.
- Put the tag before the app's scripts, without `defer`, so comma sees the first requests.
- With `toolbar: "signed-in"`, comma shows nothing until the app signs in.

### With a signed token: `appSecret`

One rule: **your app signs a short token, comma trusts it.**

Add `appSecret` to the project. Use the same secret in your app backend.

```ts
{ id: "acme", origins: ["https://app.acme.com"], appSecret: process.env.ACME_SECRET }
```

### In your app: `comma.identify(token)`

Add one endpoint that signs a token for the signed-in user. JWT, HS256, signed with the project secret:

| Claim             |                                                   |
| ----------------- | ------------------------------------------------- |
| `sub`             | User id in your app. Required.                    |
| `name`            | Display name. Required.                           |
| `email`, `avatar` | Optional. `avatar` is an image URL.               |
| `admin`           | Optional. `true` lets the user delete any thread. |
| `exp`             | Required. 5 minutes or less from now.             |

A session of an app user lasts 7 days, a guest session 90 days. In your app, `identify` signs in again on each page load. Someone who leaves your app keeps comma access for at most 7 days. Sign-out ends the session on the server.

```ts
import { sign } from "hono/jwt" // or any JWT library

app.get("/comma-token", async (c) => {
  const user = await currentUser(c) // your session
  if (!user) return c.json({ error: "Not signed in" }, 401)
  const token = await sign(
    { sub: user.id, name: user.name, avatar: user.avatarUrl, exp: Math.floor(Date.now() / 1000) + 120 },
    process.env.ACME_SECRET,
    "HS256",
  )
  return c.json({ token })
})
```

On the page, after the comma script tag:

```html
<script type="module">
  const res = await fetch("/comma-token")
  if (res.ok) window.comma.identify((await res.json()).token)
</script>
```

`window.comma.signOut()` signs the user out of comma. Call it when the user signs out of your app.

### On other sites: through your app

If your app runs comma with `comma.identify()`, the other sites of the project (a marketing site, preview deploys) can sign people in through it. Add `appUrl`, a page of your app with comma on it, and the other sites to `origins`:

```ts
{
  id: "acme",
  origins: ["https://app.acme.com", "https://www.acme.com", "https://*.preview.acme.com"],
  scope: "origin",
  userUrl: "https://api.acme.com/me", // or appSecret
  user: (body) => ({ sub: body.id, name: body.full_name, email: body.email }),
  appUrl: "https://app.acme.com/",
}
```

"Sign in with Acme" opens the app in a popup. If people are not signed in to the app, the app's own login shows, of any kind. Then comma in the app hands the user over to the site that opened the popup, and the popup closes. Your app needs no extra page, and its token never leaves the app: comma in the app asks the comma server for a hand-over, which works for one minute, only on that site.

The page must keep comma running through the app's login, or come back to a page with comma after it. A single-page app does this.

### On other sites: popup sign-in

For sites outside your app (a marketing site, a preview deploy), comma can also open a sign-in page of your app in a popup. Use it if your app does not run comma. Add `signInUrl`:

```ts
{
  id: "acme",
  origins: ["https://www.acme.com", "https://app.acme.com"],
  appSecret: process.env.ACME_SECRET,
  signInUrl: "https://app.acme.com/comma-sign-in",
}
```

comma opens `signInUrl?redirect_uri=…&state=…`. Your page:

1. Checks that `redirect_uri` is `https://<your comma server>/auth/callback`. Refuse other values.
2. Signs the user in with your normal login, if needed.
3. Redirects to `redirect_uri` with `token` (signed as above) and the same `state`.

```ts
app.get("/comma-sign-in", async (c) => {
  const redirect = c.req.query("redirect_uri")
  if (redirect !== "https://comma.example.com/auth/callback") return c.text("Bad redirect_uri", 400)
  const user = await currentUser(c)
  if (!user) return c.redirect(`/login?next=${encodeURIComponent(c.req.url)}`)
  const url = new URL(redirect)
  url.searchParams.set("token", await signCommaToken(user))
  url.searchParams.set("state", c.req.query("state") ?? "")
  return c.redirect(url.href)
})
```

comma sends the session to the site that opened the popup, only if that site is in `origins`. See `example/app.ts` for a working app.

## Sign in with Slack

People of one Slack workspace sign in with Slack in a popup. Your app needs no change.

Each comma server needs its own Slack app. Slack sends people back only to addresses that the app lists.

1. Open [this link to make the app](https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22comma%22%7D%2C%22oauth_config%22%3A%7B%22redirect_urls%22%3A%5B%22https%3A%2F%2FYOUR-COMMA-SERVER%2Fauth%2Fslack%2Fcallback%22%5D%7D%7D). Select your workspace. In the manifest, replace `YOUR-COMMA-SERVER` with the host of your comma server. Behind a proxy, set `COMMA_URL`. The app needs no scopes and no install: comma asks for `openid`, `profile` and `email` at sign-in.
2. In **Basic Information**, copy the client ID and the client secret.
3. Find the workspace id (`T…`): open Slack in a browser. It is the part after `/client/` in the URL.
4. Add to the project:

   ```ts
   {
     id: "acme",
     origins: ["https://*.preview.acme.com"],
     slack: { clientId: "1234.5678", clientSecret: process.env.ACME_SLACK_SECRET, team: "T0123ABCD" },
   }
   ```

Only people of that workspace can sign in. Their name, email and picture come from Slack.

## Keyboard

| Key                       |                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C`                       | Comment mode on or off (the key in `data-shortcut`; the letter on the key, also on other keyboard layouts)                                                                         |
| `↑` `↓`, then `Enter`     | In comment mode: pick an element and comment on it (`Tab` to a control works too). `Shift+Enter`: comment on its area                                                              |
| `Esc`                     | Close the popover, then leave comment mode                                                                                                                                         |
| `Shift+C`                 | Show or hide comments                                                                                                                                                              |
| `⌘Enter` (`Ctrl+Enter`)   | Send. `Enter`: new paragraph. `Shift+Enter`: line break                                                                                                                            |
| `⌘B` `⌘I` `⌘⇧X` `⌘E` `⌘K` | Bold, italic, strikethrough, code, link (`Ctrl` on Windows and Linux)                                                                                                              |
| `⌘⇧8` `⌘⇧7`               | Bulleted and numbered list                                                                                                                                                         |
| `↑` `↓`                   | In the panel: select a thread (it opens at its pin, the focus stays in the list). In the details: previous and next thread                                                         |
| `Enter` / `Esc`           | In the panel: go into the thread. In a thread opened from the panel: back to the list (the thread stays open)                                                                      |
| `←` `→`                   | They follow the panel's side. Toward the page: into the thread, or close the details. Away from the page: open the details, or from the thread (not while typing) back to the list |

## Development

```sh
bun run test     # server tests (bun test)
bun run e2e      # browser tests (Playwright: Chromium, Firefox, WebKit)
bun run check    # Biome, TypeScript, widget size
```

- `server/`: Hono and SQLite. API, sign-in pages, serves the widget.
- `widget/`: Preact in a Shadow DOM. UI from [shadcn/ui](https://ui.shadcn.com) (Base UI). Tiptap composer, loaded on demand.
- `example/`: the example site and app, and test pages.

See [PLAN.md](PLAN.md) for the design.
