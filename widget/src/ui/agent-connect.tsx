// A coding agent asks to work on the comments as the person: it opened this site with #comma-connect=<code> (through
// comma's /connect page). The person checks the code that the agent shows, and allows it or not.
// A chunk of its own: only that link loads it.
import { useState } from "react"
import { answerAgent } from "@/client"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { setState, useStore } from "@/store"
import { notify } from "./notices"
import { SignInForm } from "./sign-in"

export function AgentConnect({ code }: { code: string }) {
  const me = useStore((s) => s.session?.user)
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const close = () => setState({ agentCode: null })

  const answer = async (allow: boolean) => {
    setBusy(allow ? "allow" : "deny")
    setError(null)
    try {
      await answerAgent(code, allow)
      close()
      notify(allow ? "Agent connected" : "Agent not allowed")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the answer. Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow your agent?</AlertDialogTitle>
          <AlertDialogDescription>
            {me
              ? `A coding agent asks to work on the comments as ${me.name}: read, reply, comment, resolve, tag and assign. Allow it only if you started it and it shows this code.`
              : "A coding agent asks to read the comments. Sign in to answer."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-center font-medium font-mono text-xl tracking-widest">{code}</p>
        {!me && <SignInForm title={null} />}
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          {me ? (
            <>
              <Button variant="outline" disabled={!!busy} onClick={() => void answer(false)}>
                {busy === "deny" && <Spinner />}
                Don't allow
              </Button>
              <Button disabled={!!busy} onClick={() => void answer(true)}>
                {busy === "allow" && <Spinner />}
                Allow
              </Button>
            </>
          ) : (
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
