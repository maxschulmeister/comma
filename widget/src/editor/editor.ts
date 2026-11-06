// The composer editor. This module and Tiptap load on demand (a separate chunk).
import { Editor, Extension, type JSONContent, markInputRule, markPasteRule } from "@tiptap/core"
import Bold from "@tiptap/extension-bold"
import Code from "@tiptap/extension-code"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list"
import Mention from "@tiptap/extension-mention"
import Paragraph from "@tiptap/extension-paragraph"
import Strike from "@tiptap/extension-strike"
import Text from "@tiptap/extension-text"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import { PluginKey } from "@tiptap/pm/state"
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion"

export type SuggestionItem = { id: string; label: string; detail?: string; avatar?: string | null }

export type SuggestionState = {
  kind: "mention" | "emoji"
  items: SuggestionItem[]
  index: number
  rect: () => DOMRect | null
  select: (index: number) => void
}

export type EditorOptions = {
  element: HTMLElement
  content?: JSONContent | null
  placeholder: string
  onChange: (editor: Editor) => void
  onSubmit: () => void
  onLink: () => void
  onSuggestion: (state: SuggestionState | null) => void
  searchUsers: (query: string) => Promise<SuggestionItem[]>
  searchEmoji: (query: string) => Promise<SuggestionItem[]>
}

// `~strike~` (one tilde), as in Slack and Figma. `⌘⇧X` as in Figma.
const StrikeOne = Strike.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() }
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(~(?!\s)([^~]+)(?<!\s)~)$/, type: this.type })]
  },
  addPasteRules() {
    return [markPasteRule({ find: /(?:^|\s)(~(?!\s)([^~]+)(?<!\s)~)/g, type: this.type })]
  },
})

// One bridge per suggestion kind: Tiptap calls it, the widget UI renders the list.
function suggestionBridge(kind: SuggestionState["kind"], options: EditorOptions, open: { current: boolean }) {
  return () => {
    let props: SuggestionProps<SuggestionItem> | null = null
    let index = 0
    const publish = () => {
      open.current = !!props && props.items.length > 0
      if (!props || props.items.length === 0) return options.onSuggestion(null)
      const current = props
      options.onSuggestion({
        kind,
        items: current.items,
        index,
        rect: () => current.clientRect?.() ?? null,
        select: (i) => {
          const item = current.items[i]
          if (item) current.command(item)
        },
      })
    }
    return {
      onStart(p: SuggestionProps<SuggestionItem>) {
        props = p
        index = 0
        publish()
      },
      onUpdate(p: SuggestionProps<SuggestionItem>) {
        props = p
        index = Math.min(index, Math.max(0, p.items.length - 1))
        publish()
      },
      onKeyDown({ event }: SuggestionKeyDownProps) {
        if (!props || props.items.length === 0) return false
        const count = props.items.length
        if (event.key === "ArrowDown") index = (index + 1) % count
        else if (event.key === "ArrowUp") index = (index - 1 + count) % count
        else if (event.key === "Enter" || event.key === "Tab") {
          const item = props.items[index]
          if (item) props.command(item)
          return true
        } else if (event.key === "Escape") {
          props = null
          publish()
          return true
        } else return false
        publish()
        return true
      },
      onExit() {
        props = null
        publish()
      },
    }
  }
}

export function createEditor(options: EditorOptions) {
  // While a suggestion list is open, Enter picks an item and does not send.
  const suggestionOpen = { current: false }
  const Keys = Extension.create({
    name: "commaKeys",
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          if (suggestionOpen.current) return false
          options.onSubmit()
          return true
        },
        "Shift-Enter": ({ editor }) =>
          editor.commands.first(({ commands }) => [
            () => commands.splitListItem("listItem"),
            () => commands.splitBlock(),
          ]),
        "Mod-k": () => {
          options.onLink()
          return true
        },
      }
    },
  })

  const EmojiSuggestion = Extension.create({
    name: "emojiSuggestion",
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestionItem>({
          editor: this.editor,
          pluginKey: new PluginKey("emojiSuggestion"),
          char: ":",
          allowSpaces: false,
          items: ({ query }) => (query.length < 2 ? [] : options.searchEmoji(query)),
          command: ({ editor, range, props }) => {
            editor.chain().focus().insertContentAt(range, props.label).run()
          },
          render: suggestionBridge("emoji", options, suggestionOpen),
        }),
      ]
    },
  })

  return new Editor({
    element: options.element,
    injectCSS: false,
    content: options.content ?? undefined,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      StrikeOne,
      Code,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["mailto"],
        isAllowedUri: (url, ctx) =>
          /^(https?:|mailto:)/i.test(url) || (!/^[a-z][a-z0-9+.-]*:/i.test(url) && ctx.defaultValidate(url)),
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      BulletList,
      OrderedList,
      ListItem,
      ListKeymap,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder: options.placeholder }),
      Mention.configure({
        HTMLAttributes: { class: "comma-mention" },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        suggestion: {
          char: "@",
          allowSpaces: true,
          items: ({ query }) => options.searchUsers(query),
          render: suggestionBridge("mention", options, suggestionOpen),
        },
      }),
      EmojiSuggestion,
      Keys,
    ],
    onUpdate: ({ editor }) => options.onChange(editor),
  })
}

export type { Editor, JSONContent }
