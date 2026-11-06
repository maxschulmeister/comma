import { type FormEvent, useId, useState } from "react"
import { signInAsGuest, signInWithPopup } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { useStore } from "@/store"

/** Sign in with the app (popup), or as a guest with a name. */
export function SignInForm({ title = "Sign in to comment" }: { title?: string }) {
  const popupSignIn = useStore((s) => s.popupSignIn)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<"guest" | "popup" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const run = async (kind: "guest" | "popup", action: () => Promise<void>) => {
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

  return (
    <form className="flex flex-col gap-2.5" onSubmit={onSubmit} noValidate>
      <p className="font-medium text-sm">{title}</p>
      {popupSignIn && (
        <>
          <Button type="button" onClick={() => run("popup", signInWithPopup)} disabled={!!busy}>
            {busy === "popup" && <Spinner />}
            Sign in
          </Button>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Your name</Label>
        <Input
          id={id}
          value={name}
          maxLength={60}
          autoComplete="name"
          autoFocus={!popupSignIn}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </div>
      <Button type="submit" variant={popupSignIn ? "outline" : "default"} disabled={!!busy}>
        {busy === "guest" && <Spinner />}
        Continue as guest
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </form>
  )
}
