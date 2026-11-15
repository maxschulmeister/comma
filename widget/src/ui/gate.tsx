import { useEffect, useId } from "react"
import { loadFonts } from "@/shadow"
import { SignInForm } from "./sign-in"

/** The page behind the gate: c.js took its content out. comma shows only the sign-in, over the full window. */
export function Gate() {
  const id = useId()
  useEffect(loadFonts, [])
  return (
    <div className="fixed inset-0 grid place-items-center overflow-y-auto bg-muted p-4 text-foreground">
      <section
        aria-labelledby={id}
        className="flex w-full max-w-xs flex-col gap-4 rounded-xl bg-background p-6 shadow-lg ring-1 ring-foreground/10"
      >
        <h1 id={id} className="font-semibold text-base">
          Sign in to see this site
        </h1>
        <SignInForm title={null} />
      </section>
    </div>
  )
}
