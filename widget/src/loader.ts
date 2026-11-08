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

  // `data-token-from`: the app's own requests to this address carry its token (Authorization: Bearer). comma reads
  // it, and never changes a request. Here, so it sees the app's first requests. The widget decides what to do.
  const from = script.dataset.tokenFrom
  if (from) {
    const origin = new URL(from, location.href).origin
    let last: string | null | undefined
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
