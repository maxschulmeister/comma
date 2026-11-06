import { ChatCircleIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { SuggestionState } from "./editor/editor"

function EditorSpike() {
  const ref = useRef<HTMLDivElement>(null)
  const [json, setJson] = useState("")
  const [sent, setSent] = useState(0)
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null)
  useEffect(() => {
    let destroyed = false
    let editor: { destroy(): void } | undefined
    import("./editor/editor").then(({ createEditor }) => {
      if (destroyed || !ref.current) return
      editor = createEditor({
        element: ref.current,
        placeholder: "Add a comment",
        onChange: (e) => setJson(JSON.stringify(e.getJSON())),
        onSubmit: () => setSent((n) => n + 1),
        onLink: () => {},
        onSuggestion: setSuggestion,
        searchUsers: async (q) =>
          [
            { id: "u1", label: "Ada Lovelace" },
            { id: "u2", label: "Alan Turing" },
          ].filter((u) => u.label.toLowerCase().includes(q.toLowerCase())),
        searchEmoji: async (q) =>
          [
            { id: "thumbs_up", label: "👍" },
            { id: "tada", label: "🎉" },
          ].filter((e) => e.id.includes(q)),
      })
    })
    return () => {
      destroyed = true
      editor?.destroy()
    }
  }, [])
  return (
    <div className="w-72 rounded-md border p-2">
      <div ref={ref} className="comma-prose min-h-10 text-sm" data-testid="editor" />
      {suggestion && (
        <ul role="listbox" aria-label="Suggestions">
          {suggestion.items.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === suggestion.index}>
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <output data-testid="json">{json}</output>
      <output data-testid="sent">{sent}</output>
    </div>
  )
}

export function App() {
  const [picked, setPicked] = useState("")
  return (
    <TooltipProvider>
      <div className="fixed right-4 bottom-4 flex flex-col gap-2 rounded-lg bg-background p-2 shadow-md ring-1 ring-foreground/10">
        <EditorSpike />
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger render={<Button size="icon" variant="ghost" aria-label="Comment" />}>
              <ChatCircleIcon />
            </TooltipTrigger>
            <TooltipContent>Comment</TooltipContent>
          </Tooltip>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
            <PopoverContent>
              <Input aria-label="Popover input" placeholder="Type" />
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setPicked("one")}>One</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPicked("two")}>Two</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog>
            <DialogTrigger render={<Button />}>Dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Title</DialogTitle>
                <DialogDescription>Description</DialogDescription>
              </DialogHeader>
              <Input aria-label="Dialog input" />
            </DialogContent>
          </Dialog>
          <output data-testid="picked">{picked}</output>
        </div>
      </div>
    </TooltipProvider>
  )
}
