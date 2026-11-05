# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-17-couple-offers` · Task: BE-17 integration

## Resume here

- Branch `be/BE-17-couple-offers`, PR #97. Merged origin/main `4085973` without rebase after #91/220000 merged and deployed to dev (lead confirmation).
- Preserved every main DB suite plus offers, both public-RPC allowlists and all CONTRACTS log entries. Reviewed migration230000, offers tests and function source unchanged.
- Local offers46/reveal23/saver46/private helpers74/types/seed/plan/agent-sync pass. Types required the documented SUPABASE_HOME override (first attempt lacked it). Exact next step: require all seven refreshed CI checks. Then integrate main into #100; do not add unmerged230000 to #100. Lead alone merges #97 → #100; apply240000 before updated daily-reminder.
- Next implementation: BE-35 D37 archive consent guard from latest origin/main (BACKLOG). Requires mobile ack/security review; no main merges by backend.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; node supabase/tests/offers.test.mjs; node supabase/tests/rls.test.mjs; node supabase/tests/streak-saver.test.mjs; node supabase/tests/private-helpers.test.mjs; npm --prefix supabase/tests run check:types; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check; gh pr checks 97.
- Shared stack never reset/stopped. Dev only nyqbrsqqalygydtwvybb; no hosted writes. #102 retains partial Auth evidence; hosted parity/SMTP/device acceptance remains open (PO/QA). BE-31 needs PO go, BE-22 approved milestone, BE-13 after launch.

## Doing

- #97/#100 reviewed feature integrations after #91 merge.

## Done

- #91/220000 merged and dev deployment confirmed by lead.

## Next

- BE-35 after PR feedback is addressed.

## Blocked

- D28 local-day3 interpretation needs lead confirmation. Hosted Auth acceptance and function secrets/device evidence need PO/QA.

## Needs from

- Lead: green #97 → #100 merges/dev deployments; D28 confirmation; #102 documentation review.
- Mobile/security: BE-35 breaking proposal will need mobile ack and focused review.
