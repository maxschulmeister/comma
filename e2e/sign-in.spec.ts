import { expect, request, test } from "@playwright/test"
import { sign } from "hono/jwt"
import { COMMA, guestSession, panel, SITE, signIn, testPath, toolbar } from "./helpers"

test("on another site, people sign in with the app in a popup", async ({ page }) => {
  // 127.0.0.1 is another site than the app (localhost).
  await page.goto(`http://127.0.0.1:4900${testPath("popup")}`)
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .click()
  const popupPromise = page.waitForEvent("popup")
  await panel(page).getByRole("button", { name: "Sign in with Example" }).click()
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

test("identify works while an old, expired session is cleared", async ({ page }) => {
  await signIn(page, { token: "expired-or-bad", user: { id: "x", name: "Old" } })
  // Order: identify starts, then the poll with the old session fails (401), then the sign-in answer arrives.
  const gate = () => {
    let open = () => {}
    const opened = new Promise<void>((resolve) => {
      open = resolve
    })
    return { open, opened }
  }
  const poll = gate()
  const signInAnswer = gate()
  // Hold the request (not the answer) of the first poll: the server answers 401 when it gets it.
  let firstPoll = true
  await page.route("**/api/threads", async (route) => {
    if (firstPoll) {
      firstPoll = false
      await poll.opened
    }
    await route.continue()
  })
  await page.route("**/api/session/app", async (route) => {
    const response = await route.fetch()
    await signInAnswer.opened
    await route.fulfill({ response })
  })
  await page.goto(testPath("expired"))
  await expect(toolbar(page)).toBeVisible()
  const token = await sign(
    { sub: "e2e:fresh", name: "Fresh", exp: Math.floor(Date.now() / 1000) + 120 },
    "e2e-app-secret",
    "HS256",
  )
  const sent = page.waitForRequest("**/api/session/app")
  await page.evaluate(
    (t) => void (window as unknown as { comma: { identify: (t: string) => Promise<void> } }).comma.identify(t),
    token,
  )
  await sent
  poll.open()
  await expect(toolbar(page).getByRole("button", { name: "Account", exact: true })).toBeVisible()
  signInAnswer.open()
  await expect(toolbar(page).getByRole("button", { name: "Account: Fresh" })).toBeVisible()
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

test("members only: visitors see no toolbar; ?comma shows the sign-in, without a guest option", async ({ page }) => {
  const info = page.waitForResponse("**/api/projects/members")
  await page.goto(`${testPath("members")}?project=members`)
  await info
  await expect(page.locator("comma-widget")).toBeAttached()
  await expect(toolbar(page)).toHaveCount(0)
  // The shortcut does nothing for visitors either.
  await page.keyboard.press("c")
  await expect(page.locator("[data-slot=comment-overlay]")).toHaveCount(0)

  await page.goto(`${testPath("members")}?project=members&comma`)
  await expect(panel(page).getByRole("button", { name: "Sign in with Example" })).toBeVisible()
  await expect(panel(page).getByLabel("Your name")).toHaveCount(0)
})

test("a shared link asks a signed-out teammate to sign in, then opens the thread", async ({ page }) => {
  const author = await guestSession("Linker")
  const path = testPath("shared-link")
  const api = await request.newContext()
  const res = await api.post(`${COMMA}/api/threads`, {
    headers: { origin: SITE, authorization: `Bearer ${author.token}` },
    data: {
      page: path,
      anchor: {
        selectors: { css: "body > main > section > h1" },
        tag: "h1",
        text: "Test page title",
        context: "",
        point: { x: 10, y: 50 },
        viewport: 1280,
      },
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Look at this title" }] }] },
    },
  })
  const { thread } = await res.json()
  await api.dispose()

  await page.goto(`${path}#comma=${thread.id}`)
  await expect(panel(page)).toContainText("Sign in to see this comment")
  await panel(page).getByLabel("Your name").fill("Teammate")
  await panel(page).getByRole("button", { name: "Continue as guest" }).click()
  await expect(page.getByRole("dialog", { name: "Comment thread" })).toContainText("Look at this title")
  // Guests are marked as guests for everyone.
  await expect(page.getByRole("dialog", { name: "Comment thread" }).getByRole("article")).toContainText("Linker Guest")
})

test("sign-out in the widget ends the session on the server", async ({ page }) => {
  const session = await guestSession("Olga")
  await signIn(page, session)
  await page.goto(testPath("sign-out"))
  await toolbar(page).getByRole("button", { name: "Account: Olga" }).click()
  const ended = page.waitForResponse((r) => r.url() === `${COMMA}/api/session` && r.request().method() === "DELETE")
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  expect((await ended).status()).toBe(200)
  const api = await request.newContext()
  const res = await api.get(`${COMMA}/api/threads`, {
    headers: { origin: SITE, authorization: `Bearer ${session.token}` },
  })
  expect(res.status()).toBe(401)
  await api.dispose()
})

test("Sign in with Slack opens Slack's sign-in for the project's workspace in a popup", async ({ page, context }) => {
  // Playwright does not route the target of a redirect: read comma's redirect to Slack, show a fake Slack page.
  let slack: URL | undefined
  await context.route(`${COMMA}/auth/slack/start?**`, async (route) => {
    const res = await route.fetch({ maxRedirects: 0 })
    slack = new URL(res.headers().location ?? "")
    await route.fulfill({ contentType: "text/html", body: "<h1>Slack sign-in</h1>" })
  })
  await page.goto(`${testPath("slack")}?project=slack`)
  await toolbar(page)
    .getByRole("button", { name: /^Comments/ })
    .click()
  await expect(panel(page).getByLabel("Your name")).toHaveCount(0)
  const popupPromise = page.waitForEvent("popup")
  await panel(page).getByRole("button", { name: "Sign in with Slack" }).click()
  const popup = await popupPromise
  await expect(popup.getByRole("heading", { name: "Slack sign-in" })).toBeVisible()
  expect(`${slack?.origin}${slack?.pathname}`).toBe("https://slack.com/openid/connect/authorize")
  expect(slack?.searchParams.get("team")).toBe("T0E2E")
  expect(slack?.searchParams.get("redirect_uri")).toBe(`${COMMA}/auth/slack/callback`)
  await popup.close()
  await expect(panel(page).getByRole("alert")).toHaveText("Sign-in was closed.")
})

test("tabs follow each other: sign-out and sign-in in one tab change the others", async ({ context }) => {
  const key = `comma:${COMMA}:example`
  const path = testPath("tabs")
  const [a, b] = [await context.newPage(), await context.newPage()]
  const alice = await guestSession("Alice")
  await a.goto(path)
  await a.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(alice)] as const)
  for (const tab of [a, b]) {
    await tab.goto(path)
    await expect(toolbar(tab).getByRole("button", { name: "Account: Alice" })).toBeVisible()
  }
  // Sign out in tab A: tab B is signed out too.
  await toolbar(a).getByRole("button", { name: "Account: Alice" }).click()
  await a.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(toolbar(b).getByRole("button", { name: "Account", exact: true })).toBeVisible()
  // Bob signs in in tab A: tab B is Bob too.
  await toolbar(a)
    .getByRole("button", { name: /^Comments/ })
    .click()
  await panel(a).getByLabel("Your name").fill("Bob")
  await panel(a).getByRole("button", { name: "Continue as guest" }).click()
  await expect(toolbar(b).getByRole("button", { name: "Account: Bob" })).toBeVisible()
})

test("a tab whose session ended does not remove the session of another tab", async ({ page }) => {
  const key = `comma:${COMMA}:example`
  const alice = await guestSession("Alice")
  const bob = await guestSession("Bob")
  await signIn(page, alice)
  await page.goto(testPath("old-tab"))
  await expect(toolbar(page).getByRole("button", { name: "Account: Alice" })).toBeVisible()
  // Another tab stored Bob (without a storage event here), and the server ends Alice's session.
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(bob)] as const)
  await page.route("**/api/threads", (route) => route.fulfill({ status: 401, json: { error: "Sign in again" } }))
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  // This tab takes Bob's session, and the stored one stays.
  await expect(toolbar(page).getByRole("button", { name: "Account: Bob" })).toBeVisible()
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.user.name, key)).toBe("Bob")
})
