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
  await expect(button).toHaveCSS("height", "28px")
  await expect(button).toHaveCSS("font-family", /Instrument Sans Variable/)
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
    await expect(panel(page)).toBeVisible()
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
    await page.keyboard.press("Enter")
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
    await page.keyboard.press("Enter")
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
    await page.keyboard.press("Enter")
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
    await page.keyboard.press("Enter")
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
    await page.keyboard.press("Enter")
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
    await page.keyboard.press("Enter")
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
    await page.keyboard.press("Enter")
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
})
