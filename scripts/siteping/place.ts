// SitePing's region, in fractions of the element box, as comma's pin (a click) or region (a drag), in %.
type Fractions = { x: number; y: number; width: number; height: number }

const percent = (n: number) => Math.round(n * 10_000) / 100

export function placeOf(r: Fractions) {
  return r.width === 0 && r.height === 0
    ? { point: { x: percent(r.x), y: percent(r.y) } }
    : { rect: { x: percent(r.x), y: percent(r.y), width: percent(r.width), height: percent(r.height) } }
}
