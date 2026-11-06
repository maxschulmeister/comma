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
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("- one")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("two")
  await page.keyboard.press("Enter")
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
  await page.keyboard.press("Enter")
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
  await page.keyboard.press("Enter")
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
  await page.keyboard.press("Enter")
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
  await page.keyboard.press("Enter")
  const shown = threadPopover(page).getByRole("link", { name: "Open image" }).locator("img")
  await expect(shown).toHaveCount(count)
  await expect.poll(() => shown.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2)
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
  await page.keyboard.press("Enter")
  const shown = threadPopover(page).getByRole("link", { name: "Open image" }).locator("img")
  await expect
    .poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([2560, 1920])
})

test("Enter sends, Shift+Enter adds a line", async ({ page }) => {
  const popover = await startComment(page, "enter")
  await typeComment(page, popover, "line one")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("line two")
  await expect(threadPopover(page)).toBeHidden()
  await page.keyboard.press("Enter")
  await expect(threadPopover(page).locator("article .comma-prose p")).toHaveText(["line one", "line two"])
})

test("the draft stays when the popover closes, also after a sent reply", async ({ page }) => {
  const popover = await startComment(page, "draft")
  await typeComment(page, popover, "first")
  await page.keyboard.press("Enter")
  await typeComment(page, threadPopover(page), "sent reply")
  await page.keyboard.press("Enter")
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
