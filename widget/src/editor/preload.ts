let editorModule: Promise<typeof import("@/editor/editor")> | null = null

/** Loads the editor chunk. Call it early (comment mode, idle time) so the composer opens fast. */
export function preloadEditor() {
  editorModule ??= import("@/editor/editor").catch((error) => {
    editorModule = null
    throw error
  })
  return editorModule
}
