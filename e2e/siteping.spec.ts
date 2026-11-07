import { expect, request, test } from "@playwright/test"
import { pages } from "../scripts/siteping/browser-run"
import type { SitepingAnnotation } from "../scripts/siteping/import"
import { COMMA, guestSession, pins, SITE, signIn, testPath } from "./helpers"

const annotation = (feedbackId: string, a: Partial<SitepingAnnotation>): SitepingAnnotation => ({
  feedbackId,
  css: "",
  xpath: "",
  text: "",
  tag: "P",
  rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
  viewport: { width: 1280, height: 720 },
  ...a,
})

test("the SitePing import finds the elements SitePing pinned, and comma finds them again", async ({ page }) => {
  const path = testPath("siteping")
  const browser = await pages(SITE)
  const { title, anchors } = await browser
    .anchor(path, [
      annotation("lead", {
        css: "main > section > p",
        xpath: "/html[1]/body[1]/main[1]/section[1]/p[1]",
        // SitePing keeps the text as it is in the page, with its spaces.
        text: "  A paragraph that people comment on in tests.",
      }),
      // Only the XPath still fits.
      annotation("beta", { css: ".gone > p", xpath: "//div[@id='cards']/div[2]/p[1]", text: "Second card text." }),
      // The text changed: it is not sure that this is the element.
      annotation("changed", { css: "main > section > h1", tag: "H1", text: "Another title" }),
      // No text: both selectors must point to it.
      annotation("picture", { css: ".picture", xpath: "//main[1]/div[2]", tag: "DIV" }),
      annotation("one-selector", { css: ".picture", tag: "DIV" }),
      // The selectors point to two elements.
      annotation("disagree", { css: "[data-testid=alpha]", xpath: "//div[@id='cards']/div[2]/p[1]", text: "" }),
      // The CSS selector also matches copies: the XPath tells which one.
      annotation("copies", { css: ".card > h3", xpath: "//div[@id='cards']/div[2]/h3[1]", tag: "H3", text: "Beta" }),
      // The element moved and its text changed a little: the one element with clearly the most similar text.
      annotation("moved", {
        css: ".old > p",
        xpath: "//aside[1]/p[1]",
        text: "A paragraph that people comment on in a test.",
      }),
      // A short text can be anywhere.
      annotation("short", { css: ".old > p", tag: "H3", text: "Alpha" }),
    ])
    .finally(() => browser.close())
  expect(title).toBe("Test page")
  expect([...anchors.keys()].sort()).toEqual(["beta", "copies", "lead", "moved", "picture"])
  expect(anchors.get("copies")?.text).toBe("Beta")
  expect(anchors.get("moved")?.text).toBe("A paragraph that people comment on in tests.")
  expect(anchors.get("lead")).toMatchObject({ tag: "p", rect: { x: 10, y: 20, width: 50, height: 50 } })

  // comma finds the elements again: their threads have pins on the page.
  const me = await guestSession("Importer")
  const api = await request.newContext()
  for (const id of ["lead", "beta", "picture"]) {
    const res = await api.post(`${COMMA}/api/threads`, {
      headers: { origin: SITE, authorization: `Bearer ${me.token}` },
      data: {
        page: path,
        anchor: anchors.get(id),
        body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: id }] }] },
      },
    })
    expect(res.ok()).toBe(true)
  }
  await api.dispose()
  await signIn(page, me)
  await page.goto(path)
  await expect(pins(page)).toHaveCount(3)
})
