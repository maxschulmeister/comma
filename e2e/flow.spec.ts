import { expect, test } from "@playwright/test"
import {
  appSession,
  clickAt,
  newCommentPopover,
  panel,
  pins,
  signIn,
  testPath,
  threadPopover,
  toolbar,
  typeComment,
} from "./helpers"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DwnwEIGHEIAD0KBf+0cY5MAAAAAElFTkSuQmCC",
  "base64",
)

// The whole flow from the plan, with two people in two browsers.
test("comment, mention, image, reply, react, unread, resolve, reload", async ({ browser }, info) => {
  const path = testPath("flow")
  const bea = `Bea ${info.project.name}`
  const beaSession = await appSession(bea)

  // Ada is a guest. She pins a comment with a mention and an image to the title.
  const ada = await (await browser.newContext()).newPage()
  await ada.goto(path)
  await expect(toolbar(ada)).toBeVisible()
  await ada.keyboard.press("c")
  const title = ada.getByTestId("title")
  await clickAt(ada, title, 0.5, 0.5)
  const composer = newCommentPopover(ada)
  await composer.getByLabel("Your name").fill("Ada")
  await composer.getByRole("button", { name: "Continue as guest" }).click()
  await typeComment(ada, composer, `Hi @${bea.slice(0, 5)}`)
  await composer.getByRole("option", { name: bea }).click()
  await ada.keyboard.type("check this")
  await composer.locator("input[type=file]").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: PNG })
  await expect(composer.locator("li[data-state=done]")).toHaveCount(1)
  await ada.keyboard.press("ControlOrMeta+Enter")
  const adaThread = threadPopover(ada)
  await expect(adaThread.locator(".comma-mention")).toHaveText(`@${bea}`)
  await expect(adaThread.getByRole("link", { name: "Open image" })).toBeVisible()
  await ada.keyboard.press("Escape")
  await ada.keyboard.press("Escape")

  // Bea (app user) sees the pin, replies and reacts.
  const beaPage = await (await browser.newContext()).newPage()
  await signIn(beaPage, beaSession)
  await beaPage.goto(path)
  await expect(pins(beaPage)).toHaveAccessibleName(/unread/)
  await pins(beaPage).first().click()
  const beaThread = threadPopover(beaPage)
  await expect(beaThread).toContainText("check this")
  await typeComment(beaPage, beaThread, "On it")
  await beaPage.keyboard.press("ControlOrMeta+Enter")
  const first = beaThread.getByRole("article").first()
  await first.hover()
  await first.getByRole("button", { name: "Add reaction" }).click()
  await beaPage.getByRole("button", { name: "React with 👍" }).click()
  await expect(first.getByRole("button", { name: /^👍 1/ })).toBeVisible()

  // Ada sees the thread as unread on the next update.
  await ada.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(pins(ada)).toHaveAccessibleName(/unread/)
  await expect(toolbar(ada).getByRole("button", { name: /^Comments, \d+ unread$/ })).toBeVisible()
  await pins(ada).first().click()
  await expect(adaThread).toContainText("On it")
  await expect(
    adaThread
      .getByRole("article")
      .first()
      .getByRole("button", { name: `👍 1: ${bea}` }),
  ).toBeVisible()
  await expect(pins(ada)).not.toHaveAccessibleName(/unread/)

  // Ada resolves. The pin goes away.
  await adaThread.getByRole("button", { name: "Resolve" }).click()
  await expect(pins(ada)).toHaveCount(0)

  // After a reload the resolved thread opens from the panel, with its pin on the title.
  await ada.reload()
  await toolbar(ada)
    .getByRole("button", { name: /^Comments/ })
    .click()
  await panel(ada).getByRole("button", { name: "Filter and sort" }).click()
  await ada.getByRole("menuitemcheckbox", { name: "Show resolved" }).click()
  await ada.keyboard.press("Escape")
  await panel(ada).locator("[data-slot=panel-item]").click()
  await expect(adaThread).toContainText("Resolved")
  const pin = await pins(ada).first().boundingBox()
  const box = await title.boundingBox()
  expect(Math.abs((pin?.x ?? 0) - ((box?.x ?? 0) + (box?.width ?? 0) * 0.5))).toBeLessThan(2)
  expect(Math.abs((pin?.y ?? 0) + (pin?.height ?? 0) - ((box?.y ?? 0) + (box?.height ?? 0) * 0.5))).toBeLessThan(2)

  // The panel floats over the page (the default): the page keeps its width.
  expect(await ada.evaluate(() => getComputedStyle(document.documentElement).marginRight)).toBe("0px")
})
