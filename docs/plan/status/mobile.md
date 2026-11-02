# Mobile developer status
Updated: 2026-11-02 · Branch: mobile/MOB-06-data · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: mobile/MOB-06-data (from main @ 381cc5c, which has MOB-29, BE-24, BE-03); MOB-06 ready for lead review. MOB-29 is merged.
- Uncommitted work: none
- Exact next step: MOB-04 component library + `/dev/gallery` on `mobile/MOB-04-components` (from the MOB-06 branch). Lead reviews/merges MOB-06.
- Commands to re-run: `npm ci && bash qa/ci/app.sh && npm run format:check` (typecheck, lint, 114 tests in 8 suites green); `EXPO_PUBLIC_SUPABASE_URL=… EXPO_PUBLIC_SUPABASE_ANON_KEY=… npx expo export --platform ios|android --output-dir "$TMPDIR/bonded-<p>"` (the root layout now imports the Supabase client, which throws without those two vars); `npx expo-doctor` (20/20)
- Watch out for:
  - git needs `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` in EVERY bash call that runs git (otherwise the Xcode licence message and nothing happens); push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin <branch>`. No simulators on this Mac. No AI attribution in commits.
  - Data layer (MOB-06): `src/lib/{env,storage,supabase,errors,queryKeys,queryClient,persister,realtime,useCoupleRealtime,DataProvider}`. `app/_layout.tsx` wraps the app in `DataProvider`. Only `src/features/<f>/api.ts` and `src/lib/*` import `@/lib/supabase`; api.ts functions use `unwrap()`/`toAppError()` so hooks and screens only see `AppError` (`kind`, `message` already translated, `signedOut`, `retryable`). Example feature: `src/features/couple` (`getActiveCouple`, `unpair` with NOT_PAIRED = success; `useActiveCouple`, `useUnpair`).
  - `react-native-mmkv` v4 is a Nitro native module: needs a development/EAS build, not Expo Go. Session and query cache share ONE AES-256 MMKV (`src/lib/storage.ts`); its key is generated once into expo-secure-store. Jest: `src/test/setup.ts` (jest `setupFiles`) sets fake EXPO_PUBLIC_* env and mocks nitro, netinfo, secure-store and crypto.
  - Tests that create a `QueryClient` must `qc.clear()` afterwards (24 h gc timers keep Jest alive), and mutations built by hand need `gcTime: 0` (`src/lib/__tests__/dataLayer.test.ts` shows how).
  - 42501 means signed out EXCEPT when the message mentions row-level security (a policy violation for a signed-in user): that is UNKNOWN. A signed-out error anywhere calls `supabase.auth.signOut({ scope: 'local' })` (once per 2 s) and the SIGNED_OUT auth event wipes the in-memory and persisted cache. MOB-08's auth gate only has to watch the session.
  - `expo-font` needs its peer `expo-asset` installed, or the app (and Jest) fails with "Cannot find module 'expo-asset'".
  - `src/ui/tokens.json` is a verbatim copy of `design-handoff/tokens/tokens.json` (Prettier-ignored); `src/ui/__tests__/theme.test.ts` fails if they drift. To update: copy the file, don't edit it.
  - eslint `no-restricted-syntax` for app/ + src/ is ONE entry: `[...tokenOnlyRules(), ...rawStringRules()]`. Any new block for the same files must spread both, or it silently replaces them. `src/**/__tests__` gets token rules only (fixture text allowed).
  - i18n: `src/i18n/index.ts` owns its own i18next instance (`createInstance`, avoids the import/no-named-as-default-member warning), sync init (`initAsync: false`), imported first in `app/_layout.tsx`. Keys are typed (`src/i18n/i18next.d.ts`): a typo in `t('...')` fails tsc, and so does a new backend `error_code` without an `errors.<CODE>` key (template-literal key in `messageFor`). Outside components use `t` from `@/i18n`; in components `useTranslation()`.
  - `PlaceholderScreen` now takes only `screenId` (typed `ScreenId` = keys of `screens.*` in en.json); when a real screen replaces a placeholder, drop its `screens.<id>` key.
  - TS has no Node types (`"types": ["jest"]`): tests that need `fs` use a typed `require('fs')` (see `src/i18n/__tests__/i18n.test.ts`).

## Doing
- —

## Done (since last update)
- MOB-06 data layer on `mobile/MOB-06-data` (ready for lead review). New deps via `npx expo install`: @supabase/supabase-js, @tanstack/react-query + react-query-persist-client, react-native-mmkv, @react-native-community/netinfo, zustand (installed for later UI state, unused yet), expo-secure-store, expo-crypto.
  - `supabase.ts`: one client typed with `Database`, session in encrypted MMKV, `detectSessionInUrl: false`, auto-refresh only while the app is active.
  - `errors.ts`: `AppError`, `toAppError`, `unwrap`, `ERROR_CODES` = `Constants.public.Enums.error_code` (all 14 incl. QUESTION_UNAVAILABLE); text through `t('errors.*')` (en.json), partner name interpolated for PARTNER_ALREADY_ANSWERED with fallback; classes SIGNED_OUT (42501, PGRST301/303, HTTP 401, dead auth session, NOT_AUTHENTICATED), NETWORK, UNKNOWN (generic). Never copies PostgREST `details`/`hint` (can contain answer text).
  - `queryKeys.ts` (hierarchical factory, ids only), `queryClient.ts` (24 h gc, 30 s stale, no retry of database codes, 2 retries for NETWORK/UNKNOWN, NetInfo online + AppState focus managers), `persister.ts` (throttled MMKV persister, corrupt cache dropped), `DataProvider.tsx` (PersistQueryClientProvider, cache buster `v1`, cache wipe on SIGNED_OUT).
  - `realtime.ts` + `useCoupleRealtime(coupleId)`: one channel `couple:{id}`; `couple_questions` filtered by couple_id, `answers`/`thread_messages`/`reactions`/`couple_members` scoped by RLS; handlers only invalidate (pure `keysToInvalidate`, payload read for ids only); full refetch after a reconnect. Not yet: typing presence (MOB-12, D15), two-device latency check (MOB-13).
  - Tests: 114 total (56 new): every error code has own text, classification table, no detail leakage, persister, key-value storage, query client retry/sign-out rules, realtime map and channel wiring with a fake client, couple api (unpair retry). Verified: tsc, lint (no `any`), format:check, `expo export` iOS + Android, `expo-doctor` 20/20. Not seen on a device.
- MOB-29 i18n merged to main (34e3607); BE-24 and BE-03 acked (see Contract changes).
- MOB-03 theme merged to main (fc86e16).

## Next
- MOB-04 components + gallery, MOB-05 mascot (MOB-02 after LEAD-03 + D30)

## Blocked
- Simulator checks (MOB-01 boot, MOB-03 light/dark on device): waiting on the PO dev environment (Xcode fix, Android Studio). Stand-ins: `expo export` for both platforms plus Jest render tests.

## Needs from
- lead: review MOB-06. Decision to confirm: 42501 is signed-out unless the message mentions row-level security (RLS violations use the same SQLSTATE for signed-in users). Nothing outside my ownership changed.
- qa: `qa/ci/app.sh` already covers it; the app now needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` only for `expo export`/real runs (Jest sets fakes). Dev builds need them in `.env`.
- backend: none. (FYI for CONTRACTS §2: PostgREST also returns 42501 for RLS violations, not only for anon RPC calls.)

## Contract changes in flight
- Acked 2026-11-02 (mobile), CONTRACTS change log:
  - BE-24: the RLS helpers (`my_couple_id`, `is_cq_member`, `has_answered`, `both_answered`, `answer_cq`, `message_cq`, `is_couple_premium`) moved to the `private` schema and are gone from the generated `Functions` types. Nothing in `app/` or `src/` called them; the app will only use the RPCs in CONTRACTS §2.
  - BE-03 (BREAKING): `create_invite` raises `NOT_PAIRED` until `create_couple(p_stage, p_goals?, p_partner_name?)` has run at the end of onboarding (MOB-07 must call it before the invite screen; a retry while solo is idempotent). `couples.status`, `ended_at` and ids are not client-writable (settings columns only). New enums `couple_stage` (the app uses `engaged_married`, NOT spec 05's `married`), `couple_status`, `key_date_kind`. `key_dates` upserts use `onConflict: 'couple_id,kind,user_id'` (MOB-28).

## Questions for the product owner
- —
