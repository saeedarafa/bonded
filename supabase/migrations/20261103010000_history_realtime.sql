-- BE-20: history / thread unread counts, pairing realtime, and private couple avatars.
-- The unread RPC deliberately returns counts only: never message or answer text.

-- History is paged newest first by couple. The thread-read marker's primary key is already the
-- efficient exact lookup for each question; this index covers the history page itself.
create index couple_questions_history_by_couple
  on public.couple_questions (couple_id, created_at desc);

create or replace function public.unread_thread_counts()
returns table (couple_question_id uuid, unread int)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;

  -- Pair-period and reveal helpers prevent count-based side channels from a solo-era question,
  -- a locked thread, or an ended archive.
  return query
    select m.couple_question_id, count(*)::int
      from public.thread_messages m
      join public.couple_questions q on q.id = m.couple_question_id
      left join public.thread_reads r
        on r.couple_question_id = m.couple_question_id and r.user_id = auth.uid()
     where q.couple_id = v_couple
       and m.user_id <> auth.uid()
       and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
       and private.cq_in_pair_period(q.id)
       and private.both_answered(q.id)
     group by m.couple_question_id;
end $$;
revoke all on function public.unread_thread_counts() from public, anon;
grant execute on function public.unread_thread_counts() to authenticated;

-- Pairing screens subscribe to this table as a signal only, then refetch through RLS.
alter publication supabase_realtime add table public.couple_members;

-- Invite preview is anonymous but the bucket itself remains private: only the owner and a
-- current/recent partner can read it. Preview delivery therefore needs a signed URL path.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "avatar read by owner or partner" on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and name = (storage.foldername(name))[1] || '/avatar.jpg'
    and exists (
      select 1 from public.profiles p
       where p.id::text = (storage.foldername(storage.objects.name))[1]
         and private.can_read_profile(p.id)
    )
  );

create policy "avatar upload own canonical path" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.jpg');

create policy "avatar replace own canonical path" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.jpg')
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.jpg');

create policy "avatar delete own canonical path" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar.jpg');

revoke all on storage.objects from anon;
