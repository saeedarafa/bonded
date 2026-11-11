-- BE-44b (SEC-09d Low, on #195): cap undos per sender per sender-local day.
--
-- A send → undo loop gives the count back every time, so without a cap a sender could produce an
-- unbounded number of realtime INSERT/UPDATE events for the partner and rows in `little_things`.
-- Now at most 10 undos per sender per sender-local day (the day of the undone gesture, i.e. the
-- sender's profile timezone at send time, like the send limits). The 11th undo is refused with
-- UNDO_EXPIRED (no new error code: for the app it is the same "too late to undo"; the gesture stays
-- sent and counts). Undos are serialised with sends by the same per-couple advisory lock, so two
-- concurrent undos cannot both take the 10th slot. Undoing an already undone gesture stays
-- idempotent and does not count again.
--
-- Everything else in undo is unchanged from BE-45 (5 s window; refused once the push is claimed).

create or replace function private.undo_little_thing_at(p_id uuid, p_now timestamptz)
returns setof public.little_thing_state
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.little_things;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Look up first (no lock) only to find the couple for the advisory lock.
  select * into v_row from public.little_things where id = p_id and sender_id = v_uid;
  -- Unknown, or someone else's: the same code, so an id of another couple reveals nothing.
  if not found then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  if v_row.undone_at is not null then
    return query select * from private.little_things_state(v_uid, v_row.couple_id, p_now);
    return;
  end if;
  -- Same lock as send_little_thing: the undo count is decided once per couple at a time.
  perform pg_advisory_xact_lock(hashtext('little_things:' || v_row.couple_id::text));
  -- The row lock waits for any push claim in flight (BE-45, SEC-09d Info 1).
  select * into v_row from public.little_things where id = p_id and sender_id = v_uid for update;
  if v_row.undone_at is null then
    if p_now > v_row.created_at + interval '5 seconds'
       or exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = v_row.id)
       or (select count(*) from public.little_things l
            where l.sender_id = v_uid and l.local_date = v_row.local_date and l.undone_at is not null) >= 10 then
      perform private.raise_error('UNDO_EXPIRED');
    end if;
    update public.little_things set undone_at = p_now where id = v_row.id;
  end if;
  return query select * from private.little_things_state(v_uid, v_row.couple_id, p_now);
end $$;
revoke all on function private.undo_little_thing_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- Undo-count lookups per sender and day.
create index if not exists little_things_sender_undone on public.little_things (sender_id, local_date) where undone_at is not null;
