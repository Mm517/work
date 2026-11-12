-- Kitchenly Work: project files per workspace room

create table if not exists public.files (
  id         uuid primary key default gen_random_uuid(),
  room       text not null,
  path       text not null,
  content    text not null default '',
  updated_at timestamptz not null default now(),
  unique (room, path)
);

create index if not exists files_room_idx on public.files (room);

alter table public.files enable row level security;

-- MVP ONLY: anyone holding the anon key can read/write any room.
-- Before real use, replace with Supabase Auth + a room_members table.
create policy "mvp read"   on public.files for select to anon using (true);
create policy "mvp insert" on public.files for insert to anon with check (true);
create policy "mvp update" on public.files for update to anon using (true) with check (true);
create policy "mvp delete" on public.files for delete to anon using (true);

-- live file-tree updates
alter publication supabase_realtime add table public.files;
