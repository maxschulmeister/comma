// Image type and size from the file content. The file name and the browser's type are not trusted.

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export type ImageInfo = { mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; width: number; height: number }

const ascii = (b: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...b.subarray(start, start + length))

export function readImage(b: Uint8Array): ImageInfo | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length >= 24 && ascii(b, 1, 3) === "PNG" && b[0] === 0x89 && ascii(b, 12, 4) === "IHDR") {
    return { mime: "image/png", width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) {
    return { mime: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4)
    if (chunk === "VP8 " && b.length >= 30) {
      return { mime: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (chunk === "VP8L" && b.length >= 25) {
      const bits = view.getUint32(21, true)
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === "VP8X" && b.length >= 30) {
      const w = (b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16)
      const h = (b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16)
      return { mime: "image/webp", width: w + 1, height: h + 1 }
    }
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the segments to the frame header (SOFn).
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1] ?? 0
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const length = view.getUint16(i + 2)
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return { mime: "image/jpeg", width: view.getUint16(i + 7), height: view.getUint16(i + 5) }
      i += 2 + length
    }
    return null
  }
  return null
}
