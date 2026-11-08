import { expect, type Page, request, test } from "@playwright/test"
import {
  addComment,
  COMMA,
  endCommentMode,
  guestSession,
  openTestPage,
  panel,
  pins,
  SITE,
  signIn,
  testPath,
  threadPopover,
  toolbar,
  typeComment,
} from "./helpers"

type Session = Awaited<ReturnType<typeof guestSession>>

// Adds a thread with the API, as another user.
async function apiThread(session: Session, page: string, text: string, anchorText = "Test page title", tag = "h1") {
  const api = await request.newContext()
  const res = await api.post(`${COMMA}/api/threads`, {
    headers: { origin: SITE, authorization: `Bearer ${session.token}` },
    data: {
      page,
      anchor: {
        selectors: { css: `body > main > section > ${tag}` },
        tag,
        text: anchorText,
        context: "",
        point: { x: 10, y: 50 },
        viewport: 1280,
      },
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    },
  })
  expect(res.ok()).toBe(true)
  const json = await res.json()
  await api.dispose()
  return json.thread as { id: string }
}

const openPanel = async (page: Page) => {
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .click()
  await expect(panel(page)).toBeVisible()
}
const items = (page: Page) => panel(page).locator("[data-slot=panel-item]")

test("the panel pushes the page and pins follow", async ({ page }) => {
  await signIn(page, await guestSession("Pusher", SITE, "push"), SITE, "push")
  await page.goto(`${testPath("push")}?project=push`)
  await expect(toolbar(page)).toBeVisible()
  await addComment(page, page.getByTestId("lead"), "Pinned")
  await endCommentMode(page)
  const lead = page.getByTestId("lead")
  const pinX = async () => (await pins(page).first().boundingBox())?.x ?? 0
  const leadX = async () => (await lead.boundingBox())?.x ?? 0
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).marginRight)).toBe("360px")
  expect(Math.abs((await pinX()) - (await leadX()) - ((await lead.boundingBox())?.width ?? 0) * 0.2)).toBeLessThan(2)
  await panel(page).getByRole("button", { name: "Close comments" }).click()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).marginRight)).toBe("0px")
  await expect
    .poll(async () => Math.abs((await pinX()) - (await leadX()) - ((await lead.boundingBox())?.width ?? 0) * 0.2))
    .toBeLessThan(2)
})

test("push: fixed bars at the panel's edge (a site header) move too, and come back", async ({ page }) => {
  await signIn(page, await guestSession("Bars", SITE, "push"), SITE, "push")
  await page.goto(`${testPath("push-bars")}?project=push`)
  await expect(toolbar(page)).toBeVisible()
  // A header across the top, and a badge placed from the left only.
  await page.evaluate(() => {
    const bar = document.createElement("header")
    bar.dataset.testid = "bar"
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;height:40px;background:#eee"
    const badge = document.createElement("div")
    badge.dataset.testid = "badge"
    badge.style.cssText = "position:fixed;bottom:10px;left:10px;width:50px;height:20px"
    document.body.append(bar, badge)
  })
  const right = async (id: string) => {
    const box = await page.getByTestId(id).boundingBox()
    return (box?.x ?? 0) + (box?.width ?? 0)
  }
  const width = page.viewportSize()?.width ?? 0
  expect(await right("bar")).toBe(width)
  await openPanel(page)
  await expect.poll(() => right("bar")).toBe(width - 360)
  expect(await right("badge")).toBe(60)
  await panel(page).getByRole("button", { name: "Close comments" }).click()
  await expect.poll(() => right("bar")).toBe(width)
  expect(await page.getByTestId("bar").evaluate((el) => el.style.right)).toBe("0px")
})

