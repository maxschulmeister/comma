import { ArrowUpIcon, AtIcon, ImageIcon, LinkIcon, XIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { type DragEvent, useEffect, useId, useRef, useState } from "react"
import { searchUsers, uploadFile } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { Editor, EditorOptions, JSONContent, SuggestionState } from "@/editor/editor"
import { initials, userColor } from "@/lib/format"
import { useStore } from "@/store"
import type { FileRef } from "@/types"
import { EmojiButton, searchEmoji } from "./emoji"

const MAX_FILES = 5
const MAX_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

let editorModule: Promise<typeof import("@/editor/editor")> | null = null

/** Loads the editor chunk. Call it early (comment mode, idle time) so the composer opens fast. */
export function preloadEditor() {
  editorModule ??= import("@/editor/editor").catch((error) => {
    editorModule = null
    throw error
  })
  return editorModule
}

// An upload keeps its request, so a draft that opens again still gets the result.
type Upload = { key: string; preview: string; ref?: FileRef; error?: string; request?: Promise<FileRef> }

// Drafts stay when the popover closes. Key: "<user id>:new", "<user id>:reply:<thread id>".
// The user id keeps one person's draft from another person who signs in on the same page.
const drafts = new Map<string, { json: JSONContent; uploads: Upload[] }>()

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

// Removes empty paragraphs at the start and end.
function trimDoc(doc: JSONContent): JSONContent {
  const content = [...(doc.content ?? [])]
  const empty = (n: JSONContent | undefined) => n?.type === "paragraph" && !n.content?.length
  while (content.length > 1 && empty(content.at(-1))) content.pop()
  while (content.length > 1 && empty(content[0])) content.shift()
  return { ...doc, content }
}

type Props = {
  draftKey: string
  initial?: JSONContent
  placeholder: string
  label: string
  submitLabel: string
  allowFiles?: boolean
  autoFocus?: boolean
  onSubmit: (body: JSONContent, files: string[]) => Promise<unknown>
  onCancel?: () => void
}

export function Composer({
  draftKey,
  initial,
  placeholder,
  label,
  submitLabel,
  allowFiles = true,
  autoFocus = true,
  onSubmit,
  onCancel,
}: Props) {
  const userId = useStore((s) => s.session?.user.id ?? "")
  const key = useRef(`${userId}:${draftKey}`).current
  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)
  const [empty, setEmpty] = useState(true)
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [uploads, setUploads] = useState<Upload[]>(() => drafts.get(key)?.uploads ?? [])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads
  const listId = useId()

  // The focus stays in the text while arrow keys move in the suggestion list. Tell screen readers the option.
  useEffect(() => {
    const dom = editorRef.current?.view.dom
    if (!dom) return
    const attrs: Record<string, string | null> = suggestion
      ? {
          "aria-autocomplete": "list",
          "aria-expanded": "true",
          "aria-controls": listId,
          "aria-activedescendant": `${listId}-${suggestion.index}`,
        }
      : { "aria-autocomplete": null, "aria-expanded": null, "aria-controls": null, "aria-activedescendant": null }
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null) dom.removeAttribute(name)
      else dom.setAttribute(name, value)
    }
  }, [suggestion, listId])

  const track = (upload: Upload) =>
    upload.request?.then(
      (ref) => setUploads((list) => list.map((u) => (u.key === upload.key ? { ...u, ref } : u))),
      (e: Error) => setUploads((list) => list.map((u) => (u.key === upload.key ? { ...u, error: e.message } : u))),
    )

  // While it sends, nothing changes the comment: the server gets what was there when the user sent it.
  const sendingRef = useRef(false)
  sendingRef.current = sending

  const addFiles = (files: File[]) => {
    if (sendingRef.current) return
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type))
    if (images.length === 0) return
    const room = MAX_FILES - uploadsRef.current.length
    if (room <= 0 || images.length > room) setError(`You can add up to ${MAX_FILES} images.`)
    for (const file of images.slice(0, Math.max(0, room))) {
      const upload: Upload = { key: crypto.randomUUID(), preview: URL.createObjectURL(file) }
      if (file.size > MAX_BYTES) upload.error = "Over 5 MB"
      else upload.request = uploadFile(file)
      setUploads((list) => [...list, upload])
      track(upload)
    }
  }

  const submitRef = useRef<() => void>(() => {})
  submitRef.current = async () => {
    const editor = editorRef.current
    if (!editor || sending) return
    const current = uploadsRef.current
    if (current.some((u) => !u.ref && !u.error)) {
      setError("Wait for the images to upload.")
      return
    }
    const files = current.flatMap((u) => (u.ref ? [u.ref.id] : []))
    if (editor.isEmpty && files.length === 0) return
    setSending(true)
    sendingRef.current = true
    setLinkOpen(false)
    setSuggestion(null)
    setError(null)
    // No typing while it sends: the text is cleared when the server has it.
    editor.setEditable(false)
    try {
      await onSubmit(editor.isEmpty ? EMPTY_DOC : trimDoc(editor.getJSON()), files)
      drafts.delete(key)
      if (!editor.isDestroyed) editor.commands.clearContent(true)
      setUploads([])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send. Try again.")
    } finally {
      if (!editor.isDestroyed) {
        editor.setEditable(true)
        editor.commands.focus()
      }
      setSending(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor is created once per composer.
  useEffect(() => {
    let destroyed = false
    preloadEditor().then(
      ({ createEditor }) => {
        if (destroyed || !mountRef.current) return
        const options: EditorOptions = {
          element: mountRef.current,
          content: drafts.get(key)?.json ?? initial ?? null,
          placeholder,
          label,
          onChange: (editor) => {
            setEmpty(editor.isEmpty)
            setError(null)
          },
          onSubmit: () => submitRef.current(),
          onLink: () => setLinkOpen(true),
          onSuggestion: setSuggestion,
          searchUsers: async (q) =>
            (await searchUsers(q)).map((u) => ({ id: u.id, label: u.name, avatar: u.avatarUrl })),
          searchEmoji,
          onFiles: (files) => {
            if (sendingRef.current) return true
            if (!allowFiles || !files.some((f) => IMAGE_TYPES.includes(f.type))) return false
            addFiles(files)
            return true
          },
        }
        const editor = createEditor(options)
        editorRef.current = editor
        setEmpty(editor.isEmpty)
        setReady(true)
        for (const upload of uploadsRef.current) if (!upload.ref && !upload.error) track(upload)
        if (autoFocus) editor.commands.focus("end")
      },
      () => setError("Could not load the editor. Check your connection and try again."),
    )
    return () => {
      destroyed = true
      const editor = editorRef.current
      if (editor) {
        // Editing a comment keeps no draft.
        if (!initial) {
          if (!editor.isEmpty || uploadsRef.current.length > 0) {
            drafts.set(key, { json: editor.getJSON(), uploads: uploadsRef.current })
          } else drafts.delete(key)
        }
        editor.destroy()
      }
      editorRef.current = null
    }
  }, [])

  const onDrop = (event: DragEvent) => {
    if (!allowFiles) return
    const files = Array.from(event.dataTransfer?.files ?? [])
    // The text handles drops on itself (see onFiles).
    if (files.length === 0 || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    addFiles(files)
  }

  const canSend = ready && !sending && (!empty || uploads.some((u) => u.ref))

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for images; the image button does the same.
    <div
      className="flex flex-col gap-1.5"
      onDragOver={(e) => allowFiles && e.preventDefault()}
      onDrop={onDrop}
      data-slot="composer"
    >
      <div className="relative rounded-md border border-input bg-background px-2 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <div ref={mountRef} className="comma-prose max-h-48 min-h-[18px] overflow-y-auto text-xs/relaxed" />
        {!ready && <p className="text-muted-foreground text-xs/relaxed">{placeholder}</p>}
      </div>

      {suggestion && !sending && <SuggestionList state={suggestion} id={listId} />}

      {linkOpen && editorRef.current && <LinkInput editor={editorRef.current} onClose={() => setLinkOpen(false)} />}

      {uploads.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Images">
          {uploads.map((u) => (
            <li
              key={u.key}
              data-state={u.error ? "error" : u.ref ? "done" : "uploading"}
              className="relative size-14 overflow-hidden rounded-md border bg-muted"
            >
              <img src={u.preview} alt="" className={cn("size-full object-cover", !u.ref && "opacity-50")} />
              {!u.ref && !u.error && <Spinner className="absolute inset-0 m-auto" />}
              {u.error && (
                <span className="absolute inset-x-0 bottom-0 bg-destructive/90 px-0.5 text-center text-[9px] text-white">
                  {u.error}
                </span>
              )}
              <Button
                type="button"
                size="icon-xs"
                variant="secondary"
                className="absolute top-0.5 right-0.5"
                aria-label="Remove image"
                disabled={sending}
                onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      <div className="flex items-center gap-0.5">
        <EmojiButton
          disabled={sending}
          onSelect={(emoji) => editorRef.current?.chain().insertContent(emoji).run()}
          returnFocus={() => editorRef.current?.view.dom as HTMLElement | undefined}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Mention someone"
          title="Mention someone"
          disabled={!ready || sending}
          onClick={() => editorRef.current?.chain().focus().insertContent(" @").run()}
        >
          <AtIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Add link"
          title="Add link"
          disabled={!ready || sending}
          onClick={() => setLinkOpen(true)}
        >
          <LinkIcon />
        </Button>
        {allowFiles && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Add image"
              title="Add image"
              disabled={uploads.length >= MAX_FILES || sending}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.currentTarget.files ?? []))
                e.currentTarget.value = ""
              }}
            />
          </>
        )}
        <span className="flex-1" />
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="icon-sm"
          aria-label={submitLabel}
          title={`${submitLabel} (Enter)`}
          disabled={!canSend}
          onClick={() => submitRef.current()}
        >
          {sending ? <Spinner /> : <ArrowUpIcon weight="bold" />}
        </Button>
      </div>
    </div>
  )
}

function SuggestionList({ state, id }: { state: SuggestionState; id: string }) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label={state.kind === "mention" ? "People" : "Emoji"}
      className="max-h-48 overflow-y-auto rounded-md bg-popover p-1 shadow-md ring-1 ring-foreground/10"
    >
      {state.items.map((item, i) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys and Enter in the text pick options (aria-activedescendant).
        <div
          key={item.id}
          id={`${id}-${i}`}
          role="option"
          tabIndex={-1}
          aria-selected={i === state.index}
          // Keep the focus in the editor.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => state.select(i)}
          className="flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs aria-selected:bg-accent aria-selected:text-accent-foreground"
        >
          {state.kind === "mention" ? (
            <span
              className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-medium text-white"
              style={{ backgroundColor: userColor(item.id) }}
            >
              {item.avatar ? <img src={item.avatar} alt="" className="size-full object-cover" /> : initials(item.label)}
            </span>
          ) : (
            <span className="text-base leading-none">{item.label}</span>
          )}
          <span className="truncate">{state.kind === "mention" ? item.label : item.detail}</span>
        </div>
      ))}
    </div>
  )
}

function LinkInput({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = editor.getAttributes("link").href as string | undefined
  const [value, setValue] = useState(current ?? "")
  // Move the focus to the text before the input unmounts, so the focus does not go to the popover.
  const close = () => {
    editor.view.focus()
    onClose()
  }
  const apply = () => {
    let href = value.trim()
    if (href && !/^(https?:|mailto:)/i.test(href)) href = `https://${href}`
    const chain = editor.chain().extendMarkRange("link")
    if (!href) chain.unsetLink().run()
    else if (editor.state.selection.empty && !current) {
      chain.insertContent({ type: "text", text: value.trim(), marks: [{ type: "link", attrs: { href } }] }).run()
    } else chain.setLink({ href }).run()
    close()
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        aria-label="Link address"
        placeholder="Paste a link"
        value={value}
        className="h-7"
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            apply()
          } else if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            close()
          }
        }}
      />
      <Button type="button" size="sm" variant="outline" onClick={apply}>
        {value.trim() ? "Add" : "Remove"}
      </Button>
    </div>
  )
}
