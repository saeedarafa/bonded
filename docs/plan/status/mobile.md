# Mobile developer status
Updated: 2026-11-02 · Branch: mobile/MOB-29-i18n · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: mobile/MOB-29-i18n @ "[MOB-29] Status: ready for lead review" (on 79267f5 lint rule, b3c55ab i18n; from main @ fc86e16); pushed
- Uncommitted work: none
- Exact next step: lead reviews/merges MOB-29. Meanwhile start MOB-06 (data layer) on `mobile/MOB-06-data` from main (or from MOB-29 if not merged yet: `src/lib/errors.ts` messages should use `t()` from `@/i18n`, keys under `errors.*`).
- MOB-06 notes from the lead: map `Constants.public.Enums.error_code` exhaustively; add text for QUESTION_UNAVAILABLE; NOT_PAIRED on unpair retry = success; 42501 = signed out → back to auth.
- Commands to re-run: `npm ci && bash qa/ci/app.sh && npm run format:check` (typecheck, lint, 58 tests green); `npx expo export --platform ios|android --output-dir "$TMPDIR/bonded-<p>"`; `npx expo-doctor` (20/20)
- Watch out for:
  - git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools; push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. No simulators on this Mac. No AI attribution in commits.
  - `expo-font` needs its peer `expo-asset` installed, or the app (and Jest) fails with "Cannot find module 'expo-asset'".
  - `src/ui/tokens.json` is a verbatim copy of `design-handoff/tokens/tokens.json` (Prettier-ignored); `src/ui/__tests__/theme.test.ts` fails if they drift. To update: copy the file, don't edit it.
  - eslint `no-restricted-syntax` for app/ + src/ is ONE entry: `[...tokenOnlyRules(), ...rawStringRules()]`. Any new block for the same files must spread both, or it silently replaces them. `src/**/__tests__` gets token rules only (fixture text allowed).
  - i18n: `src/i18n/index.ts` owns its own i18next instance (`createInstance`, avoids the import/no-named-as-default-member warning), sync init (`initAsync: false`), imported first in `app/_layout.tsx`. Keys are typed (`src/i18n/i18next.d.ts`): a typo in `t('...')` fails tsc. Outside components use `t` from `@/i18n`; in components `useTranslation()`.
  - `PlaceholderScreen` now takes only `screenId` (typed `ScreenId` = keys of `screens.*` in en.json); when a real screen replaces a placeholder, drop its `screens.<id>` key.
  - TS has no Node types (`"types": ["jest"]`): tests that need `fs` use a typed `require('fs')` (see `src/i18n/__tests__/i18n.test.ts`).

## Doing
- —

## Done (since last update)
- MOB-29 i18n on `mobile/MOB-29-i18n` (ready for lead review): i18next 26 + react-i18next 17 + expo-localization 58 (`npx expo install`; `expo-localization` plugin added to app.config.ts). English catalogue `src/i18n/locales/en.json` (tab titles, placeholder a11y label, 41 placeholder screen names); device language picked from `getLocales()` with English fallback; typed keys. Tab titles and PlaceholderScreen go through `t()`. Lint rule `rawStringRules()` against raw strings in JSX children, visible props (title/label/placeholder/accessibilityLabel/…Label/…Title/…Text/…Hint) incl. `options={{ title }}`, and prose-like literals in other props; probe: 14/14 offending strings flagged (after de-duplicating, one error each), 0 false positives on 7 legal cases (t('key'), t(`screens.${id}`), testID, accessibilityRole, pointerEvents, punctuation/number text), token rules still fire alongside it, tests exempt from the string rule only. Tests: t() returns English, interpolation unescaped, no empty values, every `t('key')` in app/ + src/ and every placeholder screenId exists in the catalogue, tab labels render from the catalogue.
- Verified: npm ci, `qa/ci/app.sh` (typecheck, lint, 58 tests in 3 suites), format:check, `expo export` iOS and Android (catalogue strings present in both bundles), `expo-doctor` 20/20. Not seen on a device (no simulators).
- MOB-03 theme merged to main (fc86e16).

## Next
- MOB-06 data layer, MOB-04 components + gallery, MOB-05 mascot (MOB-02 after LEAD-03 + D30)

## Blocked
- Simulator checks (MOB-01 boot, MOB-03 light/dark on device): waiting on the PO dev environment (Xcode fix, Android Studio). Stand-ins: `expo export` for both platforms plus Jest render tests.

## Needs from
- lead: review MOB-29. Nothing outside my ownership changed. The BACKLOG acceptance (lint rule) is met; dynamic keys and non-JSX strings (e.g. `Alert.alert('...')`) are not linted, only covered by review and the typed keys.
- qa: no CI change; `qa/ci/app.sh` covers it. Consider adding `npm run format:check` to the `app` job (not run there today).
- backend: none

## Contract changes in flight
- —

## Questions for the product owner
- —
