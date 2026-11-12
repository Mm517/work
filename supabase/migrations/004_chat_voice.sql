-- Kitchenly Work 004: text chat (room + private DMs) and persistent voice rooms

-- ------------------------------------------------------------------ chat
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  sender_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id uuid references auth.users (id) on delete cascade, -- NULL = room channel, else a DM
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index if not exists messages_room_idx on public.messages (room_id, created_at desc);

create or replace function public.is_user_in_room(rid uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.room_members m where m.room_id = rid and m.user_id = uid);
$$;
revoke execute on function public.is_user_in_room(uuid, uuid) from public, anon;
grant  execute on function public.is_user_in_room(uuid, uuid) to authenticated;

alter table public.messages enable row level security;
revoke all on public.messages from anon;

-- room channel: every member. DM: only sender and recipient.
create policy "messages read" on public.messages for select to authenticated
  using (
    public.is_room_member(room_id)
    and (recipient_id is null or sender_id = auth.uid() or recipient_id = auth.uid())
  );
create policy "messages insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_room_member(room_id)
    and (recipient_id is null
         or (recipient_id <> auth.uid() and public.is_user_in_room(room_id, recipient_id)))
  );
create policy "messages delete own" on public.messages for delete to authenticated
  using (sender_id = auth.uid());

alter table public.messages replica identity full;

-- ----------------------------------------------------------- voice rooms
create table if not exists public.voice_rooms (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists voice_rooms_room_idx on public.voice_rooms (room_id);

alter table public.voice_rooms enable row level security;
revoke all on public.voice_rooms from anon;

create policy "voice read"   on public.voice_rooms for select to authenticated
  using (public.is_room_member(room_id));
create policy "voice insert" on public.voice_rooms for insert to authenticated
  with check (public.is_room_owner(room_id));
create policy "voice update" on public.voice_rooms for update to authenticated
  using (public.is_room_owner(room_id)) with check (public.is_room_owner(room_id));
create policy "voice delete" on public.voice_rooms for delete to authenticated
  using (public.is_room_owner(room_id));

-- every room starts with two persistent voice rooms
create or replace function public.on_room_created_voice()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.voice_rooms (room_id, name) values (new.id, 'عام'), (new.id, 'مذاكرة / شغل هادي');
  return new;
end;
$$;
drop trigger if exists rooms_default_voice on public.rooms;
create trigger rooms_default_voice
  after insert on public.rooms
  for each row execute function public.on_room_created_voice();

insert into public.voice_rooms (room_id, name)
select r.id, v.name
from public.rooms r
cross join (values ('عام'), ('مذاكرة / شغل هادي')) as v(name)
where not exists (select 1 from public.voice_rooms x where x.room_id = r.id);

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.voice_rooms;
exception when duplicate_object then null;
end $$;