test("list, search, sort and filters", async ({ page }) => {
  const me = await guestSession("Lister")
  const other = await guestSession("Other")
  const path = testPath("list")
  await apiThread(me, path, "Alpha from me")
  await apiThread(other, path, "Beta from other")
  const gamma = `Gamma on another page ${path}`
  await apiThread(other, `${path}-elsewhere`, gamma)
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)

  // This page, newest first.
  await expect(items(page)).toHaveCount(2)
  await expect(items(page).nth(0)).toContainText("Beta from other")
  await expect(items(page).nth(0)).toContainText("Other")

  // Search.
  await panel(page).getByRole("searchbox", { name: "Search comments" }).fill("alpha")
  await expect(items(page)).toHaveCount(1)
  await expect(items(page)).toContainText("Alpha from me")
  await panel(page).getByRole("searchbox", { name: "Search comments" }).fill("")

  const menu = async (name: string, role: "menuitemradio" | "menuitemcheckbox") => {
    await panel(page).getByRole("button", { name: "Filter and sort" }).click()
    await page.getByRole(role, { name }).click()
    await page.keyboard.press("Escape")
    // A click on the button while the menu still closes does not open it again.
    await expect(page.getByRole("menu")).toBeHidden()
  }

  // Only my threads.
  await menu("Only my threads", "menuitemcheckbox")
  await expect(items(page)).toHaveCount(1)
  await expect(items(page)).toContainText("Alpha from me")
  await menu("Only my threads", "menuitemcheckbox")

  // All pages: shows the page path.
  await menu("All pages", "menuitemradio")
  await expect(items(page).filter({ hasText: gamma })).toContainText(`${path}-elsewhere`)

  // Unread first: threads by others are unread for me.
  await menu("This page", "menuitemradio")
  await menu("Unread first", "menuitemradio")
  await expect(items(page).nth(0)).toContainText("Beta from other")
})

test("unread first keeps its order while I read: ↓ goes on to the next unread thread", async ({ page }) => {
  const other = await guestSession("Other")
  const me = await guestSession("Reader")
  const path = testPath("unread-order")
  // Mine (read) is the newest; the three by Other are unread for me.
  for (const text of ["Unread A", "Unread B", "Unread C"]) await apiThread(other, path, text)
  await apiThread(me, path, "Mine")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await panel(page).getByRole("button", { name: "Filter and sort" }).click()
  await page.getByRole("menuitemradio", { name: "Unread first" }).click()
  await page.keyboard.press("Escape")
  await expect(items(page).nth(0)).toContainText("Unread C")
  await items(page).nth(0).focus()
  // ↓ selects (and reads) one unread thread after the other.
  for (const text of ["Unread B", "Unread A"]) {
    await page.keyboard.press("ArrowDown")
    await expect(threadPopover(page)).toContainText(text)
  }
  // A new sort order when the panel opens again: the read ones go down.
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .click()
  await expect(panel(page)).toBeHidden()
  await openPanel(page)
  await expect(items(page).nth(0)).toContainText("Unread C")
})

test("arrow keys move between threads, Enter opens one", async ({ page }) => {
  const me = await guestSession("Keys")
  const path = testPath("keys")
  await apiThread(me, path, "First thread")
  await apiThread(me, path, "Second thread", "A paragraph that people comment on in tests.", "p")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await items(page).first().focus()
  await page.keyboard.press("ArrowDown")
  await expect(items(page).nth(1)).toBeFocused()
  await page.keyboard.press("ArrowUp")
  await expect(items(page).nth(0)).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(threadPopover(page)).toContainText("Second thread")
})

test("a thread on another page: click goes there and opens it", async ({ page }) => {
  const me = await guestSession("Traveler")
  const path = testPath("travel")
  const text = `Over there ${path}`
  await apiThread(me, `${path}-b`, text)
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await panel(page).getByRole("button", { name: "Filter and sort" }).click()
  await page.getByRole("menuitemradio", { name: "All pages" }).click()
  await page.keyboard.press("Escape")
  await items(page).filter({ hasText: text }).click()
  await expect(page).toHaveURL(new RegExp(`${path}-b$`))
  await expect(threadPopover(page)).toContainText(text)
  await expect(pins(page)).toHaveCount(1)
})

