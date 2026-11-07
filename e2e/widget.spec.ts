import { expect, test } from "@playwright/test"
import {
  addComment,
  clickAt,
  closeThread,
  endCommentMode,
  guestSession,
  newCommentPopover,
  openTestPage,
  overlay,
  panel,
  pins,
  signIn,
  testPath,
  threadPopover,
  toolbar,
  typeComment,
} from "./helpers"

test("the page does not change the widget styles", async ({ page }) => {
  await signIn(page, await guestSession("Styles"))
  await openTestPage(page, "styles")
  // The page changes the root font size. The widget uses px, so its sizes stay.
  await page.addStyleTag({ content: "html { font-size: 10px !important } * { box-shadow: none }" })
  const button = toolbar(page).getByRole("button", { name: "Comment mode" })
  await expect(button).toHaveCSS("height", "32px")
  await expect(button).toHaveCSS("font-family", /Public Sans Variable/)
  await toolbar(page)
    .getByRole("button", { name: /^Account/ })
    .click()
  // Rings and shadows work in the shadow root (Tailwind @property fallback).
  const menu = page.locator("[data-slot=dropdown-menu-content]")
  await expect(menu).toBeVisible()
  expect(await menu.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 1px/)
})

test.describe("comment mode", () => {
  test("C starts comment mode, Esc ends it", async ({ page }) => {
    await openTestPage(page, "mode")
    const button = toolbar(page).getByRole("button", { name: "Comment mode" })
    await expect(button).toHaveAttribute("aria-pressed", "false")
    await page.keyboard.press("c")
    await expect(button).toHaveAttribute("aria-pressed", "true")
    // The panel floats by default: it stays closed, so it covers no element to comment on.
    await expect(panel(page)).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(button).toHaveAttribute("aria-pressed", "false")
  })

  test("a guest signs in from the composer and pins a comment to an element", async ({ page }) => {
    await openTestPage(page, "guest")
    await page.keyboard.press("c")
    await clickAt(page, page.getByTestId("lead"), 0.5)
    const popover = newCommentPopover(page)
    await popover.getByLabel("Your name").fill("Ada")
    await popover.getByRole("button", { name: "Continue as guest" }).click()
    await typeComment(page, popover, "Fix this sentence")
    await page.keyboard.press("ControlOrMeta+Enter")
    await expect(threadPopover(page)).toContainText("Fix this sentence")
    await expect(threadPopover(page)).toContainText("Ada")
    await expect(pins(page)).toHaveCount(1)

    // After a reload the pin is still on the paragraph, at the same place.
    await page.reload()
    const pin = pins(page).first()
    await expect(pin).toBeVisible()
    const lead = await page.getByTestId("lead").boundingBox()
    const box = await pin.boundingBox()
    expect(box && lead && Math.abs(box.x - (lead.x + lead.width * 0.5))).toBeLessThan(2)
    expect(box && lead && Math.abs(box.y + box.height - (lead.y + lead.height * 0.5))).toBeLessThan(2)
  })

  test("with the keyboard: focus a page element and press Enter", async ({ page }) => {
    await signIn(page, await guestSession("Keyboard"))
    await openTestPage(page, "keyboard")
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    await page.getByRole("link", { name: "Home" }).focus()
    await page.keyboard.press("Enter")
    await typeComment(page, newCommentPopover(page), "Keyboard comment")
    await page.keyboard.press("ControlOrMeta+Enter")
    await expect(threadPopover(page)).toContainText("Keyboard comment")
    const link = await page.getByRole("link", { name: "Home" }).boundingBox()
    const pin = await pins(page).first().boundingBox()
    expect(Math.abs((pin?.x ?? 0) - ((link?.x ?? 0) + (link?.width ?? 0) / 2))).toBeLessThan(2)
  })

  test("with the keyboard: arrow keys pick any element, Enter comments on it", async ({ page }) => {
    await signIn(page, await guestSession("Arrows"))
    await openTestPage(page, "arrows")
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    const announcement = page.locator("[aria-live=polite]")
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown")
    await expect(announcement).toHaveText(
      "Paragraph: A paragraph that people comment on in tests. Press Enter to comment, Shift+Enter to comment on its area.",
    )
    await page.keyboard.press("Enter")
    await typeComment(page, newCommentPopover(page), "Picked with arrows")
    await page.keyboard.press("ControlOrMeta+Enter")
    await expect(threadPopover(page)).toContainText("Picked with arrows")
    const lead = await page.getByTestId("lead").boundingBox()
    const pin = await pins(page).first().boundingBox()
    expect(Math.abs((pin?.x ?? 0) - ((lead?.x ?? 0) + (lead?.width ?? 0) / 2))).toBeLessThan(2)
  })

  test("with the keyboard: elements in the page's own sidebar work too", async ({ page }) => {
    await signIn(page, await guestSession("Sidebar"))
    await openTestPage(page, "sidebar")
    await page.evaluate(() => {
      const aside = document.createElement("aside")
      aside.innerHTML = '<a href="#side">Side link</a>'
      document.body.prepend(aside)
    })
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    await page.getByRole("link", { name: "Side link" }).focus()
    await page.keyboard.press("Enter")
    await expect(newCommentPopover(page)).toBeVisible()
  })

  test("with the keyboard: an element under a sticky header is not picked there, it scrolls out", async ({ page }) => {
    await signIn(page, await guestSession("Sticky"))
    await page.setViewportSize({ width: 1280, height: 500 })
    await openTestPage(page, "sticky")
    await page.addStyleTag({
      content: ".site-header { position: sticky; top: 0; z-index: 10; height: 120px; } main { padding-bottom: 800px; }",
    })
    const header = page.locator(".site-header")
    const title = page.getByTestId("title")
    const headerBottom = async () => {
      const box = await header.boundingBox()
      return (box?.y ?? 0) + (box?.height ?? 0)
    }
    // The heading is behind the header, the paragraph below it shows.
    await page.evaluate((y) => window.scrollTo(0, y), ((await title.boundingBox())?.y ?? 0) - 20)
    expect((await title.boundingBox())?.y ?? 0).toBeLessThan(await headerBottom())
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    const announcement = page.locator("[aria-live=polite]")
    // ↓ first picks the first element that shows: a link in the header, not the hidden heading.
    await page.keyboard.press("ArrowDown")
    await expect(announcement).toContainText("Link: Example")
    // ↓ to the heading: it scrolls out from under the header.
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await expect(announcement).toContainText("Heading: Test page title")
    await expect.poll(async () => (await title.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(await headerBottom())
  })

  test("with the keyboard: Shift+Enter comments on the area of the picked element", async ({ page }) => {
    await signIn(page, await guestSession("Area"))
    await openTestPage(page, "area")
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    const announcement = page.locator("[aria-live=polite]")
    // ↑ first picks the last element in view: the picture.
    await page.keyboard.press("ArrowUp")
    await expect(announcement).toContainText("Image: Picture")
    await page.keyboard.press("Shift+Enter")
    await typeComment(page, newCommentPopover(page), "The whole picture")
    await page.keyboard.press("ControlOrMeta+Enter")
    await expect(threadPopover(page)).toContainText("The whole picture")
    const region = await page.locator("[data-slot=pins] > div.border-primary").first().boundingBox()
    const picture = await page.getByTestId("picture").boundingBox()
    expect(Math.round(region?.width ?? 0)).toBe(Math.round(picture?.width ?? -1))
  })

  test("moving a region keeps its size", async ({ page }) => {
    await signIn(page, await guestSession("Region mover"))
    await openTestPage(page, "region-move")
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    const picture = await page.getByTestId("picture").boundingBox()
    if (!picture) throw new Error("no box")
    await page.mouse.move(picture.x + 20, picture.y + 20)
    await page.mouse.down()
    await page.mouse.move(picture.x + 120, picture.y + 60, { steps: 5 })
    await page.mouse.up()
    await typeComment(page, newCommentPopover(page), "Region to move")
    await page.keyboard.press("ControlOrMeta+Enter")
    await expect(threadPopover(page)).toContainText("Region to move")
    await endCommentMode(page)
    const pin = await pins(page).first().boundingBox()
    if (!pin) throw new Error("no pin")
    const drop = { x: pin.x + 205, y: pin.y + 70 }
    await page.mouse.move(pin.x + 5, pin.y + 20)
    await page.mouse.down()
    await page.mouse.move(drop.x, drop.y, { steps: 8 })
    await page.mouse.up()
    await pins(page).first().click()
    const region = page.locator("[data-slot=pins] > div.border-primary").first()
    await expect(region).toBeVisible()
    const box = await region.boundingBox()
    expect(Math.round(box?.width ?? 0)).toBe(100)
    expect(Math.round(box?.height ?? 0)).toBe(40)
    // The pin tip (the region's bottom-right corner) is where the pin was dropped.
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) - drop.x)).toBeLessThan(2)
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - drop.y)).toBeLessThan(2)
  })

  test("moving a region keeps it after its neighbors changed", async ({ page }) => {
    await signIn(page, await guestSession("Region keeper"))
    await openTestPage(page, "region-neighbors")
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    const picture = await page.getByTestId("picture").boundingBox()
    if (!picture) throw new Error("no box")
    await page.mouse.move(picture.x + 20, picture.y + 20)
    await page.mouse.down()
    await page.mouse.move(picture.x + 120, picture.y + 60, { steps: 5 })
    await page.mouse.up()
    await typeComment(page, newCommentPopover(page), "Region with new neighbors")
    await page.keyboard.press("ControlOrMeta+Enter")
    await expect(threadPopover(page)).toContainText("Region with new neighbors")
    await endCommentMode(page)
    // The cards next to the picture change: the pin stays on this page.
    await page.evaluate(() => {
      for (const p of document.querySelectorAll("#cards p")) p.textContent = "Changed card text."
    })
    await page.waitForTimeout(300)
    const pin = await pins(page).first().boundingBox()
    if (!pin) throw new Error("no pin")
    await page.mouse.move(pin.x + 5, pin.y + 20)
    await page.mouse.down()
    await page.mouse.move(pin.x + 105, pin.y + 40, { steps: 8 })
    await page.mouse.up()
    await pins(page).first().click()
    const box = await page.locator("[data-slot=pins] > div.border-primary").first().boundingBox()
    expect(Math.round(box?.width ?? 0)).toBe(100)
    expect(Math.round(box?.height ?? 0)).toBe(40)
  })

  test("a drag draws a region", async ({ page }) => {
    await signIn(page, await guestSession("Region"))
    await openTestPage(page, "region")
    await page.keyboard.press("c")
    await expect(overlay(page)).toBeAttached()
    const picture = await page.getByTestId("picture").boundingBox()
    if (!picture) throw new Error("no box")
    await page.mouse.move(picture.x + 20, picture.y + 20)
    await page.mouse.down()
    await page.mouse.move(picture.x + 120, picture.y + 60, { steps: 5 })
    await page.mouse.up()
    await typeComment(page, newCommentPopover(page), "This area")
    await page.keyboard.press("ControlOrMeta+Enter")
    await expect(threadPopover(page)).toContainText("This area")
    const region = page.locator("[data-slot=pins] > div.border-primary").first()
    await expect(region).toBeVisible()
    const box = await region.boundingBox()
    expect(Math.round(box?.width ?? 0)).toBe(100)
    expect(Math.round(box?.height ?? 0)).toBe(40)
  })

  test("Shift+C hides and shows comments, and the choice stays after reload", async ({ page }) => {
    await signIn(page, await guestSession("Hider"))
    await openTestPage(page, "hide")
    await addComment(page, page.getByTestId("title"), "Hello")
    await endCommentMode(page)
    await expect(pins(page)).toHaveCount(1)
    await page.keyboard.press("Shift+C")
    await expect(pins(page)).toHaveCount(0)
    await page.reload()
    await expect(toolbar(page)).toBeVisible()
    await page.waitForTimeout(500)
    await expect(pins(page)).toHaveCount(0)
    await page.keyboard.press("Shift+C")
    await expect(pins(page)).toHaveCount(1)
  })

  test("the eye in the toolbar hides and shows comments", async ({ page }) => {
    await signIn(page, await guestSession("Eye"))
    await openTestPage(page, "eye")
    await addComment(page, page.getByTestId("title"), "Hello")
    await endCommentMode(page)
    await toolbar(page).getByRole("button", { name: "Hide comments" }).click()
    await expect(pins(page)).toHaveCount(0)
    await toolbar(page).getByRole("button", { name: "Show comments" }).click()
    await expect(pins(page)).toHaveCount(1)
    // One place for it: the account menu does not have it.
    await toolbar(page)
      .getByRole("button", { name: /^Account/ })
      .click()
    await expect(page.getByRole("menuitem", { name: /comments/ })).toHaveCount(0)
  })

  test("the toolbar order is mirrored with the panel on the left", async ({ page }) => {
    await signIn(page, await guestSession("Mirror"))
    // Without the unread count: other tests add threads to the project.
    const labels = () =>
      toolbar(page)
        .getByRole("button")
        .evaluateAll((list) => list.map((b) => b.ariaLabel?.split(",")[0]))
    await openTestPage(page, "mirror")
    await expect.poll(labels).toEqual(["Comment mode", "Hide comments", "Comments", "Account: Mirror"])
    await page.evaluate(() => localStorage.setItem("comma:panel-side", "left"))
    await page.reload()
    await expect(toolbar(page)).toBeVisible()
    await expect.poll(labels).toEqual(["Account: Mirror", "Comments", "Hide comments", "Comment mode"])
  })

  test("when the first load fails, comma tries again and shows up", async ({ page }) => {
    let failed = 0
    await page.route("**/api/projects/**", (route) => (failed++ === 0 ? route.abort() : route.continue()))
    await page.goto(testPath("first-load"))
    await expect(toolbar(page)).toBeVisible({ timeout: 10_000 })
    expect(failed).toBeGreaterThan(1)
  })

  test("pins close together merge into a cluster", async ({ page }) => {
    await signIn(page, await guestSession("Cluster"))
    await openTestPage(page, "cluster")
    const lead = page.getByTestId("lead")
    await addComment(page, lead, "One", 0.3)
    await closeThread(page)
    // Left of the first pin (a pin covers 28 px to the right of its point).
    await addComment(page, lead, "Two", 0.28)
    await endCommentMode(page)
    const cluster = page.locator("[data-slot=cluster]")
    await expect(cluster).toHaveAccessibleName("2 comments")
    await cluster.click()
    await page.getByRole("dialog", { name: "Comments here" }).getByRole("button", { name: /One/ }).click()
    await expect(threadPopover(page)).toContainText("One")
  })

  test("the author drags a pin to another element", async ({ page }) => {
    await signIn(page, await guestSession("Mover"))
    await openTestPage(page, "move")
    await addComment(page, page.getByTestId("title"), "Move me")
    await endCommentMode(page)
    const pin = pins(page).first()
    const from = await pin.boundingBox()
    const beta = await page.getByTestId("beta").boundingBox()
    if (!from || !beta) throw new Error("no box")
    await page.mouse.move(from.x + 10, from.y + 10)
    await page.mouse.down()
    await page.mouse.move(beta.x + 30, beta.y + 10, { steps: 8 })
    await page.mouse.up()
    await expect(threadPopover(page)).toBeHidden()
    await expect(pins(page).first()).toHaveAttribute("aria-label", /Move me/)
    await page.waitForTimeout(300)
    await page.reload()
    await expect(pins(page).first()).toBeVisible()
    const after = await page.getByTestId("beta").boundingBox()
    const moved = await pins(page).first().boundingBox()
    expect(Math.abs((moved?.x ?? 0) - ((after?.x ?? 0) + 30))).toBeLessThan(3)
  })

  test("hovering a pin shows a preview", async ({ page }) => {
    await signIn(page, await guestSession("Preview"))
    await openTestPage(page, "preview")
    await addComment(page, page.getByTestId("title"), "A preview text")
    await endCommentMode(page)
    await pins(page).first().hover()
    await expect(page.locator("[data-slot=hover-card-content]")).toContainText("A preview text")
  })
})

