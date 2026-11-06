// Makes large images smaller before the upload: less to send and to store.
// The server accepts up to 4 MB. This fits the request limits of AWS Lambda and Vercel.

const MAX_BYTES = 4 * 1024 * 1024
const MAX_SIDE = 2560
const QUALITY = 0.85

/**
 * The file to upload: the same file if it is small enough, else a smaller copy (long side ≤ 2560 px).
 * GIFs stay as they are, so animation stays. Throws an error with a short message for the user.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.type === "image/gif") {
    if (file.size > MAX_BYTES) throw new Error("Over 4 MB")
    return file
  }
  // An <img> and not createImageBitmap: Chromium's createImageBitmap cannot decode some PNGs that <img> shows.
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.src = url
  await img
    .decode()
    .catch(() => {
      throw new Error("Cannot read the image")
    })
    .finally(() => URL.revokeObjectURL(url))
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  if (scale === 1 && file.size <= MAX_BYTES) return file
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  // Halve in steps first: one large step skips pixels, and text in screenshots gets jagged.
  let source: CanvasImageSource = img
  let w = img.naturalWidth
  let h = img.naturalHeight
  while (w / 2 >= width) {
    w = Math.round(w / 2)
    h = Math.round(h / 2)
    source = draw(source, w, h)
  }
  const canvas = draw(source, width, height)
  const blob = await encode(canvas, file.type)
  if (blob.size > MAX_BYTES) throw new Error("Over 4 MB")
  const name = file.name.replace(/\.[^.]*$/, "") || "image"
  return new File([blob], `${name}.${blob.type.slice("image/".length)}`, { type: blob.type })
}

function draw(source: CanvasImageSource, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

// WebP. Browsers that cannot encode WebP (Safari) give PNG. Then JPEG for photos, and PNG for the rest
// (transparency) if it is not too large.
async function encode(canvas: OffscreenCanvas, type: string) {
  const webp = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY })
  if (webp.type === "image/webp" || (type !== "image/jpeg" && webp.size <= MAX_BYTES)) return webp
  return canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY })
}
