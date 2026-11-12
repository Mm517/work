-- RLS tests. Run with ./scripts-pg.sh (local Postgres + shim) or against a *local* Supabase (supabase start).
-- Everything runs in one transaction and is rolled back at the end.
begin;

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function t.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create function t.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- true when the statement raises (RLS violation, permission denied, exception...)
create function t.fails(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  return true;
end $$;

create function t.n(q text) returns bigint language plpgsql as $$
declare c bigint;
begin
  execute 'with s as (' || q || ') select count(*) from s' into c;
  return c;
end $$;

grant execute on all functions in schema t to authenticated, anon;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'alice@x.test'),
  ('b0000000-0000-0000-0000-00000000000b', 'bob@x.test'),
  ('c0000000-0000-0000-0000-00000000000c', 'carol@x.test');

select t.ok((select count(*) from public.profiles) = 3, 'profiles created by trigger');
select t.ok((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a') = 'alice',
            'profile display name defaults to email prefix');

-- alice creates two rooms
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.rooms (id, slug, name) values ('11111111-1111-1111-1111-111111111111', 'room-one', 'Room One');
insert into public.rooms (id, slug, name) values ('22222222-2222-2222-2222-222222222222', 'room-two', 'Room Two');
select t.ok((select role from public.room_members
             where room_id = '11111111-1111-1111-1111-111111111111'
               and user_id = 'a0000000-0000-0000-0000-00000000000a') = 'owner',
            'creator is auto-added as owner');
insert into public.files (room_id, path, content) values ('11111111-1111-1111-1111-111111111111', 'a.txt', 'hello');
select t.ok(t.n('select 1 from public.files') = 1, 'owner can read own room files');
select t.ok(t.fails($q$insert into public.rooms (slug, name, owner_id) values ('evil-room', 'x', 'b0000000-0000-0000-0000-00000000000b')$q$),
            'cannot create a room owned by someone else');

-- ------------------------------------------------------- outsider (bob)
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n('select 1 from public.rooms') = 0, 'outsider sees no rooms');
select t.ok(t.n('select 1 from public.files') = 0, 'outsider sees no files');
select t.ok(t.fails($q$insert into public.files (room_id, path) values ('11111111-1111-1111-1111-111111111111', 'evil.txt')$q$),
            'outsider cannot insert file');
update public.files set content = 'pwned' where room_id = '11111111-1111-1111-1111-111111111111';
delete from public.files where room_id = '11111111-1111-1111-1111-111111111111';
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.ok((select content from public.files where path = 'a.txt') = 'hello', 'outsider update/delete touched nothing');
select t.ok(t.n('select 1 from public.profiles') = 1, 'alice sees only herself until she shares a room');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.fails($q$insert into public.room_members (room_id, user_id, role) values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-00000000000b', 'member')$q$),
            'cannot add yourself to a room directly');
select t.ok(t.n('select 1 from public.room_invites') = 0, 'outsider cannot read invites');

-- anon role has nothing
select t.as_anon();
select t.ok(t.fails('select 1 from public.files'), 'anon cannot read files');
select t.ok(t.fails('select 1 from public.rooms'), 'anon cannot read rooms');

-- ---------------------------------------------------------- invites
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.room_invites (room_id) values ('11111111-1111-1111-1111-111111111111');
insert into public.room_invites (room_id, max_uses) values ('11111111-1111-1111-1111-111111111111', 1);
insert into public.room_invites (room_id, expires_at) values ('11111111-1111-1111-1111-111111111111', now() - interval '1 minute');
insert into public.room_invites (room_id, revoked) values ('11111111-1111-1111-1111-111111111111', true);
select t.ok((select char_length(token) from public.room_invites limit 1) = 64, 'invite token is 64 hex chars');

select t.as_super();
create temp table tok as
  select
    (select token from public.room_invites where max_uses is null and not revoked and expires_at > now() limit 1) as good,
    (select token from public.room_invites where max_uses = 1 limit 1) as once,
    (select token from public.room_invites where expires_at < now() limit 1) as expired,
    (select token from public.room_invites where revoked limit 1) as revoked;
grant select on tok to authenticated;

