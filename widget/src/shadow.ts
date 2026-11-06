import css from "./styles.css?inline"

const FONTS = [
  [
    "public-sans-latin-wght-normal.woff2",
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  ],
  [
    "public-sans-latin-ext-wght-normal.woff2",
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  ],
]

// Creates the widget host on <html> with an open shadow root.
// `@font-face` does not work inside a shadow root in Chromium, so it goes into the page document.
export function createShadowHost(assetBase: string) {
  const fontCss = FONTS.map(
    ([file, range]) =>
      `@font-face{font-family:'Public Sans Variable';font-style:normal;font-display:swap;font-weight:100 900;src:url(${new URL(`fonts/${file}`, assetBase)}) format('woff2-variations');unicode-range:${range}}`,
  ).join("")
  const fontStyle = document.createElement("style")
  fontStyle.dataset.comma = "fonts"
  fontStyle.textContent = fontCss
  document.head.append(fontStyle)

  const host = document.createElement("comma-widget")
  host.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647"
  document.documentElement.append(host)
  const shadow = host.attachShadow({ mode: "open" })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  shadow.adoptedStyleSheets = [sheet]

  const root = document.createElement("div")
  root.className = "comma-root"
  // The widget text is English. The page can be in another language.
  root.lang = "en"
  root.dir = "ltr"
  shadow.append(root)
  return { host, shadow, root }
}
