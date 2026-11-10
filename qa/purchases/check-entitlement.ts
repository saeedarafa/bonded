// QA-06: read-only check of what the server says after a store sandbox purchase (CONTRACTS §6).
// Prints, for each test account: its entitlements row, whether it is paired and with which listed
// account, whether the couple is premium by the app's rule, and how many partner_premium pushes were
// logged. Selects only; writes nothing. No answer text, receipts or tokens are read.
//
// The output is meant to be pasted into a committed run file (qa/purchases/runs/, public repo), so it
// never contains an email, a user id or a couple id: each account is given a label on the command
// line (LABEL=email) and only the label is printed.
//
//   SUPABASE_URL=https://nyqbrsqqalygydtwvybb.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<from the PO's password manager, never committed> \
//   node qa/purchases/check-entitlement.ts A=<buyer-email> B=<partner-email> [C=<email> ...]
//
// Allowed targets: the dev project (bonded-dev, https only) and local stacks (loopback). The
// production project is refused.
const PROD_REF = 'nciyrepyphvksusoigzx';
const DEV_REF = 'nyqbrsqqalygydtwvybb';
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

const usage =
  'usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node qa/purchases/check-entitlement.ts A=<email> [B=<email> ...]';
const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const accounts = process.argv.slice(2).map((arg) => {
  const m = arg.match(/^([A-Za-z][A-Za-z0-9 _-]{0,19})=(.+@.+)$/);
  if (!m) {
    console.error(`Expected LABEL=email (for example A=buyer@...), got an argument without a label.`);
    console.error(usage);
    process.exit(2);
  }
  return { label: m[1], email: m[2] };
});
if (!url || !key || accounts.length === 0) {
  console.error(usage);
  process.exit(2);
}
if (new Set(accounts.map((a) => a.label)).size !== accounts.length) {
  console.error('Each label must be unique.');
  process.exit(2);
}
let parsed: URL;
try {
  parsed = new URL(url);
} catch {
  console.error('SUPABASE_URL is not a URL.');
  process.exit(2);
}
const host = parsed.hostname;
if (host.includes(PROD_REF)) {
  console.error('Refusing the production project. Sandbox checks run on bonded-dev only.');
  process.exit(2);
}
if (host === `${DEV_REF}.supabase.co`) {
  if (parsed.protocol !== 'https:') {
    console.error('bonded-dev must be reached over https: (the service-role key is sent).');
    process.exit(2);
  }
} else if (!LOOPBACK.includes(host)) {
  console.error(`Unknown project host: only bonded-dev (${DEV_REF}) or a local stack.`);
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
const byEmail = (email: string) => users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
const labelOf = new Map<string, string>(); // user id -> label, for naming the partner
for (const a of accounts) {
  const u = byEmail(a.email);
  if (u) labelOf.set(u.id, a.label);
}
/** The entitlements row without its user id. */
const row = (e: Entitlement | undefined) =>
  e
    ? {
        is_active: e.is_active,
        product_id: e.product_id,
        store: e.store,
        expires_at: e.expires_at,
        updated_at: e.updated_at,
      }
    : null;
const now = Date.now();
for (const { label, email } of accounts) {
  const user = byEmail(email);
  if (!user) {
    console.log(`account ${JSON.stringify(label)}: no such account`);
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
      [partnerRow] = await get<Entitlement[]>(
        `/rest/v1/entitlements?user_id=eq.${partnerId}&select=*`,
      );
    }
  }
  const pushes = await get<{ status: string }[]>(
    `/rest/v1/push_log?user_id=eq.${user.id}&type=eq.partner_premium&select=status`,
  );
  console.log(
    JSON.stringify(
      {
        account: label,
        entitlement: row(mine),
        in_couple: coupleId !== null,
        // The partner's label when it was listed, else only that there is one.
        partner: partnerId ? (labelOf.get(partnerId) ?? 'an unlisted account') : null,
        premium_by_app_rule: { mine: live(mine, now), via_partner: live(partnerRow, now) },
        partner_premium_pushes_received: pushes.map((p) => p.status),
        checked_at: new Date(now).toISOString(),
      },
      null,
      2,
    ),
  );
}