test("the review goes on on the other page: the panel, its filters and search stay", async ({ page }) => {
  const me = await guestSession("Reviewer on the way")
  const path = testPath("review-travel")
  const text = `Far away ${path}`
  await apiThread(me, `${path}-b`, text)
  await apiThread(me, `${path}-b`, "Also far away, not found")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await panel(page).getByRole("button", { name: "Filter and sort" }).click()
  await page.getByRole("menuitemradio", { name: "All pages" }).click()
  await page.keyboard.press("Escape")
  await panel(page).getByRole("searchbox", { name: "Search comments" }).fill("far away")
  await items(page).filter({ hasText: text }).click()
  await expect(page).toHaveURL(new RegExp(`${path}-b$`))
  await expect(threadPopover(page)).toContainText(text)
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole("searchbox", { name: "Search comments" })).toHaveValue("far away")
  // Still all pages: the item says its page.
  await expect(items(page).filter({ hasText: text })).toContainText(`${path}-b`)
})

test("a detached thread shows in the panel with a label", async ({ page }) => {
  const me = await guestSession("Detacher")
  const path = testPath("detached")
  await apiThread(me, path, "Lost comment", "This heading is gone")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await expect(items(page)).toContainText("Element not found")
  await expect(pins(page)).toHaveCount(0)
  await items(page).click()
  await expect(threadPopover(page)).toContainText("Lost comment")
  // The thread says what it was about, and the author can move it.
  await expect(threadPopover(page)).toContainText("Element not found. It was on: Heading “This heading is gone”")
  await threadPopover(page).getByRole("button", { name: "Move" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Click the new place" })).toBeVisible()
})

test("a search or filter that does not show the open thread closes it", async ({ page }) => {
  const me = await guestSession("Searcher")
  const path = testPath("search-closes")
  await apiThread(me, path, "Apples")
  await apiThread(me, path, "Pears")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await items(page).filter({ hasText: "Apples" }).click()
  await expect(threadPopover(page)).toContainText("Apples")
  const search = panel(page).getByRole("searchbox", { name: "Search comments" })
  // A search that still shows it: it stays open.
  await search.fill("app")
  await expect(threadPopover(page)).toContainText("Apples")
  await search.fill("pear")
  await expect(threadPopover(page)).toBeHidden()
  await expect(items(page)).toHaveCount(1)
  await expect(items(page)).toContainText("Pears")
})

test("the panel takes the focus and gives it back", async ({ page }) => {
  const me = await guestSession("Focus")
  const path = testPath("focus")
  await apiThread(me, path, "Older")
  await apiThread(me, path, "Newer", "A paragraph that people comment on in tests.", "p")
  await signIn(page, me)
  await page.goto(path)
  const button = toolbar(page).getByRole("button", { name: /^Comments/ })
  await button.focus()
  await page.keyboard.press("Enter")
  // The first item, not the search: the keys (Shift+C, ↑ ↓) work. Only the focus: no thread opens.
  await expect(items(page).first()).toBeFocused()
  await expect(threadPopover(page)).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(panel(page)).toBeHidden()
  await expect(button).toBeFocused()

  // With a thread open: its item.
  await pins(page).first().click()
  await expect(threadPopover(page)).toBeVisible()
  await button.focus()
  await page.keyboard.press("Enter")
  await expect(items(page).filter({ hasText: "Older" })).toBeFocused()
})

test("a reply editor that loads late does not take the focus from the panel", async ({ page }) => {
  const me = await guestSession("Slow editor")
  const path = testPath("slow-editor")
  await apiThread(me, path, "Older")
  await signIn(page, me)
  // The editor loads on demand. Hold it back, as on a slow network.
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/w/chunks/editor-*.js", async (route) => {
    await held
    await route.continue()
  })
  await page.goto(path)
  await pins(page).first().click()
  await expect(threadPopover(page)).toBeVisible()
  const button = toolbar(page).getByRole("button", { name: /^Comments/ })
  await button.focus()
  await page.keyboard.press("Enter")
  const item = items(page).filter({ hasText: "Older" })
  await expect(item).toBeFocused()

  release()
  await expect(threadPopover(page).locator(".ProseMirror")).toBeVisible()
  await expect(item).toBeFocused()
})

