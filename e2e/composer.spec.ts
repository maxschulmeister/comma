import { expect, test } from "@playwright/test"
import { sign } from "hono/jwt"
import {
  appSession,
  clickAt,
  endCommentMode,
  guestSession,
  mod,
  newCommentPopover,
  openTestPage,
  pins,
  signIn,
  threadPopover,
  toolbar,
  typeComment,
} from "./helpers"

// A 2×3 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DwnwEIGHEIAD0KBf+0cY5MAAAAAElFTkSuQmCC",
  "base64",
)

test.beforeEach(async ({ page }, info) => {
  await signIn(page, await guestSession(`Writer ${info.project.name}`))
})

async function startComment(page: import("@playwright/test").Page, name: string) {
  await openTestPage(page, name)
  await page.keyboard.press("c")
  await clickAt(page, page.getByTestId("lead"))
  return newCommentPopover(page)
}

test("keys typed in comma do not reach the site's own shortcuts", async ({ page }) => {
  // A common site shortcut: it ignores keys typed in the site's text fields, but sees <comma-widget> as no field.
  await page.addInitScript(() => {
    const keys: string[] = []
    Object.assign(window, { siteKeys: keys })
    document.addEventListener("keydown", (e) => {
      const el = e.target as HTMLElement
      if (!el.isContentEditable && !["INPUT", "TEXTAREA"].includes(el.tagName)) keys.push(e.key)
    })
  })
  const popover = await startComment(page, "site-keys")
  // The site sees C (comment mode): the focus was on the page.
  await page.evaluate(() => (window as unknown as { siteKeys: string[] }).siteKeys.splice(0))
  await typeComment(page, popover, "jk/?")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("Backspace")
  expect(await page.evaluate(() => (window as unknown as { siteKeys: string[] }).siteKeys)).toEqual([])
  // Esc still closes the composer (it keeps the draft).
  await page.keyboard.press("Escape")
  await expect(popover).toBeHidden()
})

test("formatting with Markdown and shortcuts", async ({ page, browserName }) => {
  const popover = await startComment(page, "format")
  await typeComment(page, popover, "**bold** *it* ~gone~ `code` ")
  const m = mod(browserName)
  await page.keyboard.press(`${m}+b`)
  await page.keyboard.type("strong")
  await page.keyboard.press(`${m}+b`)
  await page.keyboard.press(`${m}+Shift+x`)
  await page.keyboard.type("struck")
  await page.keyboard.press(`${m}+Shift+x`)
  await page.keyboard.press("Enter")
  await page.keyboard.type("- one")
  await page.keyboard.press("Enter")
  await page.keyboard.type("two")
  await page.keyboard.press("ControlOrMeta+Enter")
  const thread = threadPopover(page)
  await expect(thread.locator("strong", { hasText: "bold" })).toBeVisible()
  await expect(thread.locator("strong", { hasText: "strong" })).toBeVisible()
  await expect(thread.locator("em", { hasText: "it" })).toBeVisible()
  await expect(thread.locator("s", { hasText: "gone" })).toBeVisible()
  await expect(thread.locator("s", { hasText: "struck" })).toBeVisible()
  await expect(thread.locator("code", { hasText: "code" })).toBeVisible()
  await expect(thread.locator("ul > li")).toHaveText(["one", "two"])
})

test("a link with ⌘K", async ({ page, browserName }) => {
  const popover = await startComment(page, "link")
  await typeComment(page, popover, "see ")
  await page.keyboard.press(`${mod(browserName)}+k`)
  await popover.getByLabel("Link address").fill("example.com/docs")
  await page.keyboard.press("Enter")
  await expect(popover.locator(".ProseMirror a")).toHaveText("example.com/docs")
  await page.keyboard.press("ControlOrMeta+Enter")
  const link = threadPopover(page).getByRole("link", { name: "example.com/docs" })
  await expect(link).toHaveAttribute("href", "https://example.com/docs")
  await expect(link).toHaveAttribute("rel", "noopener noreferrer")
})

test("mention people known to the project", async ({ page }) => {
  await appSession("Grace Hopper")
  const popover = await startComment(page, "mention")
  await typeComment(page, popover, "ask @hopp")
  const option = popover.getByRole("option", { name: "Grace Hopper" })
  await expect(option).toBeVisible()
  // Screen readers hear the active option while the focus stays in the text.
  const id = await option.getAttribute("id")
  await expect(popover.locator(".ProseMirror")).toHaveAttribute("aria-activedescendant", id ?? "")
  await page.keyboard.press("Enter")
  await page.keyboard.type("please")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(threadPopover(page).locator(".comma-mention")).toHaveText("@Grace Hopper")
})

