import { deflateSync } from "node:zlib"
import { expect, type Page, request, test } from "@playwright/test"
import { addComment, COMMA, guestSession, openTestPage, panel, SITE, signIn, testPath, threadPopover } from "./helpers"

type Session = Awaited<ReturnType<typeof guestSession>>

// A PNG of one color. The tests check the size the lightbox shows.
function png(width: number, height: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)])
  const data = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", data),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// Elements of the test page.
const ELEMENTS = {
  title: { selectors: { css: "body > main > section > h1" }, tag: "h1", text: "Test page title" },
  lead: {
    selectors: { css: "body > main > section > p" },
    tag: "p",
    text: "A paragraph that people comment on in tests.",
  },
  alpha: { selectors: { css: "#cards > div:nth-of-type(1) > p" }, tag: "p", text: "First card text." },
}

/** A thread made with the API: a screenshot of the given size, made at the given pixel ratio. */
async function apiThread(
  session: Session,
  path: string,
  text: string,
  shot: { width: number; height: number; dpr: number } = { width: 200, height: 80, dpr: 1 },
  on: keyof typeof ELEMENTS = "title",
) {
  const api = await request.newContext()
  const headers = { origin: SITE, authorization: `Bearer ${session.token}` }
  const file = await api.post(`${COMMA}/api/files`, {
    headers,
    multipart: { file: { name: "s.png", mimeType: "image/png", buffer: png(shot.width, shot.height) } },
  })
  expect(file.ok()).toBe(true)
  const res = await api.post(`${COMMA}/api/threads`, {
    headers,
    data: {
      page: path,
      anchor: {
        ...ELEMENTS[on],
        context: "",
        point: { x: 10, y: 50 },
        viewport: 1280,
      },
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      context: {
        url: `${SITE}${path}?tab=2`,
        title: "Test page",
        viewport: { width: 1440, height: 900 },
        dpr: shot.dpr,
        browser: "Firefox 140",
        os: "Linux",
        theme: "dark",
        language: "de-AT",
        timeZone: "Europe/Vienna",
        scroll: { x: 0, y: 320 },
      },
      screenshot: (await file.json()).id,
    },
  })
  expect(res.ok()).toBe(true)
  const json = await res.json()
  await api.dispose()
  return json.thread as { id: string }
}

const details = (page: Page) => page.getByRole("region", { name: "Details" })
const items = (page: Page) => panel(page).locator("[data-slot=panel-item]")
const openDetails = (page: Page) =>
  threadPopover(page)
    .getByRole("button", { name: /, details$/ })
    .click()

async function openPanel(page: Page) {
  await page
    .getByRole("toolbar", { name: "Comments" })
    .getByRole("button", { name: /^Comments/ })
    .click()
  await expect(panel(page)).toBeVisible()
}

test("the details show where the comment was made, and Back keeps the place in the list", async ({ page }) => {
  const me = await guestSession("Reviewer")
  const path = testPath("details")
  // Enough threads for the list to scroll.
  for (let i = 1; i <= 12; i++) await apiThread(me, path, `Comment ${i}`)
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  const list = panel(page).getByRole("list", { name: "Threads" })
  await expect(items(page)).toHaveCount(12)
  await items(page).filter({ hasText: "Comment 4" }).click()
  await expect(threadPopover(page)).toContainText("Comment 4")
  // Scroll the list so that the item is its last visible one: a place to keep that is not the top.
  const item = items(page).filter({ hasText: "Comment 4" })
  const scrollTop = await item.evaluate((el) => {
    const ul = el.closest("ul") as HTMLElement
    const li = el.parentElement as HTMLElement
    ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight
    return ul.scrollTop
  })
  expect(scrollTop).toBeGreaterThan(0)

  await openDetails(page)
  const layer = details(page)
  await expect(layer).toBeVisible()
  for (const text of [
    "Comment 4",
    "Heading",
    "body > main > section > h1",
    `${SITE}${path}?tab=2`,
    "320 px down",
    "Firefox 140",
    "Linux",
    "1440 × 900",
    "Dark",
    "de-AT",
    "Europe/Vienna",
  ]) {
    await expect(layer).toContainText(text)
  }
  await expect(layer.getByRole("img", { name: "Screenshot of the element" })).toBeVisible()
  // The thread stays open next to the details.
  await expect(threadPopover(page)).toContainText("Comment 4")

  // The back button is first in the header, before the title.
  const back = layer.getByRole("button", { name: "Back to comments" })
  const title = layer.getByRole("heading", { name: "Details" })
  expect((await back.boundingBox())?.x ?? 0).toBeLessThan((await title.boundingBox())?.x ?? 0)
  await back.click()
  await expect(details(page)).toBeHidden()
  await expect(list).toBeVisible()
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrollTop)
  await expect(items(page).filter({ hasText: "Comment 4" })).toBeFocused()

  // Escape also goes back. The panel and the thread stay open.
  await openDetails(page)
  await expect(details(page)).toBeVisible()
  await details(page).getByRole("button", { name: "Back to comments" }).focus()
  await page.keyboard.press("Escape")
  await expect(details(page)).toBeHidden()
  await expect(panel(page)).toBeVisible()
  await expect(threadPopover(page)).toContainText("Comment 4")
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrollTop)
})

