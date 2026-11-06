import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin as PostcssPlugin, Rule } from "postcss"
import { defineConfig, type Plugin } from "vite"

// Base UI and shadcn components are React code. Run them on Preact.
// `react/jsx-runtime` → `preact/compat/jsx-runtime`, `react-dom/client` → `preact/compat/client`.
const preactCompat = [
  { find: /^react-dom(?=\/|$)/, replacement: "preact/compat" },
  { find: /^react(?=\/|$)/, replacement: "preact/compat" },
]

// Makes Tailwind CSS work inside a shadow root:
// - `rem` → `px`, because the page can change the root font size.
// - `:root` → `:host`.
// - `@property` does not work in a shadow root: replace it with initial values.
function shadowCss(): PostcssPlugin {
  return {
    postcssPlugin: "comma-shadow-css",
    OnceExit(root, { rule, decl, atRule }) {
      const initial: Rule = rule({ selector: ":host, *, ::before, ::after, ::backdrop" })
      root.walkAtRules("property", (at) => {
        let value: string | undefined
        let syntax = ""
        at.walkDecls((d) => {
          if (d.prop === "initial-value") value = d.value
          if (d.prop === "syntax") syntax = d.value
        })
        // A registered <length> can be `0`. Unregistered, `0` is a number and breaks `calc(1px + var(--x))`.
        if (value === "0" && syntax.includes("<length")) value = "0px"
        initial.append(decl({ prop: at.params, value: value ?? "initial" }))
        at.remove()
      })
      // In the lowest layer, so utilities that set these variables win.
      if (initial.nodes.length > 0) root.prepend(atRule({ name: "layer", params: "properties", nodes: [initial] }))
      root.walkRules((r) => {
        r.selectors = r.selectors.map((s) => s.replace(/:root\b/g, ":host"))
        r.selectors = [...new Set(r.selectors)]
      })
      root.walkDecls((d) => {
        d.value = d.value.replace(/(-?\d*\.?\d+)rem\b/g, (_, n: string) => `${+(Number(n) * 16).toFixed(3)}px`)
      })
    },
  }
}

const fonts = ["instrument-sans-latin-wght-normal.woff2", "instrument-sans-latin-ext-wght-normal.woff2"]

const fromModules = (path: string) => readFileSync(resolve(import.meta.dirname, "node_modules", path))

// Static files the widget loads from the comma server: fonts, and emoji data for the picker and `:name:`.
function emitStatic(): Plugin {
  return {
    name: "comma-static",
    generateBundle() {
      for (const name of fonts) {
        this.emitFile({
          type: "asset",
          fileName: `fonts/${name}`,
          source: fromModules(`@fontsource-variable/instrument-sans/files/${name}`),
        })
      }
      for (const name of ["data.json", "messages.json", "shortcodes/iamcal.json"]) {
        this.emitFile({ type: "asset", fileName: `emoji/en/${name}`, source: fromModules(`emojibase-data/en/${name}`) })
      }
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), emitStatic()],
  css: { postcss: { plugins: [shadowCss()] } },
  resolve: {
    alias: [{ find: "@", replacement: resolve(import.meta.dirname, "./src") }, ...preactCompat],
    dedupe: ["preact"],
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: { c: resolve(import.meta.dirname, "src/loader.ts"), main: resolve(import.meta.dirname, "src/main.tsx") },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
      preserveEntrySignatures: false,
      onwarn(warning, warn) {
        // Base UI files start with "use client". It means nothing here.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return
        warn(warning)
      },
    },
  },
})