test("emoji with :name: and with the picker", async ({ page }) => {
  const popover = await startComment(page, "emoji")
  await typeComment(page, popover, "party :tada")
  await expect(popover.getByRole("option").first()).toContainText(":tada:")
  await page.keyboard.press("Enter")
  await popover.getByRole("button", { name: "Add emoji" }).click()
  await page.getByRole("searchbox", { name: "Search emoji" }).fill("thumbs up")
  // Wait for the search result: before it, the first emoji is 😀.
  const first = page.locator("[data-slot=emoji-picker-emoji]:visible").first()
  await expect(first).toContainText("👍")
  await first.click()
  await expect(popover.locator(".ProseMirror")).toContainText("👍")
  await expect(popover.locator(".ProseMirror")).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(threadPopover(page)).toContainText("party 🎉")
  await expect(threadPopover(page)).toContainText("👍")
})

// Sends a paste or drop event with an image file to the composer text.
async function sendFile(page: import("@playwright/test").Page, kind: "paste" | "drop") {
  await page.evaluate(
    ([base64, kind]) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], "b.png", { type: "image/png" }))
      const editor = document
        .querySelector("comma-widget")
        ?.shadowRoot?.querySelector("[data-slot=composer] .ProseMirror") as HTMLElement
      const r = editor.getBoundingClientRect()
      const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 4, clientY: r.top + 4 }
      editor.dispatchEvent(
        kind === "paste"
          ? new ClipboardEvent("paste", { ...init, clipboardData: data })
          : new DragEvent("drop", { ...init, dataTransfer: data }),
      )
    },
    [PNG.toString("base64"), kind] as const,
  )
}

test("images by button, paste and drop", async ({ page, browserName }) => {
  const popover = await startComment(page, "images")
  await typeComment(page, popover, "pictures")
  await popover.locator("input[type=file]").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG })
  await sendFile(page, "drop")
  // Firefox does not put files in a synthetic paste event.
  if (browserName !== "firefox") await sendFile(page, "paste")
  const count = browserName === "firefox" ? 2 : 3
  const images = popover.getByRole("list", { name: "Images" }).locator("li[data-state=done]")
  await expect(images).toHaveCount(count)
  await page.keyboard.press("ControlOrMeta+Enter")
  const shown = threadPopover(page).getByRole("link", { name: "Open image" }).locator("img")
  await expect(shown).toHaveCount(count)
  await expect.poll(() => shown.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2)
})

test("a screenshot of the visible page is added as an image", async ({ page }) => {
  const popover = await startComment(page, "screenshot")
  await typeComment(page, popover, "look")
  await popover.getByRole("button", { name: "Add screenshot" }).click()
  await expect(popover.getByRole("list", { name: "Images" }).locator("li[data-state=done]")).toHaveCount(1)
  await page.keyboard.press("ControlOrMeta+Enter")
  const shown = threadPopover(page).getByRole("link", { name: "Open image" }).locator("img")
  await expect(shown).toHaveCount(1)
  // The height of the viewport (720), at the device pixel ratio (WebKit on a Mac: 2).
  const scale = Math.min(await page.evaluate(() => window.devicePixelRatio), 2)
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(720 * scale)
})

test("a slow screenshot upload does not hold the comment back", async ({ page }) => {
  // The upload never answers.
  await page.route("**/api/files", () => {})
  const popover = await startComment(page, "slow-screenshot")
  await typeComment(page, popover, "sent anyway")
  await page.keyboard.press("ControlOrMeta+Enter")
  // After the screenshot's time limit (5 s), the comment goes without it.
  const thread = threadPopover(page)
  await expect(thread).toContainText("sent anyway", { timeout: 8000 })
  await expect(thread.getByRole("button", { name: /, details$/ }).locator("img")).toHaveCount(0)
})

test("a new thread keeps a screenshot of its element, apart from the images", async ({ page }) => {
  const popover = await startComment(page, "element-screenshot")
  const box = await page.getByTestId("lead").boundingBox()
  if (!box) throw new Error("No box")
  await typeComment(page, popover, "this text")
  await page.keyboard.press("ControlOrMeta+Enter")
  const thread = threadPopover(page)
  const shot = thread.getByRole("button", { name: /, details$/ }).locator("img")
  await expect(shot).toHaveCount(1)
  await expect(thread.getByRole("link", { name: /^Open image/ })).toHaveCount(0)
  // A small thumbnail on the line with the window size and browser: it takes no room from the comments.
  const thumb = await shot.boundingBox()
  expect(thumb?.height).toBeLessThanOrEqual(24)
  const line = await thread.getByText(/^\d+×\d+ · /).boundingBox()
  expect(
    Math.abs((thumb?.y ?? 0) + (thumb?.height ?? 0) / 2 - ((line?.y ?? 0) + (line?.height ?? 0) / 2)),
  ).toBeLessThan(4)
  // The element and a little space around it, at the device pixel ratio.
  const scale = Math.min(await page.evaluate(() => window.devicePixelRatio), 2)
  await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  const [width, height] = await shot.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])
  expect(width).toBeGreaterThanOrEqual(box.width * scale)
  expect(width).toBeLessThanOrEqual((box.width + 40) * scale)
  expect(height).toBeGreaterThanOrEqual(box.height * scale)
  expect(height).toBeLessThanOrEqual((box.height + 40) * scale)
})