test("the details follow the open thread, also with previous and next", async ({ page }) => {
  const me = await guestSession("Stepper")
  const path = testPath("details-step")
  await apiThread(me, path, "First", undefined, "title")
  await apiThread(me, path, "Second", undefined, "lead")
  await apiThread(me, path, "Third", undefined, "alpha")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  // Newest first: Third, Second, First.
  await items(page).filter({ hasText: "Second" }).click()
  await openDetails(page)
  const layer = details(page)
  await expect(layer).toContainText("2 of 3")
  await expect(layer).toContainText("Second")

  await layer.getByRole("button", { name: "Next comment" }).click()
  await expect(layer).toContainText("3 of 3")
  await expect(layer).toContainText("First")
  await expect(threadPopover(page)).toContainText("First")
  await expect(layer.getByRole("button", { name: "Next comment" })).toBeDisabled()

  // ↑ and ↓ in the details.
  await layer.getByRole("button", { name: "Previous comment" }).focus()
  await page.keyboard.press("ArrowUp")
  await expect(layer).toContainText("2 of 3")
  await page.keyboard.press("ArrowUp")
  await expect(layer).toContainText("1 of 3")
  await expect(threadPopover(page)).toContainText("Third")

  // A click on another pin shows its details.
  await page.getByRole("button", { name: /^Comment by Stepper.*: Second$/ }).click()
  await expect(threadPopover(page)).toContainText("Second")
  await expect(layer).toContainText("2 of 3")

  // When the thread closes, the details close too.
  await threadPopover(page).getByRole("button", { name: "Close" }).click()
  await expect(details(page)).toBeHidden()
  await expect(panel(page)).toBeVisible()
})

test("the lightbox shows the screenshot at the size it had on the page", async ({ page }) => {
  const me = await guestSession("Looker")
  const path = testPath("details-zoom")
  // Made on a screen with pixel ratio 2: 600 × 200 pixels were 300 × 100 on the page.
  await apiThread(me, path, "Small", { width: 600, height: 200, dpr: 2 })
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await items(page).filter({ hasText: "Small" }).click()
  await openDetails(page)
  await details(page).getByRole("button", { name: "Show the screenshot at full size" }).click()
  const box = page.getByRole("dialog", { name: "Screenshot" })
  const img = box.locator("img")
  await expect(img).toBeVisible()
  // After the open animation.
  await expect
    .poll(() => img.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]))
    .toEqual([300, 100])
  // A dark backdrop that blurs the page. Nothing in comma blends with what is under it: a blend makes all of comma
  // one closed group, and the backdrop then blurs only comma, not the page.
  const backdrop = page.locator("[data-slot=dialog-overlay]")
  expect(await backdrop.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(
    /\/ 0\.[5-9]|rgba\(0, 0, 0, 0\.[5-9]/,
  )
  const blends = await page
    .locator("comma-widget")
    .evaluate((host) =>
      [...(host.shadowRoot?.querySelectorAll("*") ?? [])].flatMap((el) =>
        [null, "::before", "::after"]
          .map((pseudo) => getComputedStyle(el, pseudo).mixBlendMode)
          .filter((mode) => mode !== "normal"),
      ),
    )
  expect(blends).toEqual([])
  // Escape closes only the lightbox.
  await page.keyboard.press("Escape")
  await expect(box).toBeHidden()
  await expect(details(page)).toBeVisible()
})

