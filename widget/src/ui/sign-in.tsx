import { type FormEvent, useId, useState } from "react"
import { signInAsGuest, signInWithPopup } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { useStore } from "@/store"

/** Sign in with the app or Slack (popup), or as a guest with a name. The project decides which ones it has. */
export function SignInForm({ title = "Sign in to comment" }: { title?: string }) {
  const info = useStore((s) => s.projectInfo)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<"guest" | "popup" | "slack" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const run = async (kind: "guest" | "popup" | "slack", action: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError("Enter your name.")
      return
    }
    void run("guest", () => signInAsGuest(name.trim()))
  }

  if (!info) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    )
  }

  const app = info.name ?? "your account"
  const popups = info.popupSignIn || info.slack
  return (
    <form className="flex flex-col gap-2.5" onSubmit={onSubmit} noValidate>
      <p className="font-medium text-sm">{title}</p>
      {info.popupSignIn && (
        <Button type="button" onClick={() => run("popup", () => signInWithPopup("app"))} disabled={!!busy}>
          {busy === "popup" && <Spinner />}
          Sign in with {app}
        </Button>
      )}
      {info.slack && (
        <Button
          type="button"
          variant={info.popupSignIn ? "outline" : "default"}
          onClick={() => run("slack", () => signInWithPopup("slack"))}
          disabled={!!busy}
        >
          {busy === "slack" && <Spinner />}
          Sign in with Slack
        </Button>
      )}
      {popups && info.guests && (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Separator className="flex-1" />
          or
          <Separator className="flex-1" />
        </div>
      )}
      {info.guests && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>Your name</Label>
            <Input
              id={id}
              value={name}
              maxLength={60}
              autoComplete="name"
              autoFocus={!popups}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <Button type="submit" variant={popups ? "outline" : "default"} disabled={!!busy}>
            {busy === "guest" && <Spinner />}
            Continue as guest
          </Button>
        </>
      )}
      {!popups && !info.guests && (
        <p className="text-muted-foreground text-sm">Sign in to {info.name ?? "the app"} to comment.</p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </form>
  )
}
