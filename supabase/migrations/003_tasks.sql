-- Kitchenly Work 003: Kanban tasks

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  status      text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done')),
  assignee_id uuid references auth.users (id) on delete set null,
  priority    text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date    date,
  file_path   text check (file_path is null or char_length(file_path) <= 500),
  position    double precision not null default 0,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_room_idx on public.tasks (room_id, status, position);

-- an assignee must belong to the same room
create or replace function public.tasks_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.assignee_id is not null and not exists (
    select 1 from public.room_members m
    where m.room_id = new.room_id and m.user_id = new.assignee_id
  ) then
    raise exception 'assignee is not a member of this room' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists tasks_guard_trg on public.tasks;
create trigger tasks_guard_trg
  before insert or update on public.tasks
  for each row execute function public.tasks_guard();

alter table public.tasks enable row level security;
revoke all on public.tasks from anon;

create policy "tasks read"   on public.tasks for select to authenticated
  using (public.is_room_member(room_id));
create policy "tasks insert" on public.tasks for insert to authenticated
  with check (public.is_room_member(room_id) and created_by = auth.uid());
create policy "tasks update" on public.tasks for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
create policy "tasks delete" on public.tasks for delete to authenticated
  using (public.is_room_member(room_id));

-- DELETE events must carry room_id so Realtime filters (room_id=eq...) can match them
alter table public.tasks replica identity full;
alter table public.files replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;
