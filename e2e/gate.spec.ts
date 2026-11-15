import { expect, type Page, request, test } from "@playwright/test"
import { COMMA, guestSession, SITE, signIn, testPath, toolbar } from "./helpers"

// Project `gated`: only people who are signed in see the page. Guests need the password "e2e-password".
const gatedPage = (name: string, tag = "&gate") => `${testPath(name)}?project=gated${tag}`
const gate = (page: Page) => page.getByRole("heading", { name: "Sign in to see this site" })
const content = (page: Page) => page.getByTestId("title")
const noindex = (page: Page) => page.locator('meta[name="robots"][content="noindex, nofollow"]')

test("a gated page shows only the sign-in until a guest signs in with the password", async ({ page }) => {
  await page.goto(gatedPage("gate"))
  await expect(gate(page)).toBeVisible()
  // The page content is not in the document, and search engines must not index the page.
  await expect(content(page)).toHaveCount(0)
  await expect(noindex(page)).toHaveCount(1)
  await expect(toolbar(page)).toBeHidden()

  await page.getByLabel("Your name").fill("Ada")
  await page.getByLabel("Password").fill("wrong")
  await page.getByRole("button", { name: "Continue as guest" }).click()
  await expect(page.getByRole("alert")).toHaveText("Wrong password")

  // The right password: the page loads again, with its content.
  await page.getByLabel("Password").fill("e2e-password")
  await page.getByRole("button", { name: "Continue as guest" }).click()
  await expect(content(page)).toBeVisible()
  await expect(gate(page)).toBeHidden()
  await expect(toolbar(page).getByRole("button", { name: "Account: Ada" })).toBeVisible()
  await expect(noindex(page)).toHaveCount(1)

  // Sign out: the gate comes back. The page loads again only after the session ends on the server.
  const token = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}").token,
    `comma:${COMMA}:gated`,
  )
  await toolbar(page).getByRole("button", { name: "Account: Ada" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(gate(page)).toBeVisible()
  await expect(content(page)).toHaveCount(0)
  const api = await request.newContext()
  const res = await api.get(`${COMMA}/api/threads`, { headers: { origin: SITE, authorization: `Bearer ${token}` } })
  expect(res.status()).toBe(401)
  await api.dispose()
})

test("a person who is signed in sees the gated page at once", async ({ page }) => {
  await signIn(page, await guestSession("Grace", SITE, "gated", "e2e-password"), SITE, "gated")
  await page.goto(gatedPage("signed-in"))
  await expect(content(page)).toBeVisible()
  await expect(toolbar(page).getByRole("button", { name: "Account: Grace" })).toBeVisible()
  await expect(gate(page)).toBeHidden()
  await expect(noindex(page)).toHaveCount(1)
})

test("without data-gate on the script tag, the project's gate still covers the page", async ({ page }) => {
  await page.goto(gatedPage("no-attribute", ""))
  await expect(gate(page)).toBeVisible()
  await expect(content(page)).toHaveCount(0)
  await expect(noindex(page)).toHaveCount(1)
})
