-- BE-36 / D43 (lead default 2026-11-10): the first question of every active pack is free.
-- A question is startable when it is active and sits in at least one active pack where
--   * the pack is free, or
--   * the couple is premium (either current member, private.is_couple_premium), or
--   * it is that pack's first question: lowest `position` among the pack's ACTIVE questions
--     (ties broken by question id, so exactly one question per pack is free).
-- Multi-pack rule: free if it is the first question of ANY active pack it belongs to. This matches
-- the existing "any active pack grants access" check and what the app shows per pack (33).
-- Errors are unchanged: QUESTION_UNAVAILABLE when the question is inactive or in no active pack,
-- PREMIUM_REQUIRED otherwise. Idempotent: the same couple + question returns the existing row.
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
  if not exists (
    select 1 from pack_questions pq join question_packs p on p.id = pq.pack_id
     where pq.question_id = p_question and p.active
       and (
         not p.is_premium
         or p_question = (
           select f.question_id from pack_questions f join questions fq on fq.id = f.question_id
            where f.pack_id = p.id and fq.active
            order by f.position, f.question_id
            limit 1
         )
         or private.is_couple_premium(v_couple)
       )
  ) then
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
