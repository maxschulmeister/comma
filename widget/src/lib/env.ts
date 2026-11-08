// Where a comment is made: the page, the screen and the browser. The team sees the page as the author saw it.

// Query parameters that can hold secrets (sign-in codes, tokens) do not go into a comment.
const SECRET = /token|secret|passw|auth|session|signature|api_?key|^sig$|^code$|^key$/i

export function pageContext() {
  const url = new URL(location.href)
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) if (SECRET.test(key)) url.searchParams.delete(key)
  return {
    url: url.href,
    title: document.title.trim().slice(0, 200),
    viewport: { width: innerWidth, height: innerHeight },
    dpr: Math.round(devicePixelRatio * 100) / 100,
    browser: browserOf(navigator.userAgent),
    os: osOf(navigator.userAgent, navigator.maxTouchPoints),
    // The browser setting. A page can have its own theme switch.
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? ("dark" as const) : ("light" as const),
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    scroll: { x: Math.max(0, Math.round(scrollX)), y: Math.max(0, Math.round(scrollY)) },
  }
}

export type PageContext = ReturnType<typeof pageContext>
type AddedLater = "theme" | "language" | "timeZone" | "scroll"
/** A saved context. Threads made before a field was added do not have it. */
export type SavedContext = Omit<PageContext, AddedLater> & Partial<Pick<PageContext, AddedLater>>

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/OPR\/(\d+)/, "Opera"],
  [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
  [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
  [/Version\/(\d+).*Safari/, "Safari"],
]

export function browserOf(ua: string) {
  for (const [re, name] of BROWSERS) {
    const version = re.exec(ua)?.[1]
    if (version) return `${name} ${version}`
  }
  return "Other browser"
}

export function osOf(ua: string, touchPoints = 0) {
  if (/iPhone|iPod/.test(ua)) return "iOS"
  // iPadOS says "Macintosh". Only the touch screen tells it apart.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return "iPadOS"
  if (/Android/.test(ua)) return "Android"
  if (/CrOS/.test(ua)) return "ChromeOS"
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS"
  if (/Windows/.test(ua)) return "Windows"
  if (/Linux/.test(ua)) return "Linux"
  return "Other system"
}

/** "1280×800 · Chrome 131 · macOS · 2×" */
export function describeContext(c: SavedContext) {
  return [`${c.viewport.width}×${c.viewport.height}`, c.browser, c.os, c.dpr !== 1 && `${c.dpr}×`]
    .filter(Boolean)
    .join(" · ")
}
