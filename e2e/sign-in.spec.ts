import { expect, test } from "@playwright/test"
import { sign } from "hono/jwt"
import { panel, testPath, toolbar } from "./helpers"

test("on another site, people sign in with the app in a popup", async ({ page }) => {
  // 127.0.0.1 is another site than the app (localhost).
  await page.goto(`http://127.0.0.1:4900${testPath("popup")}`)
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .click()
  const popupPromise = page.waitForEvent("popup")
  await panel(page).getByRole("button", { name: "Sign in", exact: true }).click()
  const popup = await popupPromise
  await expect(popup.getByRole("heading", { name: "Sign in to Example" })).toBeVisible()
  await popup.getByLabel("Name").fill("Grace")
  await popup.getByRole("button", { name: "Sign in" }).click()
  await expect(toolbar(page).getByRole("button", { name: "Account: Grace" })).toBeVisible()
  await expect.poll(() => popup.isClosed()).toBe(true)
  await expect(panel(page)).toContainText("No comments")

  // The session stays after a reload.
  await page.reload()
  await expect(toolbar(page).getByRole("button", { name: "Account: Grace" })).toBeVisible()

  // Sign out.
  await toolbar(page).getByRole("button", { name: "Account: Grace" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(toolbar(page).getByRole("button", { name: "Account", exact: true })).toBeVisible()
})

test("in the app, comma.identify signs people in without a sign-in screen", async ({ page }) => {
  await page.goto("/login?next=/app")
  await page.getByLabel("Name").fill("Linus")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  await expect(toolbar(page).getByRole("button", { name: "Account: Linus" })).toBeVisible()
})

test("identify works when the page calls a stub that it read before the widget loaded", async ({ page }) => {
  // Signed in to the app (cookie). The test page itself does not call identify.
  await page.goto("/login?next=/")
  await page.getByLabel("Name").fill("Stubby")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Ship websites your team agrees on" })).toBeVisible()

  // Hold the widget back, so the page reads the stub from c.js first.
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/w/main.js", async (route) => {
    await held
    await route.continue()
  })
  await page.goto(testPath("stub"), { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => "comma" in window)
  await page.evaluate(async () => {
    const w = window as unknown as { comma: { identify: (t: string) => void }; callStub: () => void }
    const stub = w.comma.identify
    const token = (await (await fetch("/comma-token")).json()).token
    w.callStub = () => stub(token)
  })
  release()
  await expect(toolbar(page)).toBeVisible()
  await page.evaluate(() => (window as unknown as { callStub: () => void }).callStub())
  await expect(toolbar(page).getByRole("button", { name: "Account: Stubby" })).toBeVisible()
})

test("signOut cancels a sign-in that is still on its way", async ({ page }) => {
  await page.goto(testPath("cancel-sign-in"))
  await expect(toolbar(page)).toBeVisible()
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/session/app", async (route) => {
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  const token = await sign(
    { sub: "e2e:cancelled", name: "Cancelled", exp: Math.floor(Date.now() / 1000) + 120 },
    "e2e-app-secret",
    "HS256",
  )
  await page.evaluate((t) => {
    const comma = (window as unknown as { comma: { identify: (t: string) => Promise<void>; signOut: () => void } })
      .comma
    void comma.identify(t)
    comma.signOut()
  }, token)
  release()
  await page.waitForResponse("**/api/session/app")
  await page.waitForTimeout(200)
  await expect(toolbar(page).getByRole("button", { name: "Account", exact: true })).toBeVisible()
})

test("a guest signs in with a name", async ({ page }) => {
  await page.goto(testPath("guest-sign-in"))
  await toolbar(page).getByRole("button", { name: "Account", exact: true }).click()
  await page.getByRole("menuitem", { name: "Sign in" }).click()
  const form = page.getByRole("dialog").filter({ hasText: "Your name" })
  await form.getByLabel("Your name").fill("Gus")
  await form.getByRole("button", { name: "Continue as guest" }).click()
  await expect(toolbar(page).getByRole("button", { name: "Account: Gus" })).toBeVisible()
})
