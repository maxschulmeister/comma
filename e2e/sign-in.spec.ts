import { expect, test } from "@playwright/test"
import { panel, testPath, toolbar } from "./helpers"

test("on another site, people sign in with the app in a popup", async ({ page }) => {
  // 127.0.0.1 is another site than the app (localhost).
  await page.goto(`http://127.0.0.1:4900${testPath("popup")}`)
  await toolbar(page).getByRole("button", { name: /^Comments/ }).click()
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

test("a guest signs in with a name", async ({ page }) => {
  await page.goto(testPath("guest-sign-in"))
  await toolbar(page).getByRole("button", { name: "Account", exact: true }).click()
  await page.getByRole("menuitem", { name: "Sign in" }).click()
  const form = page.getByRole("dialog").filter({ hasText: "Your name" })
  await form.getByLabel("Your name").fill("Gus")
  await form.getByRole("button", { name: "Continue as guest" }).click()
  await expect(toolbar(page).getByRole("button", { name: "Account: Gus" })).toBeVisible()
})
