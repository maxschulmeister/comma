// Fixed-window counters in the database, so all server instances (serverless) share them.
import { type Db, get } from "./db"

/** Records a hit for the key. Returns false if the key has reached `max` in the current window. */
export async function takeLimit(db: Db, key: string, max: number, windowMs: number, now: number) {
  // One statement: a new window starts at 1, else the count grows. Atomic, also with many instances.
  const row = await get<{ count: number }>(
    db,
    `insert into limits (key, window_start, count) values (?, ?, 1)
     on conflict (key) do update set
       count = case when window_start <= ? then 1 else count + 1 end,
       window_start = case when window_start <= ? then excluded.window_start else window_start end
     returning count`,
    key,
    now,
    now - windowMs,
    now - windowMs,
  )
  return (row?.count ?? 1) <= max
}
