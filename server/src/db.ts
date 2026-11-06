import { Database } from "bun:sqlite"

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
  resolved_by text references users (id)
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
  uploaded_by text not null references users (id),
  mime text not null,
  size integer not null,
  width integer not null,
  height integer not null,
  data blob not null,
  created_at integer not null
);
create index if not exists files_comment on files (comment_id);

create table if not exists versions (
  project text primary key,
  version integer not null
);
`

export function openDb(path: string) {
  const db = new Database(path, { create: true, strict: true })
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;")
  db.exec(SCHEMA)
  return db
}

export type Db = Database