test("an empty panel takes the focus itself", async ({ page }) => {
  await signIn(page, await guestSession("Empty focus"))
  await openTestPage(page, "focus-empty")
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .focus()
  await page.keyboard.press("Enter")
  await expect(panel(page)).toBeFocused()
})

test("a link opens a resolved, detached thread", async ({ page }) => {
  const me = await guestSession("Linked")
  const path = testPath("deep-resolved")
  const thread = await apiThread(me, path, "Old and resolved", "This heading is gone")
  const api = await request.newContext()
  await api.patch(`${COMMA}/api/threads/${thread.id}`, {
    headers: { origin: SITE, authorization: `Bearer ${me.token}` },
    data: { status: "resolved" },
  })
  await api.dispose()
  await signIn(page, me)
  await page.goto(`${path}#comma=${thread.id}`)
  await expect(threadPopover(page)).toContainText("Old and resolved")
  await expect(threadPopover(page)).toContainText("Resolved")
})

test("a link to a thread on a hidden element opens it next to the panel", async ({ page }) => {
  const me = await guestSession("Hidden")
  const path = testPath("deep-hidden")
  const thread = await apiThread(me, path, "On a hidden element", "A paragraph that people comment on in tests.", "p")
  await signIn(page, me)
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const lead = document.querySelector("[data-testid=lead]") as HTMLElement
      lead.style.display = "none"
    })
  })
  await page.goto(`${path}#comma=${thread.id}`)
  await expect(threadPopover(page)).toContainText("On a hidden element")
  await expect(panel(page)).toBeVisible()
})

test.describe("narrow screens", () => {
  test.use({ viewport: { width: 400, height: 800 } })
  test("the panel covers the full screen and does not push the page", async ({ page }) => {
    await signIn(page, await guestSession("Narrow"))
    await openTestPage(page, "narrow")
    await openPanel(page)
    expect((await panel(page).boundingBox())?.width).toBe(400)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).marginRight)).toBe("0px")
    // The page and the pins behind the panel take no focus and no clicks.
    expect(await page.evaluate(() => document.body.inert)).toBe(true)
    await expect(page.locator("[data-slot=pins]")).toHaveAttribute("inert", "")
    // Comment mode does not open the panel here.
    await panel(page).getByRole("button", { name: "Close comments" }).click()
    await page.keyboard.press("c")
    await expect(panel(page)).toBeHidden()
  })

  test("the toolbar is centered and small, and stays in place over the panel", async ({ page }) => {
    await signIn(page, await guestSession("Narrow bar"))
    await openTestPage(page, "narrow-bar")
    const box = await toolbar(page).boundingBox()
    expect(box?.width).toBeLessThan(160)
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - 200)).toBeLessThan(2)
    await openPanel(page)
    expect(await toolbar(page).boundingBox()).toEqual(box)
    // The same button closes the panel.
    await toolbar(page)
      .getByRole("button", { name: /^Comments/ })
      .click()
    await expect(panel(page)).toBeHidden()
  })

  test("a thread opens next to its pin: the panel closes", async ({ page }) => {
    const me = await guestSession("Narrow reader")
    const path = testPath("narrow-open")
    await apiThread(me, path, "Read me on the page")
    await signIn(page, me)
    await page.goto(path)
    await openPanel(page)
    await items(page).first().click()
    await expect(panel(page)).toBeHidden()
    await expect(threadPopover(page)).toContainText("Read me on the page")
  })

  test("a thread without its element opens on the screen, and does not cover its details", async ({ page }) => {
    const me = await guestSession("Narrow detached")
    const path = testPath("narrow-detached")
    await apiThread(me, path, "On the page")
    await apiThread(me, path, "Element gone", "This heading is gone")
    await signIn(page, me)
    await page.goto(path)
    // First a thread with a pin (the panel closes), then the panel again, and the one without its element.
    await openPanel(page)
    await items(page).filter({ hasText: "On the page" }).click()
    await expect(threadPopover(page)).toContainText("On the page")
    await openPanel(page)
    await items(page).filter({ hasText: "Element gone" }).click()
    const thread = threadPopover(page)
    await expect(thread).toContainText("Element gone")
    const box = (await thread.boundingBox()) ?? { x: -1, width: 0 }
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(400)
    // The details cover the screen: the thread hides until they close.
    await panel(page).getByRole("button", { name: "Details: Element gone" }).click()
    await expect(panel(page).getByRole("region", { name: "Details" })).toBeVisible()
    await expect(thread).toBeHidden()
    await panel(page).getByRole("button", { name: "Back to comments" }).click()
    await expect(threadPopover(page)).toContainText("Element gone")
  })
})

