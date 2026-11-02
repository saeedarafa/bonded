# Mobile developer status
Updated: 2026-11-02 · Branch: mobile/MOB-03-theme · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: mobile/MOB-03-theme @ "[MOB-03] Verify theme: expo-asset, token drift and personColors tests" (on wip e59d7bd, on main @ 3df822f); NOT pushed (git push failed: no GitHub credentials in the shell; run `git push -u origin mobile/MOB-03-theme`)
- Uncommitted work: none
- Exact next step: lead reviews/merges MOB-03 (the wip commit + its follow-up; squash on merge). Meanwhile start MOB-29 (i18n scaffold, every string through `t()`, lint rule against raw JSX strings) on `mobile/MOB-29-i18n` from main (or from MOB-03 if not merged: it extends `tokenOnlyRules()` in eslint.config.js). Then MOB-06 (data layer) on its own branch.
- MOB-06 notes from the lead: map `Constants.public.Enums.error_code` exhaustively; add text for QUESTION_UNAVAILABLE; NOT_PAIRED on unpair retry = success; 42501 = signed out → back to auth.
- Commands to re-run: `npm ci && bash qa/ci/app.sh && npm run format:check` (typecheck, lint, 50 tests green); `npx expo export --platform ios|android --output-dir "$TMPDIR/bonded-<p>"`; `npx expo-doctor` (20/20)
- Watch out for:
  - git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools. No simulators on this Mac. No AI attribution in commits.
  - `expo-font` needs its peer `expo-asset` installed, or the app (and Jest) fails with "Cannot find module 'expo-asset'".
  - `src/ui/tokens.json` is a verbatim copy of `design-handoff/tokens/tokens.json` (Prettier-ignored); `src/ui/__tests__/theme.test.ts` fails if they drift. To update: copy the file, don't edit it.
  - Only `src/ui/theme.ts` may hold colour/font literals (eslint `no-restricted-syntax`). A later rule set must spread `tokenOnlyRules()` or it silently replaces these rules.
  - TS has no Node types (`"types": ["jest"]`): import JSON instead of using `fs` in tests.

## Doing
- —

## Done (since last update)
- MOB-03 theme on `mobile/MOB-03-theme` (ready for lead review): `src/ui/` (tokens.json copy, theme.ts with colors light/dark, type styles with weight baked into the family, space/radius/size/motion, `personColors(colors, isMe)`), ThemeProvider following the system scheme (also feeds the navigation theme), Outfit + DM Sans via `@expo-google-fonts` behind the splash (system font fallback on load error), root and tab layouts themed, lint rule against hard-coded colours, font sizes and font names (probe file: 6/6 flagged, `transparent` allowed). Added missing `expo-asset`. Tests: token drift, light/dark key parity, every type token maps to a loaded font, personColors in both schemes.
- Verified: typecheck, lint, format:check, `npm test` (50 tests), `expo export` iOS and Android, `expo-doctor` 20/20. Light/dark not seen on a device (no simulators).

## Next
- MOB-29 i18n, MOB-04 components + gallery, MOB-05 mascot, MOB-06 data layer (MOB-02 after LEAD-03 + D30)

## Blocked
- Simulator checks (MOB-01 boot, MOB-03 light/dark on device): waiting on the PO dev environment (Xcode fix, Android Studio). Stand-ins: `expo export` for both platforms plus Jest render tests.

## Needs from
- lead: review MOB-03. Nothing outside my ownership changed (`.prettierignore` is mobile's from MOB-01).
- qa: no CI change; `qa/ci/app.sh` covers it. Consider adding `npm run format:check` to the `app` job (not run there today).
- backend: none

## Contract changes in flight
- —

## Questions for the product owner
- —
