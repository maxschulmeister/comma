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
  const project = script.dataset.project ?? ""

  // The project's `gate`: only people who are signed in see the page. Search engines must not index it. A person who
  // is not signed in sees only comma: the page is hidden, and its content goes out of the document. After sign-in,
  // the page loads again (see main.tsx). `signedIn`: the same check as loadSession in client.ts.
  const gate = (signedIn: boolean) => {
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex, nofollow"
    document.head.append(meta)
    if (signedIn) return
    // <comma-widget> sets `all: initial`, so it stays visible.
    const style = document.createElement("style")
    style.textContent = "html{visibility:hidden!important}"
    document.head.append(style)
    const clear = () => {
      const body = document.body
      body.replaceChildren()
      // The page's scripts can add content later.
      new MutationObserver(() => body.replaceChildren()).observe(body, { childList: true })
    }
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", clear, { once: true })
    else clear()
  }
  // `data-gate`: here, before the page shows. Without it, the widget closes the gate when it knows the project.
  if ("gate" in script.dataset) {
    let signedIn = false
    try {
      const session = JSON.parse(localStorage.getItem(`comma:${new URL(script.src).origin}:${project}`) ?? "null")
      signedIn = typeof session?.token === "string" && !!session.user?.id
    } catch {} // Storage can be blocked.
    gate(signedIn)
  }

  Object.assign(window, {
    comma: {
      identify: stub("identify"),
      signOut: stub("signOut"),
      __queue: queue,
      __gate: gate,
      __script: {
        src: script.src,
        project,
        shortcut: script.dataset.shortcut,
        tokenFrom: script.dataset.tokenFrom,
        gate: "gate" in script.dataset,
      },
    },
  })

  // `data-token-from`: the app's own requests to this address carry its token (Authorization: Bearer). comma reads
  // it, and never changes a request. Here, so it sees the app's first requests. The widget decides what to do.
  const from = script.dataset.tokenFrom
  if (from) {
    const origin = new URL(from, location.href).origin
    let last: string | null | undefined
    // `data-token-key`: where the app keeps its token (localStorage or sessionStorage). The app signs out by removing
    // it, often with no request after it: comma signs out at once, also when it is gone at page load.
    const key = script.dataset.tokenKey
    if (key) {
      const gone = () => {
        last = undefined
        queue.push(["appSignedOut", []])
      }
      const has = () => {
        try {
          return localStorage.getItem(key) !== null || sessionStorage.getItem(key) !== null
        } catch {
          return true // Storage is blocked: no way to know.
        }
      }
      if (!has()) gone()
      const storage = Storage.prototype
      const { removeItem, clear } = storage
      storage.removeItem = function (this: Storage, name: string) {
        removeItem.call(this, name)
        if (name === key && !has()) gone()
      }
      storage.clear = function (this: Storage) {
        clear.call(this)
        if (!has()) gone()
      }
      // Another tab of the app signed out.
      addEventListener("storage", (event) => {
        if ((event.key === key || event.key === null) && !has()) gone()
      })
    }
    const seen = (url: string | URL, auth: string | null) => {
      if (new URL(url, location.href).origin !== origin) return
      const token = /^Bearer\s+(\S+)$/i.exec(auth ?? "")?.[1] ?? null
      if (token === last) return
      last = token
      queue.push(["token", [token]])
    }
    const pageFetch = window.fetch
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      try {
        const [input, init] = args
        const request = input instanceof Request ? input : null
        seen(request?.url ?? String(input), new Headers(init?.headers ?? request?.headers).get("authorization"))
      } catch {}
      return pageFetch.apply(this, args)
    }
    const xhr = XMLHttpRequest.prototype
    const { open, setRequestHeader, send } = xhr
    const requests = new WeakMap<XMLHttpRequest, { url: string | URL; auth: string | null }>()
    // open() has two forms: (method, url) and (method, url, async, user, password).
    xhr.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      requests.set(this, { url: args[1] as string | URL, auth: null })
      return (open as (...a: unknown[]) => void).apply(this, args)
    }
    xhr.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      const request = requests.get(this)
      if (request && name.toLowerCase() === "authorization") request.auth = value
      return setRequestHeader.call(this, name, value)
    }
    xhr.send = function (this: XMLHttpRequest, ...args: [Document | XMLHttpRequestBodyInit | null | undefined]) {
      const request = requests.get(this)
      try {
        if (request) seen(request.url, request.auth)
      } catch {}
      return send.apply(this, args)
    }
  }

  import(/* @vite-ignore */ new URL("w/main.js", script.src).href)
}
