// BE-14: fixed clocks, real migrations, revealed-only aggregates, premium and Sunday claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDb, supabaseDir } from './pglite-supabase.mjs';
const db = await createDb();
let passed = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed++; console.log('PASS '+message); };
const A='00000000-0000-0000-0000-000000000141', B='00000000-0000-0000-0000-000000000142', O='00000000-0000-0000-0000-000000000143';
const NOW='2026-11-01T18:00:00Z', WEEK='2026-10-26';
const run = async (role, uid, sql, args=[]) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
  try { return await db.query(sql,args); } finally { await db.exec('reset role'); }
};
const recap = async (uid=A, week=WEEK, now=NOW) => {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[uid ?? '']);
  return (await db.query('select (private.weekly_recap_at($1::date,$2::timestamptz)).*',[week,now])).rows[0];
};
const due = async (now=NOW) => (await run('service_role',null,'select * from due_weekly_recaps($1::timestamptz)',[now])).rows;
const resetClaims = async () => db.exec('delete from weekly_recap_log; delete from push_log');
try {
  await db.exec(`insert into auth.users(id) values('${A}'),('${B}'),('${O}');
    update profiles set timezone='UTC'; select set_config('request.jwt.claim.sub','${A}',false);`);
  const couple=(await db.query(`select create_couple('dating') id`)).rows[0].id;
  await db.query(`insert into couple_members(couple_id,user_id) values($1,$2)`,[couple,B]);
  await db.query(`update couples set timezone='UTC',paired_at='2026-10-25T12:00Z' where id=$1`,[couple]);
  await db.exec(`insert into questions(body,sort_order) select 'FIXTURE recap '||g,g from generate_series(1,20) g;`);
  let qnum=0;
  const question=async (day, source='daily', created='2026-10-26T09:00Z') => (await db.query(`
    insert into couple_questions(couple_id,question_id,source,assigned_for,created_at)
    select $1,id,$2,$3::date,$4::timestamptz from questions where sort_order=$5 returning id`,[couple,source,day,created,++qnum])).rows[0].id;
  const answer=async (q,u,time='2026-10-26T12:00Z') => {
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    return (await db.query(`insert into answers(couple_question_id,user_id,body,created_at)
    values($1,$2,'FIXTURE private answer',$3::timestamptz) returning id`,[q,u,time])).rows[0].id;
  };
  const message=async (q,u,time='2026-10-27T10:00Z') => (await db.query(`insert into thread_messages(client_id,couple_question_id,user_id,body,created_at)
    values(gen_random_uuid(),$1,$2,'FIXTURE private reply',$3::timestamptz) returning id`,[q,u,time])).rows[0].id;
  const react=async (answerId,u,time='2026-10-28T10:00Z',kind='❤️') => db.query(`insert into reactions(answer_id,user_id,kind,created_at)
    values($1,$2,$3,$4::timestamptz)`,[answerId,u,kind,time]);
  const q1=await question(WEEK), q2=await question('2026-10-27'), locked=await question('2026-10-28');
  const a1=await answer(q1,A), b1=await answer(q1,B), a2=await answer(q2,A,'2026-10-27T12:00Z');
  await answer(q2,B,'2026-10-27T12:00Z');
  const lockedAnswer=await answer(locked,B);
  const pack=await question(null,'pack');
  await answer(pack,A); await answer(pack,B);
  const future=await question('2026-11-02');
  await answer(future,A); await answer(future,B);
  await message(q1,A); await message(q2,B);
  await react(a1,B); await react(a2,B,'2026-10-28T11:00Z','😮');
  // Privileged malformed legacy rows must not become a recap side channel.
  await message(locked,B); await react(lockedAnswer,A);
  const solo=await question('2026-10-24','daily','2026-10-24T12:00Z');
  const soloAnswer=await answer(solo,A,'2026-10-24T13:00Z'); await answer(solo,B,'2026-10-24T13:00Z');
  await message(solo,B); await react(soloAnswer,A);
  const free=await recap();
  assert.deepEqual(free,{days_together:2,replies:null,reactions:null,most_loved_answer_id:null,is_full:false}); passed++;
  ok(JSON.stringify(await recap(B))===JSON.stringify(free),'both free partners get days only, idempotently');
  ok((await run('authenticated',A,'select * from answers where id=$1',[lockedAnswer])).rows.length===0,'locked partner answer remains invisible');
  await db.query(`insert into entitlements(user_id,is_active,expires_at) values($1,true,'2026-12-01')`,[B]);
  const paid=await recap();
  ok(paid.is_full && paid.days_together===2 && paid.replies===2 && paid.reactions===2,'partner premium unlocks only revealed pair-period activity');
  ok(paid.most_loved_answer_id===a2,'every emoji counts (❤️ and 😮); ties select latest answer');
  await react(a1,A);
  ok((await recap()).most_loved_answer_id===a1,'more reactions beat recency');
  ok(JSON.stringify(await recap(B))===JSON.stringify(await recap()),'premium partners share a recap');
  ok(!JSON.stringify(await recap()).includes('FIXTURE'),'RPC returns no answer or reply text');
  // Include activity on an older revealed question; use event times for replies/reactions.
  const old=await question('2026-10-25','daily','2026-10-25T13:00Z');
  const oldAnswer=await answer(old,A,'2026-10-25T14:00Z'); await answer(old,B,'2026-10-25T14:00Z');
  await message(old,A,'2026-10-26T00:00Z'); await react(oldAnswer,B,'2026-10-26T00:00Z');
  await message(q1,A,'2026-10-25T23:59:59Z'); await message(q1,A,'2026-11-02T00:00Z');
  await message(q1,A,'2026-11-01T18:00:01Z');
  const boundary=await recap();
  ok(boundary.days_together===2 && boundary.replies===3 && boundary.reactions===4,'event week lower bound inclusive; end/future events excluded; old revealed threads included');
  ok((await recap(A,'2026-11-02')).days_together===0,'future week has no completed days');
  ok((await recap(A,null)).days_together===2,'null week selects server-clock current Monday');
  await message(q1,A,'2026-10-26T04:00Z');
  await message(q1,A,'2026-11-02T05:00Z');
  await db.query(`update couples set timezone='America/New_York' where id=$1`,[couple]);
  const dst=await recap(A,WEEK,'2026-11-02T06:00Z');
  ok(dst.days_together===2 && dst.replies===5 && dst.reactions===3,'DST week uses local midnight bounds (169 hours), excludes next week and pack days');
  await db.query(`update couples set timezone='UTC' where id=$1`,[couple]);
  await db.query(`update entitlements set expires_at=$1 where user_id=$2`,[NOW,B]);
  ok(!(await recap()).is_full && (await recap()).replies===null,'premium expires at exact boundary');
  await db.query(`update entitlements set expires_at=null,is_active=false where user_id=$1`,[B]);
  ok(!(await recap()).is_full,'inactive lifetime entitlement does not unlock recap');
  await db.query(`update entitlements set is_active=true where user_id=$1`,[B]);
  await db.query(`update couple_members set left_at='2026-11-01' where user_id=$1`,[B]);
  ok(!(await recap()).is_full && (await recap()).days_together===0,'former-member premium and answers do not contribute');
  await db.query(`update couple_members set left_at=null where user_id=$1`,[B]);
  await assert.rejects(recap(null),/NOT_AUTHENTICATED/); passed++;
  await assert.rejects(recap(O),/NOT_PAIRED/); passed++;
  ok((await run('authenticated',A,'select (weekly_recap($1::date)).*',[WEEK])).rows[0].days_together===2,'authenticated public wrapper works with server clock');
  for(const role of ['anon','authenticated','service_role']) {
    await assert.rejects(run(role,A,`select private.weekly_recap_at('2026-10-26',now())`),/permission denied/); passed++;
    await assert.rejects(run(role,A,`select private.recap_days($1,'2026-10-26',now())`,[couple]),/permission denied/); passed++;
    await assert.rejects(run(role,A,`select * from private.recap_questions($1,now())`,[couple]),/permission denied/); passed++;
  }
  await assert.rejects(run('anon',null,`select weekly_recap('2026-10-26')`),/permission denied/); passed++;
  for(const role of ['anon','authenticated']) {
    await assert.rejects(run(role,A,'select * from due_weekly_recaps()'),/permission denied/); passed++;
    await assert.rejects(run(role,A,'select * from weekly_recap_log'),/permission denied/); passed++;
    await assert.rejects(run(role,A,`insert into weekly_recap_log(user_id,week_start) values($1,'2026-10-26')`,[A]),/permission denied/); passed++;
  }
  ok((await due('2026-11-01T17:59:59Z')).length===0,'before Sunday window');
  ok((await due('2026-11-01T18:15Z')).length===0,'Sunday window upper bound exclusive');
  ok((await due('2026-10-31T18:00Z')).length===0,'Saturday excluded');
  const first=await due();
  ok(first.length===2 && first.every(r=>r.claim_id&&r.days_together===2),'Sunday claims one days-only push for each partner');
  ok(first.every(r=>Object.keys(r).sort().join()===['claim_id','days_together','user_id'].join()),'service result contains no premium stats or user content');
  ok((await due('2026-11-01T18:14:59Z')).length===0,'repeat invocation claims nothing');
  await db.exec(`update push_log set status='suppressed'`);
  ok((await due()).length===0,'suppressed delivery never refunds weekly claim');
  ok((await due('2026-11-08T18:00Z')).length===2,'next local week gets independent claims');
  await resetClaims();
  await db.query(`update notification_prefs set replies=false where user_id=$1`,[A]);
  ok((await due()).map(r=>r.user_id).join()===B,'replies toggle controls recap');
  await resetClaims();
  await db.exec(`update notification_prefs set replies=true,quiet_start='17:00',quiet_end='19:00'`);
  ok((await due()).length===0,'recipient non-wrapping quiet hours');
  await db.exec(`update notification_prefs set quiet_start='23:00',quiet_end='07:00'`);
  await db.query(`update profiles set timezone='Asia/Tokyo' where id=$1`,[A]);
  ok((await due()).map(r=>r.user_id).join()===B,'schedule uses couple timezone; quiet hours use recipient timezone');
  await db.exec(`update profiles set timezone='UTC'`); await resetClaims();
  for(let i=0;i<4;i++) await db.query(`select * from claim_push($1,'tips',gen_random_uuid(),null,'2026-11-01',$2::timestamptz)`,[A,NOW]);
  ok((await due()).map(r=>r.user_id).join()===B,'weekly push shares four/day cap with other pushes');
  await resetClaims();
  await db.query(`update couples set timezone='Asia/Kathmandu' where id=$1`,[couple]);
  ok((await due('2026-11-01T12:15Z')).length===2,'quarter-hour cron handles non-hour offset');
  await resetClaims();
  await db.query(`update couples set timezone='America/New_York' where id=$1`,[couple]);
  await db.exec(`update notification_prefs set quiet_start='01:00',quiet_end='02:00'`);
  ok((await due('2026-11-01T23:00Z')).length===2,'Sunday after DST fallback selects once');
  ok((await due('2026-11-01T23:10Z')).length===0,'DST Sunday retry deduplicates');
  await resetClaims();
  await db.query(`update couples set timezone='UTC',status='ended',ended_at=$1 where id=$2`,[NOW,couple]);
  ok((await due()).length===0,'ended couples receive no recap');
  await assert.rejects(recap(),/NOT_PAIRED/); passed++;
  await db.query(`update couples set status='active',ended_at=null where id=$1`,[couple]);
  await db.query(`update couple_members set left_at=$1 where user_id=$2`,[NOW,B]);
  ok((await due()).length===0,'solo/one-current-member couple receives no recap');
  await db.query(`update couple_members set left_at=null where user_id=$1`,[B]);
  await due(); await db.query(`delete from auth.users where id=$1`,[A]);
  ok((await db.query('select count(*)::int n from weekly_recap_log where user_id=$1',[A])).rows[0].n===0,'account deletion cascades private weekly ledger');
  // Acceptance fixture: actual seeded streak-11 couple, with explicit Sunday clock.
  await db.exec(`delete from auth.users`);
  await db.exec(fs.readFileSync(`${supabaseDir}/seed.sql`,'utf8'));
  await db.query(`select dev_seed.apply_scenario('streak-11-both-answered',$1::timestamptz)`,['2026-11-01T22:00Z']);
  const maya='00000000-0000-4000-a000-00000000a001';
  const seeded=await recap(maya,WEEK,'2026-11-01T23:00Z');
  ok(seeded.days_together===7 && !seeded.is_full && seeded.replies===null,'seeded streak-11 couple has seven real completed days, free stats hidden');
  await db.query(`insert into entitlements(user_id,is_active) values($1,true) on conflict(user_id) do update set is_active=true,expires_at=null`,[maya]);
  const seededPaid=await recap(maya,WEEK,'2026-11-01T23:00Z');
  ok(seededPaid.days_together===7 && seededPaid.is_full && seededPaid.replies===4 && seededPaid.reactions===1 && seededPaid.most_loved_answer_id,'seeded paid recap counts actual thread/reaction fixtures');
  console.log(`${passed} passed, 0 failed`);
} finally { await db.close(); }