select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.fails($q$select public.accept_invite('not-a-token')$q$), 'bad token rejected');
select t.ok(t.fails($q$select public.accept_invite((select expired from tok))$q$), 'expired invite rejected');
select t.ok(t.fails($q$select public.accept_invite((select revoked from tok))$q$), 'revoked invite rejected');
select t.ok((select public.accept_invite((select good from tok))) = 'room-one', 'valid invite returns slug');
select t.ok(t.n('select 1 from public.files') = 1, 'member can read files after joining');
select t.ok(t.n('select 1 from public.rooms') = 1, 'member sees only the joined room (not room-two)');
select t.ok(t.n('select 1 from public.profiles') = 2, 'members see each other profiles');
select t.ok(t.n('select 1 from public.room_members') = 2, 'member sees the member list');
insert into public.files (room_id, path, content) values ('11111111-1111-1111-1111-111111111111', 'b.txt', 'from bob');
update public.files set content = 'edited by bob' where path = 'a.txt';
select t.ok((select updated_by from public.files where path = 'a.txt') = 'b0000000-0000-0000-0000-00000000000b',
            'updated_by is stamped by trigger');
select t.ok(t.fails($q$insert into public.files (room_id, path) values ('22222222-2222-2222-2222-222222222222', 'x.txt')$q$),
            'member cannot write into another room');
select t.ok(t.n('select 1 from public.room_invites') = 0, 'member cannot read invites');
select t.ok(t.n($q$update public.rooms set name = 'hacked' returning 1$q$) = 0, 'member cannot rename room');
select t.ok(t.n($q$delete from public.rooms returning 1$q$) = 0, 'member cannot delete room');
select t.ok(t.n($q$delete from public.room_members where user_id = 'a0000000-0000-0000-0000-00000000000a' returning 1$q$) = 0,
            'member cannot remove the owner');

-- single-use invite
select t.as_user('c0000000-0000-0000-0000-00000000000c');
select t.ok((select public.accept_invite((select once from tok))) = 'room-one', 'single-use invite works once');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n($q$delete from public.room_members where user_id = 'c0000000-0000-0000-0000-00000000000c' returning 1$q$) = 0,
            'member cannot remove another member');

-- ---------------------------------------------------- realtime.messages
select t.as_super();
select set_config('realtime.topic', 'room:11111111-1111-1111-1111-111111111111:presence', true);
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into realtime.messages (topic, extension) values ('room:11111111-1111-1111-1111-111111111111:presence', 'broadcast');
select t.ok(t.n('select 1 from realtime.messages') >= 1, 'member can send+receive on own room topic');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n('select 1 from realtime.messages') >= 1, 'second member can receive on the room topic');

select t.as_super();
create temp table outsider as select 'd0000000-0000-0000-0000-00000000000d'::uuid as id;
insert into auth.users (id, email) values ('d0000000-0000-0000-0000-00000000000d', 'dave@x.test');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.ok(t.n('select 1 from realtime.messages') = 0, 'outsider receives nothing on the room topic');
select t.ok(t.fails($q$insert into realtime.messages (topic, extension) values ('room:11111111-1111-1111-1111-111111111111:presence', 'broadcast')$q$),
            'outsider cannot send on the room topic');

select t.as_super();
select set_config('realtime.topic', 'public-lobby', true);
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.ok(t.fails($q$insert into realtime.messages (topic, extension) values ('public-lobby', 'broadcast')$q$),
            'non-room topics are denied by default');
select t.as_super();
select set_config('realtime.topic', 'room:22222222-2222-2222-2222-222222222222:doc:x', true);
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.fails($q$insert into realtime.messages (topic, extension) values ('room:22222222-2222-2222-2222-222222222222:doc:x', 'broadcast')$q$),
            'member of room-one cannot use room-two topic');

-- ------------------------------------------------------------------ tasks
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.tasks (room_id, title, assignee_id)
  values ('11111111-1111-1111-1111-111111111111', 'task A', 'b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n('select 1 from public.tasks') = 1, 'owner can create+read tasks');
select t.ok(t.fails($q$insert into public.tasks (room_id, title, assignee_id) values ('11111111-1111-1111-1111-111111111111', 'x', 'd0000000-0000-0000-0000-00000000000d')$q$),
            'cannot assign a task to a non-member');
select t.ok(t.fails($q$insert into public.tasks (room_id, title, status) values ('11111111-1111-1111-1111-111111111111', 'x', 'bogus')$q$),
            'invalid status rejected');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n('select 1 from public.tasks') = 1, 'member sees room tasks');
update public.tasks set status = 'doing', position = 5;
select t.ok((select status from public.tasks) = 'doing', 'member can move a task');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.ok(t.n('select 1 from public.tasks') = 0, 'outsider sees no tasks');
select t.ok(t.fails($q$insert into public.tasks (room_id, title) values ('11111111-1111-1111-1111-111111111111', 'evil')$q$),
            'outsider cannot create tasks');
select t.ok(t.n($q$update public.tasks set title = 'pwn' returning 1$q$) = 0, 'outsider cannot update tasks');
select t.ok(t.n($q$delete from public.tasks returning 1$q$) = 0, 'outsider cannot delete tasks');

