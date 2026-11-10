// QA-06: read-only check of what the server says after a store sandbox purchase (CONTRACTS §6).
// Prints, for each test account: its entitlements row, its current couple and partner, whether the
// couple is premium by the app's rule, and how many partner_premium pushes were logged. Selects only;
// writes nothing. No answer text, receipts or tokens are read.
//
//   SUPABASE_URL=https://nyqbrsqqalygydtwvybb.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<from the PO's password manager, never committed> \
//   node qa/purchases/check-entitlement.ts <buyer-email> [<partner-email> ...]
//
// Allowed targets: the dev project (bonded-dev) and local stacks. The production project is refused.
const PROD_REF = 'nciyrepyphvksusoigzx';
const DEV_REF = 'nyqbrsqqalygydtwvybb';

const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const emails = process.argv.slice(2);
if (!url || !key || emails.length === 0) {
  console.error('usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node qa/purchases/check-entitlement.ts <email>...');
  process.exit(2);
}
const host = new URL(url).hostname;
if (host.includes(PROD_REF)) {
  console.error('Refusing the production project. Sandbox checks run on bonded-dev only.');
  process.exit(2);
}
if (!['127.0.0.1', 'localhost', `${DEV_REF}.supabase.co`].includes(host)) {
  console.error(`Unknown project ${host}: only bonded-dev (${DEV_REF}) or a local stack.`);
  process.exit(2);
}
const headers = { apikey: key, authorization: `Bearer ${key}` };
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${url}${path}`, { headers });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

type User = { id: string; email: string };
type Entitlement = {
  user_id: string;
  is_active: boolean;
  product_id: string | null;
  store: string | null;
  expires_at: string | null;
  updated_at: string;
};
type Member = { couple_id: string; user_id: string; left_at: string | null };

const live = (e: Entitlement | undefined, now: number) =>
  Boolean(e?.is_active && (e.expires_at === null || Date.parse(e.expires_at) > now));

const { users } = await get<{ users: User[] }>('/auth/v1/admin/users?per_page=1000');
const now = Date.now();
for (const email of emails) {
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.log(`${email}: no such account`);
    continue;
  }
  const [mine] = await get<Entitlement[]>(`/rest/v1/entitlements?user_id=eq.${user.id}&select=*`);
  const members = await get<Member[]>(
    `/rest/v1/couple_members?user_id=eq.${user.id}&left_at=is.null&select=couple_id,user_id,left_at`,
  );
  const coupleId = members[0]?.couple_id ?? null;
  let partnerId: string | null = null;
  let partnerRow: Entitlement | undefined;
  if (coupleId) {
    const both = await get<Member[]>(
      `/rest/v1/couple_members?couple_id=eq.${coupleId}&left_at=is.null&select=couple_id,user_id,left_at`,
    );
    partnerId = both.find((m) => m.user_id !== user.id)?.user_id ?? null;
    if (partnerId) {
      [partnerRow] = await get<Entitlement[]>(`/rest/v1/entitlements?user_id=eq.${partnerId}&select=*`);
    }
  }
  const pushes = await get<{ status: string }[]>(
    `/rest/v1/push_log?user_id=eq.${user.id}&type=eq.partner_premium&select=status`,
  );
  console.log(
    JSON.stringify(
      {
        account: email,
        entitlement: mine ?? null,
        couple: coupleId,
        partner: partnerId,
        premium_by_app_rule: { mine: live(mine, now), via_partner: live(partnerRow, now) },
        partner_premium_pushes_received: pushes.map((p) => p.status),
        checked_at: new Date(now).toISOString(),
      },
      null,
      2,
    ),
  );
}
