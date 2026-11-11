-- BE-43b (SEC-09b follow-ups on BE-43; CONTRACTS §2).
--
--   * Low: Storage's signed upload URL (`createSignedUploadUrl(name, { upsert: true })`) is checked
--     against the INSERT policy only when it is created, before the object exists, and the upload
--     through it then runs as the Storage service (no RLS). Its token stays valid for 2 hours, so it
--     could overwrite a recording AFTER it was attached (reproduced on a local stack: a 10 KB thread
--     message recording replaced by 350 KB), skipping no-overwrite and the attach-time size cap and
--     changing a recording the partner may already have heard. The upsert reaches Postgres as
--     `insert … on conflict do update`, so a BEFORE UPDATE row trigger sees it, whatever the role.
--     Voice objects are write-once: an update that changes the content (`version` or `metadata`),
--     the name or the bucket is rejected with INVALID_VOICE. Nothing legitimate updates them: the
--     app uploads with upsert false, the cleanup and the owner only delete.
--   * Attach time: an object without a numeric `metadata.size` is rejected (INVALID_VOICE) instead of
--     relying on the bucket limit; Storage always writes the size, so a missing one is not a real upload.
--   * (Info, function side) `voice-cleanup` no longer passes its own clock: `voice_sweep` uses the
--     database's `now()`, the same clock as the 23-hour attach window.

create or replace function private.voice_objects_write_once() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if old.bucket_id is distinct from 'voice' and new.bucket_id is distinct from 'voice' then
    return new;
  end if;
  if new.bucket_id is distinct from old.bucket_id
     or new.name is distinct from old.name
     or (to_jsonb(new) -> 'version') is distinct from (to_jsonb(old) -> 'version')
     or new.metadata is distinct from old.metadata then
    perform private.raise_error('INVALID_VOICE');
  end if;
  return new;  -- e.g. Storage touching last_accessed_at / updated_at
end $$;
revoke all on function private.voice_objects_write_once() from public, anon, authenticated, service_role;

drop trigger if exists voice_objects_write_once on storage.objects;
create trigger voice_objects_write_once before update on storage.objects
  for each row execute function private.voice_objects_write_once();

-- BE-43's check, with the size now required. Same signature; only the size handling changed.
create or replace function private.voice_check_new(p_cq uuid, p_user uuid, p_path text, p_max_ms int, p_max_bytes bigint)
returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple  uuid;
  v_created timestamptz;
  v_size    text;
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
  if not private.voice_path_ok(p_path, v_couple, p_user) then
    perform private.raise_error('INVALID_VOICE');
  end if;
  -- Serialise with every other attach of, and the owner's delete of, the same object. Each query
  -- below is a new statement, so it sees what committed while this waited.
  perform pg_advisory_xact_lock(hashtext('voice:' || p_path));
  if exists (select 1 from public.answers a where a.voice_path = p_path)
     or exists (select 1 from public.thread_messages m where m.voice_path = p_path) then
    perform private.raise_error('INVALID_VOICE');
  end if;
  select o.created_at, o.metadata->>'size' into v_created, v_size
    from storage.objects o where o.bucket_id = 'voice' and o.name = p_path;
  -- Missing, or uploaded so long ago that the cleanup may already be removing it (24 h).
  if not found or v_created < now() - interval '23 hours' then
    perform private.raise_error('INVALID_VOICE');
  end if;
  -- Storage records the byte size of every upload; without it the cap cannot be checked.
  if v_size is null or v_size !~ '^[0-9]{1,15}$' then
    perform private.raise_error('INVALID_VOICE');
  end if;
  if v_size::bigint > p_max_bytes then
    raise exception using message = 'VOICE_TOO_LONG', errcode = 'P0001',
      detail = format('{"max_ms":%s,"max_bytes":%s}', p_max_ms, p_max_bytes);
  end if;
end $$;
revoke all on function private.voice_check_new(uuid, uuid, text, int, bigint) from public, anon, authenticated, service_role;
