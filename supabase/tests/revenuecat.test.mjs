import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
const A='00000000-0000-4000-a000-00000000a001', B='00000000-0000-4000-a000-00000000a002', C='00000000-0000-4000-a000-00000000a003';
let passed=0;
const ok=(value,message)=>{ assert.ok(value,message); passed++; console.log('PASS '+message); };
const change=(id,active=true,expiry='2099-01-01T00:00:00Z')=>({user_id:id,is_active:active,product_id:'yearly_trial',store:'app_store',expires_at:expiry});
const apply=async(id,rows,time='2026-11-03T12:00:00Z')=>db.query('select apply_revenuecat_event($1,$2,$3::jsonb)',[id,time,JSON.stringify(rows)]);
const row=async id=>(await db.query('select * from entitlements where user_id=$1',[id])).rows[0];
const sends=async()=>(await db.query("select * from private.revenuecat_test_dispatch where type='partner_premium'")).rows;
try {
  await db.exec(`create table private.revenuecat_test_dispatch(type public.push_type,record_id uuid,couple_id uuid,actor uuid);
    create or replace function private.dispatch_notify(p_type public.push_type,p_record_id uuid,p_couple_id uuid,p_couple_question_id uuid,p_actor_user_id uuid)
    returns void language sql security definer set search_path=public as $$
      insert into private.revenuecat_test_dispatch values(p_type,p_record_id,p_couple_id,p_actor_user_id)
    $$;
    insert into auth.users(id) values('${A}'),('${B}'),('${C}');
    select set_config('request.jwt.claim.sub','${A}',false);`);
  const couple=(await db.query("select create_couple('dating') id")).rows[0].id;
  await db.query('insert into couple_members(couple_id,user_id) values($1,$2)',[couple,B]);
  await db.query("insert into entitlements(user_id,is_active,updated_at) values($1,false,'2020-01-01')",[A]);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(apply('denied-'+role,[change(A)]),/permission denied/); passed++;
    await assert.rejects(db.query('select * from private.revenuecat_events'),/permission denied/); passed++;
    await assert.rejects(db.query('update entitlements set is_active=true'),/permission denied/); passed++;
    await db.exec('reset role');
    ok(!(await row(A)).is_active,role+' cannot modify entitlements via RLS');
  }
  await db.exec('set role service_role');
  await apply('purchase',[change(A)]);
  await db.exec('reset role');
  ok((await row(A)).is_active,'service role applies purchase');
  ok((await sends()).length===1 && (await sends())[0].actor===A,'first premium activation dispatches once to partner');
  const initial=await row(A);
  await apply('purchase',[change(A,false)],'2026-11-04T00:00:00Z');
  ok((await row(A)).is_active && (await sends()).length===1,'same event id cannot change state or redispatch');
  await apply('same-time',[change(A,false)]);
  await apply('old',[change(A,false)],'2026-11-02T00:00:00Z');
  assert.deepEqual(await row(A),initial); passed++;
  await apply('renewal',[change(A)],'2026-11-05T00:00:00Z');
  ok((await sends()).length===1,'renewal does not send another activation');
  await apply('partner-own-purchase',[change(B)],'2026-11-05T00:00:00Z');
  ok((await sends()).length===1,'already-premium couple does not get activation push');
  await apply('expire-both',[change(A,false),change(B,false)],'2026-11-06T00:00:00Z');
  ok(!(await row(A)).is_active && !(await row(B)).is_active,'multi-user change commits both revocations');
  await apply('restore-source',[change(A)],'2026-11-07T00:00:00Z');
  const before=(await sends()).length;
  await apply('same-couple-transfer',[change(A,false),change(B)],'2026-11-08T00:00:00Z');
  ok(!(await row(A)).is_active && (await row(B)).is_active,'transfer moves active premium');
  ok((await sends()).length===before,'same-couple transfer does not manufacture an activation');
  await apply('expired',[change(B,true,'2000-01-01T00:00:00Z')],'2026-11-09T00:00:00Z');
  ok(!(await db.query('select private.is_couple_premium($1) premium',[couple])).rows[0].premium,'expired active row cannot unlock premium');
  await apply('lifetime',[change(B,true,null)],'2026-11-10T00:00:00Z');
  ok((await row(B)).expires_at===null && (await sends()).length===before+1,'lifetime grants premium with no expiry');
  const lifetime=await row(B);
  await assert.rejects(apply('rollback',[change(B,false),{user_id:C,is_active:null}],'2026-11-11T00:00:00Z'),/INVALID_WEBHOOK/); passed++;
  assert.deepEqual(await row(B),lifetime); passed++;
  ok((await db.query("select count(*)::int n from private.revenuecat_events where event_id='rollback'")).rows[0].n===0,'failed transaction does not consume event id');
  await apply('rollback',[change(B)],'2026-11-11T00:00:00Z');
  ok((await row(B)).updated_at.toISOString()==='2026-11-11T00:00:00.000Z','failed event can be retried successfully');
  await apply('outsider',[change(C)],'2026-11-12T00:00:00Z');
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${C}',false)`);
  ok((await db.query('select user_id from entitlements')).rows.every(r=>r.user_id===C),'outsider sees only own entitlement');
  await db.exec('reset role');
  await db.query("update couples set status='ended',ended_at='2026-11-12T00:00:00Z' where id=$1",[couple]);
  const endedBefore=(await sends()).length;
  await apply('ended-revoke',[change(B,false)],'2026-11-13T00:00:00Z');
  await apply('ended-reactivate',[change(B)],'2026-11-14T00:00:00Z');
  ok((await sends()).length===endedBefore,'ended couple never dispatches partner premium');
  await db.query('delete from auth.users where id=$1',[C]);
  await apply('deleted-user',[change(C)],'2026-11-15T00:00:00Z');
  ok(!await row(C),'late webhook does not recreate deleted profile');
  for(const invalid of [null,{},[],[change(A),{...change(B),is_active:null}]]) {
    await assert.rejects(apply('invalid-'+passed,invalid),/INVALID_WEBHOOK/); passed++;
  }
  console.log(`${passed} passed, 0 failed`);
} finally { await db.close(); }
