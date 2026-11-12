-- Kitchenly Work 002: Supabase Auth + rooms + membership + strict RLS + private Realtime
-- Replaces the open "mvp" policies from 001 with membership-based access.

-- ---------------------------------------------------------------------------
-- profiles (display name per auth user)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'user_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ), 40)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- users that signed up before this migration
insert into public.profiles (id, display_name)
select u.id, left(coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(coalesce(u.email, ''), '@', 1)), 40)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- rooms / room_members / invites / bans
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9_-]{3,64}$'),
  name       text not null check (char_length(name) between 1 and 80),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members (user_id);
create unique index if not exists room_members_one_owner on public.room_members (room_id) where role = 'owner';

create table if not exists public.room_invites (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  token      text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  max_uses   int check (max_uses is null or max_uses > 0),
  uses       int not null default 0,
  revoked    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists room_invites_room_idx on public.room_invites (room_id);

-- members removed by the owner can't come back through an old invite link
create table if not exists public.room_bans (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  banned_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- ---------------------------------------------------------------------------
-- helper functions (SECURITY DEFINER so policies don't recurse into RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_room_member(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = rid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_room_owner(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = rid and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.shares_room_with(uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members a
    join public.room_members b on a.room_id = b.room_id
    where a.user_id = auth.uid() and b.user_id = uid
  );
$$;

-- "room:<uuid>[:anything]" -> uuid, otherwise NULL (used by realtime.messages policies)
create or replace function public.topic_room_id(t text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  if t ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:|$)' then
    return split_part(t, ':', 2)::uuid;
  end if;
  return null;
end;
$$;

-- the creator becomes the owner member automatically
create or replace function public.on_room_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.room_members (room_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists rooms_add_owner on public.rooms;
create trigger rooms_add_owner
  after insert on public.rooms
  for each row execute function public.on_room_created();

-- when the owner removes someone, remember it (leaving by yourself is not a ban)
create or replace function public.on_member_removed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null
     and auth.uid() <> old.user_id
     and exists (select 1 from public.rooms r where r.id = old.room_id) then
    insert into public.room_bans (room_id, user_id) values (old.room_id, old.user_id)
    on conflict do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists room_members_ban on public.room_members;
create trigger room_members_ban
  after delete on public.room_members
  for each row execute function public.on_member_removed();

-- join through an invite token; returns the room slug
create or replace function public.accept_invite(p_token text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  inv  public.room_invites;
  slug text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into inv from public.room_invites where token = p_token for update;
  if not found
     or inv.revoked
     or inv.expires_at < now()
     or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'invalid or expired invite' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.room_bans b where b.room_id = inv.room_id and b.user_id = auth.uid()) then
    raise exception 'removed from this room' using errcode = 'P0001';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (inv.room_id, auth.uid(), 'member')
  on conflict do nothing;

  if found then
    update public.room_invites set uses = uses + 1 where id = inv.id;
  end if;

  select r.slug into slug from public.rooms r where r.id = inv.room_id;
  return slug;
end;
$$;

revoke execute on function public.is_room_member(uuid)    from public, anon;
revoke execute on function public.is_room_owner(uuid)     from public, anon;
revoke execute on function public.shares_room_with(uuid)  from public, anon;
revoke execute on function public.accept_invite(text)     from public, anon;
grant  execute on function public.is_room_member(uuid)    to authenticated;
grant  execute on function public.is_room_owner(uuid)     to authenticated;
grant  execute on function public.shares_room_with(uuid)  to authenticated;
grant  execute on function public.accept_invite(text)     to authenticated;
grant  execute on function public.topic_room_id(text)     to authenticated;

-- ---------------------------------------------------------------------------
-- files: attach to rooms, drop the open policies
-- ---------------------------------------------------------------------------
drop policy if exists "mvp read"   on public.files;
drop policy if exists "mvp insert" on public.files;
drop policy if exists "mvp update" on public.files;
drop policy if exists "mvp delete" on public.files;

-- keep the old text column for reference; rows without room_id become invisible
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'files' and column_name = 'room') then
    alter table public.files rename column room to legacy_room;
  end if;
end $$;
alter table public.files alter column legacy_room drop not null;

alter table public.files add column if not exists room_id    uuid references public.rooms (id) on delete cascade;
alter table public.files add column if not exists updated_by uuid references auth.users (id) on delete set null;
create unique index if not exists files_room_id_path_key on public.files (room_id, path);
create index if not exists files_room_id_idx on public.files (room_id);

create or replace function public.files_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists files_touch_trg on public.files;
create trigger files_touch_trg
  before update on public.files
  for each row execute function public.files_touch();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_members  enable row level security;
alter table public.room_invites  enable row level security;
alter table public.room_bans     enable row level security;
alter table public.files         enable row level security;

revoke all on public.profiles, public.rooms, public.room_members,
              public.room_invites, public.room_bans, public.files from anon;

-- profiles: yourself + people you share a room with; you edit only your own
create policy "profiles read"   on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_room_with(id));
create policy "profiles insert" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- rooms
create policy "rooms read"   on public.rooms for select to authenticated
  using (public.is_room_member(id) or owner_id = auth.uid());
create policy "rooms insert" on public.rooms for insert to authenticated
  with check (owner_id = auth.uid());
create policy "rooms update" on public.rooms for update to authenticated
  using (public.is_room_owner(id)) with check (owner_id = auth.uid());
create policy "rooms delete" on public.rooms for delete to authenticated
  using (public.is_room_owner(id));

-- room_members: no insert/update policy on purpose (only trigger + accept_invite write)
create policy "members read"   on public.room_members for select to authenticated
  using (public.is_room_member(room_id));
create policy "members delete" on public.room_members for delete to authenticated
  using (role <> 'owner' and (user_id = auth.uid() or public.is_room_owner(room_id)));

-- invites + bans: owner only
create policy "invites owner all" on public.room_invites for all to authenticated
  using (public.is_room_owner(room_id))
  with check (public.is_room_owner(room_id) and created_by = auth.uid());
create policy "bans owner all" on public.room_bans for all to authenticated
  using (public.is_room_owner(room_id))
  with check (public.is_room_owner(room_id));

-- files: room members only
create policy "files read"   on public.files for select to authenticated
  using (public.is_room_member(room_id));
create policy "files insert" on public.files for insert to authenticated
  with check (public.is_room_member(room_id));
create policy "files update" on public.files for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
create policy "files delete" on public.files for delete to authenticated
  using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- Realtime Authorization: private channels named "room:<room_uuid>:..."
-- (presence + Yjs broadcast). Only members of that room may join/send/receive.
-- ---------------------------------------------------------------------------
do $$
begin
  alter table realtime.messages enable row level security;
exception when insufficient_privilege then
  raise notice 'realtime.messages: RLS already managed by Supabase (skipped)';
end $$;

drop policy if exists "kw room members receive" on realtime.messages;
drop policy if exists "kw room members send"    on realtime.messages;

create policy "kw room members receive" on realtime.messages
  for select to authenticated
  using (public.is_room_member(public.topic_room_id((select realtime.topic()))));

create policy "kw room members send" on realtime.messages
  for insert to authenticated
  with check (public.is_room_member(public.topic_room_id((select realtime.topic()))));
