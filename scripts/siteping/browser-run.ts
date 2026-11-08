// Opens the pages of a site in Chromium and finds the elements of SitePing annotations there (see browser.ts).
// Each page opens at the window size of its first annotation, so responsive layouts show the same elements.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import type { Anchor } from "../../widget/src/anchor"
import type { SitepingAnnotation } from "./import"

/** `auth`: "user:password" for a site behind basic auth. */
export async function pages(origin: string, auth?: string) {
  // The page script as one file. `bun build` also works when this runs in Node (Playwright tests).
  const script = execFileSync(
    "bun",
    ["build", fileURLToPath(new URL("browser.ts", import.meta.url)), "--format=iife"],
    {
      encoding: "utf8",
    },
  )
  const [username = "", password = ""] = auth
    ? [auth.slice(0, auth.indexOf(":")), auth.slice(auth.indexOf(":") + 1)]
    : []
  const browser = await chromium.launch()

  async function anchor(path: string, annotations: SitepingAnnotation[]) {
    const context = await browser.newContext({
      viewport: annotations[0]?.viewport ?? { width: 1280, height: 800 },
      httpCredentials: auth ? { username, password } : undefined,
    })
    try {
      const page = await context.newPage()
      const res = await page.goto(new URL(path, origin).href, { waitUntil: "networkidle" })
      if (!res?.ok()) throw new Error(`${path}: ${res?.status() ?? "no answer"}`)
      await page.addScriptTag({ content: script })
      const anchors = new Map<string, Anchor>()
      for (const a of annotations) {
        const found = await page.evaluate(
          (a) =>
            (window as unknown as { commaSiteping: { anchorFor(a: unknown): Anchor | null } }).commaSiteping.anchorFor(
              a,
            ),
          a,
        )
        if (found) anchors.set(a.feedbackId, found)
      }
      return { title: (await page.title()).trim(), anchors }
    } finally {
      await context.close()
    }
  }

  return { anchor, close: () => browser.close() }
}
