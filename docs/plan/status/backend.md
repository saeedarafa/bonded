# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-18-server-premium-contract` · Task: BE-18/MOB-19 contract alignment

## Resume here

- Branch `be/BE-18-server-premium-contract`, PR #120; source839c024, original final heade2d2fcf has seven green checks (run42055398023). Merged origin/main `65d014d` without rebase; premium contract source unchanged. No runtime/schema/types change in this PR.
- Contract matches merged MOB-19: server entitlement rows for self/current partner, active and unexpired (null lifetime); SDK customer info prompts refetch; purchase/restore waits for server confirmation. App checks expiry on fetch/refetch; DB enforces exact clock boundary.
- Exact next step: check refreshed #120 CI/feedback and lead merge. BE-35 handoff now on `be/BE-35-archive-consent` @0f6ee1a: latest main integrated, consent56/reveal23/types/static pass. Keep #115 draft until ready MOB-46 + mobile ack + QA-16 and complete integrated CI;250000 follows #100/240000.
- Startup authored PR comments/reviews/inline checked; no unanswered backend requests. #100 at8fa27cf and #102 atea05a51 still seven green/mergeable; await lead. QA-16 #119 atadb2612 accepted/security reviewed; db-reset/db-tests/functions/static pass, app missing CONFIRM_ARCHIVE. MOB-46 remote at7c36d21 WIP/no PR; never integrate unfinished companions.
- New lead P2 from #121: consider `get_streak.saver_reason` (`used_this_month` | `too_many_missed` | null) and `previous_streak`; optional saver notification. Evaluate on separate BE-11 follow-up branch; no unrelated code in #120. BE-31 needs PO go, BE-22 milestone approval, BE-13 after launch.
- Re-run: `git fetch`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view <n> --comments`; `gh pr checks 100`; `gh pr checks 102`; `gh pr checks 115`; `gh pr checks 119`; `gh pr checks 120`; `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`.
- No hosted writes/shared-stack resets. Dev only nyqbrsqqalygydtwvybb; never prod. Security BE-35 review holds throughba98aad; relevant consumer changes need review. Hooks .githooks; no secrets/AI attribution. Uncommitted none after push.

## Doing

- BE-18/MOB-19 contract wording requested by lead, separate docs PR from latest main.
- BE-35 backend complete; consumer integration pending on draft #115.

## Done

- #100/#102 requested integrations pushed and seven checks green.
- #115 main650f3b9 integration; consent56/reveal23/types/static green.

## Next

- Lead merges contract correction and green #100/#102; MOB-46/QA-16 integration then lead deploy250000 after240000.

## Blocked

- #115 needs mobile consent/error adoption + ack, QA-16 and green integrated CI. #100/#102 await lead merges. BE-31 needs PO go, BE-22 approved milestone, BE-13 after launch. Hosted Auth/device/function configuration evidence needs PO/QA. D28 local-day3 interpretation needs lead confirmation. No other unblocked BE backlog task.

## Needs from

- Lead: review §6 correction; merge/deploy #100 (240000 before updated daily-reminder), merge #102 docs; BE-35 companion integration250000 after240000; D28/partner ritual-time/J5 privacy decisions.
- Mobile: MOB-46 ack and sheet-only `p_archive_own:true`; `CONFIRM_ARCHIVE` handling including stale pending approvals.
- QA: QA-16 solo consent fixtures/refusal coverage.
- Security: re-review relevant consumer/source changes before #115 integration.
