-- BE-41 (D46, D11 amended; CONTRACTS §2, §8): answer length depends on Premium at write time.
--   Free couple:    answers 1–500 characters.
--   Premium couple: answers 1–2000 characters (`private.is_couple_premium` of the answer's couple).
--   Lapsed couple:  long answers stay readable; a new answer or an edit of the text is held to 500
--                   (lead default: an existing long answer may be edited only down to ≤ 500).
--   Thread messages unchanged (1–2000). Pack-question answers share `answers`: same rule.
--   Too long raises exactly ANSWER_TOO_LONG (SQLSTATE P0001) with DETAIL '{"max":500}' or
--   '{"max":2000}' (PostgREST `details`, a JSON string). Empty stays the 23514 check violation.

alter type public.error_code add value if not exists 'ANSWER_TOO_LONG';

-- The CHECK becomes the absolute backstop (1–2000, holds with triggers disabled). Every stored row
-- already satisfies it (0001 allowed ≤ 2000, D11 then ≤ 500), so it is validated, not NOT VALID.
alter table public.answers drop constraint answers_body_length;
alter table public.answers
  add constraint answers_body_length check (char_length(body) between 1 and 2000);

-- Runs after answers_before_write (trigger name order), so on UPDATE couple_question_id is the
-- stored one. SECURITY DEFINER only because the writer has no USAGE on `private`; it reads the
-- question's couple, the caller's own row and the couple's entitlements, and returns no data.
create or replace function private.answers_validate_length() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_len    int := char_length(new.body);
  v_couple uuid;
  v_max    int;
begin
  -- Empty / null: the CHECK and NOT NULL answer as before. At most 500 is always fine.
  if v_len is null or v_len <= 500 then return new; end if;
  if tg_op = 'UPDATE' then
    -- Re-saving unchanged text (a retry, or touching client_written_at) never trips the limit, so
    -- a lapsed couple's long answer stays as it is.
    if new.body is not distinct from old.body then return new; end if;
  elsif exists (select 1 from public.answers a
                 where a.couple_question_id = new.couple_question_id and a.user_id = new.user_id
                   and a.body = new.body) then
    -- The INSERT half of an upsert that re-sends the stored text: BEFORE INSERT fires for the
    -- proposed row before the conflict is found, and the DO UPDATE half then changes nothing. Any
    -- other text is checked here already (the CHECK also runs on the proposed row, before the
    -- conflict, so a too-long upsert must be answered here to get ANSWER_TOO_LONG, not 23514).
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

create trigger answers_length_check before insert or update of body on public.answers
  for each row execute function private.answers_validate_length();
