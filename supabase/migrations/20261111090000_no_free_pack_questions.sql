-- BE-46 / D51 (PO 2026-11-10, reverses D43 / BE-36): packs have no free preview.
-- A couple can start a pack question only when it is Premium (either current member,
-- private.is_couple_premium). This applies to EVERY pack question: the lowest-position exception
-- from 20261110150000_free_first_pack_question.sql is removed, and a pack's own `is_premium` flag no
-- longer grants free access either ("Packs come with Premium, for both of you").
-- Errors are unchanged: QUESTION_UNAVAILABLE when the question is inactive or in no active pack
-- (checked first, so a free couple learns nothing new about inactive content), PREMIUM_REQUIRED
-- otherwise. Idempotent: the same couple + question returns the existing row.
-- Lead default (D51): pack questions a free couple already started under D43 stay answerable and
-- revealable. No data is removed, and the answer, reveal, thread and reaction paths never checked
-- premium for an existing couple_questions row, so they are untouched here. Only creating a NEW row
-- is gated: when the couple already has a row for this question (started under D43, or while it was
-- Premium), the RPC still returns it, because the app opens a started pack question for the second
-- partner by calling start_pack_question (MOB-49, "same row"). Pack and question availability is
-- still checked first, exactly as before.
create or replace function public.start_pack_question(p_question uuid) returns public.couple_questions
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_row    couple_questions;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  if not exists (
    select 1 from pack_questions pq
      join question_packs p on p.id = pq.pack_id
      join questions q on q.id = pq.question_id
     where pq.question_id = p_question and p.active and q.active
  ) then
    perform private.raise_error('QUESTION_UNAVAILABLE');
  end if;
  select * into v_row from couple_questions where couple_id = v_couple and question_id = p_question;
  if found then return v_row; end if;
  if not private.is_couple_premium(v_couple) then
    perform private.raise_error('PREMIUM_REQUIRED');
  end if;

  insert into couple_questions (couple_id, question_id, source)
  values (v_couple, p_question, 'pack')
  on conflict do nothing;

  select * into v_row from couple_questions where couple_id = v_couple and question_id = p_question;
  return v_row;
end $$;

revoke all on function public.start_pack_question(uuid) from public, anon;
grant execute on function public.start_pack_question(uuid) to authenticated;
