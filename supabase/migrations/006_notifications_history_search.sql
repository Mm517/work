-- Kitchenly Work 006: stored notifications, file snapshots (history), file search

-- ---------------------------------------------------------- notifications
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,      -- recipient
  from_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('ask', 'invite')),
  body         text not null default '' check (char_length(body) <= 1000),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, room_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
-- recipients may only flip read_at; nothing else is updatable
revoke update on public.notifications from authenticated;
grant  update (read_at) on public.notifications to authenticated;

create policy "notifications read" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications insert" on public.notifications for insert to authenticated
  with check (
    from_user_id = auth.uid()
    and user_id <> auth.uid()
    and public.is_room_member(room_id)
    and public.is_user_in_room(room_id, user_id)
  );
create policy "notifications update" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications delete" on public.notifications for delete to authenticated
  using (user_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------- snapshots
create table if not exists public.file_snapshots (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  file_id    uuid not null references public.files (id) on delete cascade,
  content    text not null,
  label      text check (label is null or char_length(label) <= 100),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists file_snapshots_file_idx on public.file_snapshots (file_id, created_at desc);

alter table public.file_snapshots enable row level security;
revoke all on public.file_snapshots from anon;

create policy "snapshots read" on public.file_snapshots for select to authenticated
  using (public.is_room_member(room_id));
create policy "snapshots insert" on public.file_snapshots for insert to authenticated
  with check (
    public.is_room_member(room_id)
    and created_by = auth.uid()
    and exists (select 1 from public.files f where f.id = file_id and f.room_id = file_snapshots.room_id)
  );
-- no update/delete: history is append-only (pruned by the trigger below)

-- automatic checkpoint: when a file changes and its newest snapshot is >5 min old; keep the last 50
create or replace function public.files_auto_snapshot()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.content is distinct from old.content and new.room_id is not null then
    if not exists (
      select 1 from public.file_snapshots s
      where s.file_id = new.id and s.created_at > now() - interval '5 minutes'
    ) then
      insert into public.file_snapshots (room_id, file_id, content, label, created_by)
      values (new.room_id, new.id, new.content, 'auto', auth.uid());
      delete from public.file_snapshots
      where file_id = new.id
        and id not in (
          select id from public.file_snapshots where file_id = new.id order by created_at desc limit 50
        );
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists files_auto_snapshot_trg on public.files;
create trigger files_auto_snapshot_trg
  after update on public.files
  for each row execute function public.files_auto_snapshot();

-- ---------------------------------------------------------------- search
-- SECURITY INVOKER: RLS on files limits results to the caller's rooms.
create or replace function public.search_files(p_room uuid, p_q text)
returns table (path text, line_no int, snippet text)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    select '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  ),
  by_path as (
    select f.path, 0 as line_no, ''::text as snippet
    from public.files f, q
    where f.room_id = p_room and char_length(trim(p_q)) >= 2 and f.path ilike q.pat
    limit 50
  ),
  by_content as (
    select f.path, l.n::int as line_no, left(l.line, 200) as snippet
    from public.files f
    cross join q
    cross join lateral (
      select t.line, t.n
      from unnest(string_to_array(f.content, E'\n')) with ordinality as t(line, n)
      where t.line ilike q.pat
      order by t.n
      limit 3
    ) l
    where f.room_id = p_room and char_length(trim(p_q)) >= 2
    limit 150
  )
  select * from by_path
  union all
  select * from by_content;
$$;
revoke execute on function public.search_files(uuid, text) from public, anon;
grant  execute on function public.search_files(uuid, text) to authenticated;
