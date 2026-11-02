# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-08-notify-v2` · Milestone: M3

## Resume here

- Branch: `be/BE-08-notify-v2`, rebasing onto `origin/main` after BE-12 merged.
- Exact next step: finish this rebase, rerun the DB/Deno checks, force-push PR #17 and await green CI/lead merge. Do not deploy until a safe dev project is identified.
- Watch out for: `public.claim_push` is service-role-only; it is a PostgREST wrapper over the locked private implementation.

## Doing

- BE-08 / PR #17: resolving its post-BE-12 rebase conflicts for CI.

## Blocked

- Dev deployment is blocked because the linked Supabase project is explicitly labelled production by the CLI.

## Needs from

- Lead: merge PR #17 on green CI and identify an unambiguous dev project for deployment.
