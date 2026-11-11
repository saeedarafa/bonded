-- BE-42 (D46; CONTRACTS §2): voice answers and voice thread messages in a private Storage bucket.
--
--   * Bucket `voice` (private). Object name: `{couple_id}/{uid}/{uuid}.{m4a|aac|ogg|opus}`, lower-case
--     ids for the two folders. No server re-encoding. The bucket allows audio MIME types only, up
--     to 400 KB per object (SEC-09). Per-kind size and duration caps, the daily upload cap and
--     deletion with purge/delete-account are BE-43.
--   * `answers` and `thread_messages` get `kind` (`text` | `voice`), `voice_path`, `voice_duration_ms`.
--     A row is text XOR voice (CHECK, 23514): text = body, no voice fields; voice = no body, both
--     voice fields. Daily answers: one or the other. Threads mix both kinds freely.
--   * Writing a NEW voice reference needs a Premium couple at write time (`PREMIUM_REQUIRED`) and an
--     already uploaded object in the writer's own folder of that couple, used by no other row
--     (`INVALID_VOICE`). Re-saving an unchanged reference always passes, so a lapsed couple keeps
--     its voice rows (and may switch an answer back to text).
--   * Storage RLS:
--       upload  only into `{my active couple}/{me}/…`, only while the couple is Premium;
--       read    the owner always; anyone else only through a row that THEY can read under the
--               existing `answers` / `thread_messages` RLS (the subquery runs as the caller). So a
--               partner gets a voice answer exactly when the reveal rule lets them read the row
--               (D13), and thread voice like thread text (couple members, incl. the 30-day ended
--               archive, D08). Lapsed couples keep read access (no Premium check on read).
--       delete  the owner, only objects no row references (an unused take or a replaced one).
--       update  none (no overwrite; names are fresh UUIDs). anon has no access (BE-20 revoke).

alter type public.error_code add value if not exists 'INVALID_VOICE';

create type public.content_kind as enum ('text', 'voice');

-- ───────────────────────────── Bucket ─────────────────────────────

