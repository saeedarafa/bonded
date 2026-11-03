# Security reviewer status
Updated: 2026-11-03 · Branch: security/SEC-04-typed-code · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code, 2026-11-03 (stopped for a usage limit)
- Branch + last commit: security/SEC-04-typed-code (status only; see git log). security/SEC-03-invite-link holds the SEC-03 status; security/SEC-02-recheck is untouched.
- Uncommitted work: none
- SEC-04 (#41 BE-26, head 86895dc): verdict **changes requested**, posted as a PR comment. F1 Medium: the inviter approves blind (they can't read the requester's name: can_read_profile; join_requests holds ids only). F2 Low: no cap on pending requests per invite, and a requester can re-request right after a decline. N1 dead private.complete_invite; N2 approve leaves claim.sub = requester for the rest of the tx; N3 authenticated keeps TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on join_requests; N4 Realtime DELETE events aren't RLS-filtered (needs_validation). D02/SEC-02 sign-off withheld until F1 and F2 are fixed.
- Checked: approve/decline authz (IDOR), the invite-id binding fix and its tests, the pending requester can't read couple/members/questions/answers, attempt counting, Realtime SELECT policy, grants. Tests on 86895dc: join-requests 23/0, rls 23/0, error-codes 52/0, private-helpers 74/0, invite-link 45/0; ended-couples and hardening were still running when I stopped (not seen).
- Exact next step: when backend pushes fixes for F1/F2 on #41, re-review: the name exposure is inviter-only, pending-only, length-capped, plus the decline-sticks and cap tests; then sign off D02 (the SEC-02 item). Then SEC-02 re-check on security/SEC-02-recheck.
- Commands to re-run: `git archive <head> supabase docs | tar -x -C <scratch>`, symlink ~/dev/bonded/supabase/tests/node_modules into <scratch>/supabase/tests, `env -i PATH=$PATH HOME=<scratch> node <suite>.test.mjs` (join-requests, rls, ended-couples, hardening).
- Watch out for: the harness blocks writing report files from a sub-agent, so the full reports are the PR comments (#46 SEC-03, #41 SEC-04). invites-v2/hardening take >5 min on PGlite.

## Doing
- nothing

## Done (since last update)
- SEC-03: focused review of PR #46 (BE-28, D36 invite_link) at e876172: **sign off**, no confirmed findings. Info notes: N1 fix #38 before MOB-33 ships Share link and never log invite_link tokens; N2 no per-link revoke (by design); N3 mint volume bounded. D37 sanity check: solo-caller accept path OK; residual SEC-01 F1 (typed code without approval), so BE-26 should land before or with MOB-33's join entry points. Posted as a PR comment.

## Next
- SEC-04 re-review of #41 after the F1/F2 fixes, then D02 sign-off
- SEC-02 re-check (branch security/SEC-02-recheck, not started)
- Verify MOB-33 (token logging, #38) when its PR opens

## Blocked
- —

## Needs from
- backend: #41 F1 (requester first name for the inviter) and F2 (decline sticks, pending cap); N1–N3 optional
- mobile: fix #38 before MOB-33 ships the Share link path (SEC-03 N1)
- lead: sequence BE-26 (approval for typed codes) before/with MOB-33 join entry points (D37)

## Contract changes in flight
- —

## Questions for the product owner
- —
