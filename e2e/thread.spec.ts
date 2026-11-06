import { type BrowserContext, expect, type Page, test } from "@playwright/test"
import { sign } from "hono/jwt"
import {
  addComment,
  appSession,
  guestSession,
  openTestPage,
  panel,
  pins,
  signIn,
  testPath,
  threadPopover,
  typeComment,
} from "./helpers"

// The author adds a comment. Returns the page, in browse mode with the thread open.
async function withComment(page: Page, name: string, author: string, text = "First comment") {
  await signIn(page, await guestSession(author))
  await openTestPage(page, name)
  await addComment(page, page.getByTestId("lead"), text)
  return threadPopover(page)
}

async function asOther(context: BrowserContext, name: string, session: Awaited<ReturnType<typeof guestSession>>) {
  const other = await context.browser()?.newPage()
  if (!other) throw new Error("no browser")
  await signIn(other, session)
  await other.goto(testPath(name))
  await pins(other).first().click()
  return other
}

test("replies and reactions", async ({ page, context }) => {
  const thread = await withComment(page, "reply", "Ann")
  const bob = await asOther(context, "reply", await guestSession("Bob"))
  const bobThread = threadPopover(bob)
  await typeComment(bob, bobThread, "A reply")
  await bob.keyboard.press("Enter")
  await expect(bobThread.getByRole("article")).toHaveCount(2)

  // Quick reaction on the first comment.
  const first = bobThread.getByRole("article").first()
  await first.hover()
  await first.getByRole("button", { name: "Add reaction" }).click()
  await bob.getByRole("button", { name: "React with 🎉" }).click()
  const chip = first.getByRole("button", { name: /^🎉 1/ })
  await expect(chip).toHaveAttribute("aria-pressed", "true")
  await expect(bobThread).toBeVisible()

  // Ann sees the reply and the reaction after the next update (window focus).
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(thread.getByRole("article")).toHaveCount(2)
  const annChip = thread
    .getByRole("article")
    .first()
    .getByRole("button", { name: /^🎉 1: Bob/ })
  await expect(annChip).toHaveAttribute("aria-pressed", "false")
  await annChip.click()
  await expect(thread.getByRole("article").first().getByRole("button", { name: /^🎉 2/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await bob.close()
})

test("edit and delete own comments", async ({ page }) => {
  const thread = await withComment(page, "edit", "Edith")
  await typeComment(page, thread, "Second")
  await page.keyboard.press("Enter")
  const second = thread.getByRole("article").nth(1)
  await expect(second).toContainText("Second")

  await second.hover()
  await second.getByRole("button", { name: "Comment actions" }).click()
  await page.getByRole("menuitem", { name: "Edit" }).click()
  const editor = second.locator(".ProseMirror")
  await expect(editor).toHaveText("Second")
  await editor.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" edited")
  await page.keyboard.press("Enter")
  await expect(second).toContainText("Second edited")
  await expect(second).toContainText("(edited)")

  await second.hover()
  await second.getByRole("button", { name: "Comment actions" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect(thread.getByRole("article")).toHaveCount(1)

  // Deleting the first comment deletes the thread.
  const first = thread.getByRole("article").first()
  await first.hover()
  await first.getByRole("button", { name: "Comment actions" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(page.getByRole("alertdialog")).toContainText("Delete thread?")
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect(thread).toBeHidden()
  await expect(pins(page)).toHaveCount(0)
})

test("others cannot edit or delete my comment or thread", async ({ page, context }) => {
  await withComment(page, "others", "Owner")
  const other = await asOther(context, "others", await guestSession("Other"))
  const thread = threadPopover(other)
  await expect(thread.getByRole("article")).toHaveCount(1)
  await expect(thread.getByRole("button", { name: "Comment actions" })).toHaveCount(0)
  await thread.getByRole("button", { name: "Thread actions" }).click()
  await expect(other.getByRole("menuitem", { name: "Delete thread" })).toHaveCount(0)
  await other.close()
})

test("an admin deletes any thread", async ({ page, context }) => {
  await withComment(page, "admin", "Writer")
  const admin = await asOther(context, "admin", await appSession("Admin", true))
  await threadPopover(admin).getByRole("button", { name: "Thread actions" }).click()
  await admin.getByRole("menuitem", { name: "Delete thread" }).click()
  await admin.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect(pins(admin)).toHaveCount(0)
  await admin.close()
})

test("resolve tells what happened and can be undone", async ({ page }) => {
  const thread = await withComment(page, "resolve-undo", "Undoer")
  await thread.getByRole("button", { name: "Resolve" }).click()
  await expect(thread).toBeHidden()
  await expect(pins(page)).toHaveCount(0)
  const status = page.getByRole("status").filter({ hasText: "Thread resolved" })
  await expect(status).toBeVisible()
  await status.getByRole("button", { name: "Undo" }).click()
  await expect(pins(page)).toHaveCount(1)
  await expect(threadPopover(page)).toContainText("First comment")
  await expect(threadPopover(page)).not.toContainText("Resolved")
})

test("resolve hides the pin, reopen from the panel shows it", async ({ page }) => {
  const thread = await withComment(page, "resolve", "Res")
  await thread.getByRole("button", { name: "Resolve" }).click()
  await expect(thread).toBeHidden()
  await expect(pins(page)).toHaveCount(0)
  await expect(panel(page).getByRole("button", { name: /First comment/ })).toHaveCount(0)

  await panel(page).getByRole("button", { name: "Filter and sort" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show resolved" }).click()
  await page.keyboard.press("Escape")
  await panel(page)
    .getByRole("button", { name: /First comment/ })
    .click()
  await expect(thread).toContainText("Resolved by Res")
  await thread.getByRole("button", { name: "Reopen" }).click()
  await expect(thread).not.toContainText("Resolved")
  await thread.getByRole("button", { name: "Close" }).click()
  await expect(pins(page)).toHaveCount(1)
})

test("the author moves the pin with the keyboard", async ({ page }) => {
  const thread = await withComment(page, "move-keys", "Keys")
  await thread.getByRole("button", { name: "Thread actions" }).click()
  await page.getByRole("menuitem", { name: "Move" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Click the new place" })).toBeVisible()
  await page.getByRole("link", { name: "Home" }).focus()
  await page.keyboard.press("Enter")
  await expect(threadPopover(page)).toBeVisible()
  const link = await page.getByRole("link", { name: "Home" }).boundingBox()
  await expect
    .poll(async () =>
      Math.abs(((await pins(page).first().boundingBox())?.x ?? 0) - ((link?.x ?? 0) + (link?.width ?? 0) / 2)),
    )
    .toBeLessThan(2)
})

// Holds requests that match until the returned function is called. "answer": the server answers at once, the
// page gets the answer late. "request": the request reaches the server late.
async function hold(page: Page, pattern: string, late: "request" | "answer" = "request") {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(pattern, async (route) => {
    if (late === "request") {
      await held
      return route.continue()
    }
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  return release
}

test("a poll during a slow reply does not lose the reply", async ({ page }) => {
  const thread = await withComment(page, "slow-reply", "Slow")
  const release = await hold(page, "**/api/threads/*/comments")
  await typeComment(page, thread, "Slow reply")
  await page.keyboard.press("Enter")
  // A poll finishes while the reply is still on its way.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await page.waitForResponse("**/api/threads")
  release()
  await expect(thread.getByRole("article")).toHaveCount(2)
  await expect(thread.locator("[data-slot=composer] .ProseMirror")).not.toContainText("Slow reply")
  await expect(thread.getByRole("alert")).toHaveCount(0)
})

test("an old answer does not hide a newer reply", async ({ page, context }) => {
  await withComment(page, "old-answer", "First")
  const other = await context.browser()?.newPage()
  if (!other) throw new Error("no browser")
  await signIn(other, await guestSession("Second"))
  // Opening the thread marks it read. That answer comes late.
  const release = await hold(other, "**/api/threads/*/read", "answer")
  await other.goto(testPath("old-answer"))
  await pins(other).first().click()
  const thread = threadPopover(other)
  await typeComment(other, thread, "Newer reply")
  await other.keyboard.press("Enter")
  await expect(thread.getByRole("article")).toHaveCount(2)
  release()
  await other.waitForResponse("**/api/threads/*/read")
  await other.waitForTimeout(200)
  await expect(thread.getByRole("article")).toHaveCount(2)
  await other.close()
})

test("a late answer does not bring back a deleted thread", async ({ page }) => {
  const thread = await withComment(page, "late-delete", "Deleter")
  const release = await hold(page, "**/api/comments/*/reactions/*", "answer")
  const first = thread.getByRole("article").first()
  await first.hover()
  await first.getByRole("button", { name: "Add reaction" }).click()
  await page.getByRole("button", { name: "React with 👍" }).click()
  await thread.getByRole("button", { name: "Thread actions" }).click()
  await page.getByRole("menuitem", { name: "Delete thread" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect(pins(page)).toHaveCount(0)
  release()
  await page.waitForResponse("**/api/comments/*/reactions/*")
  await page.waitForTimeout(200)
  await expect(pins(page)).toHaveCount(0)
})

test("an old read answer does not undo Mark as unread", async ({ page, context }) => {
  await withComment(page, "read-order", "Writer")
  const other = await context.browser()?.newPage()
  if (!other) throw new Error("no browser")
  await signIn(other, await guestSession("Reader"))
  // The first read change (opening marks it read) is answered late.
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let first = true
  await other.route("**/api/threads/*/read", async (route) => {
    const response = await route.fetch()
    if (first) {
      first = false
      await held
    }
    await route.fulfill({ response })
  })
  await other.goto(testPath("read-order"))
  await pins(other).first().click()
  const thread = threadPopover(other)
  await thread.getByRole("button", { name: "Thread actions" }).click()
  await other.getByRole("menuitem", { name: "Mark as unread" }).click()
  await expect(pins(other).first()).toHaveAccessibleName(/unread/)
  release()
  await other.waitForTimeout(300)
  await expect(pins(other).first()).toHaveAccessibleName(/unread/)
  await other.close()
})

test("a poll does not undo Mark as unread that is on its way", async ({ page, context }) => {
  await withComment(page, "read-poll", "Writer")
  const other = await asOther(context, "read-poll", await guestSession("Reader"))
  await expect(pins(other).first()).not.toHaveAccessibleName(/unread/)
  // "Mark as unread" is held on its way to the server.
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await other.route("**/api/threads/*/read", async (route) => {
    await held
    await route.continue()
  })
  const thread = threadPopover(other)
  await thread.getByRole("button", { name: "Thread actions" }).click()
  await other.getByRole("menuitem", { name: "Mark as unread" }).click()
  await expect(pins(other).first()).toHaveAccessibleName(/unread/)
  // Another change makes the next poll return new data, still with the old read state.
  const first = threadPopover(page).getByRole("article").first()
  await first.hover()
  await first.getByRole("button", { name: "Add reaction" }).click()
  await page.getByRole("button", { name: "React with 🎉" }).click()
  await expect(first.getByRole("button", { name: /^🎉 1/ })).toBeVisible()
  const polled = other.waitForResponse((r) => r.url().endsWith("/api/threads") && r.status() === 200)
  await other.evaluate(() => window.dispatchEvent(new Event("focus")))
  await polled
  await other.waitForTimeout(200)
  await expect(pins(other).first()).toHaveAccessibleName(/unread/)
  release()
  await other.close()
})

test("an unsaved edit goes away when another user signs in", async ({ page }) => {
  const thread = await withComment(page, "edit-identify", "Editor")
  const first = thread.getByRole("article").first()
  await first.hover()
  await first.getByRole("button", { name: "Comment actions" }).click()
  await page.getByRole("menuitem", { name: "Edit" }).click()
  await first.locator(".ProseMirror").click()
  await page.keyboard.type(" unsaved change")
  const token = await sign(
    { sub: "e2e:edit-other", name: "Someone else", exp: Math.floor(Date.now() / 1000) + 120 },
    "e2e-app-secret",
    "HS256",
  )
  await page.evaluate(
    (t) => (window as unknown as { comma: { identify: (t: string) => void } }).comma.identify(t),
    token,
  )
  await expect(
    page.getByRole("toolbar", { name: "Comments" }).getByRole("button", { name: "Account: Someone else" }),
  ).toBeVisible()
  await expect(thread).not.toContainText("unsaved change")
})

test("copy link and mark as unread", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are a Chromium feature in Playwright")
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const thread = await withComment(page, "link", "Linker")
  await thread.getByRole("button", { name: "Thread actions" }).click()
  await page.getByRole("menuitem", { name: "Copy link" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(new RegExp(`${testPath("link")}#comma=[\\w-]+$`))

  await thread.getByRole("button", { name: "Thread actions" }).click()
  await page.getByRole("menuitem", { name: "Mark as unread" }).click()
  await expect(thread).toBeHidden()
  await expect(pins(page).first()).toHaveAccessibleName(/unread/)
  await expect(page.getByRole("button", { name: /^Comments, \d+ unread$/ })).toBeVisible()

  // The link opens the thread.
  const other = await context.newPage()
  await other.goto(link)
  await expect(threadPopover(other)).toContainText("First comment")
  await other.close()
})

test("the thread names its element, shows where it was made, and outlines the element", async ({ page }) => {
  const thread = await withComment(page, "context", "Viewer")
  await expect(thread).toContainText("Paragraph: A paragraph that people comment on in tests")
  const size = page.viewportSize()
  await expect(thread).toContainText(`${size?.width}×${size?.height}`)
  const outline = page.locator("[data-slot=anchor-outline]")
  await expect(outline).toBeVisible()
  const lead = await page.getByTestId("lead").boundingBox()
  const box = await outline.boundingBox()
  expect(Math.abs((box?.x ?? 0) - (lead?.x ?? 0))).toBeLessThan(2)
  expect(Math.abs((box?.width ?? 0) - (lead?.width ?? 0))).toBeLessThan(2)
  await page.keyboard.press("Escape")
  await expect(outline).toHaveCount(0)
})

test("assign a thread; the assignee finds it with Assigned to me", async ({ page, context }) => {
  const assignee = await appSession(`Bea ${test.info().testId}`)
  const thread = await withComment(page, "assign", "Assigner")
  await thread.getByRole("button", { name: "Assign" }).click()
  const picker = page.getByRole("dialog", { name: "Assign" })
  await picker.getByRole("searchbox", { name: "Search people" }).fill(assignee.user.name)
  await picker.getByRole("button", { name: assignee.user.name }).click()
  await expect(thread).toContainText(`Assigned to ${assignee.user.name}`)
  await expect(page.getByRole("status").filter({ hasText: `Assigned to ${assignee.user.name}` })).toBeVisible()

  const other = await context.browser()?.newPage()
  if (!other) throw new Error("no browser")
  await signIn(other, assignee)
  await other.goto(testPath("assign"))
  await other
    .getByRole("toolbar", { name: "Comments" })
    .getByRole("button", { name: /^Comments/ })
    .click()
  await panel(other).getByRole("button", { name: "Filter and sort" }).click()
  await other.getByRole("menuitemcheckbox", { name: "Assigned to me" }).click()
  await other.keyboard.press("Escape")
  const items = panel(other).locator("[data-slot=panel-item]")
  await expect(items).toHaveCount(1)
  await expect(items).toContainText("First comment")
  await expect(items).toContainText("Unread")
  await other.close()
})