-- --------------------------------------------------- chat + voice rooms
-- (at this point: alice=owner, bob=member, carol=member, dave=outsider)
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.messages (room_id, body) values ('11111111-1111-1111-1111-111111111111', 'hello room');
insert into public.messages (room_id, recipient_id, body)
  values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-00000000000b', 'secret for bob');
select t.ok(t.fails($q$insert into public.messages (room_id, sender_id, body) values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-00000000000b', 'spoofed')$q$),
            'cannot spoof the sender');
select t.ok(t.fails($q$insert into public.messages (room_id, recipient_id, body) values ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-00000000000d', 'dm outsider')$q$),
            'cannot DM a non-member');
select t.ok(t.fails($q$insert into public.messages (room_id, recipient_id, body) values ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', 'dm self')$q$),
            'cannot DM yourself');
select t.ok(t.n('select 1 from public.messages') = 2, 'sender sees room msg + own DM');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n('select 1 from public.messages') = 2, 'recipient sees room msg + DM');
select t.as_user('c0000000-0000-0000-0000-00000000000c');
select t.ok(t.n('select 1 from public.messages') = 1, 'third member sees only the room message (DM is private)');
select t.ok(t.n($q$delete from public.messages where sender_id = 'a0000000-0000-0000-0000-00000000000a' returning 1$q$) = 0,
            'cannot delete other people messages');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.ok(t.n('select 1 from public.messages') = 0, 'outsider sees no messages');
select t.ok(t.fails($q$insert into public.messages (room_id, body) values ('11111111-1111-1111-1111-111111111111', 'evil')$q$),
            'outsider cannot post');

select t.as_super();
insert into public.rooms (id, slug, name, owner_id) values ('33333333-3333-3333-3333-333333333333', 'room-three', 'R3', 'a0000000-0000-0000-0000-00000000000a');
select t.ok((select count(*) from public.voice_rooms where room_id = '33333333-3333-3333-3333-333333333333') = 2,
            'new rooms get default voice rooms');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.fails($q$insert into public.voice_rooms (room_id, name) values ('11111111-1111-1111-1111-111111111111', 'x')$q$),
            'member cannot create voice rooms');
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.voice_rooms (room_id, name) values ('11111111-1111-1111-1111-111111111111', 'extra');
select t.ok(t.n($q$select 1 from public.voice_rooms where name = 'extra'$q$) = 1, 'owner can create voice rooms');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n($q$select 1 from public.voice_rooms where name = 'extra'$q$) = 1, 'member can read voice rooms');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.ok(t.n('select 1 from public.voice_rooms') = 0, 'outsider sees no voice rooms');

-- ------------------------------------------------------------------ github
select t.as_super();
insert into public.room_github (room_id, repo_full_name, default_branch)
  values ('11111111-1111-1111-1111-111111111111', 'acme/app', 'main');
insert into public.github_tokens (room_id, user_id, token_enc)
  values ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', 'v1.secret');
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.ok(t.n('select 1 from public.room_github') = 1, 'member can see linked repo');
select t.ok(t.fails('select 1 from public.github_tokens'), 'even the owner cannot read github tokens from the client');
select t.ok(t.fails($q$insert into public.room_github (room_id, repo_full_name, default_branch) values ('22222222-2222-2222-2222-222222222222', 'a/b', 'main')$q$),
            'clients cannot write room_github');
