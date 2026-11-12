-- Kitchenly Work 005: GitHub integration (owner-only)

-- which repo a room is linked to: readable by members, written only by the server (service role)
create table if not exists public.room_github (
  room_id        uuid primary key references public.rooms (id) on delete cascade,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  default_branch text not null check (char_length(default_branch) between 1 and 200),
  connected_by   uuid references auth.users (id) on delete set null,
  connected_at   timestamptz not null default now()
);

-- OAuth tokens (AES-256-GCM encrypted by the app). NO policies and NO grants: only the service role can touch it.
create table if not exists public.github_tokens (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  token_enc  text not null,
  created_at timestamptz not null default now()
);

alter table public.room_github   enable row level security;
alter table public.github_tokens enable row level security;
revoke all on public.room_github   from anon, authenticated;
revoke all on public.github_tokens from anon, authenticated;
grant select on public.room_github to authenticated;

create policy "room_github read" on public.room_github for select to authenticated
  using (public.is_room_member(room_id));
