// BE-08: ledger is server-only; dispatch triggers remain portable without pg_net/Vault locally.
import { createDb } from './pglite-supabase.mjs';
let db; try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (c) passed++; else { failed++; process.exitCode = 1; } };
const U = '00000000-0000-0000-0000-000000000081';
const run = async (role, uid, sql) => { await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`); try { return await db.query(sql); } finally { await db.exec('reset role'); } };
await db.exec(`insert into auth.users (id) values ('${U}')`);
try { await run('authenticated', U, 'select * from push_log'); ok(false, 'client cannot read push ledger'); } catch (e) { ok(/permission denied/.test(e.message), 'clients cannot read push ledger'); }
try { await run('anon', null, 'select * from push_log'); ok(false, 'anon ledger denied'); } catch (e) { ok(/permission denied/.test(e.message), 'anon cannot read push ledger'); }
ok((await db.query(`select private.dispatch_notify('partner_answered', gen_random_uuid(), gen_random_uuid(), null, '${U}'::uuid)`)).rows.length === 1, 'dispatch is a local no-op without Vault and pg_net');
const claim = () => db.query(`select * from private.claim_push($1, 'thread_activity', gen_random_uuid(), null, current_date, now())`, [U]);
const grouped = await Promise.all([claim(), claim()]);
ok(grouped.map(r => r.rows[0].claim_id !== null).filter(Boolean).length === 1, 'concurrent thread claims produce one five-minute group');
try { await run('authenticated', U, `select * from public.claim_push('${U}', 'nudge', gen_random_uuid(), null, current_date, now())`); ok(false, 'authenticated cannot claim a push'); } catch (e) { ok(/permission denied/.test(e.message), 'authenticated cannot claim a push'); }
try { await run('anon', null, `select * from public.claim_push('${U}', 'nudge', gen_random_uuid(), null, current_date, now())`); ok(false, 'anon cannot claim a push'); } catch (e) { ok(/permission denied/.test(e.message), 'anon cannot claim a push'); }
ok((await run('service_role', null, `select * from public.claim_push('${U}', 'nudge', gen_random_uuid(), null, current_date + 1, now())`)).rows[0].claim_id !== null, 'service role reaches the atomic claim through the public RPC wrapper');
for (let i = 0; i < 4; i++) await db.query(`select * from private.claim_push($1, 'partner_premium', gen_random_uuid(), null, current_date, now())`, [U]);
ok((await db.query(`select count(*)::int n from push_log where user_id=$1 and local_date=current_date`, [U])).rows[0].n <= 4, 'locked claims never exceed four daily pushes');
console.log(`\n${passed} passed, ${failed} failed`); await db.close();
