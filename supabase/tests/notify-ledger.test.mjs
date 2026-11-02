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
console.log(`\n${passed} passed, ${failed} failed`); await db.close();
