import { execFileSync } from "node:child_process"
import { expect, type Page, test } from "@playwright/test"
import type { Anchor } from "../widget/src/anchor"

// The anchor module, built for the browser.
const bundle = execFileSync("bun", ["build", "e2e/anchor-entry.ts", "--target=browser"], { encoding: "utf8" })

type Api = {
  createAnchor: (el: Element, at: { point: { x: number; y: number } } | { rect: DOMRectInit }) => Anchor
  resolveAnchor: (anchor: Anchor) => Element | null
  anchorBox: (anchor: Anchor, el: Element) => { x: number; y: number; width: number; height: number }
}
declare global {
  interface Window {
    commaAnchor: Api
    saved: Anchor
    target: Element | null
  }
}

async function open(page: Page) {
  await page.goto("/fixtures/anchors")
  await page.addScriptTag({ content: bundle })
}

// Creates an anchor on the element with `data-fixture=name`, at the given % of its box.
async function pin(page: Page, name: string, x = 25, y = 50) {
  return page.evaluate(
    ([name, x, y]) => {
      const el = document.querySelector(`[data-fixture="${name}"]`) as Element
      const r = el.getBoundingClientRect()
      window.target = el
      window.saved = window.commaAnchor.createAnchor(el, {
        point: { x: r.left + (r.width * x) / 100, y: r.top + (r.height * y) / 100 },
      })
      return window.saved
    },
    [name, x, y] as const,
  )
}

// The `data-fixture` name of the element the anchor resolves to, or null.
function resolved(page: Page, anchor?: Anchor) {
  return page.evaluate((a) => {
    const el = window.commaAnchor.resolveAnchor(a ?? window.saved)
    return el ? (el.getAttribute("data-fixture") ?? el.outerHTML.slice(0, 80)) : null
  }, anchor)
}

test("a pin stays on its element after a section is added above it", async ({ page }) => {
  await open(page)
  await pin(page, "pricing-title", 25, 50)
  await page.evaluate(() => {
    const s = document.createElement("section")
    s.innerHTML = "<h2>News</h2><p>Something new.</p><h2>Pricing plans soon</h2>"
    document.querySelector("main")?.prepend(s)
  })
  const result = await page.evaluate(() => {
    const el = window.commaAnchor.resolveAnchor(window.saved)
    const r = window.target?.getBoundingClientRect() as DOMRect
    return {
      same: el === window.target,
      box: el && window.commaAnchor.anchorBox(window.saved, el),
      expected: { x: r.left + r.width * 0.25, y: r.top + r.height * 0.5 },
    }
  })
  expect(result.same).toBe(true)
  expect(result.box?.x).toBeCloseTo(result.expected.x, 1)
  expect(result.box?.y).toBeCloseTo(result.expected.y, 1)
})

test("a pin stays on its element after a reload and a viewport resize", async ({ page }) => {
  await open(page)
  const anchor = await pin(page, "btn-pro")
  await page.setViewportSize({ width: 420, height: 800 })
  await open(page)
  expect(await resolved(page, anchor)).toBe("btn-pro")
})

test("a pin on a repeated element finds the right one by its context", async ({ page }) => {
  await open(page)
  const anchor = await pin(page, "btn-ent")
  await page.evaluate(() => {
    const card = document.createElement("div")
    card.className = "card"
    card.innerHTML = "<h3>Starter</h3><p>For one person.</p><button>Learn more</button>"
    document.querySelector(".cards")?.prepend(card)
  })
  expect(await resolved(page, anchor)).toBe("btn-ent")
})

test("a pin is detached when its element is removed", async ({ page }) => {
  await open(page)
  await pin(page, "faq-1")
  await page.evaluate(() => document.querySelector('[data-fixture="faq-1"]')?.remove())
  expect(await resolved(page)).toBeNull()
})

test("a pin is detached, not moved, when the selector matches a different element", async ({ page }) => {
  await open(page)
  await pin(page, "faq-1")
  // The first paragraph now has other text. Its selector still matches it.
  await page.evaluate(() => {
    const p = document.querySelector('[data-fixture="faq-1"]') as HTMLElement
    p.textContent = "Gamma answer about something completely different."
    p.removeAttribute("data-fixture")
  })
  expect(await resolved(page)).toBeNull()
})

test("data-comment-anchor is the most stable anchor", async ({ page }) => {
  await open(page)
  await pin(page, "signup")
  expect(await page.evaluate(() => window.saved.selectors.anchor)).toBe("signup")
  await page.evaluate(() => {
    const el = document.querySelector('[data-fixture="signup"]') as HTMLElement
    el.innerHTML = "<button>Create account</button>"
    document.querySelector("main")?.prepend(el)
  })
  expect(await resolved(page)).toBe("signup")
})

test("framework ids are not used in selectors", async ({ page }) => {
  await open(page)
  const anchor = await page.evaluate(() => {
    const el = document.querySelector("header nav a") as Element
    const r = el.getBoundingClientRect()
    return window.commaAnchor.createAnchor(el, { point: { x: r.left + 1, y: r.top + 1 } })
  })
  expect(anchor.selectors.css).not.toContain(":r3:")
  expect(anchor.selectors.id).toBeUndefined()
})

test("a region keeps its size relative to the element, also outside the element", async ({ page }) => {
  await open(page)
  const result = await page.evaluate(() => {
    const el = document.querySelector('[data-fixture="hero"]') as HTMLElement
    const r = el.getBoundingClientRect()
    // Larger than the element: starts 10 px left of it and ends 10 px below it.
    const rect = { x: r.left - 10, y: r.top + 10, width: r.width + 10, height: r.height }
    const anchor = window.commaAnchor.createAnchor(el, { rect })
    el.style.width = "50%"
    const r2 = el.getBoundingClientRect()
    return { anchor, box: window.commaAnchor.anchorBox(anchor, el), r2 }
  })
  expect(result.anchor.rect?.x).toBeLessThan(0)
  expect((result.anchor.rect?.y ?? 0) + (result.anchor.rect?.height ?? 0)).toBeGreaterThan(100)
  expect(result.box.width).toBeCloseTo(result.r2.width * ((result.anchor.rect?.width ?? 0) / 100), 1)
  expect(result.box.x).toBeLessThan(result.r2.left)
})

test("a short text whose context changed is detached, not moved to a look-alike", async ({ page }) => {
  await open(page)
  await pin(page, "btn-ent")
  // The Enterprise card goes away. Two other "Learn more" buttons stay.
  await page.evaluate(() => document.querySelector('[data-fixture="btn-ent"]')?.closest(".card")?.remove())
  expect(await resolved(page)).toBeNull()
})

test("a long text is found even when its neighbors change", async ({ page }) => {
  await open(page)
  await pin(page, "lead")
  await page.evaluate(() => {
    const title = document.querySelector('[data-fixture="title"]') as HTMLElement
    title.textContent = "A new title"
  })
  expect(await resolved(page)).toBe("lead")
})

test("identical twins: the pin stays on its twin", async ({ page }) => {
  await open(page)
  const anchor = await pin(page, "twin-2")
  await open(page)
  expect(await resolved(page, anchor)).toBe("twin-2")
})

test("identical twins: when one goes away, the pin is detached, not moved to the other", async ({ page }) => {
  await open(page)
  await pin(page, "twin-1")
  await page.evaluate(() => document.querySelector('[data-fixture="twin-1"]')?.closest(".card")?.remove())
  expect(await resolved(page)).toBeNull()
})
