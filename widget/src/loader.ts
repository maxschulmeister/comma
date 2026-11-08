// c.js: the script tag on the page. It must stay small and have no imports.
// It saves the script settings, queues API calls, and loads the widget module.
type Call = [name: string, args: unknown[]]

const script = document.currentScript as HTMLScriptElement | null
if (script && !("comma" in window)) {
  const queue: Call[] = []
  const stub =
    (name: string) =>
    (...args: unknown[]) =>
      void queue.push([name, args])
  Object.assign(window, {
    comma: {
      identify: stub("identify"),
      signOut: stub("signOut"),
      __queue: queue,
      __script: { src: script.src, project: script.dataset.project ?? "", shortcut: script.dataset.shortcut },
    },
  })
  import(/* @vite-ignore */ new URL("w/main.js", script.src).href)
}
