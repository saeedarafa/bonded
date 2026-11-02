# Release validator status
Updated: 2026-11-02 · Branch: release/REL-01-checklist · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: release/REL-01-checklist @ "[REL-01] Checklist: kickoff scope (D02, D21, D26, D32, D33)"
- Uncommitted work: none
- Exact next step: `git switch -c release/REL-02-business-checks` from REL-01, then write the §BIZ checks (D27 paywall rows incl. D21 split, D31, trial copy, restore, ≤3-tap reachability)
- Commands to re-run: `node scripts/plan/generate.mjs --check` (must say `up to date`)
- Watch out for: `/usr/bin/git` crashes; use `DEVELOPER_DIR=/Library/Developer/CommandLineTools git -C /Users/saeedarafa/dev/bonded-release ...`. No remote yet: commit locally only. Don't hand-edit `screen-requirements.csv`.

## Doing
- REL-02 business-rule checks (next)

## Done (since last update)
- REL-01: RC_CHECKLIST updated for kickoff scope. Added Coverage section (decision → check map), FUN-15 (widgets), FUN-16 (invite token), UI-08 (Rive mascot), BIZ-09 (free recap), STORE-06 (Spicy pack absent), PRIV-04 (token not logged). Changed FUN-02, FUN-03, FUN-04, A11Y-03, STORE-02. `screen-requirements.csv` already current (screen 38 is P0); generator `--check` up to date.

## Next
- REL-02, then REL-03 (M2 dry run, waits on MOB-09, MOB-11)

## Blocked
- —

## Needs from
- lead: scope-map.json notes so the generated rows carry the new decisions (I won't hand-edit the CSV):
  - 38: BEH note should add "never shows partner answer before I answered (FUN-04)"; data note "no answer text in timeline".
  - 10: data `invite.link` → "invite.link with token (D02)".
  - 32: note "no Spicy · 18+ pack at launch (D33)".
  - 31: data "weekly aggregate; free = days together only (D21)".
- lead: `.github/skills/bonded-release-check/SKILL.md` §4 and `.github/agents/release-validator.agent.md` (Store row) still say the Spicy 18+ pack "may require a mature rating"; D33 holds the pack. Please update to "rating without the Spicy pack; pack absent (STORE-06)".
- mobile (MOB-30): a way to dump the widget timeline data in a dev build so FUN-15 can prove no answer text is stored.

## Contract changes in flight
- —

## Questions for the product owner
- —
