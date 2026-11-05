# comma: plan

Comments pinned to any website. Vercel-style comment UX. One script tag. Your own service.

## Why

[SitePing](https://github.com/NeosiaNexus/SitePing) has the right idea, but:

- The UI is not good. We want Vercel comment UI and UX.
- It is too large: 12 packages, ~41k lines of source.
- Integration is hard: each site must mount an endpoint, add a database schema and run a CLI.
- Pins drift. A rectangle is anchored to the smallest element that contains all of it. This is often `<section>`, `<main>` or `<body>`. The rectangle is stored as % of that container. When a new section is added inside the container, the pin moves.

## Principles

- One `<script>` tag on any site. No framework needed.
- One central service holds the data. Sites do not host a backend.
- Small scope. Add features only when we need them.
- A comment never points to a wrong element. If we cannot find its element, the comment is "detached".

## v1 scope

In:

- **Comment mode**: press `C` (or the toolbar button). `Esc` exits.
- **Element pins**: hover outlines the element under the cursor. Click pins a comment to that element.
- **Rectangles**: drag draws a rectangle. It is anchored to the element under its center.
- **Composer** at the pin. `⌘/Ctrl+Enter` sends.
- **Thread popover** at the pin: replies, resolve and reopen, edit and delete own comments.
- **Panel** in push mode (the page gets narrower): threads on this page or on all pages, filter open/resolved, `↑`/`↓` to move between threads.
- **Deep link**: the URL hash opens a thread.
- **Login**: guest name, `identify(token)` in your app, popup sign-in on other sites.
- **Detached comments**: show in the panel, not on the page.
- **Refresh**: load threads when the panel opens and when the window gets focus.

Out (later, maybe):

- Screenshots, email/Slack alerts, issue-tracker sync.
- Mentions, reactions, Markdown, file uploads.
- Realtime updates.
- Translations.
- Admin UI.

## Architecture

```
comma/
  server/    Hono + SQLite: API, sign-in pages, serves c.js
  widget/    TypeScript + Preact in a Shadow DOM, built to one file c.js
  example/   static pages to test against
```

### Integration

Any site:

```html
<script src="https://comma.example.com/c.js" data-project="acme" defer></script>
```

In your app, when the user is signed in:

```js
window.comma.identify(token); // token from your backend, see "Login"
```

### Widget

- One host element on `<html>` with an open Shadow DOM. Open, so Playwright can reach it.
- Preact: React-style code, ~4 kB, no conflict with React on the page.
- Reset inherited styles with `:host { all: initial }`. Use `px` or own variables, not `rem` (the page can change the root font size).
- Layers:
  - **Pins**: positioned on their elements. Update on scroll, resize and DOM changes (one `requestAnimationFrame` per frame).
  - **Comment mode overlay**: catches pointer events, finds the element under the cursor with `elementsFromPoint` (skip own layers), draws the outline.
  - **Popovers**: composer and thread, next to the pin.
  - **Panel**: fixed on the right.
- No iframe in v1.
- Size target: ≤ 30 kB gzip.

### Push panel

- On open, add `html { margin-right: <panel width> }` in a style tag in the page document. Remove it on close.
- Normal content reflows. Element-anchored pins follow it.
- Known limits:
  - `position: fixed` elements (fixed headers, banners, modals) still go under the panel.
  - Media queries do not change (the viewport width stays the same).
  - The page scrollbar is under the panel.
- If these limits are a problem later: load the page in an iframe next to the panel, or use a browser extension side panel.

### Anchors

Data stored per thread:

- `selectors`: `data-comment-anchor` value, `id`, CSS selector (stable attributes only, no hashed class names, no framework ids).
- `tag`, `text` (first ~120 characters), text of nearby elements.
- `point` (pin) or `rect` (rectangle) as % of the anchor element box.
- Viewport width when created.

Find the element again:

1. `[data-comment-anchor="…"]`, then `#id`, then the CSS selector.
2. If no match, scan elements with the same tag and score by text.
3. Check each candidate: same tag and similar text. Below the threshold: detached.

Rules:

- A pin anchors to the clicked element itself, never to a container.
- A rectangle anchors to the element under its center. Its % can be < 0 or > 100. Check this with tests in step 1. Change it if it drifts.
- Developers can add `data-comment-anchor="pricing"` for very stable anchors.

### Login

One rule: **your app signs a short token, comma trusts it.**

| Where | How |
|---|---|
| Inside your app | The app backend signs a token. The frontend calls `comma.identify(token)`. No login screen. |
| On another site | "Sign in" opens a popup → comma redirects to the app sign-in URL → the app (after its normal login) redirects back with a signed token → the popup sends a comma session to the widget with `postMessage` and closes. |
| No account | Guest: enter a name. |

Details:

- App token: JWT, HS256, signed with the project secret. Claims: `sub`, `name`, optional `email` and `avatar`. Expiry ≤ 5 minutes.
- The widget exchanges an app token or a guest name for a **comma session token** (JWT, signed by the server, bound to one project).
- The widget keeps the session token in `localStorage` and sends it as `Authorization: Bearer …`. No cookies, so Safari and Firefox work. Users sign in once per site.
- `postMessage` and redirects go only to origins registered for the project.
- In the app, the work is one endpoint that signs the token (~20–30 lines).

### Server

- Hono on Bun, SQLite with `bun:sqlite`. One file database.
- Validate all input at the entry point (zod).
- CORS and `Origin` check: only the project's registered origins.
- Comment text is plain text. The widget renders it as text, never as HTML.

Projects live in `comma.config.ts`. Secrets come from env:

```ts
export default {
  projects: [
    {
      id: "acme",
      origins: ["https://www.acme.com", "http://localhost:3000"],
      appSecret: process.env.ACME_SECRET, // optional: enables app login
      signInUrl: "https://app.acme.com/comma-sign-in", // optional: enables popup sign-in
    },
  ],
};
```

### Data

```
users     id, project, kind (guest|app), external_id, name, email, avatar_url, created_at
threads   id, project, page (URL path), anchor (JSON), status (open|resolved),
          created_by, created_at, resolved_at
comments  id, thread_id, author_id, body, created_at, edited_at
```

Deleting the first comment of a thread deletes the thread.

### API

```
GET    /c.js
POST   /api/session/guest        { project, name }      → { token, user }
POST   /api/session/app          { project, appToken }  → { token, user }
GET    /auth/start               ?project&origin        → redirect to signInUrl
GET    /auth/callback            ?token&state           → page: postMessage session to opener, close
GET    /api/threads              ?page (optional)       → threads with comments
POST   /api/threads              { page, anchor, body } → thread
PATCH  /api/threads/:id          { status }
POST   /api/threads/:id/comments { body }
PATCH  /api/comments/:id         { body }
DELETE /api/comments/:id
```

All `/api/threads` and `/api/comments` routes need a session token. The project comes from the token.

## Steps

Each step uses TDD: write a failing test first.

1. **Repo setup**: Bun workspaces, TypeScript strict, Biome, Playwright.
2. **Anchors** (Playwright on fixture pages, real layout):
   - A pin stays on its element after a section is added above it.
   - A pin stays on its element after a reload and a viewport resize.
   - A pin is detached when its element is removed.
   - A pin is detached, not moved, when the selector matches a different element.
3. **Server** (`bun test` on `app.fetch`):
   - Guest and app sessions. Bad, expired and wrong-project tokens fail.
   - Threads and comments CRUD. Only the author can edit or delete.
   - Origin check and CORS.
4. **Widget UI**: comment mode, outline, pins, composer, thread popover.
5. **Panel**: push mode, list, filters, keyboard, deep link.
6. **Popup sign-in**: `/auth/start`, `/auth/callback`, origin checks. A fake app in `example/` signs tokens.
7. **End-to-end** (Playwright on `example/`): guest adds a comment → reply → resolve → reload → pin still on its element → panel narrows the page.
8. **README**: integration for any site, for an app with `identify`, and for popup sign-in.

## Checks

- `bun test`: server and pure logic.
- `bunx playwright test`: anchors and end-to-end.
- `bunx biome check`, `tsc --noEmit`.
- Size check on `c.js`.

## References

- SitePing anchor matching (selectors + XPath + text fingerprint + score): `packages/widget/src/dom/`. Reuse the ideas, not the code.
- Vercel toolbar (public scripts on `vercel.live`): the UI is in a closed Shadow DOM. A 0×0 iframe on `vercel.live` does login and data. A hidden iframe runs the UI code. We can add a bridge iframe later to hide the token from page scripts or share one login across sites.
