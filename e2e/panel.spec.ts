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
  await signIn(page, await guestSession("Pusher"))
  await openTestPage(page, "push")
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

test("a detached thread shows in the panel with a label", async ({ page }) => {
  const me = await guestSession("Detacher")
  const path = testPath("detached")
  await apiThread(me, path, "Lost comment", "This heading is gone")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await expect(items(page)).toContainText("Detached")
  await expect(pins(page)).toHaveCount(0)
  await items(page).click()
  await expect(threadPopover(page)).toContainText("Lost comment")
  await expect(threadPopover(page)).toContainText("Detached")
})

test("the panel takes the focus and gives it back", async ({ page }) => {
  await signIn(page, await guestSession("Focus"))
  await openTestPage(page, "focus")
  const button = toolbar(page).getByRole("button", { name: /^Comments/ })
  await button.focus()
  await page.keyboard.press("Enter")
  await expect(panel(page).getByRole("searchbox", { name: "Search comments" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(panel(page)).toBeHidden()
  await expect(button).toBeFocused()
})

test.describe("narrow screens", () => {
  test.use({ viewport: { width: 400, height: 800 } })
  test("the panel covers the full screen and does not push the page", async ({ page }) => {
    await signIn(page, await guestSession("Narrow"))
    await openTestPage(page, "narrow")
    await openPanel(page)
    expect((await panel(page).boundingBox())?.width).toBe(400)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).marginRight)).toBe("0px")
    // The page behind the panel takes no focus and no clicks.
    expect(await page.evaluate(() => document.body.inert)).toBe(true)
    // Comment mode does not open the panel here.
    await panel(page).getByRole("button", { name: "Close comments" }).click()
    await page.keyboard.press("c")
    await expect(panel(page)).toBeHidden()
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
