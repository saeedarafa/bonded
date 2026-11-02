-- BE-05: content model (D11, D12, D14, D33; CONTRACTS §2).
--   D11  answers are 1–500 characters (thread messages stay 1–2000).
--   D12  day 1 of every couple is the special question `first_day`.
--   D14  reactions are one of four kinds; one per user per target; changing it is an upsert.
--   D33  packs carry `age_gate` ('18+'); the loader skips age-gated packs by default.
--   Content columns the loader needs (supabase/content/README.md): external_id, stages, special.

-- ───────────────────────────── D11: answers 1–500 ─────────────────────────────
-- NOT VALID: new and edited rows are held to 500; rows written under the old limit stay readable.
alter table public.answers drop constraint answers_body_check;
alter table public.answers
  add constraint answers_body_length check (char_length(body) between 1 and 500) not valid;

-- ───────────────────────────── D14: reactions.kind ─────────────────────────────
create type public.reaction_kind as enum ('love', 'laugh', 'wow', 'spark');

alter table public.reactions add column kind public.reaction_kind;
update public.reactions set kind = 'love' where kind is null;   -- pre-launch rows only
alter table public.reactions alter column kind set not null;
alter table public.reactions drop column emoji;

-- PostgREST upsert needs a conflict target that is a plain unique constraint (a partial unique
-- index can't be inferred). A NULL answer_id/message_id never collides (NULLS DISTINCT), so one
-- constraint per target column is enough: onConflict 'answer_id,user_id' / 'message_id,user_id'.
drop index public.reactions_one_per_answer;
drop index public.reactions_one_per_message;
alter table public.reactions
  add constraint reactions_one_per_answer unique (answer_id, user_id),
  add constraint reactions_one_per_message unique (message_id, user_id);

-- Changing a reaction is an UPDATE of an own row (ON CONFLICT DO UPDATE). Same couple and
-- reveal conditions as inserting, so the target can't be moved out of the couple or onto a
-- question the user hasn't answered.
revoke update on public.reactions from anon, authenticated;
grant update (user_id, answer_id, message_id, kind) on public.reactions to authenticated;
create policy "change own reactions" on public.reactions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));

-- ───────────────────────────── Questions and packs ─────────────────────────────
create type public.special_question as enum ('first_day', 'anniversary', 'together_since', 'half_iversary', 'birthday');

alter table public.questions
  add column external_id text unique,                              -- loader's upsert key ('d001', 'special-first_day')
  add column stages public.couple_stage[] not null default '{}',   -- '{}' = every stage
  add column special public.special_question,
  add column age_gate text check (age_gate = '18+'),
  add constraint questions_special_not_daily check (special is null or not daily_eligible);
-- One live special question of each kind per locale (get_daily_question picks first_day).
create unique index questions_one_special_per_locale on public.questions (special, locale)
  where special is not null and active;

alter table public.question_packs
  add column age_gate text check (age_gate = '18+'),
  add column icon text;

-- ───────────────────────────── get_daily_question (D12, stages) ─────────────────────────────
-- Day 1 of a couple (no daily question yet) is the active `first_day` special question; after
-- that the next daily-eligible question that fits the couple's stage ('{}' fits all; a couple
-- without a stage only gets the ones that fit all). Specials never come up as ordinary dailies.
create or replace function public.get_daily_question() returns public.couple_questions
language plpgsql security definer set search_path = public as $$
declare
  v_couple   uuid := private.my_couple_id();
  v_today    date;
  v_stage    public.couple_stage;
  v_question uuid;
  v_row      couple_questions;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select (now() at time zone timezone)::date, stage into v_today, v_stage from couples where id = v_couple;

  select * into v_row from couple_questions
   where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
  if found then return v_row; end if;

  if not exists (select 1 from couple_questions where couple_id = v_couple and source = 'daily') then
    select q.id into v_question from questions q
     where q.active and q.special = 'first_day'
     order by q.sort_order, q.id limit 1;
  end if;

  if v_question is null then
    select q.id into v_question from questions q
     where q.active and q.daily_eligible and q.special is null
       and (cardinality(q.stages) = 0 or v_stage = any (q.stages))
       and (not q.is_premium or private.is_couple_premium(v_couple))
       and not exists (select 1 from couple_questions cq where cq.couple_id = v_couple and cq.question_id = q.id)
     order by q.sort_order, q.id
     limit 1;
  end if;
  if v_question is null then perform private.raise_error('LIBRARY_EXHAUSTED'); end if;

  insert into couple_questions (couple_id, question_id, source, assigned_for)
  values (v_couple, v_question, 'daily', v_today)
  on conflict do nothing;

  select * into v_row from couple_questions
   where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
  return v_row;
end $$;
