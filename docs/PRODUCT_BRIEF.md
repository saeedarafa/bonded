# Product Brief — Bonded

## The idea
A mobile app (iOS + Android) that helps couples feel closer through one small daily ritual: **both partners answer the same question each day, and each person only sees their partner's answer after giving their own.** Once both have answered, they can talk about it in a short thread. It takes a few minutes a day and builds a habit of real conversation.

## Who it's for
Couples who are dating, living together or married, including long-distance couples, who want an easy, low-effort way to keep learning about each other and stay connected despite busy lives.

## Core loop
1. Sign up and **pair with your partner** using a 6-character invite code or link.
2. Each day, both partners get the **same question**. It changes at midnight in the couple's timezone and never repeats.
3. You answer. Your partner's answer stays **locked** ("Answer to unlock") until you've answered too.
4. Once you have answered, the answers are **revealed**; once both have answered, a **thread** opens for replies and emoji reactions.
5. Push notifications ("Sam answered — answer to see it") and a **streak** for days you both answered bring you back tomorrow.

## MVP features
Accounts (email, Apple, Google) · onboarding · partner pairing · daily question · answer / lock / reveal · discussion thread + reactions · live updates · push notifications · daily reminder · streak · history of past questions · themed **question packs** (premium) · subscription + paywall · settings, unpair, delete account · analytics and crash reporting · 150+ original questions.

## Business model
Freemium subscription:
- **Free:** the daily question, pairing, threads, streak, history.
- **Premium:** question packs, and later the AI features.
- **One subscription covers both partners:** if either pays, both get premium.
- Plans: yearly with a 7-day free trial, and monthly. Purchases run through RevenueCat.

## Later: AI features (Phase 2)
With each person's opt-in consent:
- Answers are analysed for themes, sentiment and depth to build a **private, evolving profile** of each partner.
- A **weekly couple report**: strengths, growth areas and suggested questions.
- Rules: the couple report uses only answers both partners have already seen; each personal profile is visible only to its owner; crisis language shows support resources instead of insights; no training on user data.

## Inspiration and differentiation
The mechanics were studied from Paired (a leading couples app) by reverse-engineering its Android build. This app has its **own original design and question content**: wireframes and designs are supplied by the founder, and no copying of Paired's text, visuals or branding is allowed. The plan is to start smaller and simpler, then grow through the AI profile and weekly reports.

## Tech stack
Expo (React Native, TypeScript, Expo Router) · Supabase (Postgres with row-level security, Auth, Realtime, Edge Functions, pg_cron) · TanStack Query + MMKV · RevenueCat · Expo Push · Sentry · PostHog · EAS Build/Submit/Update. Business rules (such as the reveal rule) are enforced in the database, not the app.

## Project status (2026-11-02)
- **Done:** architecture, MVP feature list, contracts between agents, and database migrations, with 23 passing tests (reveal rule, pairing, streaks, premium).
- **Design:** approved and handed off in `design-handoff/` (77 screens, design system, mascot Bao & Bun).
- **Next:** five agents (lead, mobile, backend/data, QA, release validation) plus a security reviewer work in parallel over a 7-week plan (M1–M6). See `AGENTS.md`.
- **Founder:** a solo indie hacker and the product owner.

## Key files
`AGENTS.md` · `docs/plan/{BACKLOG,SCOPE,DESIGN_DELTA}.md` · `docs/CONTRACTS.md` · `docs/ARCHITECTURE.md` · `design-handoff/` · `supabase/` · `qa/`