select t.ok(t.fails($q$insert into public.github_tokens (room_id, user_id, token_enc) values ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-00000000000a', 'x')$q$),
            'clients cannot write github_tokens');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.ok(t.n('select 1 from public.room_github') = 0, 'outsider cannot see linked repo');
select t.as_anon();
select t.ok(t.fails('select 1 from public.github_tokens'), 'anon cannot read github tokens');

-- ------------------------------------------ notifications / snapshots / search
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.notifications (room_id, user_id, kind, body)
  values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-00000000000b', 'ask', 'how do I deploy?');
select t.ok(t.fails($q$insert into public.notifications (room_id, user_id, from_user_id, kind) values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c', 'ask')$q$),
            'cannot forge the notification sender');
select t.ok(t.fails($q$insert into public.notifications (room_id, user_id, kind) values ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-00000000000d', 'ask')$q$),
            'cannot notify a non-member');
select t.ok(t.n('select 1 from public.notifications') = 0, 'sender cannot read notifications addressed to others');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n('select 1 from public.notifications') = 1, 'recipient sees the stored notification (offline delivery)');
update public.notifications set read_at = now();
select t.ok((select read_at from public.notifications) is not null, 'recipient can mark as read');
select t.ok(t.fails($q$update public.notifications set body = 'tampered'$q$), 'recipient cannot edit the body');
select t.as_user('c0000000-0000-0000-0000-00000000000c');
select t.ok(t.n('select 1 from public.notifications') = 0, 'other members cannot read it');

-- snapshots: auto checkpoint on content change (throttled), manual snapshot, privacy, search
select t.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.files (room_id, path, content) values ('11111111-1111-1111-1111-111111111111', 'src/app.ts', 'const a = 1;' || E'\n' || 'export const Needle = 2;');
update public.files set content = 'const a = 1;' || E'\n' || 'export const Needle = 3;' where path = 'src/app.ts';
select t.ok(t.n($q$select 1 from public.file_snapshots where label = 'auto' and file_id = (select id from public.files where path = 'src/app.ts')$q$) = 1, 'first content change creates an auto snapshot');
update public.files set content = 'changed again' where path = 'src/app.ts';
select t.ok(t.n($q$select 1 from public.file_snapshots where label = 'auto' and file_id = (select id from public.files where path = 'src/app.ts')$q$) = 1, 'auto snapshots are throttled to one per 5 minutes');
insert into public.file_snapshots (room_id, file_id, content, label)
  select room_id, id, content, 'manual' from public.files where path = 'src/app.ts';
select t.ok(t.n($q$select 1 from public.file_snapshots where file_id = (select id from public.files where path = 'src/app.ts')$q$) = 2, 'member can save a manual snapshot');
select t.ok(t.fails($q$insert into public.file_snapshots (room_id, file_id, content) select '22222222-2222-2222-2222-222222222222', id, 'x' from public.files where path = 'src/app.ts'$q$),
            'snapshot room must match the file room');
select t.ok(t.n($q$update public.file_snapshots set content = 'rewritten history' returning 1$q$) = 0, 'snapshots are append-only (no update)');
select t.ok(t.n($q$delete from public.file_snapshots returning 1$q$) = 0, 'snapshots cannot be deleted by clients');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.ok(t.n('select 1 from public.file_snapshots') = 0, 'outsider sees no snapshots');

select t.as_user('a0000000-0000-0000-0000-00000000000a');
update public.files set content = 'const a = 1;' || E'\n' || 'export const Needle = 4;' where path = 'src/app.ts';
select t.ok((select count(*) from public.search_files('11111111-1111-1111-1111-111111111111', 'needle')) = 1, 'search finds content case-insensitively');
select t.ok((select line_no from public.search_files('11111111-1111-1111-1111-111111111111', 'needle')) = 2, 'search reports the line number');
select t.ok((select count(*) from public.search_files('11111111-1111-1111-1111-111111111111', 'app.ts')) = 1, 'search finds file paths');
select t.ok((select count(*) from public.search_files('11111111-1111-1111-1111-111111111111', '%')) = 0, 'LIKE wildcards are escaped');
select t.ok((select count(*) from public.search_files('11111111-1111-1111-1111-111111111111', 'n')) = 0, 'too-short queries return nothing');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.ok((select count(*) from public.search_files('11111111-1111-1111-1111-111111111111', 'needle')) = 0, 'outsider search returns nothing (RLS)');

-- ---------------------------------------------------------- removal / ban
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.ok(t.n($q$delete from public.room_members where user_id = 'b0000000-0000-0000-0000-00000000000b' returning 1$q$) = 1,
            'owner can remove a member');
select t.ok(t.n('select 1 from public.room_bans') = 1, 'removal records a ban');
select t.ok(t.n($q$delete from public.room_members where user_id = 'a0000000-0000-0000-0000-00000000000a' returning 1$q$) = 0,
            'owner cannot remove self');
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.ok(t.n('select 1 from public.files') = 0, 'removed member loses access');
select t.ok(t.fails($q$select public.accept_invite((select good from tok))$q$), 'removed member cannot rejoin with old invite');

-- member can leave by themselves (no ban)
select t.as_user('c0000000-0000-0000-0000-00000000000c');
select t.ok(t.n($q$delete from public.room_members where user_id = 'c0000000-0000-0000-0000-00000000000c' returning 1$q$) = 1,
            'member can leave');
select t.as_super();
select t.ok((select count(*) from public.room_bans where user_id = 'c0000000-0000-0000-0000-00000000000c') = 0, 'leaving is not a ban');

-- owner deletes the room: everything cascades without FK errors
select t.as_user('a0000000-0000-0000-0000-00000000000a');
delete from public.rooms where id = '11111111-1111-1111-1111-111111111111';
select t.as_super();
select t.ok((select count(*) from public.files where room_id = '11111111-1111-1111-1111-111111111111') = 0, 'room delete cascades');

rollback;