test.describe("very narrow screens", () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: false })
  test("the composer fits the screen", async ({ page }) => {
    await signIn(page, await guestSession("Small"))
    await openTestPage(page, "very-narrow")
    await page.getByTestId("picture").scrollIntoViewIfNeeded()
    await toolbar(page).getByRole("button", { name: "Comment mode" }).tap()
    // At the right edge of the picture. Comment mode covers the page, so a tap at the place, not on the element.
    const picture = (await page.getByTestId("picture").boundingBox()) ?? { x: 0, y: 0, width: 0 }
    await page.touchscreen.tap(picture.x + picture.width - 10, picture.y + 20)
    const composer = page.getByRole("dialog", { name: "New comment" })
    await typeComment(page, composer, "Small screen")
    const box = (await composer.boundingBox()) ?? { x: -1, width: 999 }
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    // The page does not get wider.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  })
})

test("new comments from others appear without a reload", async ({ page, browserName }) => {
  const me = await guestSession("Watcher")
  const other = await guestSession("Poster")
  const path = testPath("poll")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await expect(panel(page)).toContainText("No comments")
  await apiThread(other, path, "Fresh news")
  // On window focus.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(items(page)).toContainText("Fresh news")
  await expect(toolbar(page).getByRole("button", { name: /^Comments, \d+ unread$/ })).toBeVisible()

  // Every 15 s while the tab is visible.
  test.skip(browserName !== "chromium", "Slow: one browser is enough")
  await apiThread(other, path, "Later news")
  await expect(items(page).filter({ hasText: "Later news" })).toBeVisible({ timeout: 17_000 })
})

test("a search with no match on this page points to matches on other pages", async ({ page }) => {
  const me = await guestSession("Seeker")
  const path = testPath("search-elsewhere")
  await apiThread(me, path, "Here on this page")
  await apiThread(me, `${path}-pricing`, "The pricing table is too wide")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await panel(page).getByRole("searchbox", { name: "Search comments" }).fill("pricing table")
  await expect(panel(page)).toContainText("No comments on this page match “pricing table”")
  // The other browsers of the run add theirs to the project.
  await expect(panel(page)).toContainText(/\d+ match(es)? on other pages/)
  await panel(page).getByRole("button", { name: "Search all pages" }).click()
  await expect(items(page).filter({ hasText: "The pricing table is too wide" }).first()).toBeVisible()
  await expect(items(page).filter({ hasText: "Here on this page" })).toHaveCount(0)
})

test("an empty page points to comments on other pages", async ({ page }) => {
  const me = await guestSession("Empty")
  const other = await guestSession("Elsewhere")
  const path = testPath("empty-elsewhere")
  const text = `Over on the other page ${path}`
  await apiThread(other, `${path}-b`, text)
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await expect(panel(page)).toContainText("No comments on this page")
  await expect(panel(page)).toContainText(/\d+ (comment|comments) on other pages/)
  await panel(page).getByRole("button", { name: "Show all pages" }).click()
  await expect(items(page).filter({ hasText: text })).toBeVisible()
  // The filter button tells that a filter is on.
  await expect(panel(page).getByRole("button", { name: "Filter and sort, 1 on" })).toBeVisible()
})

