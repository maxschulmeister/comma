# comma: design

Comments pinned to any website. Vercel-style comment UX. One script tag. Your own service.

## Why

[SitePing](https://github.com/NeosiaNexus/SitePing) has the right idea, but:

- We want a comment UI and UX like Vercel's.
- It is too large: 12 packages, ~41k lines of source.
- Integration is hard: each site must mount an endpoint, add a database schema and run a CLI.
- Pins drift. A rectangle is anchored to the smallest element that contains all of it. This is often `<section>`, `<main>` or `<body>`. The rectangle is stored as % of that container. When a new section is added inside the container, the pin moves.

## Principles

- One `<script>` tag on any site. No framework needed.
- One central service holds the data. Sites do not host a backend.
- Good UX first. v1 has at least the features of Figma comments (see "v1 scope"). Leave out what is not needed for that.
- A comment never points to a wrong element. If we cannot find its element, the comment is "detached".
- All UI is built with [shadcn/ui](https://ui.shadcn.com) components (see "UI").

## v1 scope

Baseline: Figma comments ([guide](https://help.figma.com/hc/en-us/articles/360039825314), [add](https://help.figma.com/hc/en-us/articles/360041068574), [manage](https://help.figma.com/hc/en-us/articles/360041547593), [move/edit](https://help.figma.com/hc/en-us/articles/360041547853)), plus what a website needs.

### Create

- **Comment mode**: press `C` or the toolbar button. `Esc` exits. The panel opens with comment mode (on narrow screens it closes, because it covers the page).
  - The shortcut is the letter on the key, also on other keyboard layouts. Without a Latin letter: the key's place. `data-shortcut` on the script tag sets another letter, or `none`.
- **Element pin**: hover outlines the element under the cursor. Click pins a comment to that element.
- **Region**: drag draws a rectangle. It is anchored to the element under its center.
- **Touch**: in comment mode, tap pins a comment.
- **Keyboard**: `↑` `↓` pick elements. The first pick is an element that shows fully; a picked element that does not (outside the window, or under a sticky header) scrolls to the middle.
- The composer opens at the pin. The element (or the region) shows an outline while the composer or thread is open.

### Composer

- Rich text (formatting shows while you type): bold, italic, strikethrough, inline code, link, bulleted and numbered lists.
- Markdown input rules: `**bold**`, `*italic*`, `~strike~`, `` `code` ``, `- ` and `1. ` start lists.
- Shortcuts: `⌘B`, `⌘I`, `⌘⇧X`, `⌘E`, `⌘K`, `⌘⇧7`, `⌘⇧8` (`Ctrl` on Windows and Linux).
- `@` mentions with a picker. You can mention people known to the project (signed-in users and people who commented).
- Emoji: picker button and `:name:` autocomplete. Both insert the Unicode character.
- Images: up to 5 per comment (PNG, JPEG, GIF, WebP, ≤ 4 MB each), by paste, drop or button.
  - Before the upload, the widget makes images larger than 2560 px on the long side smaller, with a canvas. It encodes them as WebP. Where the browser cannot encode WebP (Safari), it uses JPEG for photos and PNG for images with transparency.
  - GIFs stay as they are, so animation stays.
  - 4 MB fits the request limits of Lambda and Vercel (see DEPLOY.md).
- Element screenshot: a new thread keeps a screenshot of its element or region, with 16 px around it, as SitePing does.
  - The widget takes it when the comment is sent and uploads it. It is not one of the 5 images. A small thumbnail shows at the end of the thread's info line (see Details). It is a record for when the element or its look changes.
  - Only the part on screen. If it fails or takes more than 5 s, the thread has no screenshot. The comment never waits for it.
  - Server: `files.thread_id`. The file goes with the thread.
- Screenshot button: adds the visible part of the page as an image, without comma and the panel.
  - [modern-screenshot](https://github.com/qq15725/modern-screenshot) (~10 kB gzip, loads on the first screenshot). It copies the page into an SVG `<foreignObject>`, so the browser draws it. Chosen over html2canvas-pro (69 kB, draws CSS in JS), SnapDOM (103 kB) and html-to-image (few updates).
  - The scroll position is a negative margin on `<html>`, so `position: fixed` elements stay in place.
  - Limits: images and fonts from other sites without CORS stay blank. Scroll positions of inner scroll areas come from the library.
- `⌘Enter` (`Ctrl+Enter`) sends. `Enter` starts a new paragraph or list item. `Shift+Enter` adds a line break.
- Drafts:
  - A new comment's draft stays on its pin when the popover closes. A click on the pin opens it again.
  - A click on another place while the draft has text asks: "Move here" or "Discard and start new". The draft never moves without a question.
  - "Discard" in the composer removes the draft.
  - Drafts stay after a reload: `sessionStorage`, per person and page (new threads) or thread (replies). Sign-out deletes them.

### Pins

- A pin shows the author avatar and a dot when unread.
- Hover: preview (author, first lines, reply count). Only the mouse opens it: when a thread closes, the focus goes back to its pin, and a preview there would stay.
- Click: thread popover.
- Pins close together merge into a cluster with a count and avatars. Click a cluster to see its threads.
- Drag a pin to move it (thread author only). This saves a new anchor. A move that fails says so ("Could not move the comment"), and the pin goes back.
- Pins show by default. The eye in the toolbar or `Shift+C` hides comma from the page, for a look at the page as visitors see it: the pins, the panel, the open thread with its details, and comment mode. Showing brings the panel, the thread and the details back (kept for the tab, also after a page load). The widget remembers the choice. Opening the panel shows the comments again (the panel lists them). Hidden by key, the focus goes to the eye.
- Resolved threads do not show on the page.

### Thread popover

- Replies.
- Reactions on each comment: quick set and picker.
- Header: the element ("Heading: Pricing"). Under it: the assignee, and the info line: where the comment was made (window size, browser, system) and the screenshot thumbnail. A click on the line opens or closes the details.
- Menu: copy link, move (author), mark as unread, edit (own), delete comment (own), delete thread (author or admin).
- Deleting the first comment deletes the thread.
- New replies while the thread is open: at the end of the list (or with my own reply), the list follows them, and replies by others are read. Reading older comments, the list stays; a "1 new reply" button shows them. Screen readers hear "Ada replied".
- Focus: `Esc` goes back to the pin. After resolve: Undo. After the thread is deleted: the Comments button.
- Resolve and reopen. A resolved thread says who resolved it and when.
- Assign: anyone in the project assigns the thread to a person (search). The thread becomes unread for them.
- Element not found (detached): the thread says what it was on ("Paragraph “A paragraph…”"). The author can move it.
- Status messages: small text beside the toolbar, in the same row, on the side away from the corner. Over the page: a pill as high as the toolbar, with ↶ as large as its buttons. With the panel open: plain text at the other end of the panel's bottom row. Narrow screens: a smaller pill above the toolbar. The toolbar does not move. One `role="status"` region. Short texts, so they fit in the open panel (360 px): "Thread resolved" with ↶ (Undo), "Link copied", "Could not move". A message goes after 4 s, one with ↶ after 8 s, but not while the mouse is on it or the keyboard focus is in it. "Cannot reach comma" with ↻ (Try again) stays until an update works.

### Panel

Two modes and two sides. Each person chooses in the panel's view menu (sliders icon): "Panel Mode" (Overlay, Push), "Panel Side" (Left, Right) and "Show Details" (Panel, Dialog). A drag on the panel header also moves it: on release it goes to the side its middle is on (not on narrow screens). The labels match the config values; the menu items have tooltips with what each one does. The choices are kept in localStorage; without one, the project settings `panel` (default `overlay`) and `details` (default `panel`) decide. View choices are personal (screen size, the task at hand), so a person makes them, not the config.

- `overlay` (default): the panel floats over the page, 8 px from the top, the bottom and the right, with rounded corners. The page keeps its width, but its right part is covered.
- `push`: the page gets a right margin and reflows next to the panel. Nothing is covered, but the page is 360 px narrower: its media queries still see the full window, so it shows a state no real device shows.
- Left or right, in both modes. Push on the left gives the page a left margin. Notices and threads stay out of the panel's side.
- Floating, the panel must not hide what people work on: comment mode does not open it (push mode does), and a thread opens beside it, never under it. A thread whose pin is under the panel opens beside its item in the panel.

- Each item: author, page (title and path), first lines, reply count, assignee, unread state, time.
  - Unread: the newest comment by someone else ("Bob replied"), with the first comment as context.
- Search in comment text, in the current scope (this page or all pages). No match on this page, but on other pages: "No comments on this page match", "2 matches on other pages" and "Search all pages". A search or filter that hides the open thread closes it.
- Sort: date, or unread first. "Unread first" keeps its order while the panel is open: a thread read there keeps its place, so `↓` goes on to the next unread one. It sorts again when the panel opens or the sort changes.
- The panel's open state, filters, sort and search are kept for the tab (sessionStorage): the review goes on after a page load, also on another page.
- Opened from the toolbar (or by `Shift+C`), the panel takes the focus: the open thread's item, else the first item, else the panel. Not the search: there, `Shift+C` and the arrows would type. Only the focus: no thread opens.
- Filters: this page or all pages, only my threads (I created, replied or was mentioned), assigned to me, show resolved. The filter button is next to the search field and shows when a filter is on.
- Item states look different: hover is light, the open thread is darker with a bar on the left, the keyboard focus is an inset ring (it does not cover the next item).
- Empty list: says why, and offers the way out: "Clear search", "Clear filters", "Show all pages" (with the count on other pages), "Show resolved", "Add comment".
- `↑`/`↓` select a thread: it opens at its pin and the page scrolls to it; the focus stays in the list (selection follows focus, as in a mail list). `Enter` goes into the thread; `Esc` there comes back to the list, and the thread stays open (a thread opened from its pin closes with `Esc`). Tab does not select.
- Each item has an info button (ⓘ), as high as the item, that opens the thread with its details. An icon without a direction: the same on both sides and in both details layouts; its tooltip names the key. Only the mouse reaches it (no extra Tab stop per item).
- The arrows follow the panel's side. Toward the page (`←` with the panel on the right): into the thread, or close the details. Away from the page: open the details, or from the thread (if no text is typed) back to the list. In the panel, a ← button left of "Details" goes back to the list, as "back" in a browser, on both sides. The details dialog closes with ×.
- A thread on another page: click navigates to that page and opens the thread.
- Detached threads show with an "Element not found" label.
- Screens narrower than 640 px: the panel covers the full screen. The toolbar stays over it. A thread with a pin opens at its pin, and the panel closes.

### Details

Two layouts (view menu, or the project default `details`): `panel` (default), a layer of the side panel next to the page; or `dialog`, a large window over the page with the screenshot on the left and the facts on the right. Both work the same way, as below. In the dialog, `Esc` closes it and the screenshot fits its pane first.

- For hard bugs and changed pages. Most reviews do not need them, so they open only on request, from the thread's info line. They do not open when a thread opens.
- Content: the element screenshot, then facts in groups: Comment (author, exact date, text), Element (type, text, selector), Page (title, URL, scroll position), Device (browser, system, window size and pixel ratio, theme, language, time zone).
- They follow the open thread: a click on another pin shows its details. Previous and next (and `↑` `↓`) go through the panel list, with "3 of 12". The arrow toward the page or `Esc` closes them. The focus stays in the details. The reply box does not take it.
- The thread popover stays open next to the details, so the screenshot and the live page show side by side.
- Closing shows the list again at the same scroll position, with the focus on the open thread's item. The list stays under the layer (inert), so it keeps its scroll position.
- When the thread or the panel closes, the details close too.
- Lightbox: the screenshot at the size it had on the page (pixels ÷ the pixel ratio of the author's screen, up to 2). Larger than the window: it fits first, a click shows the full size.
- "Copy as bug report": Markdown with the facts, the replies (with author and date), the screenshot and a link to the thread, for Jira or GitHub.
- They do not open automatically when a thread opens: most reviews need only the list. A remembered choice was considered and left out: it would surprise people.
- Not now: console and network capture. Categories (bug, change): a label could come later in the thread menu.

### Motion

Only where it shows where something comes from, fast and short; keyboard actions change at once.

- The floating panel slides in from its own edge: 8 px and opacity, 150 ms, strong ease-out (`--ease-out`). Not in push mode (the page jumps anyway), not on narrow screens, and not while it is dragged or lands on its side.
- A status message comes up from the bottom: 400 ms `ease`.
- No motion for the details (opened with `→`), previous / next, and ↑ ↓ selection: people do these many times in a row.
- Reduced motion: no slides (see styles.css).

### Toolbar

- Small floating bar: comment mode, show or hide pins (eye), panel button with unread count, user menu (name, avatar, sign in or out). With the panel on the left, the order is mirrored: the account is at the outer corner on both sides.
- It does not move. It stays in the bottom corner on the panel's side (16 px from the edges; centered on narrow screens), also while the panel is closed. The open panel takes it in, so the same click opens and closes the panel. Over the page it floats (ring and shadow). In the open panel it is part of the panel: no ring, no shadow (they go with the panel's 150 ms slide-in). The panel's list and details show nothing in its band and fade in above it, and have room at the end, so their last line scrolls clear of it.
- Project setting `toolbar: "signed-in"`: visitors see no toolbar and no shortcut until they sign in. `?comma` in the URL, or a link to a thread, shows the sign-in.

### Unread and updates (in the widget)

- Read state per user and thread. A thread is unread when it has a comment by someone else after your last read.
- The panel button shows the count of unread threads.
- Poll every 15 s while the tab is visible, and when the window gets focus. `ETag`, so no change costs little.
- Stop polling after 5 minutes with no input (pointer, keys, scroll). On the next input or focus, poll at once and start again. Tabs that stay open do not cost requests.
- Updates fail after the comments loaded: "Cannot reach comma. Comments may be out of date." with Try again. The comments stay. The message goes when an update works again.
- The first load of the project fails: comma tries again after 5 s, then twice as long each time up to a minute, and at once when the browser is online again.
- No push (SSE or WebSocket) in v1: each target needs a different solution. For team use, polling stays in the free tiers.

### Identity

- Guest name, `identify(token)` in your app, popup sign-in on other sites (see "Login").
- All tabs of a site share one session: a sign-in or sign-out in one tab changes the others. When the server ends a tab's session, the tab removes the stored session only if it is that one.
- Guests: project setting `guests`. Default: on without `appSecret`, off with it. Anyone can type any name, so guests show "Guest" next to their name everywhere.
- The sign-in button names the app: "Sign in with Acme" (project setting `name`).
- Avatar from the app token. Else initials on a color from the user id.
- Admin: app token claim `admin: true`. Admins can delete any thread.

### Other

- **Deep link**: the URL hash opens a thread.
- **Detached comments**: show in the panel, not on the page.
- **Rate limit**: 100 comments and 100 images per hour per user (same as Figma). 30 new guests per hour per project. A project can change each limit (`limits`).
- **Accessibility**: all actions work with the keyboard. Popovers and the panel manage focus. Controls have labels.
  - Focus rings: solid, 4.7:1 on white. Small text: 4.5:1 or more (avatar initials, unread count, muted text).
  - Touch: controls that show on hover (comment menu, add reaction) always show.
  - `prefers-reduced-motion`: no slides, zooms or smooth scroll.
  - The widget root has `lang="en"`.
- **Text size**: comments 14 px. The composer 16 px on narrow screens (iOS Safari zooms into smaller fields).
- **Narrow screens**: threads and the composer are at most the screen width less 16 px. The panel covers the screen, so threads keep no room for it, and wait while its details are open.
- **Keys stay in comma**: key events from inside comma stop at its shadow root (except `Esc` and `Tab`). Else the site sees them on `<comma-widget>`, not on a text field, and its own shortcuts run while people type. comma's own shortcuts listen in the capture phase.

Out (later, maybe):

- Console and network capture.
- Email and Slack notifications (decided: not in v1).
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
window.comma.identify(token) // token from your backend, see "Login"
```

### Widget

- One host element on `<html>` with an open Shadow DOM. Open, so Playwright can reach it.
- Preact: React-style code, ~4 kB, no conflict with React on the page. shadcn components use it through `preact/compat` (see "UI").
- Reset inherited styles with `:host { all: initial }`. Use `px` or own variables, not `rem` (the page can change the root font size).
- Layers:
  - **Pins**: positioned on their elements. Update on scroll, resize and DOM changes (one `requestAnimationFrame` per frame).
  - **Comment mode overlay**: catches pointer events, finds the element under the cursor with `elementsFromPoint` (skip own layers), draws the outline.
  - **Popovers**: composer and thread, next to the pin.
  - **Panel**: fixed on the right or the left.
  - **Toolbar**: floating, in the bottom corner on the panel's side.
- No iframe in v1.

### UI

- Build all UI with shadcn/ui components: toolbar, pins, popovers, menus, panel, forms, sign-in. Do not write a custom component when a shadcn component does the job. Change shadcn components only to fit the widget (Shadow DOM, sizes).
- Set up with the preset:

  ```sh
  bunx shadcn@latest create --preset b19FZ2
  ```

  Preset `base-nova`: [Base UI](https://base-ui.com) primitives (`@base-ui/react`), Tailwind v4, `tw-animate-css`, Phosphor icons, Public Sans, neutral base, amber primary, radius `0.45rem`, light and dark tokens.
- Shadow DOM fixes:
  - Tailwind CSS goes into the shadow root (constructable stylesheet), not `document.head`.
  - Theme variables on `:host`, not `:root`. Dark mode: `.dark` class on the host element.
  - Tailwind v4 `@property` rules do not work inside a shadow root. Add them once to the page document, or give fallback values.
  - Convert `rem` to `px` at build time (the page can change the root font size).
  - `@font-face` does not work in a shadow root in Chromium. Add the Public Sans `@font-face` to the page document.
  - Base UI portals: render into a container inside the shadow root.
- Trade-offs:
  - Base UI under `preact/compat`: step 1 checked it in Chromium, Firefox and WebKit. It works, with two fixes:
    - Preact renders after the whole event (`options.debounceRendering`), not in a microtask between listeners.
    - React bubbles events from a portal to its parent; Preact does not. So Base UI sees a press in a nested popup (menu, emoji picker, dialog) as a press outside the parent popover. Top-level popovers ignore presses inside the widget. A press on the page still closes them.
    - Frimousse 0.4.0 (emoji picker) reads its store at render and subscribes later, in an effect. Preact runs effects after paint, so a change in between was lost: the list showed old rows after a search. `patches/frimousse@0.4.0.patch` reads the store again when it subscribes, as `useSyncExternalStore` does.
  - Base UI, Tailwind CSS and icons add size (see "Size").
- Composer: [Tiptap](https://tiptap.dev) v3 (MIT), core only, no React binding. Preact mounts it with a ref.
  - Extensions: Document, Paragraph, Text, Bold, Italic, Strike, Code, Link, lists, HardBreak, UndoRedo, Placeholder, Mention. Not StarterKit (it adds what we do not use).
  - `:name:` autocomplete: `@tiptap/suggestion` with our own emoji list. Not `@tiptap/extension-emoji` (measured: +~70 kB gzip, and it stores emoji as nodes).
  - `injectCSS: false`: Tiptap puts its CSS in `document.head`, which does not reach the Shadow DOM. Add the ProseMirror base CSS to our own styles.
  - ProseMirror supports Shadow DOM, with fixes for Safari (`getComposedRanges`). Step 1 checks this in all browsers.
- Thread view: does not use Tiptap. A small renderer turns the stored JSON into Preact elements. Only known nodes and marks, no `innerHTML`.
- Size (measured, checked by `bun run size`):
  - `c.js` + `main.js` ≤ 140 kB gzip (now ~125 kB): toolbar, pins, threads, panel. Base UI and Floating UI are the largest part, then Tailwind CSS and Phosphor icons. Preact is ~6 kB. `c.js` is a 0.2 kB loader that loads `main.js`.
  - Editor chunk ≤ 135 kB gzip (now ~120 kB): Tiptap core + ProseMirror + the extensions above. Loads on demand. Preloads when comment mode starts or when the browser is idle.
  - Emoji picker chunk ≤ 15 kB gzip ([Frimousse](https://frimousse.liveblocks.io), from the shadcn registry). Emoji data (Emojibase, with Slack names for `:name:`) loads on demand from the comma server.

### Push panel

- On open, add `html { margin-right: <panel width> }` in a style tag in the page document. Remove it on close.
- Normal content reflows. Element-anchored pins follow it.
- Fixed elements placed from the panel's side (a site header across the top, a chat button in the corner) move by the panel's width too, while it is open. Their own inline value comes back on close.
- Known limits:
  - Fixed elements that the site adds later (a modal, a header that becomes fixed on scroll), or that are placed only from the other side (`left: 0; width: 100vw`), still go under the panel.
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
4. Changed text and short text also need similar neighbors, also when the id still matches.
5. If the page had the same or a similar text more than once when the comment was made (product cards, "Learn more"), only the same text with the same neighbors and the same container (the card it is in: its text start, links and images) is accepted. Copies in the same card (two "Reserve" buttons of one hotel room) are twins: only their position tells them apart, so a sort detaches them. If the id and the neighbors disagree, the comment is detached.
6. A short label or a control (button, form field) that is not a link or image itself ("Add to cart", also with an icon or in a wrapper) also needs the same links and images in its largest small container (its card: up to 4 levels up, up to 300 characters of text). All of them must still be there, as often as before: a sort or a new item in a small list keeps the comment, another product in the card detaches it. For a control (button, form field, also a label or icon in it or in a link), the card's texts count too ("Ada Lee", "Order 1234"), so another record in the same card detaches the comment, and so does a changed price. A card with more than 50 links, images and texts must keep all of them (a sort keeps the comment, any other change detaches it). Icons in buttons do not count: they are the same on every card and change when toggled. A filter that shows another product in the same card detaches the comment.
7. Links and images are identified by their URL without tracking, size and signature parameters, also in `srcset` and in the `<source>` elements of a `<picture>`.
8. On the open page, the element found before stays while it keeps its text, also when its neighbors change (not for repeated text).

Rules:

- A pin anchors to the clicked element itself, never to a container.
- A rectangle anchors to the element under its center. Its % can be < 0 or > 100. Check this with tests in step 1. Change it if it drifts.
- Developers can add `data-comment-anchor="pricing"` for very stable anchors.

### Login

One rule: **your app signs a short token, comma trusts it.**

| Where           | How                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inside your app | The app backend signs a token. The frontend calls `comma.identify(token)`. No login screen.                                                                                                                                                                                                                               |
| On another site | "Sign in" opens a popup → comma redirects to the app sign-in URL → the app (after its normal login) redirects back with a signed token → the popup sends a comma session to the widget with `postMessage` and closes.                                                                                                     |
| Through the app | `appUrl`: "Sign in" opens a page of the app that runs comma → the app's own login, if needed → comma in the app asks the server for a hand-over to the site that opened the popup (`postMessage`, only to that site's origin) → the site claims it for a session. No sign-in page in the app; its token stays in the app. |
| Slack           | "Sign in with Slack" opens a popup → Slack (OpenID Connect) → comma gets the user from Slack and checks the workspace → the popup sends a comma session to the widget. For sites without their own sign-in.                                                                                                               |
| No account      | Guest: enter a name.                                                                                                                                                                                                                                                                                                      |

Details:

- App token: JWT, HS256, signed with the project secret. Claims: `sub`, `name`, optional `email` and `avatar`. Expiry ≤ 5 minutes.
- The widget exchanges an app token or a guest name for a **comma session token** (JWT, signed by the server, bound to one project). App sessions last 7 days, guest sessions 90 days: someone who leaves the app loses access within a week.
- The widget keeps the session token in `localStorage` and sends it as `Authorization: Bearer …`. No cookies, so Safari and Firefox work. Users sign in once per site.
- Each session is a row in `sessions`. Sign-out deletes it, so a copied token stops working.
- Apps that cannot sign tokens: `userUrl`. comma sends the app's own access token to the app's "current user" endpoint. A `200` names the user. No backend change.
- No app code at all: `data-token-from` on the script tag. c.js watches the app's `fetch` and `XMLHttpRequest` calls to that address and reads their bearer token (it never changes a request). comma signs in with the first token per page load, and again after a gap without a token; 5 s without a token signs out. `data-token-key`: the storage key of the app's token; its removal (also in another tab, or missing at page load) signs out at once, because apps often send nothing after their sign-out. comma's account menu then has no "Sign out": the app signs in and out.
- Slack: one workspace per project (`slack.team`). comma exchanges the code with the client secret and reads `openid.connect.userInfo` from Slack. No library: the flow has no ID token check, because the user info comes straight from Slack.
- Hand-over (`appUrl`): the site posts `comma:sign-in` to the popup until it answers. comma in the app answers only its opener, and only when an app user is signed in. The server signs a hand-over (JWT: `sub`, project, the site's origin, 1 minute) only for comma on the app's origin, and only for a site of the project. The site claims it with its own `Origin`, for a new session.
- `postMessage` and redirects go only to origins registered for the project.
- In the app, the work is one endpoint that signs the token (~20–30 lines).

### Server

- Hono. Runs on Bun (Docker), AWS Lambda, Cloudflare Workers and Vercel (see DEPLOY.md).
- SQLite through libSQL: one local file, or a remote database (Turso) on serverless targets. Writes go in one `batch`.
- Validate all input at the entry point (zod).
- CORS and `Origin` check: only the project's registered origins. `*` matches one subdomain label (preview deploys).
- Project `scope: "origin"`: each origin has its own threads (`threads.site`). Default: the project shares them.
- Comment body is stored as Tiptap JSON. The server checks it against the allowed nodes and marks (zod), with a size limit. It rejects anything else.
- The server reads mentions from the mention nodes, and plain text (for search) from the text nodes. The client does not send them separately.
- Links: only `http`, `https` and `mailto`. Rendered with `rel="noopener noreferrer"` and `target="_blank"`.
- Images: stored in the database (one file to back up), or in S3 or R2 (serverless). Check type by file content, not by name. Uploads that no comment uses after 24 h are deleted.
- Rate limit in the database (`limits`, one counter per key and hour), so all serverless instances share it.

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
}
```

### Data

```
users      id, project, kind (guest|app), external_id, name, email, avatar_url, is_admin, created_at
threads    id, project, page (URL path), anchor (JSON), status (open|resolved),
           created_by, created_at, updated_at, resolved_at, resolved_by,
           context (JSON: url, title, viewport, dpr, browser, os, theme, language, timeZone, scroll), assignee_id, site (host)
comments   id, thread_id, author_id, body (Tiptap JSON), text (plain, for search), created_at, edited_at
mentions   comment_id, user_id   (from the body)
reactions  comment_id, user_id, emoji
reads      user_id, thread_id, read_at
files      id, project, comment_id (null until used), uploaded_by, mime, size, width, height, data, created_at
sessions   id, user_id, created_at, expires_at
```

- Any change to a thread or its comments updates `threads.updated_at`.
- File ids are random (128 bit), so image URLs cannot be guessed.

### API

```
GET    /c.js
POST   /api/session/guest        { project, name }      → { token, user }
POST   /api/session/app          { project, appToken }  → { token, user }
DELETE /api/session                                     → ends this session
GET    /auth/start               ?project&origin        → redirect to signInUrl
GET    /auth/callback            ?token&state           → page: postMessage session to opener, close
GET    /api/threads                         → all threads with comments, reactions, read state (ETag)
POST   /api/threads                         { page, anchor, body, files, context? } → thread
PATCH  /api/threads/:id                     { status } | { page, anchor } | { assignee: user id | null }
DELETE /api/threads/:id
POST   /api/threads/:id/read                { read: true|false }
POST   /api/threads/:id/comments            { body, files }
PATCH  /api/comments/:id                    { body }
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
   - shadcn: `bunx shadcn@latest create --preset b19FZ2` in `widget/`. Wire Tailwind CSS into the shadow root (see "UI").
   - Spike: shadcn Button, Popover, Dropdown Menu and Dialog with `preact/compat` in the Shadow DOM. Focus, keyboard, portals and styles work in Chromium, Firefox and WebKit. Measure the gzip size.
   - Spike: Tiptap in an open Shadow DOM. Typing, selection, shortcuts, input rules and the mention popup work in Chromium, Firefox and WebKit. If a browser fails: fix it, or move only the editor into the page DOM with scoped styles.
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
6. **Composer**: Tiptap with shortcuts and input rules, mentions, emoji, images, drafts, on-demand loading. Thread renderer from JSON.
7. **Thread popover**: replies, reactions, menu, resolve, mark as unread, copy link.
8. **Panel**: push mode, list, search, sort, filters, keyboard, other-page threads, deep link, narrow screens, polling.
9. **Popup sign-in**: `/auth/start`, `/auth/callback`, origin checks. A fake app in `example/` signs tokens.
10. **End-to-end** (Playwright on `example/`): guest adds a comment with a mention and an image → second user replies and reacts → first user sees unread → resolve → reload → pin still on its element → panel narrows the page.
11. **README**: integration for any site, for an app with `identify`, and for popup sign-in.

## Checks

- `bun test`: server and pure logic.
- `bunx playwright test`: anchors and end-to-end.
- `bunx biome check`, `tsc --noEmit`.
- Size check on `c.js` and the editor chunk.

## References

- SitePing anchor matching (selectors + XPath + text fingerprint + score): `packages/widget/src/dom/`. Reuse the ideas, not the code.
- Vercel toolbar (public scripts on `vercel.live`): the UI is in a closed Shadow DOM. A 0×0 iframe on `vercel.live` does login and data. A hidden iframe runs the UI code. We can add a bridge iframe later to hide the token from page scripts or share one login across sites.