test("a screenshot larger than the window fits first; a click shows it at full size", async ({ page }) => {
  const me = await guestSession("Wide")
  const path = testPath("details-wide")
  await apiThread(me, path, "Wide", { width: 3000, height: 300, dpr: 1 })
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await items(page).filter({ hasText: "Wide" }).click()
  await openDetails(page)
  await details(page).getByRole("button", { name: "Show the screenshot at full size" }).click()
  const img = page.getByRole("dialog", { name: "Screenshot" }).locator("img")
  const width = () => img.evaluate((el) => el.getBoundingClientRect().width)
  await expect.poll(width).toBeLessThan(1280)
  await img.click()
  await expect.poll(width).toBe(3000)
  await img.click()
  await expect.poll(width).toBeLessThan(1280)
})

test("copy as bug report", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are a Chromium feature in Playwright")
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const me = await guestSession("Reporter")
  const path = testPath("details-copy")
  const thread = await apiThread(me, path, "Button is cut off")
  // A reply that changes the request: it is part of the report.
  const api = await request.newContext()
  const replier = await guestSession("Designer")
  await api.post(`${COMMA}/api/threads/${thread.id}/comments`, {
    headers: { origin: SITE, authorization: `Bearer ${replier.token}` },
    data: {
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Not the heading: the button." }] },
          { type: "paragraph", content: [{ type: "text", text: "Make it wider." }] },
        ],
      },
    },
  })
  for (const tag of ["Design", "Bug"]) {
    await api.put(`${COMMA}/api/threads/${thread.id}/tags/${tag}`, {
      headers: { origin: SITE, authorization: `Bearer ${me.token}` },
    })
  }
  await api.dispose()
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await items(page).first().click()
  await openDetails(page)
  await details(page).getByRole("button", { name: "Copy as bug report" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Bug report copied" })).toBeVisible()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain("Button is cut off")
  expect(text).toContain("- Tags: Bug, Design")
  expect(text).toContain("Firefox 140")
  expect(text).toContain("`body > main > section > h1`")
  expect(text).toMatch(/!\[Screenshot\]\(http:\/\/localhost:4800\/files\/[\w-]+\)/)
  expect(text).toContain(`${SITE}${path}#comma=`)
  expect(text).toMatch(/\*\*Replies\*\*\n- Designer \(guest\), .+: Not the heading: the button\.\n {2}Make it wider\./)
})

test("the info line of a new thread opens and closes the details", async ({ page }) => {
  await signIn(page, await guestSession("Fresh"))
  await openTestPage(page, "details-new")
  await addComment(page, page.getByTestId("lead"), "fresh")
  await openDetails(page)
  await expect(details(page)).toBeVisible()
  await expect(panel(page)).toBeVisible()
  // The same line closes them again.
  await openDetails(page)
  await expect(details(page)).toBeHidden()
})

test("with details: dialog, the details open over the page, with previous and next", async ({ page }) => {
  const me = await guestSession("Dialoger", SITE, "dialog")
  const path = testPath("details-dialog")
  await apiThread(me, path, "Older", undefined, "title")
  // Made at pixel ratio 2: 600 × 200 pixels were 300 × 100 on the page.
  await apiThread(me, path, "Newer", { width: 600, height: 200, dpr: 2 }, "lead")
  await signIn(page, me, SITE, "dialog")
  await page.goto(`${path}?project=dialog`)
  await openPanel(page)
  await items(page).filter({ hasText: "Newer" }).click()
  await openDetails(page)
  const dialog = page.getByRole("dialog", { name: "Details" })
  await expect(dialog).toBeVisible()
  await expect(details(page)).toBeHidden()
  await expect(dialog).toContainText("1 of 2")
  await expect(dialog).toContainText("Europe/Vienna")
  const img = dialog.getByRole("img", { name: "Screenshot of the element" })
  await expect
    .poll(() => img.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]))
    .toEqual([300, 100])

  await page.keyboard.press("ArrowDown")
  await expect(dialog).toContainText("2 of 2")
  await expect(dialog).toContainText("Older")
  await expect(threadPopover(page)).toContainText("Older")

  // Escape closes the dialog. The thread stays open.
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(threadPopover(page)).toContainText("Older")
})

