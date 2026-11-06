import { expect, type Locator, type Page, request, test } from "@playwright/test"
import { sign } from "hono/jwt"

export const COMMA = "http://localhost:4800"
export const SITE = "http://localhost:4900"

type Session = { token: string; user: { id: string; name: string } }

/** A guest session made with the API. */
export async function guestSession(name: string, origin = SITE): Promise<Session> {
  const api = await request.newContext()
  const res = await api.post(`${COMMA}/api/session/guest`, { headers: { origin }, data: { project: "example", name } })
  expect(res.ok()).toBe(true)
  const session = await res.json()
  await api.dispose()
  return session
}

/** An app user session (the app signs a token, comma trusts it). */
export async function appSession(name: string, admin = false): Promise<Session> {
  const appToken = await sign(
    { sub: `e2e:${name}`, name, admin, exp: Math.floor(Date.now() / 1000) + 120 },
    "e2e-app-secret",
    "HS256",
  )
  const api = await request.newContext()
  const res = await api.post(`${COMMA}/api/session/app`, {
    headers: { origin: SITE },
    data: { project: "example", appToken },
  })
  expect(res.ok()).toBe(true)
  const session = await res.json()
  await api.dispose()
  return session
}

/** Signs the page in before its scripts run. */
export async function signIn(page: Page, session: Session, origin = SITE) {
  await page.addInitScript(
    ([key, value]) => {
      if (location.origin === key[1]) localStorage.setItem(key[0], value)
    },
    [[`comma:${COMMA}:example`, origin], JSON.stringify(session)] as const,
  )
}

// A page of its own for each test, browser and run: threads on other pages do not show.
const RUN = Date.now().toString(36)
export const testPath = (name: string) => `/t/${name}-${test.info().project.name}-${test.info().repeatEachIndex}-${RUN}`

export async function openTestPage(page: Page, name: string) {
  await page.goto(testPath(name))
  await expect(toolbar(page)).toBeVisible()
}

export const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Comments" })
export const panel = (page: Page) => page.getByRole("complementary", { name: "Comments" })
export const threadPopover = (page: Page) => page.getByRole("dialog", { name: "Comment thread" })
export const newCommentPopover = (page: Page) => page.getByRole("dialog", { name: "New comment" })
export const pins = (page: Page) => page.locator("[data-slot=pin]")

export const overlay = (page: Page) => page.locator("[data-slot=comment-overlay]")

/** Clicks the page in comment mode, at a % of the element box. */
export async function clickAt(page: Page, target: Locator, x = 0.2, y = 0.5) {
  await expect(overlay(page)).toBeAttached()
  const box = await target.boundingBox()
  if (!box) throw new Error("No box")
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
}

/** Types into the focused editor. Waits until the editor has loaded. */
export async function typeComment(page: Page, scope: Locator, text: string) {
  const editor = scope.locator(".ProseMirror")
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type(text)
}

/** Comment mode, click on the target, type and send. */
export async function addComment(page: Page, target: Locator, text: string, x = 0.2, y = 0.5) {
  if ((await toolbar(page).getByRole("button", { name: "Comment mode" }).getAttribute("aria-pressed")) !== "true") {
    await page.keyboard.press("c")
  }
  await clickAt(page, target, x, y)
  const popover = newCommentPopover(page)
  await typeComment(page, popover, text)
  await page.keyboard.press("Enter")
  await expect(threadPopover(page)).toContainText(text.replace(/[*~`]/g, ""))
}

export const mod = (browserName: string) =>
  browserName === "webkit" || process.platform === "darwin" ? "Meta" : "Control"

/** Escape closes the open popover, a second Escape ends comment mode. Waits for each. */
export async function closeThread(page: Page) {
  await page.keyboard.press("Escape")
  await expect(threadPopover(page)).toBeHidden()
}

export async function endCommentMode(page: Page) {
  await closeThread(page)
  await page.keyboard.press("Escape")
  await expect(toolbar(page).getByRole("button", { name: "Comment mode" })).toHaveAttribute("aria-pressed", "false")
}
