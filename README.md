# comma

Comments pinned to any website. One script tag. Your own service.

- Press `C`, click an element, write a comment. Drag to comment on a region.
- Threads with replies, reactions, mentions, images, resolve and unread state.
- A panel with all comments of the site. Search, filters, keyboard navigation.
- Pins stay on their element when the page changes. If comma cannot find the element, the comment is "detached". It never moves to a wrong element.

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

| Env            | Default           |                                                     |
| -------------- | ----------------- | --------------------------------------------------- |
| `COMMA_SECRET` | (required)        | Signs session tokens. 32 or more random characters. |
| `COMMA_DB`     | `comma.sqlite`    | SQLite file. Back up this file.                     |
| `COMMA_CONFIG` | `comma.config.ts` | Projects (see below).                               |
| `PORT`         | `4000`            |                                                     |

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

Add `data-comment-anchor="pricing"` to an element to give it a very stable anchor. Comments on it find it again, also when its text changes or it moves.

## Sign in with your app

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

`window.comma.signOut()` signs the user out of comma.

### On other sites: popup sign-in

For sites outside your app (a marketing site, a preview deploy), comma can open your app's sign-in in a popup. Add `signInUrl`:

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

## Keyboard

| Key                       |                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `C`                       | Comment mode on or off                                                                                                |
| `↑` `↓`, then `Enter`     | In comment mode: pick an element and comment on it (`Tab` to a control works too). `Shift+Enter`: comment on its area |
| `Esc`                     | Close the popover, then leave comment mode                                                                            |
| `Shift+C`                 | Show or hide comments                                                                                                 |
| `Enter` / `Shift+Enter`   | Send / new line                                                                                                       |
| `⌘B` `⌘I` `⌘⇧X` `⌘E` `⌘K` | Bold, italic, strikethrough, code, link (`Ctrl` on Windows and Linux)                                                 |
| `⌘⇧8` `⌘⇧7`               | Bulleted and numbered list                                                                                            |
| `↑` `↓`                   | In the panel: move between threads                                                                                    |

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