test("the screenshot shows the part of the page that is on screen, without the panel", async ({ page }) => {
  await openTestPage(page, "screenshot-scroll")
  // A red block above the page, then scroll so that its end is on screen.
  await page.evaluate(() => {
    const block = document.createElement("div")
    block.style.cssText = "height:1000px;background:rgb(255,0,0)"
    document.body.prepend(block)
    window.scrollTo(0, 800)
  })
  // Comment mode opens the panel too.
  await page.keyboard.press("c")
  await clickAt(page, page.getByTestId("lead"))
  const popover = newCommentPopover(page)
  await popover.getByRole("button", { name: "Add screenshot" }).click()
  const preview = popover.getByRole("list", { name: "Images" }).locator("img")
  await preview.waitFor()
  // Read the view after the click: Playwright scrolls the button into view before it clicks.
  const view = await page.evaluate(() => ({
    scroll: window.scrollY,
    width:
      document.documentElement.clientWidth - Number.parseFloat(getComputedStyle(document.documentElement).marginRight),
    scale: Math.min(window.devicePixelRatio, 2),
  }))
  expect(view.scroll).toBeGreaterThan(10)
  expect(view.scroll).toBeLessThan(990)
  // Colors 10 px above and below the end of the red block, and the width.
  const seen = await preview.evaluate(async (img: HTMLImageElement, { scroll, scale }) => {
    const bitmap = await createImageBitmap(await (await fetch(img.src)).blob())
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bitmap, 0, 0)
    const at = (y: number) => [...ctx.getImageData(5 * scale, (1000 - scroll + y) * scale, 1, 1).data.slice(0, 3)]
    return { above: at(-10), below: at(10), width: bitmap.width }
  }, view)
  expect(seen.above).toEqual([255, 0, 0])
  expect(seen.below).not.toEqual([255, 0, 0])
  expect(seen.width).toBe(view.width * view.scale)
})

test("a large image is made smaller before the upload", async ({ page }) => {
  const popover = await startComment(page, "large-image")
  await typeComment(page, popover, "large")
  // A 4000×3000 PNG with noise, so it is larger than 4 MB. Dropped on the composer text.
  const size = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4000, 3000)
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D
    const data = ctx.createImageData(4000, 3000)
    for (let i = 0; i < data.data.length; i += 65_536) crypto.getRandomValues(data.data.subarray(i, i + 65_536))
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255
    ctx.putImageData(data, 0, 0)
    const blob = await canvas.convertToBlob({ type: "image/png" })
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], "large.png", { type: "image/png" }))
    const editor = document
      .querySelector("comma-widget")
      ?.shadowRoot?.querySelector("[data-slot=composer] .ProseMirror") as HTMLElement
    const r = editor.getBoundingClientRect()
    editor.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: r.left + 4,
        clientY: r.top + 4,
        dataTransfer: transfer,
      }),
    )
    return blob.size
  })
  expect(size).toBeGreaterThan(4 * 1024 * 1024)
  await expect(popover.getByRole("list", { name: "Images" }).locator("li[data-state=done]")).toHaveCount(1)
  await page.keyboard.press("ControlOrMeta+Enter")
  const shown = threadPopover(page).getByRole("link", { name: "Open image" }).locator("img")
  await expect
    .poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([2560, 1920])
})

test("Enter adds a paragraph, Shift+Enter a line break, ⌘Enter sends", async ({ page }) => {
  const popover = await startComment(page, "enter")
  await typeComment(page, popover, "one")
  await page.keyboard.press("Enter")
  await page.keyboard.type("two")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("three")
  await expect(threadPopover(page)).toBeHidden()
  await page.keyboard.press("ControlOrMeta+Enter")
  const paragraphs = threadPopover(page).locator("article .comma-prose p")
  await expect(paragraphs).toHaveText(["one", "twothree"])
  await expect(paragraphs.nth(1).locator("br")).toHaveCount(1)
})

test("the draft stays when the popover closes, also after a sent reply", async ({ page }) => {
  const popover = await startComment(page, "draft")
  await typeComment(page, popover, "first")
  await page.keyboard.press("ControlOrMeta+Enter")
  await typeComment(page, threadPopover(page), "sent reply")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(threadPopover(page).getByRole("article")).toHaveCount(2)
  await typeComment(page, threadPopover(page), "unsent reply")
  await endCommentMode(page)
  await pins(page).first().click()
  await expect(threadPopover(page).locator("[data-slot=composer] .ProseMirror")).toHaveText("unsent reply")
})

