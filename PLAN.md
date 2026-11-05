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
- Good UX first. v1 has at least the features of Figma comments (see "v1 scope"). Leave out what is not needed for that.
- A comment never points to a wrong element. If we cannot find its element, the comment is "detached".

## v1 scope

Baseline: Figma comments ([guide](https://help.figma.com/hc/en-us/articles/360039825314), [add](https://help.figma.com/hc/en-us/articles/360041068574), [manage](https://help.figma.com/hc/en-us/articles/360041547593), [move/edit](https://help.figma.com/hc/en-us/articles/360041547853)), plus what a website needs.

### Create

- **Comment mode**: press `C` or the toolbar button. `Esc` exits. The panel opens with comment mode.
- **Element pin**: hover outlines the element under the cursor. Click pins a comment to that element.
- **Region**: drag draws a rectangle. It is anchored to the element under its center.
- **Touch**: in comment mode, tap pins a comment.
- The composer opens at the pin.

### Composer

- Markdown subset: bold, italic, strikethrough, inline code, link, bulleted and numbered lists.
- Shortcuts: `⌘B`, `⌘I`, `⌘⇧X`, `⌘E`, `⌘K`, `⌘⇧7`, `⌘⇧8` (`Ctrl` on Windows and Linux).
- `@` mentions with a picker. You can mention people known to the project (signed-in users and people who commented).
- Emoji: picker button and `:name:` autocomplete.
- Images: up to 5 per comment (PNG, JPEG, GIF, WebP, ≤ 5 MB each), by paste, drop or button.
- `Enter` sends. `Shift+Enter` adds a line.
- The draft stays if the popover closes.

### Pins

- A pin shows the author avatar and a dot when unread.
- Hover: preview (author, first lines, reply count).
- Click: thread popover.
- Pins close together merge into a cluster with a count and avatars. Click a cluster to see its threads.
- Drag a pin to move it (thread author only). This saves a new anchor.
- Pins show by default. `Shift+C` shows or hides them. The widget remembers the choice.
- Resolved threads do not show on the page.

### Thread popover

- Replies.
- Reactions on each comment: quick set and picker.
- Menu: copy link, mark as unread, edit (own), delete comment (own), delete thread (author or admin).
- Deleting the first comment deletes the thread.
- Resolve and reopen.

### Panel (push mode)

- Each item: author, page, first lines, reply count, unread state, time.
- Search in comment text.
- Sort: date, or unread first.
- Filters: this page or all pages, only my threads (I created, replied or was mentioned), show resolved.
- `↑`/`↓` move between threads. `Enter` opens one.
- A thread on another page: click navigates to that page and opens the thread.
- Detached threads show with a "detached" label.
- Screens narrower than 640 px: the panel covers the full screen.

### Toolbar

- Small floating bar: comment mode, panel button with unread count, user menu (name, avatar, sign in or out, show or hide pins).

### Unread and updates (in the widget)

- Read state per user and thread. A thread is unread when it has a comment by someone else after your last read.
- The panel button shows the count of unread threads.
- Poll every 15 s while the tab is visible, and when the window gets focus. `ETag`, so no change costs little.

### Identity

- Guest name, `identify(token)` in your app, popup sign-in on other sites (see "Login").
- Avatar from the app token. Else initials on a color from the user id.
- Admin: app token claim `admin: true`. Admins can delete any thread.

### Other

- **Deep link**: the URL hash opens a thread.
- **Detached comments**: show in the panel, not on the page.
- **Rate limit**: 100 comments per hour per user (same as Figma).
- **Accessibility**: all actions work with the keyboard. Popovers and the panel manage focus. Controls have labels.

Out (later, maybe):

- Page screenshots, console and network capture.
- Email and Slack notifications (see "Open questions").
- Issue-tracker sync.
- Realtime push (SSE or WebSocket). v1 polls.
- User groups, notification settings.
- Translations.
- Admin UI.
- Bridge iframe.

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
  - **Toolbar**: floating, bottom right.
- No iframe in v1.
- Composer: a plain text field with Markdown syntax and shortcuts. The thread shows the rendered result. A rich text editor (formatting shows while you type) is much more code. Add it later if needed.
- Size target: `c.js` ≤ 35 kB gzip. Emoji data loads on demand.

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
- Comment text is stored as Markdown. The widget escapes all HTML, then renders the Markdown subset. Links: only `http`, `https` and `mailto`, with `rel="noopener noreferrer"`.
- Images: stored in SQLite (one file to back up). Check type by file content, not by name. Uploads that no comment uses after 24 h are deleted.
- Rate limit in memory (one server process).

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
users      id, project, kind (guest|app), external_id, name, email, avatar_url, is_admin, created_at
threads    id, project, page (URL path), anchor (JSON), status (open|resolved),
           created_by, created_at, updated_at, resolved_at, resolved_by
comments   id, thread_id, author_id, body (Markdown), created_at, edited_at
mentions   comment_id, user_id
reactions  comment_id, user_id, emoji
reads      user_id, thread_id, read_at
files      id, project, comment_id (null until used), uploaded_by, mime, size, width, height, data, created_at
```

- Any change to a thread or its comments updates `threads.updated_at`.
- File ids are random (128 bit), so image URLs cannot be guessed.

### API

```
GET    /c.js
POST   /api/session/guest        { project, name }      → { token, user }
POST   /api/session/app          { project, appToken }  → { token, user }
GET    /auth/start               ?project&origin        → redirect to signInUrl
GET    /auth/callback            ?token&state           → page: postMessage session to opener, close
GET    /api/threads                         → all threads with comments, reactions, read state (ETag)
POST   /api/threads                         { page, anchor, body, mentions, files } → thread
PATCH  /api/threads/:id                     { status } | { page, anchor }
DELETE /api/threads/:id
POST   /api/threads/:id/read                { read: true|false }
POST   /api/threads/:id/comments            { body, mentions, files }
PATCH  /api/comments/:id                    { body, mentions }
DELETE /api/comments/:id
PUT    /api/comments/:id/reactions/:emoji
DELETE /api/comments/:id/reactions/:emoji
GET    /api/users                           ?q → mention picker
POST   /api/files                           image → { id, url }
GET    /files/:id                           image
```

All `/api/*` routes except sessions need a session token. The project comes from the token.

## Steps

Each step uses TDD: write a failing test first.

1. **Repo setup**: Bun workspaces, TypeScript strict, Biome, Playwright.
2. **Anchors** (Playwright on fixture pages, real layout):
   - A pin stays on its element after a section is added above it.
   - A pin stays on its element after a reload and a viewport resize.
   - A pin is detached when its element is removed.
   - A pin is detached, not moved, when the selector matches a different element.
3. **Server core** (`bun test` on `app.fetch`):
   - Guest and app sessions. Bad, expired and wrong-project tokens fail.
   - Threads and comments. Only the author can edit or delete. Admins can delete threads.
   - Origin check, CORS, rate limit.
4. **Server extras**: mentions, reactions, read state, user search, files, `ETag`.
5. **Widget shell**: Shadow DOM, toolbar, comment mode, outline, pins, clusters, move pin, `Shift+C`, touch.
6. **Composer**: Markdown subset and shortcuts, safe render, mentions, emoji, images, drafts.
7. **Thread popover**: replies, reactions, menu, resolve, mark as unread, copy link.
8. **Panel**: push mode, list, search, sort, filters, keyboard, other-page threads, deep link, narrow screens, polling.
9. **Popup sign-in**: `/auth/start`, `/auth/callback`, origin checks. A fake app in `example/` signs tokens.
10. **End-to-end** (Playwright on `example/`): guest adds a comment with a mention and an image → second user replies and reacts → first user sees unread → resolve → reload → pin still on its element → panel narrows the page.
11. **README**: integration for any site, for an app with `identify`, and for popup sign-in.

## Checks

- `bun test`: server and pure logic.
- `bunx playwright test`: anchors and end-to-end.
- `bunx biome check`, `tsc --noEmit`.
- Size check on `c.js`.

## Open questions

1. **Email for mentions and replies in v1?** Figma sends these. Without email, people see mentions only when they open the widget. Email needs a provider (for example Resend or SMTP). Guests have no email unless they give one.
2. **Composer**: plain text with Markdown (planned), or a rich text editor?

## References

- SitePing anchor matching (selectors + XPath + text fingerprint + score): `packages/widget/src/dom/`. Reuse the ideas, not the code.
- Vercel toolbar (public scripts on `vercel.live`): the UI is in a closed Shadow DOM. A 0×0 iframe on `vercel.live` does login and data. A hidden iframe runs the UI code. We can add a bridge iframe later to hide the token from page scripts or share one login across sites.
