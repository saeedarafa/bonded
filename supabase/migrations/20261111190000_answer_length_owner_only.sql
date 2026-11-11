-- BE-41b (SEC-11 Low on #175): no exact-guess oracle on a partner's locked answer.
-- In BE-41's private.answers_validate_length the INSERT shortcut "this is the stored text re-sent"
-- matched on new.user_id before RLS checks ownership. A member could insert a row with the
-- partner's user_id and a guessed long text: a correct guess skipped the length check and failed
-- on RLS, a wrong one raised ANSWER_TOO_LONG, so the error confirmed the guess before reveal.
-- Now the shortcut also needs new.user_id = auth.uid() (or no JWT user: seed, migrations, service
-- role), so a guess at someone else's text always takes the normal path and every guess gets the
-- same error. The UPDATE shortcut is unchanged: RLS only lets a client update its own rows, and
-- answers_before_write pins user_id to the stored one.
create or replace function private.answers_validate_length() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_len    int := char_length(new.body);
  v_couple uuid;
  v_max    int;
begin
  -- Empty / null (voice rows): the CHECKs answer as before. At most 500 is always fine.
  if v_len is null or v_len <= 500 then return new; end if;
  if tg_op = 'UPDATE' then
    -- Re-saving unchanged text (a retry, or touching client_written_at) never trips the limit, so
    -- a lapsed couple's long answer stays as it is.
    if new.body is not distinct from old.body then return new; end if;
  elsif (auth.uid() is null or new.user_id = auth.uid())
    and exists (select 1 from public.answers a
                 where a.couple_question_id = new.couple_question_id and a.user_id = new.user_id
                   and a.body = new.body) then
    -- The INSERT half of an upsert that re-sends the caller's own stored text: BEFORE INSERT fires
    -- for the proposed row before the conflict is found, and the DO UPDATE half then changes
    -- nothing. Only the caller's own row (BE-41b): never compare against someone else's text.
    return new;
  end if;
  -- A client writing into a question that is not its active couple's: RLS rejects the row after
  -- this trigger. Say nothing here, so the error cannot reveal another couple's Premium state.
  if auth.uid() is not null and not private.is_active_cq_member(new.couple_question_id) then
    return new;
  end if;
  select cq.couple_id into v_couple from public.couple_questions cq where cq.id = new.couple_question_id;
  v_max := case when v_couple is not null and private.is_couple_premium(v_couple) then 2000 else 500 end;
  if v_len > v_max then
    raise exception using message = 'ANSWER_TOO_LONG', errcode = 'P0001',
      detail = format('{"max":%s}', v_max);
  end if;
  return new;
end $$;
revoke all on function private.answers_validate_length() from public, anon, authenticated, service_role;
