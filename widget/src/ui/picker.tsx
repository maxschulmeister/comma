// The parts of the pickers in a thread (Assign, Tags): a search field and the choices below it.
import { CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import type { ComponentProps, Ref } from "react"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"

/**
 * The search field. Enter runs `onEnter` with the text in the field, not the state: the state can be one render
 * behind the field (see debounceRendering in main.tsx).
 */
export function PickerSearch({
  label,
  value,
  onChange,
  onEnter,
  ref,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onEnter: (value: string) => void
  ref?: Ref<HTMLInputElement>
}) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <MagnifyingGlassIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={ref}
        type="search"
        autoFocus
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          onEnter(e.currentTarget.value.trim())
        }}
      />
    </InputGroup>
  )
}

/** A choice. A check shows when it is chosen. */
export function PickerOption({
  checked,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { checked: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
      {checked && <CheckIcon className="shrink-0" />}
    </button>
  )
}
