// The database: SQLite through libSQL. A local file, or a remote database (Turso, own sqld).
// Entry files make the client: `@libsql/client` (also files) or `@libsql/client/web` (remote only, no native code).
// Do not use `transaction()`: on `:memory:` it opens a new, empty database. Use `batch`: one round trip, atomic.
import type { Client, InStatement, InValue } from "@libsql/client"

export type Db = Client

const SCHEMA = `
create table if not exists users (
  id text primary key,
  project text not null,
  kind text not null check (kind in ('guest', 'app')),
  external_id text,
  name text not null,
  email text,
  avatar_url text,
  is_admin integer not null default 0,
  reads_version integer not null default 0,
  created_at integer not null
);
create unique index if not exists users_external on users (project, external_id) where kind = 'app';

create table if not exists threads (
  id text primary key,
  project text not null,
  page text not null,
  anchor text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by text not null references users (id),
  created_at integer not null,
  updated_at integer not null,
  resolved_at integer,
  resolved_by text references users (id),
  context text,
  assignee_id text references users (id),
  site text
);
create index if not exists threads_project on threads (project, updated_at);

create table if not exists comments (
  id text primary key,
  thread_id text not null references threads (id) on delete cascade,
  author_id text not null references users (id),
  body text not null,
  text text not null,
  created_at integer not null,
  edited_at integer
);
create index if not exists comments_thread on comments (thread_id, created_at);

create table if not exists mentions (
  comment_id text not null references comments (id) on delete cascade,
  user_id text not null references users (id),
  primary key (comment_id, user_id)
);

create table if not exists reactions (
  comment_id text not null references comments (id) on delete cascade,
  user_id text not null references users (id),
  emoji text not null,
  created_at integer not null,
  primary key (comment_id, user_id, emoji)
);

create table if not exists reads (
  user_id text not null references users (id),
  thread_id text not null references threads (id) on delete cascade,
  read_at integer not null,
  unread integer not null default 0,
  primary key (user_id, thread_id)
);

create table if not exists files (
  id text primary key,
  project text not null,
  comment_id text references comments (id) on delete cascade,
  -- Set on the screenshot of a thread's element. comment_id stays null.
  thread_id text references threads (id) on delete cascade,
  uploaded_by text not null references users (id),
  mime text not null,
  size integer not null,
  width integer not null,
  height integer not null,
  data blob not null,
  created_at integer not null
);
create index if not exists files_comment on files (comment_id);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users (id),
  created_at integer not null,
  expires_at integer not null
);
create index if not exists sessions_expires on sessions (expires_at);

create table if not exists limits (
  key text primary key,
  window_start integer not null,
  count integer not null
);

create table if not exists versions (
  project text primary key,
  version integer not null
);

-- Tags on threads, by key (see tags.ts).
create table if not exists thread_tags (
  thread_id text not null references threads (id) on delete cascade,
  key text not null,
  created_at integer not null,
  primary key (thread_id, key)
);

-- A coding agent asks to connect (see agent.ts). A person allows it in the widget: then user_id is set.
create table if not exists agent_connects (
  -- Shown to the person and the agent, so the person can see that the request is from their agent.
  code text primary key,
  -- Only the agent knows it. It gets the token with it.
  secret text not null unique,
  project text not null,
  -- The host that the agent asked for. When the person allows: the host where they allowed.
  site text,
  user_id text references users (id),
  session_id text,
  created_at integer not null,
  expires_at integer not null
);
`

/** Makes the tables. Files also get WAL and foreign keys. Remote databases may not keep pragmas, so the app
 * deletes child rows itself and does not use `on delete cascade`. */
export async function migrate(db: Db, local: boolean) {
  if (local)
    await db.executeMultiple("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;")
  await db.executeMultiple(SCHEMA)
  // Columns added after the first release. `create table if not exists` does not add them to an old table.
  for (const [table, name, type] of ADDED_COLUMNS) {
    const columns = await db.execute(`select name from pragma_table_info('${table}')`)
    if (!columns.rows.some((r) => r.name === name)) await db.execute(`alter table ${table} add column ${name} ${type}`)
  }
  return db
}

const ADDED_COLUMNS = [
  ["threads", "context", "text"],
  ["threads", "assignee_id", "text references users (id)"],
  // The host the thread was made on. Projects with scope `origin` show each host its own threads.
  ["threads", "site", "text"],
  ["files", "thread_id", "text references threads (id)"],
] as const

export const sql = (text: string, ...args: InValue[]): InStatement => ({ sql: text, args })

export async function all<T>(db: Db, text: string, ...args: InValue[]) {
  return (await db.execute({ sql: text, args })).rows as unknown as T[]
}

export async function get<T>(db: Db, text: string, ...args: InValue[]) {
  return (await all<T>(db, text, ...args))[0]
}

/** Runs a write. Returns the number of changed rows. */
export async function run(db: Db, text: string, ...args: InValue[]) {
  return (await db.execute({ sql: text, args })).rowsAffected
}