test("a search without results names the search and clears it", async ({ page }) => {
  await signIn(page, await guestSession("Searcher"))
  await openTestPage(page, "search-empty")
  await openPanel(page)
  const search = panel(page).getByRole("searchbox", { name: "Search comments" })
  await search.fill("zebra")
  await expect(panel(page)).toContainText("No comments match “zebra”")
  await panel(page).getByRole("button", { name: "Clear search" }).click()
  await expect(search).toHaveValue("")
})

test("the empty panel has a button that starts a comment", async ({ page }) => {
  await signIn(page, await guestSession("Starter"))
  await openTestPage(page, "start-empty")
  await openPanel(page)
  await panel(page).getByRole("button", { name: "Add comment" }).click()
  await expect(toolbar(page).getByRole("button", { name: "Comment mode" })).toHaveAttribute("aria-pressed", "true")
})

test("an unread thread shows its newest reply, and pages show their title", async ({ page }) => {
  const me = await guestSession("Asker")
  const other = await guestSession("Answerer")
  const path = testPath("newest-reply")
  const thread = await apiThread(me, path, "Is this the right title?")
  const api = await request.newContext()
  await api.post(`${COMMA}/api/threads/${thread.id}/comments`, {
    headers: { origin: SITE, authorization: `Bearer ${other.token}` },
    data: {
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Yes, ship it" }] }] },
    },
  })
  await api.dispose()
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  const item = items(page).first()
  await expect(item).toContainText("Answerer")
  await expect(item).toContainText("replied")
  await expect(item).toContainText("Yes, ship it")
  await expect(item).toContainText("Is this the right title?")

  // A comment made in the widget keeps the page title.
  await panel(page).getByRole("button", { name: "Close comments" }).click()
  const titled = `With a title ${path}`
  await addComment(page, page.getByTestId("lead"), titled)
  await endCommentMode(page)
  await openPanel(page)
  await panel(page).getByRole("button", { name: "Filter and sort" }).click()
  await page.getByRole("menuitemradio", { name: "All pages" }).click()
  await page.keyboard.press("Escape")
  await expect(items(page).filter({ hasText: titled })).toContainText("Test page")
})

test("when comma cannot be reached, the panel says so and tries again on request", async ({ page }) => {
  await signIn(page, await guestSession("Offline"))
  await page.route(`${COMMA}/api/threads`, (route) => route.abort("connectionrefused"))
  await openTestPage(page, "offline")
  await openPanel(page)
  await expect(panel(page)).toContainText("Could not load comments.")
  await expect(panel(page)).not.toContainText("Loading…")
  await page.unroute(`${COMMA}/api/threads`)
  await panel(page).getByRole("button", { name: "Try again" }).click()
  await expect(panel(page)).toContainText("No comments on this page")
})

test("the panel floats over the page by default; a toggle makes it push the page, and stays", async ({ page }) => {
  await signIn(page, await guestSession("Floater"))
  await openTestPage(page, "overlay")
  await openPanel(page)
  const margin = () => page.evaluate(() => getComputedStyle(document.documentElement).marginRight)
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const box = async () => (await panel(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  // Overlay: the page keeps its width. A margin on the top, the bottom and the side shows that it floats.
  expect(await margin()).toBe("0px")
  // After the short slide-in.
  await expect.poll(async () => viewport.width - (await box()).x - (await box()).width).toBe(8)
  const b = await box()
  expect(b.y).toBe(8)
  expect(viewport.height - b.y - b.height).toBe(8)

  await panel(page).getByRole("button", { name: "View options" }).click()
  await page.getByRole("menuitemradio", { name: "Push" }).click()
  await page.keyboard.press("Escape")
  await expect.poll(margin).toBe("360px")
  await expect.poll(async () => (await box()).y).toBe(0)

  // The choice stays after a reload.
  await page.reload()
  // The panel stays open for the tab.
  await expect(panel(page)).toBeVisible()
  await expect.poll(margin).toBe("360px")
  await panel(page).getByRole("button", { name: "View options" }).click()
  await page.getByRole("menuitemradio", { name: "Overlay" }).click()
  await expect.poll(margin).toBe("0px")
})

test("a project can make push the default", async ({ page }) => {
  await signIn(page, await guestSession("Pushed", SITE, "push"), SITE, "push")
  await page.goto(`${testPath("push-default")}?project=push`)
  await openPanel(page)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).marginRight)).toBe("360px")
  await panel(page).getByRole("button", { name: "View options" }).click()
  await expect(page.getByRole("menuitemradio", { name: "Push" })).toBeChecked()
})

