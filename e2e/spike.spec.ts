import { expect, test } from "@playwright/test"

test("shadcn components work in the shadow root with preact/compat", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("/spike")
  const popoverButton = page.getByRole("button", { name: "Popover" })
  await expect(popoverButton).toBeVisible()
  // rem is converted to px: the page root font size does not change the widget.
  await expect(popoverButton).toHaveCSS("height", "28px")
  // The font loads.
  await expect(popoverButton).toHaveCSS("font-family", /Instrument Sans Variable/)

  await popoverButton.click()
  const input = page.getByRole("textbox", { name: "Popover input" })
  await expect(input).toBeVisible()
  await input.fill("hello")
  await expect(input).toHaveValue("hello")
  await page.keyboard.press("Escape")
  await expect(input).toBeHidden()
  await expect(popoverButton).toBeFocused()

  await page.getByRole("button", { name: "Menu" }).click()
  await expect(page.getByRole("menuitem", { name: "One" })).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menuitem", { name: "One" })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menuitem", { name: "Two" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("picked")).toHaveText("two")

  await page.getByRole("button", { name: "Dialog" }).click()
  const dialog = page.getByRole("dialog", { name: "Title" })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  const focusedInDialog = await dialog.evaluate((d) => {
    const active = (d.getRootNode() as ShadowRoot).activeElement
    return !!active && d.contains(active)
  })
  expect(focusedInDialog).toBe(true)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  await page.getByRole("button", { name: "Comment" }).hover()
  await expect(page.locator("[data-slot=tooltip-content]")).toHaveText("Comment")
  expect(errors).toEqual([])
})

test("Tiptap works in the shadow root", async ({ page, browserName }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("/spike")
  const editor = page.getByTestId("editor").locator(".ProseMirror")
  const json = page.getByTestId("json")
  await editor.click()
  await page.keyboard.type("Hello **bold** and *it* and ~gone~ and `x` ")
  await expect(json).toContainText('"marks":[{"type":"bold"}],"text":"bold"')
  await expect(json).toContainText('"marks":[{"type":"italic"}],"text":"it"')
  await expect(json).toContainText('"marks":[{"type":"strike"}],"text":"gone"')
  await expect(json).toContainText('"marks":[{"type":"code"}],"text":"x"')

  const mod = browserName === "webkit" || process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.press(`${mod}+b`)
  await page.keyboard.type("strong")
  await page.keyboard.press(`${mod}+b`)
  await expect(json).toContainText('"marks":[{"type":"bold"}],"text":"strong"')

  // Shift+Enter starts a new line, then `- ` starts a list.
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("- item")
  await expect(json).toContainText('"type":"bulletList"')

  // Mention picker: type, arrow, Enter picks (does not send).
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.type("hi @a")
  await expect(page.getByRole("option")).toHaveCount(2)
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("option", { name: "Alan Turing" })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")
  await expect(json).toContainText('"type":"mention","attrs":{"id":"u2","label":"Alan Turing"')
  await expect(page.getByTestId("sent")).toHaveText("0")

  // Emoji autocomplete inserts the character.
  await page.keyboard.type(" :ta")
  await expect(page.getByRole("option", { name: "🎉" })).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(json).toContainText("🎉")

  // Selection: select all and delete.
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.press("Backspace")
  await expect(json).toHaveText('{"type":"doc","content":[{"type":"paragraph"}]}')

  await page.keyboard.type("done")
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("sent")).toHaveText("1")
  expect(errors).toEqual([])
})