test("pins follow client-side navigation", async ({ page }) => {
  await signIn(page, await guestSession("Navigator"))
  await openTestPage(page, "spa")
  await addComment(page, page.getByTestId("lead"), "On the first page")
  await endCommentMode(page)
  await expect(pins(page)).toHaveCount(1)
  const path = new URL(page.url()).pathname
  await page.evaluate(() => history.pushState({}, "", `${location.pathname}-next`))
  await expect(pins(page)).toHaveCount(0)
  await page.evaluate((p) => history.pushState({}, "", p), path)
  await expect(pins(page)).toHaveCount(1)
})

test("a page that changes all the time: pins still follow their elements", async ({ page }) => {
  await signIn(page, await guestSession("Ticker"))
  await openTestPage(page, "ticker")
  await addComment(page, page.getByTestId("lead"), "On the lead")
  await endCommentMode(page)
  await expect(pins(page)).toHaveCount(1)
  // A ticker changes the page every 50 ms, then the pinned element shows something else.
  await page.evaluate(() => {
    const ticker = document.createElement("p")
    document.body.append(ticker)
    setInterval(() => {
      ticker.textContent = String(Math.random())
    }, 50)
    const lead = document.querySelector('[data-testid="lead"]') as HTMLElement
    lead.textContent = "Something else entirely, written by the app."
  })
  await expect(pins(page)).toHaveCount(0)
})

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: false, viewport: { width: 390, height: 800 } })
  test("a tap pins a comment", async ({ page }) => {
    await signIn(page, await guestSession("Toucher"))
    await openTestPage(page, "touch")
    await toolbar(page).getByRole("button", { name: "Comment mode" }).tap()
    const lead = await page.getByTestId("lead").boundingBox()
    if (!lead) throw new Error("no box")
    await page.touchscreen.tap(lead.x + 20, lead.y + 5)
    await expect(newCommentPopover(page)).toBeVisible()
  })

  test("comment actions and reactions show without hover", async ({ browser, browserName }) => {
    test.skip(browserName === "firefox", "Playwright has no mobile emulation in Firefox")
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } })
    const page = await context.newPage()
    await signIn(page, await guestSession("Thumb"))
    await openTestPage(page, "touch-actions")
    await addComment(page, page.getByTestId("lead"), "Tapped")
    const opacity = (name: string) =>
      threadPopover(page)
        .getByRole("button", { name })
        .evaluate((el) => getComputedStyle(el).opacity)
    expect(await opacity("Comment actions")).toBe("1")
    expect(await opacity("Add reaction")).toBe("1")
    await context.close()
  })
})