test("overlay: comment mode does not open the panel, and a thread opens beside it, not under it", async ({ page }) => {
  await signIn(page, await guestSession("Beside"))
  await openTestPage(page, "overlay-beside")
  // A comment on the right part of the picture, which the panel covers when it is open.
  await addComment(page, page.getByTestId("picture"), "Right side", 0.95, 0.2)
  await expect(panel(page)).toBeHidden()
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .click()
  await expect(panel(page)).toBeVisible()
  await expect(threadPopover(page)).toBeVisible()
  const right = async () => {
    const thread = (await threadPopover(page).boundingBox()) ?? { x: 0, width: 0 }
    return thread.x + thread.width - ((await panel(page).boundingBox())?.x ?? 0)
  }
  await expect.poll(right).toBeLessThanOrEqual(0)
})

test("the filter button is next to the search field", async ({ page }) => {
  await signIn(page, await guestSession("Filterer"))
  await openTestPage(page, "filter-place")
  await openPanel(page)
  const search = (await panel(page).getByRole("searchbox", { name: "Search comments" }).boundingBox()) ?? {
    y: 0,
    height: 0,
  }
  const filter = (await panel(page).getByRole("button", { name: "Filter and sort" }).boundingBox()) ?? {
    y: 0,
    height: 0,
  }
  expect(Math.abs(filter.y + filter.height / 2 - (search.y + search.height / 2))).toBeLessThan(4)
})

test("the panel goes to the side it is dragged to, in both modes; the view menu does the same", async ({ page }) => {
  await signIn(page, await guestSession("Dragger"))
  await openTestPage(page, "sides")
  await openPanel(page)
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const box = async () => (await panel(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  const margins = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return [style.marginLeft, style.marginRight]
    })
  await expect.poll(async () => viewport.width - (await box()).x - (await box()).width).toBe(8)

  // Drag the header to the left half of the window. Overlay: 8 px from the left edge.
  const drag = async (toX: number) => {
    const header = (await panel(page).getByRole("heading", { name: "Comments" }).boundingBox()) ?? { x: 0, y: 0 }
    await page.mouse.move(header.x + 10, header.y + 5)
    await page.mouse.down()
    await page.mouse.move(toX, header.y + 5, { steps: 8 })
    await page.mouse.up()
  }
  await drag(200)
  await expect.poll(async () => (await box()).x).toBe(8)
  expect(await margins()).toEqual(["0px", "0px"])

  // The side stays after a reload, and in push mode: the page gets its margin on the left.
  await page.reload()
  // The panel stays open for the tab.
  await expect(panel(page)).toBeVisible()
  await expect.poll(async () => (await box()).x).toBe(8)
  await panel(page).getByRole("button", { name: "View options" }).click()
  await expect(page.getByRole("menuitemradio", { name: "Left" })).toBeChecked()
  await page.getByRole("menuitemradio", { name: "Push" }).click()
  await page.keyboard.press("Escape")
  await expect.poll(margins).toEqual(["360px", "0px"])
  await expect.poll(async () => (await box()).x).toBe(0)

  // Drag back to the right in push mode.
  await drag(1100)
  await expect.poll(margins).toEqual(["0px", "360px"])
  await expect.poll(async () => (await box()).x + (await box()).width).toBe(viewport.width)

  // The view menu moves it without a drag.
  await panel(page).getByRole("button", { name: "View options" }).click()
  await page.getByRole("menuitemradio", { name: "Left" }).click()
  await expect.poll(margins).toEqual(["360px", "0px"])
})