-- Storage enforces both limits on upload (SEC-09 Low 1): 400 KB per object (the larger BE-43 cap:
-- a 90 s answer at ~24 kbps is ~270 KB) and audio types only, matching the four extensions. The
-- client must send one of these as the upload's contentType (m4a: `audio/mp4`). Per-kind caps,
-- duration caps and the daily upload cap are BE-43.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 409600,
        array['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/aacp', 'audio/ogg', 'audio/opus'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ───────────────────────────── Columns and the text XOR voice rule ─────────────────────────────

alter table public.answers
  add column kind              public.content_kind not null default 'text',
  add column voice_path        text,
  add column voice_duration_ms integer check (voice_duration_ms > 0),
  alter column body drop not null,
  add constraint answers_text_xor_voice check (
    (kind = 'text'  and body is not null and voice_path is null and voice_duration_ms is null)
    or (kind = 'voice' and body is null and voice_path is not null and voice_duration_ms is not null));

alter table public.thread_messages
  add column kind              public.content_kind not null default 'text',
  add column voice_path        text,
  add column voice_duration_ms integer check (voice_duration_ms > 0),
  alter column body drop not null,
  add constraint thread_messages_text_xor_voice check (
    (kind = 'text'  and body is not null and voice_path is null and voice_duration_ms is null)
    or (kind = 'voice' and body is null and voice_path is not null and voice_duration_ms is not null));

-- One row per object (also the lookup path of the storage read policy).
create unique index answers_voice_path_key on public.answers (voice_path) where voice_path is not null;
create unique index thread_messages_voice_path_key on public.thread_messages (voice_path) where voice_path is not null;

-- Answers are column-limited (BE-06): clients may now also write the three voice columns.
grant insert (kind, voice_path, voice_duration_ms) on public.answers to authenticated;
grant update (kind, voice_path, voice_duration_ms) on public.answers to authenticated;

-- ───────────────────────────── Helpers ─────────────────────────────

-- The canonical object name for a writer in a couple. Folder ids are lower-case UUID text.
create or replace function private.voice_path_ok(p_path text, p_couple uuid, p_user uuid) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_path is not null and p_couple is not null and p_user is not null
     and p_path ~ ('^' || p_couple::text || '/' || p_user::text
                   || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(m4a|aac|ogg|opus)$')
$$;
revoke all on function private.voice_path_ok(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.voice_path_ok(text, uuid, uuid) to authenticated, service_role;

-- Whether any answer or message points at the object (bypasses RLS: used by the owner's delete
-- policy, which only ever asks about objects in the caller's own folder).
create or replace function private.voice_object_referenced(p_name text) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select exists (select 1 from public.answers where voice_path = p_name)
      or exists (select 1 from public.thread_messages where voice_path = p_name)
$$;
revoke all on function private.voice_object_referenced(text) from public, anon, authenticated, service_role;
grant execute on function private.voice_object_referenced(text) to authenticated, service_role;

-- ───────────────────────────── Write-time validation ─────────────────────────────

-- Shared check for a NEW voice reference written by a client into question p_cq. p_reused = some
-- other answer or message already points at the object (computed by the table's trigger).
-- SECURITY DEFINER only because the writer has no USAGE on `private` and cannot see the partner's
-- rows or storage.objects; it returns nothing, and every error is a bare code.
create or replace function private.voice_check_new(p_cq uuid, p_user uuid, p_path text, p_reused boolean)
returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid;
begin
  -- Not the writer's own row in their active couple: RLS rejects the row after the trigger. Say
  -- nothing here, so the error cannot reveal another couple's Premium state or objects.
  if auth.uid() is not null
     and (p_user is distinct from auth.uid() or not private.is_active_cq_member(p_cq)) then
    return;
  end if;
  select cq.couple_id into v_couple from public.couple_questions cq where cq.id = p_cq;
  if v_couple is null then return; end if;  -- the foreign key answers
  if not private.is_couple_premium(v_couple) then
    perform private.raise_error('PREMIUM_REQUIRED');
  end if;
  if p_reused
     or not private.voice_path_ok(p_path, v_couple, p_user)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'voice' and o.name = p_path) then
    perform private.raise_error('INVALID_VOICE');
  end if;
end $$;
revoke all on function private.voice_check_new(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;

-- answers: BEFORE INSERT/UPDATE, after answers_before_write and answers_length_check (trigger name
-- order), so on UPDATE couple_question_id/user_id are the stored ones.
create or replace function private.answers_validate_voice() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if new.kind is distinct from 'voice' or new.voice_path is null then return new; end if;  -- CHECK decides
  if tg_op = 'UPDATE' and new.voice_path is not distinct from old.voice_path then return new; end if;
  -- The INSERT half of an upsert fires before the conflict is found: the same reference on the
  -- same row is not new (retry / offline queue, also after a lapse).
  if exists (select 1 from public.answers a
              where a.couple_question_id = new.couple_question_id and a.user_id = new.user_id
                and a.voice_path = new.voice_path) then
    return new;
  end if;
  perform private.voice_check_new(new.couple_question_id, new.user_id, new.voice_path,
    exists (select 1 from public.answers a where a.voice_path = new.voice_path)
    or exists (select 1 from public.thread_messages m where m.voice_path = new.voice_path));
  return new;
end $$;
revoke all on function private.answers_validate_voice() from public, anon, authenticated, service_role;

-- thread_messages: a sent message keeps its kind and recording (edits change text only).
create or replace function private.thread_messages_validate_voice() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.kind := old.kind;
    new.voice_path := old.voice_path;
    new.voice_duration_ms := old.voice_duration_ms;
    return new;
  end if;
  if new.kind is distinct from 'voice' or new.voice_path is null then return new; end if;
  -- A resend with the same client_id (on conflict do nothing) is not new.
  if exists (select 1 from public.thread_messages m
              where m.client_id = new.client_id and m.user_id = new.user_id and m.voice_path = new.voice_path) then
    return new;
  end if;
  perform private.voice_check_new(new.couple_question_id, new.user_id, new.voice_path,
    exists (select 1 from public.answers a where a.voice_path = new.voice_path)
    or exists (select 1 from public.thread_messages m where m.voice_path = new.voice_path));
  return new;
end $$;
revoke all on function private.thread_messages_validate_voice() from public, anon, authenticated, service_role;

create trigger answers_voice_check before insert or update on public.answers
  for each row execute function private.answers_validate_voice();
create trigger thread_messages_voice_check before insert or update on public.thread_messages
  for each row execute function private.thread_messages_validate_voice();

-- ───────────────────────────── Storage policies (bucket `voice`) ─────────────────────────────

create policy "voice upload own folder of premium active couple" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice'
    and private.voice_path_ok(name, private.my_couple_id(), auth.uid())
    and private.is_couple_premium(private.my_couple_id())
  );

-- Partner/couple access goes through the row's own RLS: the subqueries run as the caller, so the
-- `answers` reveal-rule policy and the `thread_messages` policy decide. Unreferenced objects (an
-- upload not yet attached) are the owner's only.
create policy "voice read by owner or through a readable row" on storage.objects for select to authenticated
  using (
    bucket_id = 'voice'
    and (
      (storage.foldername(storage.objects.name))[2] = auth.uid()::text
      or exists (select 1 from public.answers a where a.voice_path = storage.objects.name)
      or exists (select 1 from public.thread_messages m where m.voice_path = storage.objects.name)
    )
  );

create policy "voice delete own unreferenced object" on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice'
    and (storage.foldername(storage.objects.name))[2] = auth.uid()::text
    and not private.voice_object_referenced(storage.objects.name)
  );