test("polling stops after 5 minutes with no input, the next input polls at once", async ({ page }) => {
  await page.clock.install()
  await signIn(page, await guestSession("Idle"))
  let polls = 0
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/threads") polls++
  })
  // Moves the clock in 15 s steps. Each poll finishes before the next step.
  const wait = async (minutes: number) => {
    for (let i = 0; i < minutes * 4; i++) {
      await page.clock.runFor(15_000)
      await page.waitForTimeout(50)
    }
  }
  await openTestPage(page, "idle")
  await page.mouse.move(10, 10)
  const start = polls
  await wait(1)
  expect(polls - start).toBeGreaterThanOrEqual(3)
  // No input for more than 5 minutes.
  await wait(6)
  const idle = polls
  await wait(10)
  expect(polls).toBe(idle)
  await page.mouse.move(20, 20)
  await expect.poll(() => polls).toBe(idle + 1)
  // Polling runs again.
  await wait(1)
  expect(polls).toBeGreaterThanOrEqual(idle + 3)
})

test.describe("shortcut", () => {
  const commentMode = (page: import("@playwright/test").Page) =>
    toolbar(page).getByRole("button", { name: "Comment mode" })

  test("the shortcut follows the letter on the key, not its place", async ({ page }) => {
    await signIn(page, await guestSession("Dvorak"))
    await openTestPage(page, "shortcut-letter")
    // On a Dvorak keyboard, the C letter is where QWERTY has I.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyI" })))
    await expect(commentMode(page)).toHaveAttribute("aria-pressed", "true")
  })

  test("the site sets another key, or none", async ({ page }) => {
    await signIn(page, await guestSession("Keys"))
    await page.goto(`${testPath("shortcut-m")}?shortcut=m`)
    await expect(toolbar(page)).toBeVisible()
    await page.keyboard.press("c")
    await expect(commentMode(page)).toHaveAttribute("aria-pressed", "false")
    await page.keyboard.press("m")
    await expect(commentMode(page)).toHaveAttribute("aria-pressed", "true")

    await page.goto(`${testPath("shortcut-none")}?shortcut=none`)
    await expect(toolbar(page)).toBeVisible()
    await page.keyboard.press("c")
    await expect(commentMode(page)).toHaveAttribute("aria-pressed", "false")
  })
})

test("the widget says it is English, and keeps still with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await signIn(page, await guestSession("Still"))
  await openTestPage(page, "still")
  await expect(page.locator("comma-widget .comma-root").first()).toHaveAttribute("lang", "en")
  await addComment(page, page.getByTestId("lead"), "Still")
  const seconds = await threadPopover(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).animationDuration))
  expect(seconds).toBeLessThan(0.001)
})