test("overlay on the left: a thread opens beside the panel", async ({ page }) => {
  await signIn(page, await guestSession("LeftBeside"))
  await page.addInitScript(() => localStorage.setItem("comma:panel-side", "left"))
  await openTestPage(page, "overlay-left")
  // A comment on the left part of the picture, which the panel covers when it is open.
  await addComment(page, page.getByTestId("picture"), "Left side", 0.02, 0.2)
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .click()
  await expect(threadPopover(page)).toBeVisible()
  const gap = async () => {
    const thread = (await threadPopover(page).boundingBox()) ?? { x: 0 }
    const side = (await panel(page).boundingBox()) ?? { x: 0, width: 0 }
    return thread.x - (side.x + side.width)
  }
  await expect.poll(gap).toBeGreaterThanOrEqual(0)
})

test("the toolbar stays in place: the open panel takes it in, on both sides and in both modes", async ({ page }) => {
  await signIn(page, await guestSession("Docked"))
  await openTestPage(page, "docked")
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  for (const [mode, side] of [
    ["overlay", "right"],
    ["overlay", "left"],
    ["push", "right"],
    ["push", "left"],
  ]) {
    await page.evaluate(
      ([mode, side]) => {
        localStorage.setItem("comma:panel-mode", mode)
        localStorage.setItem("comma:panel-side", side)
      },
      [mode, side],
    )
    await page.reload()
    const bar = (await toolbar(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
    // On the panel's side, also while the panel is closed.
    expect(side === "left" ? bar.x : viewport.width - bar.x - bar.width).toBe(16)
    expect(viewport.height - bar.y - bar.height).toBe(16)
    const button = (await toolbar(page)
      .getByRole("button", { name: /^Comments/ })
      .boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
    // One click opens the panel, the next click at the same place closes it.
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
    await expect(panel(page)).toBeVisible()
    expect(await toolbar(page).boundingBox()).toEqual(bar)
    const box = async () => (await panel(page).boundingBox()) ?? { x: 0, width: 0 }
    await expect
      .poll(async () => (side === "left" ? (await box()).x : viewport.width - (await box()).x - (await box()).width))
      .toBe(mode === "overlay" ? 8 : 0)
    const p = await box()
    expect(bar.x).toBeGreaterThanOrEqual(p.x)
    expect(bar.x + bar.width).toBeLessThanOrEqual(p.x + p.width)
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
    await expect(panel(page)).toBeHidden()
  }
})

test("the list and the details scroll clear of the toolbar", async ({ page }) => {
  const me = await guestSession("Clear")
  const path = testPath("clear")
  for (let i = 1; i <= 15; i++) await apiThread(me, path, `Comment ${i}`)
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await expect(items(page)).toHaveCount(15)
  const list = panel(page).getByRole("list", { name: "Threads" })
  await list.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  const bar = (await toolbar(page).boundingBox()) ?? { y: 0 }
  const last = (await items(page).last().boundingBox()) ?? { y: 0, height: 0 }
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y)

  // A low window: the details scroll too.
  await page.setViewportSize({ width: 1280, height: 400 })
  await panel(page).getByRole("button", { name: "Details: Comment 1", exact: true }).click()
  const details = panel(page).getByRole("region", { name: "Details" })
  await details.locator(".overflow-y-auto").evaluate((el) => el.scrollTo(0, el.scrollHeight))
  const copy = (await details.getByRole("button", { name: "Copy as bug report" }).boundingBox()) ?? { y: 0, height: 0 }
  const lowBar = (await toolbar(page).boundingBox()) ?? { y: 0 }
  expect(copy.y + copy.height).toBeLessThanOrEqual(lowBar.y)
})