test("an open draft is not shown to another user who signs in with identify", async ({ page }) => {
  const popover = await startComment(page, "draft-identify")
  await typeComment(page, popover, "draft of the first user")
  const token = await sign(
    { sub: "e2e:other-user", name: "Other user", exp: Math.floor(Date.now() / 1000) + 120 },
    "e2e-app-secret",
    "HS256",
  )
  await page.evaluate(
    (t) => (window as unknown as { comma: { identify: (t: string) => void } }).comma.identify(t),
    token,
  )
  await expect(toolbar(page).getByRole("button", { name: "Account: Other user" })).toBeVisible()
  await expect(popover.locator(".ProseMirror")).not.toContainText("draft of the first user")
})

test("a draft is not shown to the next person who signs in", async ({ page }) => {
  const popover = await startComment(page, "draft-private")
  await typeComment(page, popover, "my secret draft")
  await page.keyboard.press("Escape")
  await expect(popover).toBeHidden()
  await page.keyboard.press("Escape")
  await toolbar(page)
    .getByRole("button", { name: /^Account/ })
    .click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await toolbar(page).getByRole("button", { name: "Account", exact: true }).click()
  await page.getByRole("menuitem", { name: "Sign in" }).click()
  const form = page.getByRole("dialog").filter({ hasText: "Your name" })
  await form.getByLabel("Your name").fill("Next person")
  await form.getByRole("button", { name: "Continue as guest" }).click()
  await page.keyboard.press("c")
  await clickAt(page, page.getByTestId("lead"))
  const editor = newCommentPopover(page).locator(".ProseMirror")
  await expect(editor).toBeVisible()
  await expect(editor).not.toContainText("my secret draft")
})

test("a draft keeps its place: a click elsewhere asks before it moves", async ({ page }) => {
  const popover = await startComment(page, "draft-place")
  await typeComment(page, popover, "About the lead")
  await page.keyboard.press("Escape")
  await expect(popover).toBeHidden()
  const draftPin = page.getByRole("button", { name: "Unsent comment" })
  await expect(draftPin).toBeVisible()

  await clickAt(page, page.getByTestId("title"))
  const prompt = page.getByRole("dialog", { name: "Unsent comment" })
  await expect(prompt).toContainText("Move your unsent comment here?")
  await prompt.getByRole("button", { name: "Move here" }).click()
  await expect(newCommentPopover(page).locator(".ProseMirror")).toHaveText("About the lead")
  const title = await page.getByTestId("title").boundingBox()
  const pin = await draftPin.boundingBox()
  expect(Math.abs((pin?.y ?? 0) + (pin?.height ?? 0) - ((title?.y ?? 0) + (title?.height ?? 0) / 2))).toBeLessThan(4)

  await page.keyboard.press("Escape")
  await clickAt(page, page.getByTestId("lead"))
  await page
    .getByRole("dialog", { name: "Unsent comment" })
    .getByRole("button", { name: "Discard and start new" })
    .click()
  await expect(newCommentPopover(page).locator(".ProseMirror")).toHaveText("")
})

test("a draft stays after a reload, and Discard removes it", async ({ page }) => {
  const popover = await startComment(page, "draft-reload")
  await typeComment(page, popover, "Half a thought")
  await page.reload()
  await page.getByRole("button", { name: "Unsent comment" }).click()
  await expect(newCommentPopover(page).locator(".ProseMirror")).toHaveText("Half a thought")
  await newCommentPopover(page).getByRole("button", { name: "Discard" }).click()
  await expect(newCommentPopover(page)).toBeHidden()
  await expect(page.getByRole("button", { name: "Unsent comment" })).toHaveCount(0)
  await page.reload()
  await expect(toolbar(page)).toBeVisible()
  await expect(page.getByRole("button", { name: "Unsent comment" })).toHaveCount(0)
})

test("a comment that cannot reach comma says so and stays in the composer", async ({ page }) => {
  const popover = await startComment(page, "offline-send")
  await typeComment(page, popover, "keep me")
  await page.route(`**/api/threads`, (route) =>
    route.request().method() === "POST" ? route.abort("connectionrefused") : route.continue(),
  )
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(popover).toContainText("Cannot reach comma. Try again.")
  await expect(popover.locator(".ProseMirror")).toHaveText("keep me")
})

test("a new thread keeps the theme, language, time zone and scroll position", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  const popover = await startComment(page, "context-more")
  const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/threads"))
  await typeComment(page, popover, "dark mode")
  await page.keyboard.press("ControlOrMeta+Enter")
  const expected = await page.evaluate(() => ({
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }))
  const context = (await sent).postDataJSON().context
  expect(context).toMatchObject({ theme: "dark", ...expected, scroll: { x: 0, y: expect.any(Number) } })
})
