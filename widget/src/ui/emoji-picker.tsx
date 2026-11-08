// The emoji picker. A separate chunk: it loads on first open.
import { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch } from "@/components/ui/emoji-picker"
import { emojiBaseUrl } from "./emoji"

export default function Picker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <EmojiPicker className="h-80 w-72" emojibaseUrl={emojiBaseUrl()} onEmojiSelect={(e) => onSelect(e.emoji)}>
      <EmojiPickerSearch aria-label="Search emoji" placeholder="Search emoji" autoFocus />
      <EmojiPickerContent />
      <EmojiPickerFooter />
    </EmojiPicker>
  )
}