test("the chevron of an item opens the thread with its details", async ({ page }) => {
  const me = await guestSession("Chevron")
  const path = testPath("details-chevron")
  await apiThread(me, path, "First", undefined, "title")
  await apiThread(me, path, "Second", undefined, "lead")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  // The chevron is as high as the item: an easy target.
  const chevron = panel(page).getByRole("button", { name: "Details: Second" })
  const item = await items(page).filter({ hasText: "Second" }).boundingBox()
  const box = await chevron.boundingBox()
  expect(Math.abs((box?.height ?? 0) - (item?.height ?? 0))).toBeLessThan(1)
  expect(Math.abs((box?.y ?? 0) - (item?.y ?? 0))).toBeLessThan(1)
  await chevron.click()
  await expect(threadPopover(page)).toContainText("Second")
  await expect(details(page)).toContainText("1 of 2")
  await expect(details(page)).toContainText("A paragraph that people comment on in tests.")
})

test("arrow keys: ↑ ↓ in the list, → opens the details, ← goes back", async ({ page }) => {
  const me = await guestSession("Arrows")
  const path = testPath("details-arrows")
  await apiThread(me, path, "First", undefined, "title")
  await apiThread(me, path, "Second", undefined, "lead")
  await apiThread(me, path, "Third", undefined, "alpha")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  // Newest first: Third, Second, First.
  await items(page).first().focus()
  // ↓ selects the next comment: it opens at its pin, and the focus stays in the list.
  await page.keyboard.press("ArrowDown")
  await expect(items(page).filter({ hasText: "Second" })).toBeFocused()
  await expect(threadPopover(page)).toContainText("Second")
  await expect(items(page).filter({ hasText: "Second" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(details(page)).toContainText("2 of 3")
  await expect(threadPopover(page)).toContainText("Second")
  await page.keyboard.press("ArrowDown")
  await expect(details(page)).toContainText("3 of 3")
  await page.keyboard.press("ArrowLeft")
  await expect(details(page)).toBeHidden()
  await expect(items(page).filter({ hasText: "First" })).toBeFocused()
  await expect(threadPopover(page)).toContainText("First")

  // ↑ selects Second. ← goes into its thread on the page: the reply box gets the focus.
  await page.keyboard.press("ArrowUp")
  await expect(items(page).filter({ hasText: "Second" })).toBeFocused()
  await expect(threadPopover(page)).toContainText("Second")
  await page.keyboard.press("ArrowLeft")
  // The empty reply box has the focus. → goes back to the panel, to the same item. The thread stays open.
  await expect(threadPopover(page).locator(".ProseMirror")).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(items(page).filter({ hasText: "Second" })).toBeFocused()
  await expect(threadPopover(page)).toContainText("Second")
  // In the reply box, → moves the cursor and the focus stays there.
  await page.keyboard.press("ArrowLeft")
  await threadPopover(page).locator(".ProseMirror").click()
  await page.keyboard.type("ab")
  await page.keyboard.press("ArrowRight")
  await expect(threadPopover(page).locator(".ProseMirror")).toBeFocused()
})

test("with details: dialog, the item has an expand icon, and the keys work the same way", async ({ page }) => {
  const me = await guestSession("Keys", SITE, "dialog")
  const path = testPath("details-dialog-keys")
  await apiThread(me, path, "First", undefined, "title")
  await apiThread(me, path, "Second", undefined, "lead")
  await signIn(page, me, SITE, "dialog")
  await page.goto(`${path}?project=dialog`)
  await openPanel(page)
  // The same icon in both layouts: it says "details", the key says where.
  const open = panel(page).getByRole("button", { name: "Details: Second" })
  await expect(open).toHaveAttribute("data-icon", "info")

  // → opens the dialog, ↓ goes on, ← closes it. The focus goes to the item of the open thread.
  await items(page).first().focus()
  await page.keyboard.press("ArrowRight")
  const dialog = page.getByRole("dialog", { name: "Details" })
  await expect(dialog).toContainText("1 of 2")
  // The dialog takes the focus when it opens.
  await expect
    .poll(() => dialog.evaluate((el) => el.contains((el.getRootNode() as ShadowRoot).activeElement)))
    .toBe(true)
  await page.keyboard.press("ArrowDown")
  await expect(dialog).toContainText("2 of 2")
  await page.keyboard.press("ArrowLeft")
  await expect(dialog).toBeHidden()
  await expect(items(page).filter({ hasText: "First" })).toBeFocused()
  await expect(threadPopover(page)).toContainText("First")

  // Escape closes it the same way.
  await page.keyboard.press("ArrowRight")
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(items(page).filter({ hasText: "First" })).toBeFocused()
})

test("the view menu switches where the details open, and the choice stays", async ({ page }) => {
  const me = await guestSession("Viewer")
  const path = testPath("details-view")
  await apiThread(me, path, "Only", undefined, "title")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await panel(page).getByRole("button", { name: "View options" }).click()
  await page.getByRole("menuitemradio", { name: "Dialog" }).click()
  await page.keyboard.press("Escape")
  await expect(panel(page).getByRole("button", { name: "Details: Only" })).toHaveAttribute("title", "Details (→)")
  await page.reload()
  // The panel stays open for the tab.
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole("button", { name: "Details: Only" }).click()
  await expect(page.getByRole("dialog", { name: "Details" })).toBeVisible()
  await expect(details(page)).toBeHidden()
})

test("with the panel on the left, the arrows turn: → goes to the page, ← to the details", async ({ page }) => {
  const me = await guestSession("Lefty")
  const path = testPath("details-left")
  await apiThread(me, path, "First", undefined, "title")
  await apiThread(me, path, "Second", undefined, "lead")
  await signIn(page, me)
  await page.addInitScript(() => localStorage.setItem("comma:panel-side", "left"))
  await page.goto(path)
  await openPanel(page)
  await expect.poll(async () => (await panel(page).boundingBox())?.x).toBe(8)
  await expect(panel(page).getByRole("button", { name: "Details: Second" })).toHaveAttribute("title", "Details (←)")
  // Newest first: Second, First.
  await items(page).first().focus()
  await page.keyboard.press("ArrowDown")
  await expect(threadPopover(page)).toContainText("First")
  // ← (away from the page) opens the details, → (toward the page) closes them.
  await page.keyboard.press("ArrowLeft")
  await expect(details(page)).toContainText("2 of 2")
  await page.keyboard.press("ArrowRight")
  await expect(details(page)).toBeHidden()
  await expect(items(page).filter({ hasText: "First" })).toBeFocused()
  // → goes into the thread on the page, ← back to the list.
  await page.keyboard.press("ArrowRight")
  await expect(threadPopover(page).locator(".ProseMirror")).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(items(page).filter({ hasText: "First" })).toBeFocused()
  await expect(threadPopover(page)).toContainText("First")
})

test("Enter goes into a thread from the list, Esc comes back and the thread stays open", async ({ page }) => {
  const me = await guestSession("Escaper")
  const path = testPath("details-esc")
  await apiThread(me, path, "Only", undefined, "title")
  await signIn(page, me)
  await page.goto(path)
  await openPanel(page)
  await items(page).first().focus()
  await page.keyboard.press("Enter")
  await expect(threadPopover(page).locator(".ProseMirror")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(items(page).first()).toBeFocused()
  await expect(threadPopover(page)).toContainText("Only")
  // A thread opened from its pin closes with Escape, as before.
  await threadPopover(page).getByRole("button", { name: "Close" }).click()
  await expect(threadPopover(page)).toBeHidden()
  await page.getByRole("button", { name: /^Comment by Escaper/ }).click()
  await expect(threadPopover(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(threadPopover(page)).toBeHidden()
})
