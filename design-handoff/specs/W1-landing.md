# W1 · hellobonded.com landing + invite fallback

The marketing site at `https://hellobonded.com`: one landing page and the `/j/{code}` invite fallback. It is a plain static site on Cloudflare Pages. The lead builds it under `web/` in LEAD-04. It goes live only at launch.

- **Board:** `source/W01-Landing.dc.html` (16 frames: mobile scroll points, desktop, invite states, scroll timeline).
- **Working prototypes (the motion reference):** `prototypes/W01-landing.html`, `prototypes/W01-invite.html`. Open them over a local server (e.g. `python3 -m http.server` in `design-handoff/`) because they load `../assets/mascot/*.svg`. `?t=paper:0.5`, `?t=notes:0.9` or `?t=talk` jumps to a scroll point, and `?rm=1` simulates reduced motion.
- **Product truth:** `PRODUCT.md`. **Tokens:** `DESIGN.md` §2–4 (same colours, Outfit + DM Sans).
- **Direction (founder, 2026-11-11):** written for curious couples. The page leads with the mascots: Bao & Bun talk in speech bubbles and react with emoji as you scroll. Today's question is a crumpled paper note that smooths open as you scroll. The form is "folded notes": your note is open and your partner's stays folded until both have answered. The header is a floating, see-through pill. Mobile and desktop are both in scope.

## Page map (top to bottom, CRO order, founder review 2026-11-11)

| # | Section | id | Type | Frames |
|---|---|---|---|---|
| 0 | Floating pill nav (both mascots in the logo) + step tracker | — | fixed | all |
| 1 | Hero → today's note | `paper` | sticky track, 190svh | W1.1–W1.3, W1.12 |
| 2 | Answer alone → open together (+ Another question) | `notes` | sticky track, 230svh | W1.4–W1.6b, W1.13 |
| 3 | Turn answers into conversations | `talk` | normal flow | W1.7 |
| 3a | CTA: Try tonight's question together | `try` | normal flow | W1.7a |
| 4 | What you gain (surface band) | `gains` | normal flow | W1.7b |
| 4a | Made for where you are | `where` | normal flow | W1.7c |
| 4a+ | More ways to stay close (Premium features, not labelled) | `more` | normal flow | W1.7d |
| 4b | Little moments (one day) + bids research | `day` | sticky track, 200svh | W1.8a–d |
| 5 | Why it works: research + therapist (surface band) | `why` | normal flow | W1.9, W1.9b |
| 5a | CTA: Your first question is one tap away | `try2` | normal flow | W1.9c |
| 6a | FAQ (surface band) | `faq` | normal flow | W1.10b |
| 7 | Close + footer | `get` | normal flow | W1.11 |
| — | `/j/{code}` invite | — | separate page | W1.14–W1.16 |

## Show, don't tell (founder review 2026-11-11)
Nobody reads long text, so every long-text section is an animated scene with a short title and one line. Detail lives behind "Read the research" fold-outs.
- **Scene box (`.art`):** 150 tall, radius 22, `bg` on `surface` bands and `surface2` in Why and Bids. Mascots at 60 × 48 (`.m.mm`).
- **Trigger:** each scene plays **once** when 35% of it scrolls into view (IntersectionObserver adds `.in`). Reduced motion (or `?rm=1`) shows each scene's end state with no movement.
- **Speech chips (`.sb`):** Outfit 700 14, `surface` with a `line` border (`partner` border for Bun).

### 3 · What you gain: five scenes (W1.7b)
Desktop grid is 3 + 2, mobile 1 column. Each has a title (Outfit 700 19) and one line (`text2`, at most 9 words).

| Title | Line | Scene |
|---|---|---|
| Know them more each year | Every answer shows who they are now. | Bao & Bun. 🎸 🌮 ✈️ pop above Bun one by one (0.3 / 0.8 / 1.3 s, squish) |
| More than logistics | Something real to talk about tonight. | Chip "Did you pay the bill?" is struck through (0.6 s), lifts away (1.4 s), and "What made you laugh today? 😄" rises in (1.7 s) |
| Feel heard, not judged | Nobody goes first. Nobody gets graded. | Two mini notes (orange and sky covers) lift open **at the same moment** (1 s), then the "Opened together" chip |
| Close at any distance | Same question, wherever you both are. | Bao and Bun far apart under a dashed arc. 🧡 travels the arc (CSS `offset-path`, 2.8 s loop) |
| A habit that's easy to keep | A few minutes a day. Miss one? No guilt. | The counter counts up to **7** "days in a row" while 7 day squares fill orange one by one |

### 4a+ · More ways to stay close (W1.7d)
**Founder 2026-11-11: no Premium section on the landing page.** The goal is the install. Premium features appear as reasons to love the app, **without the word Premium, prices, plans or trials**. The only disclosure is the FAQ line "Some extras … come with an optional upgrade inside the app". It must stay, so the page never implies paid features are free; this protects App Store review and consumer-law compliance.
- H2: **More ways to stay close.** Sub: For the nights you want to go a little deeper. Four scenes (`surface2` boxes), a 4-column grid on desktop and 1 column on mobile:

| Title | Line | Scene | Feature (D-ref) |
|---|---|---|---|
| Questions for every mood | Deep, silly or dreamy. Pick what fits tonight. | Four pack cards (Deep Talks, Laugh Together, Future Us, Long-Distance) fan out one by one, each in its own tint | Question packs (S07) |
| Say it out loud | Send a voice answer when typing isn't enough. | A voice chip with a play button, a waveform pulsing and "0:12", Bao beside it | Voice answers (D46) |
| Look back together | Every answer you've shared, kept for both of you. | Three past-day rows (Day 12/11/10 + question) drop in one after another | Full History (D55) |
| Your week, every Sunday | A little recap of the moments you shared. | A recap card: "Your week together" counts to 6 days answered and 14 replies, then "❤️ Most-loved answer" | Weekly recap (D21) |

- D27 still applies: show only features that are shipped on launch day; remove a scene if its feature isn't live.
- "More hugs, kisses & goodnights" is shown through the playground instead (no counts). Streak saver and longer answers are not shown.

### 5 · Why it works: three animated findings (W1.9)
Desktop: scene left, text right. Each has an H3, **one sentence**, the "In Bonded" line, then a `details` fold-out "Read the research" (`youText` 14, chevron) holding the longer explanation and the citation.

| H3 | Sentence | In Bonded | Scene |
|---|---|---|---|
| Questions build closeness. | Pairs who traded gradually deeper questions felt much closer after just 45 minutes. | a new question, every day. | Three "?" bubbles pop (0.2 / 1 / 1.8 s) while Bao and Bun step closer in three steps |
| Knowing their world keeps you close. | Knowing each other's worries, hopes and days helps couples weather change. | every answer adds to your map. | A faint grid map. An orange route draws itself (2 s) and the 🏠 🌱 ✨ pins pop on it |
| Feeling understood is the heart of it. | Closeness grows when one opens up and the other responds with care. | a thread after every reveal. | Bao: "Rough day…" → Bun: "I'm here 🧡" → a heart beats between them |

Fold-out texts and sources are the ones from §5 above. The therapist block line becomes: **Every question is reviewed before it reaches you.**

### 4b · Turn toward the little moments + playground (W1.8d, W1.8e)
- **Scene:** Bao: "Look, a rainbow! 🌈". Bun starts turned away (rotated, desaturated), turns toward it (1.1 s) and says "Wow! 😍". H3 **Turn toward the little moments.** Sentence: Partners reach out in tiny ways all day. Couples who turn toward them tend to be happier. In Bonded: sending one takes a tap. Answering takes one more. The fold-out holds the bids research (Gottman & DeClaire 2001; Driver & Gottman 2004).
- **Playground** (`#play`, `surface` card, radius 28): "Try it: send Bun a little something." A `youTint` stage with Bao (left) and Bun (right), a speech chip, and two 56 px pill buttons. It mirrors D48 and is a demo only, sending nothing.
  - **Kiss** (tap): each tap flies a 💋 from Bao to Bun (0.9 s) and the counter shows ×1…×5 (max 5). After a 0.9 s pause Bun goes happy and says "3 kisses! 😚 Kissing you back" (or "A kiss! 😚").
  - **Hold to hug** (press and hold; Space or Enter also hold): the button fills orange left to right over up to 5 s. Bao & Bun slide together until they touch, both go happy, and a 🧡 grows above them. On release, Bun says "Quick hug! Again? 🙂" (< 1 s), "That was a good one 🧡" (< 4 s) or "Best hug ever. Hugging you back 🤗".
  - Hint: Tap Kiss up to 5 times. Hold Hug longer for a longer hug.
  - Reduced motion: no flying or sliding, only the replies.

### Store badges
The placeholders now carry the Apple logo and the four-colour Google Play triangle beside the text (icon 24, gap 8, label 17 px, no wrapping). **Production still ships the official badge artwork** from Apple Marketing Resources and the Google Play badge generator, unchanged.

## Research findings as a FIGURE VIEWER (founder, 2026-11-11; replaces the 2 × 2 card grid below)
The founder kept the four illustrations but rejected the card grid as generic. The findings are now **one journal-style figure viewer**, with no cards, header strips, chip rows or coloured footer blocks.
- **Tabs** (`role="tablist"`, a hairline `line` underline, scrolling sideways on phones): **Fig. 1** Closeness · **Fig. 2** Novelty · **Fig. 3** Intimacy · **Fig. 4** Little things. The active tab has dark text, a `youText` "Fig. n" label and an orange underline that fills as an autoplay progress bar. Left/right arrow keys move between tabs.
- **Figure stage** (left on desktop, 1.2 : 0.8 columns; on top on phones): a "light table" panel (`bg`, radius 20, a hairline inset border, a 22 px **graph-paper grid** in sand at 28%), with the chart inside (max 440 × 260). Below it, a real paper-style caption: **Fig. n.** + title + "Illustration of Aron et al., 1997." + the ILLUSTRATION tag.
- **Text** (right on desktop, no box): the claim H3 (Outfit 700 32/37 desktop, 28/33 mobile) with citation chips; one sentence (17/26, max 46ch); a study line "STUDY · design · participants · journal and year" (small caps label); then, under a hairline, **In Bonded** as a note with an orange arrow circle and Outfit 600 19 text.
- **Behaviour:** while the viewer is in view it auto-advances every **7 s**, replaying each chart's animation. Hovering pauses it, and any tab click or arrow key stops autoplay. Panes slide in 10 px (no opacity fade, so content is never invisible). Reduced motion: no autoplay, final chart states. Visibility is checked against the viewport on every animation frame (not IntersectionObserver), so it is robust.
- **Robustness rule:** charts are drawn in their **final state by default** (bars full, lines drawn, points, hearts and highlights visible). The `.in` class only adds the entrance animation (`from` keyframes). A missed trigger (a throttled or background tab, a JS error) can never leave a figure blank. Each figure replays when shown and whenever the viewer re-enters the viewport.
- Unchanged: the method strip above, the References (7) list and the honesty line below; the chart designs and the citation, study and In-Bonded copy (see the table in v3).

## Research section v3: "really science-based" (founder, 2026-11-11)
The section borrows a research paper's visual language, honestly and inside Bonded's world.
- **Method strip** (under the centred header, replacing the seal card): three numbered steps, side by side on desktop with a dashed `you` connector that draws in, stacked on phones. Each step is a `bg` card with a 48 px icon tile and a number badge:
  1. 📖 **Peer-reviewed research**: We start from published studies on what brings couples closer.
  2. 📝 **Turned into a daily ritual**: Each finding shapes how the questions and little moments work.
  3. Rosette seal **Reviewed by a licensed therapist**: A licensed marriage and family therapist (LMFT) reviews every question before it reaches you. (`you` border; the quote slot lives here.)
- **Four figure cards** (2 × 2 on desktop; a swipe row on phones). Each card has:
  - A figure panel (`surface2`) with a caption **Fig. n** plus a title, an **ILLUSTRATION** tag, and an inline SVG chart with dashed gridlines, axes and labels (DM Sans 10–11).
  - The H3 with **citation chips** (numbers linking to `#ref-n`, which open the References list).
  - One sentence, plus **study chips** (design · participants · journal and year).
  - The `youTint` "In Bonded" panel.

| Fig. | Chart | Animation | Study chips | Refs |
|---|---|---|---|---|
| 1 Closeness after 45 minutes | Bars: Small talk (low, sand) vs Deeper questions (high, `you`) | Bars grow (squish), then ▲ pops | Lab experiment · Pairs of strangers · *PSPB* 1997 | 1 |
| 2 Satisfaction, before and after | Slope chart: Familiar activity (flat, sand) vs New activity (steep, `you`) | Lines draw, end points pop, labels rise | Survey + lab experiments · Married & dating couples · *JPSP* 2000 | 2 |
| 3 The intimacy process | Loop: Opens up → Responds with care → Feels understood → Closer ♥ | Each node lights `youTint` in turn (4.8 s cycle) while an orange dot travels the loop | Theory + diary studies · Everyday conversations · 1988 · *JPSP* 1998 | 3, 4 |
| 4 A week of little moments | 7 day squares (M–S). ♥ on M/W/F; the next day fills `you`; curved arrows between | Hearts pop, arrows draw, next days fill (staggered) | Daily diary study · Couples in relationships · *Pers. Relationships* 2010 | 5 |

- **References (7)** is a collapsible list with full APA citations and DOI links. Citation chips open it and scroll to the entry (96 px scroll margin under the nav). The entries:
  1. Aron et al. 1997, *PSPB* 23(4)
  2. Aron, Norman, Aron, McKenna & Heyman 2000, *JPSP* 78(2)
  3. Reis & Shaver 1988, *Handbook of Personal Relationships*
  4. Laurenceau, Barrett & Pietromonaco 1998, *JPSP* 74(5)
  5. Algoe, Gable & Maisel 2010, *Personal Relationships* 17(2)
  6. Gottman & DeClaire 2001
  7. Driver & Gottman 2004, *Family Process* 43(3)
- **Honesty line (centred):** Figures illustrate the direction of published findings. They are not study data or Bonded results, and Bonded itself hasn't been studied. Bonded is a daily habit, not therapy. Going through something hard? A couples therapist can help.
- **Rules:** charts never show numbers or axis values (no invented data). The ILLUSTRATION tag is mandatory. **The lead verifies every citation, study design and participant chip against the papers before launch.**
- Reduced motion: charts render in their final state, and the loop dot is removed.

## Download CTA panels (founder, 2026-11-11)
- Both inline CTAs (`#try`, `#try2`) are a **solid `you` (orange) panel**: radius 32, 48/56 padding on desktop, and a soft orange shadow `0 18px 40px rgba(255,138,76,.28)`. It is the only solid-orange block on the page, so it reads as "the place to act".
- Inside the panel:
  - H2 (40/44 desktop, 30/34 mobile) and sub, both in `text` (#2A1407 on #FF8A4C ≈ 7:1).
  - A countdown pill (`surface` at 60%): clock, **Free** · Next question in **HH:MM:SS**.
  - Black store badges with a dark shadow that lift 2 px on hover.
- Bao & Bun (76 px desktop, 64 px mobile) **stand on** the panel's top edge, at the top right (their base overlaps the edge by 3 px). The section has 120 px of top padding to make room for them and their bubble.
- **They talk while the panel is ≥ 50% in view.** A speech chip above them cycles every 2.6 s: Bao "Tonight's question is ready ✨", then Bun "Let's answer it together 🧡" (sky border), then Bao "Tap a badge 👇". The speaker switches to the happy face and hops (squish bounce). The loop stops when the panel leaves view.
- **Cheer on intent:** hovering (or touching) a store badge makes both jump with happy faces, and the chip says "Yay! See you inside 🎉".
- Reduced motion: chips still change text, but nothing hops.
- **Phone spacing (< 960 px):**
  - Section: 100 px top (room for the mascots and their bubble, 20 px clear above the bubble), **24 px bottom**. The section after a CTA starts with **40 px** top padding, so the next section's background change lands right under the panel and its heading sits 64 px below the panel. On phones, other sections use 56 px top and bottom.
  - Panel: padding 26/20/20, radius 28, gap 18.
  - H2 28/32; sub 16/23 with 8 px above; countdown pill 13 px with 14 px above.
  - **Badges are the exact same component as the closing section's badges** (48 px tall, same padding, 17 px store name, 24 px logo) — no panel-specific resizing. On phones the panel content is **centred**, and the two badges stack as identical 150 px badges centred in the panel (the panel is too narrow for two full-size badges side by side). Desktop: badges side by side on the right.
  - The countdown pill reads "Next question in **HH:MM:SS**" (no "Free", so it stays on one line).
  - **Reassurance line** under the badges: "Free to download · No card needed" (DM Sans 600 13, `text` at 80%). On desktop it is centred under the badges.
  - Phones: heading, sub, countdown pill, badges and reassurance line are all centred; 16 px gap rhythm.
  - Mascots 58 × 47, 20 px from the right; bubble 13 px.
  - Desktop is unchanged.
- Desktop: copy left, badges right. Phones: copy, then the two badges stacked full width at 52 px.

## Names: Bao & Bun only (founder, 2026-11-11)
- The page uses no human demo names. The viewer is **Bao** (orange) and the partner is **Bun** (sky) everywhere: the folded notes, the talk thread, the voice answer, the seal on the folded note and all the bubbles.
- Section heads for "What you gain", "More ways to stay close", Research and FAQ are centred. On desktop, the 5-scene gains grid centres its last row (3 + 2).

## Research header centred (founder, 2026-11-11)
- The "Built on what research says about closeness." H2, its sub and the therapist seal strip are centred over the 2 × 2 card grid. Text inside the strip stays left-aligned.

## Try it tray v2 (founder, 2026-11-11)
- **Per-gesture tints from the design tokens:** Kiss and Miss you in blush tint with `blushText` icons; Morning in `youTint` with `youText`; Goodnight in `partnerTint` with `partnerText`; Hug in solid `you` with a soft orange glow. No borders.
- **Send feedback:** the tapped button squishes (0.86 → 1.1 → 1, 450 ms) and a "+1" (Outfit 800 13 `youText`) floats up 22 px and fades. The "Sent: n" counter pops.
- **Focus ring:** keyboard only, 2 px `youText` with a 3 px offset (it should never read as a selected state).
- **CTA:** "Send real ones tonight →" is a 48 px pill with a 1.5 px `you` border on `surface`, turning `youTint` on hover.

## FAQ: Premium questions (founder, 2026-11-11)
**Order (founder): the four Premium questions come last**, after the general questions (Is Bonded free? → Who writes the questions? → Does my partner need the app too? → What if one of us misses a day? → Who can see our answers? → Long-distance → the four Premium questions). Originally they were added right after "Is Bonded free?" (whose answer now names "Bonded Premium, an optional upgrade inside the app"). All answers come from product decisions (one subscription covers both; D55 lapse rules; D46 long answers stay readable; D27 shipped features only). **No prices or trial lengths on the site.**
- **If I pay for Premium, does my partner need to pay too?** No. One subscription covers you both. When either of you subscribes, you both get every Premium feature, even if your partner joins after you've subscribed.
- **What do I get with Premium?** Every question pack, your whole history (not only today and yesterday), voice answers and messages, longer answers, more hugs, kisses and goodnights, a streak saver for the odd missed day, and the full weekly recap. *(Remove any item not shipped at launch, per D27.)*
- **What happens if Premium ends?** Nothing is deleted. You both keep the daily question and every free feature. Older days in your history lock again until you renew, and longer answers you already wrote stay readable.
- **How much is Premium, and can I cancel?** Plans and prices are shown in the app before you subscribe. You can cancel anytime in your App Store or Google Play subscription settings.

## FAQ centred (founder, 2026-11-11)
- The H2 "Questions couples ask us." is centred, and the question list (max 760) is centred under it as a block. Questions and answers stay left-aligned inside the block so the chevrons line up.

## Try it hint follows the layout (founder, 2026-11-11)
- The stage bubble before the first gesture reads **"Tap or hold one on the left 👈"** at ≥ 960 px (buttons sit left of the stage) and **"Tap or hold below 👇"** on phones (buttons sit under the stage). It updates on resize until the first gesture.

## Hero centred on desktop (founder, 2026-11-11; overrides the two-column desktop hero)
- At ≥ 960 px the hero track (`#paper`) is **one centred column**, like phones:
  - H1 (64/66) in a container max 900 px wide, so it wraps to 2 lines. It starts 118 px from the top.
  - Sub (max 46ch), badges and the proof list (a left-aligned list, centred as a block) are all centred.
  - The crumpled note sits centred below, with Bao & Bun anchored to its lower corners and "Scroll to open" under it.
- On scroll the hero copy block shrinks to the caption's height on desktop too, so the opened note gets the room. The caption "A new question every morning." is centred.
- The notes and day tracks keep their two-column desktop layout.

## SEO (founder, 2026-11-11): required build step for LEAD-04
**Tooling:** when building `web/`, run the **claude-seo** plugin (github.com/AgriciDaniel/claude-seo, MIT; reviewed 2026-11-11). Use a dedicated SEO sub-agent run before launch:
- `seo-page` on the built page: run its deterministic `page_checks.py` on the saved HTML (`--file`, no network) and fix every finding that applies.
- `seo-technical` (crawlability, robots, canonical, headers), `seo-schema` (JSON-LD), `seo-performance` (Core Web Vitals), `seo-sitemap`, and `seo-geo` (AI-search visibility: clear entity facts, FAQ).
- **Install note:** the installer copies skills and agents into `~/.claude` and adds a global PostToolUse hook (a Python JSON-LD validator on every Edit/Write). Install only with the founder's OK, ideally as a plugin enabled for the build session only. Do **not** enable the paid-API extensions (DataForSEO, Ahrefs, SE Ranking, Profound, Firecrawl). Read any script before running it.

**Page requirements (design-side):**
- `<title>` **Bonded · Fall for each other a little more, every day** (52 chars).
- Meta description (≤ 155 chars, was ~220): **A daily question for couples: answer on your own, open both answers together, then talk. Reviewed by a licensed therapist. Free on iOS and Android.** (147 chars).
- Canonical `https://hellobonded.com/`. `lang="en"`. Exactly one H1 (hero). H2 per section, H3 inside cards (no skipped levels in main content).
- **Every animated or illustrated piece keeps its words as real text in the DOM** (headlines, scene titles, figure captions, chart `aria-label`s, FAQ answers). Animation is never the only carrier of meaning.
- Open Graph and Twitter tags with the 1200 × 630 image from J1. `og:url` matches the canonical.
- **JSON-LD:**
  - `Organization` (name Bonded, url, logo).
  - `MobileApplication` (name, operatingSystem "iOS, Android", applicationCategory "LifestyleApplication", `offers` price "0" for the free download). **No `aggregateRating` or `review` until real ones exist.**
  - `FAQPage` using the FAQ questions and answers verbatim (all 10, Premium ones last).
- `robots.txt` (allow all, sitemap link) and `sitemap.xml` (`/`, `/terms`, `/privacy`). **`/j/*` stays out of the sitemap and carries `noindex`** (already specified).
- Images: real `alt` (decorative mascot SVGs `aria-hidden`), explicit `width`/`height`, the hero is not lazy-loaded.
- Performance targets: LCP < 2.5 s, CLS < 0.1 (sticky tracks and the countdown must not shift layout), INP < 200 ms. Self-host and preload the two fonts. Keep JS small; no third-party scripts.
- Keep claims SEO-safe: no "proven" or "#1"; the research section keeps its ILLUSTRATION tags and honesty line.

## Try it: NIGHT BY DEFAULT (founder, 2026-11-11; overrides the colour notes below)
- The section **starts in the night scene**: a full-bleed dusky plum **#3E2D47** band. Moon (left of centre, under the bubble) and stars twinkle (2.4 s) in the transparent stage; Bao & Bun are awake; the bubble reads "Tap or hold below 👇".
- On plum: title, sub, "Little things", counter and labels in #F6ECDF. Gesture circles stay `surface` with coloured icons. **Hug is `you` orange** with a dark icon (dark brown would disappear on plum) and keeps its invite pulse. The CTA is a **cream #FFF9F1 pill with dark text** (hover `youTint`). Focus rings are cream.
- **Gestures:**
  - **Morning:** the band switches to the orange day look (sun rises, dark text, dark CTA) for 2.8 s, then returns to night.
  - **Goodnight:** stays night, and both mascots doze.
  - **Kiss, Hug, Miss you:** play over the night sky.
- Implementation: `data-default="night"` on the section; after every gesture it restores the night state.

## Try it colours (orange day look, now used during "Morning" only) (founder, 2026-11-11; overrides the dark-band, dark-card and peach notes)
- **Section:** a full-bleed **`you` orange band (#FF8A4C)**, the same orange as the download CTA panels. It is clearly different from the cream day track above and the light-cream research band below.
- **No card and no inner backgrounds** (founder, 2026-11-11): everything sits directly on the orange.
  - Title, sub, "Little things" and the "Sent: n" counter are in `text` (#2A1407 on #FF8A4C ≈ 7:1).
  - Sound toggle: cream at 40% with a thin dark border.
  - Stage: transparent. Bao & Bun stand on the orange; the speech bubble stays `surface`.
  - Gesture buttons: `surface` circles with coloured icons (blush text, `youText`, `partnerText`). **Hug is a deep-brown #2A1D16 circle with a cream icon**, with a cream invite pulse.
  - CTA: a solid #2A1407 pill (52 px) with cream text, "Send real ones tonight →".
  - **Goodnight:** the whole band fades to dusky plum #3E2D47 for 2.8 s (the text turns #F6ECDF; moon and stars rise), then back to orange.
  - Phones: stage 220 px tall. Desktop: stage 340 px, controls on the left. The card uses the light-theme internals: dark title, `text2` sub, `surface2` tray, tinted gesture buttons, and the orange-outlined CTA pill on cream.
- **Stage:** `youTint` → #FFEFE4 gradient (dusk #3A2C40 at night).
- The review-only `?tc=a|b|c` switch in the prototype is not part of the build.

## Try it: dark card (superseded)
- The section (`#bids`) is a **`youTint` (#FFE3D1) peach band**, full bleed, so it differs from the cream day track before it and the light-cream research band after it. The card is **deep warm brown #2A1D16** (from the dark palette), with no border and the shadow `0 22px 44px rgba(42,20,7,.22)`.
- On the card:
  - Title #F6ECDF; sub #CDBBA8.
  - Sound toggle #3A2B22 with a #4E3C30 border.
  - Tray #3A2B22 with light labels; the "Sent" number in #FFA676.
  - CTA pill: transparent with a `you` border and #FFA676 text; on hover, a 14% orange fill.
  - Focus rings in #FFA676.
- The stage is a light window (gradient #FFF9F1 → #FFEADC; dusk #3A2C40 at night) with dark text.
- **Phones:** stage mascots 86 × 69 with a 24 px gap and 12 px side padding, so they never clip. Labels are 10.5 px, and the tray runs nearly to the card edges.

## Try it v3 (founder review 2026-11-11, latest)
- **Width:** the card spans the full content width (same edges as every section: 1120 max, starting at the shared `--side` edge). It is **not** a narrower centred card.
- **Desktop layout:** 40 px padding, columns 0.95 : 1.05 with a 48 px gap. Left column: the title (Outfit 800 34/38, "Try it: send Bun a little something.") with the sound toggle, the sub "Tap to send. Hold the hug for a longer one. Sound on.", the gesture **tray**, then the CTA "Send real ones tonight →" (left-aligned). Right column: the stage spanning all rows, **360 px** tall, with mascots 124 × 100 on a soft `youTint` → #FFEFE4 vertical gradient (dusk #3A2C40 at night).
- **Tray:** a `surface2` panel (radius 24) with a header row: "Little things" on the left and a live **Sent: n** counter on the right (Outfit 800 `youText`; pops each time). The counter goes up on every kiss tap, each released hug and each Morning, Goodnight or Miss you. Below the header sits the five-button fan (`surface` circles, Hug in `you`).
- **Phones:** the title (26/30), the sub, the stage (260 px), the tray running nearly to the card edges, then the CTA centred. Below 360 px, labels drop to 10 px and the padding tightens, so no labels overlap at 320 px (checked).

## "More ways to stay close" scenes, v2 (founder review 2026-11-11)
All four scenes are 184 px tall, `surface2`, with their content **centred both ways**. Three use the same **mini card** (`surface`, radius 14, width `min(240px, 100% − 28px)`, padding 12/14, soft shadow, an 11 px `youText` header label) so they read as one family:
- **Questions for every mood:** three pack cards (Deep Talks, Laugh Together, Future Us) fan out at −10° / 0° / +10°, spaced so each name stays fully visible.
- **Say it out loud:** an answer card with the header "Today's question", "What song reminds you of us?", a voice chip (play button, 16-bar waveform, 0:12) and "● Bao · voice answer". The waveform fills from `line` to `youText` bar by bar as if playing; then Bun's 🥹 pops at the card's corner (3.4 s).
- **Look back together:** a History card with three rows (Tue 12 / Mon 11 / Sun 10 + question, truncated with an ellipsis). Each row ends with an orange and a sky dot ("you both answered"). The rows drop in one by one.
- **Your week, every Sunday:** a recap card with "Your week together", a 7-square week strip (6 fill orange one by one; 1 stays empty, since a missed day is never highlighted), counters ticking up to **6** days and **14** replies, then "❤️ Most-loved: 'The way you hum…'".
- Try it's top padding is reduced to 8 px, because the day track's frame already provides the gap.

## Round 2026-11-11 (late): no repeats, aligned fan, better studies, spacing
- **No repeated question:** the hero paper note now shows **If we could relive one day together, which would you pick?** The folded notes keep "What's a small thing I do that makes your day better?" (plus the two extra pairs). Never show the same question in two sections.
- **Gesture fan alignment:** no arc. Each button is a grid of a 76 px icon cell (circle centred) plus the label, so every icon centre and every label shares one line. Hug is 60–72 px in `you`; the others are 46–56 px. Labels: Kiss · Morning · **Hug** · Goodnight · Miss you (12 px; 11 px below 400 px). The hold instruction lives in the card sub: Tap to send. Hold the hug for a longer one. Sound on.
- **Research: four cards, a 2 × 2 grid on desktop** (a swipe row on phones). "Love maps" is removed as not specific to Bonded's daily mechanics. Lead verifies all citations before launch:
  1. Questions build closeness (Aron et al., 1997). In Bonded: a new question for both of you, every day.
  2. **Something new keeps you close.** Couples who share new experiences together report feeling more satisfied with their relationship. Aron, Norman, Aron, McKenna & Heyman, 2000, *JPSP* 78(2), doi:10.1037/0022-3514.78.2.273. Scene: four day tiles (Mon–Thu) flip in with a new emoji each. In Bonded: a new question every day, and packs for every mood.
  3. Feeling understood is the heart of it (Reis & Shaver, 1988; Laurenceau et al., 1998).
  4. **Little things add up.** Small, everyday moments of appreciation give relationships a real boost. Algoe, Gable & Maisel, 2010, *Personal Relationships* 17(2), doi:10.1111/j.1475-6811.2010.01273.x. Scene: "Thanks for the coffee ☕", then "Anytime 🧡", then a heartbeat. In Bonded: a good morning, a hug or a goodnight takes one tap.
- **No duplicate little-moments sections:** the day track (230svh) ends by swapping its caption (80–92%) from **The small moments count most.** to **Turn toward them.** "Partners reach out in tiny ways all day. Couples who usually turn toward those moments tend to be happier together." plus a source line (Gottman & DeClaire, 2001 · Driver & Gottman, 2004). The separate "Turn toward the little moments" section and its rainbow scene are gone. Try it follows as a **centred card** (max 880, stage 300 tall on desktop, fan max 560 centred).
- **Desktop spacing:**
  - The hero copy is top-aligned, with the H1 starting 70 px under the nav pill (136 px from the top).
  - Every `.sec` uses `padding-block: clamp(64px, 6.25vw, 80px)`.
  - Inline CTAs use 48 px; Try it uses 40 px of top padding (it continues the day story).
- **Hero mascots on desktop** are anchored to the note itself (JS reads the note's box): Bao at the lower-left corner, Bun at the lower-right, bubbles just above them, and "Scroll to open" just under the note. Phones keep the stage-corner layout.

## Alignment and "Turn toward" revision (founder review 2026-11-11, latest)
- **One content edge for the whole page:** sections, sticky frames and the footer share `--side: max(var(--gutter), calc((100% - 1120px) / 2))` as their side padding. Every H1/H2 starts on the same x (73 px at 1280). The only exception is the centred close section. Never use `max-width + margin: auto` on one section and `vw` maths on another.
- **Hero proof, one icon column:** a list of three rows, each a 22 px icon cell plus text (DM Sans 500 15, `text`, bold key phrase):
  1. Rosette seal: Reviewed by a **licensed therapist (LMFT)**
  2. Book: Built on **decades of relationship science**
  3. Clock: **Free** · Next question in **HH:MM:SS** (live, `role="timer"`)
- **"Turn toward the little moments" + Try it are one section** (`#bids`). Phones stack them; desktop is 0.85 : 1.15 columns with the copy left and the playground card right, vertically centred. The rainbow scene is removed (the playground demonstrates the idea).
  - Copy: H2 **Turn toward the little moments.** Sub: Partners reach out in tiny ways all day. Couples who turn toward those moments tend to be happier together. Dot line: In Bonded, sending one takes a tap. Answering takes one more. Then the "Read the research" fold-out (Gottman & DeClaire 2001; Driver & Gottman 2004).
  - Card (stretch layout): title + sound toggle, then the sub "Tap a little thing to send it. Hold the hug for longer.", the stage (250 px; 280 on desktop), the five-button fan (spread edge to edge) and the CTA centred.
  - **New stage moments:**
    - **Morning:** a sun rises from below and settles under the bubble.
    - **Goodnight:** the stage dims to dusk, the moon rises (left of centre) and stars appear.
    - **Miss you:** two sky-blue pulse rings ripple out from Bun.
    - **Hug release:** seven 🧡/💛 hearts burst upward in a fan.
    - **Hug invite:** until the first gesture, the hug button gives off a soft orange pulse ring (off with reduced motion).

## Therapist credential (founder, 2026-11-11)
The reviewing therapist is a **licensed marriage and family therapist (LMFT)**. They stay unnamed. Use the credential everywhere the review is mentioned:
- **Hero proof:** "**Every question reviewed** by a licensed marriage & family therapist (LMFT)"
- **Seal strip:** **Every question, reviewed by a licensed therapist** / A licensed marriage and family therapist (LMFT) reviews every question before it reaches you, so each one is thoughtful, kind and worth answering together.
- **FAQ "Who writes the questions?":** … Then a licensed marriage and family therapist (LMFT) reviews every single one before it reaches you.
- **Meta description:** … Every question reviewed by a licensed marriage and family therapist (LMFT).
- **Rule:** keep their written confirmation of the credential and the review on file. If the review arrangement ends, remove every one of these lines before the next deploy.
These supersede the "relationship therapist" wording elsewhere in this spec.

## Revision: promise, proof, research and Try it (founder review 2026-11-11, latest; overrides earlier copy)
**Core promises, spread across the page** (founder picked all three):
- Hero H1 and `<title>`: **Fall for each other a little more, every day.** (mobile `clamp(32px, 9.6vw, 40px)`, line-height 1.1)
- "What you gain" H2: **Never run out of things to talk about.** Sub: A new question every day, and a few minutes that are only about the two of you.
- Closing H2: **Know each other like no one else does.** Sub: Free on iPhone and Android. Download Bonded, invite your person, and open the next question together.

**Hero proof** (replaces the "Free to start" pills): two lines under the badges (DM Sans 500 15, `text`, bold lead-in, 22 px icons):
- Rosette check seal (`you`): "**Every question reviewed** by a relationship therapist"
- Book icon (`youText`): "**Built on decades** of relationship science"
- Then the countdown line (13 px): clock icon, then "Free · Next question in **HH:MM:SS**".
- When the therapist's exact credential is confirmed, use it, e.g. "reviewed by a **licensed marriage and family therapist**". That is the single strongest trust upgrade available. Do not add "licensed" before it's confirmed.

**Live countdown** (hero and close): ticks every second to the next local midnight, which is when the question changes. The wording is "Next question", never "tonight's", so it's true at any hour. `role="timer"`, `aria-live="off"`. Tabular numerals in Outfit 800 `youText`.

**Hero on small phones:** the hero stage is a size container. Below 135 px of stage height the speech bubble and scroll hint hide; below 95 px the mascots hide too.

**Why it works, redesigned (W1.9):**
- Right under the heading, a **therapist seal strip**: `bg` card with a 1.5 px `you` border, a 60 px rosette seal with a check, **Every question, reviewed by a relationship therapist**, and "A relationship therapist reviews every question before it reaches you, so each one is thoughtful, kind and worth answering together." The quote slot stays hidden until real.
- **Three connected cards** (desktop 3 columns; mobile a swipe row with 86% cards and dots). Each card is a `bg` card (radius 22, `line` border):
  1. The animated scene (160 px, `surface2`).
  2. Body: H3 Outfit 700 21/26, one sentence, a source tag (12 px on `surface2`, e.g. "Aron et al., 1997") and the "Read the research" fold-out.
  3. A `youTint` **In Bonded** panel joined underneath, with a round orange ↓ connector on its top edge. Panel text is Outfit 600 17/23: A new question for both of you, every day. / Every answer adds to your map, and History keeps it. / A thread opens after every reveal, made for responding.
- The honesty line stays below the cards.

**Try it, redesigned (W1.8e):** it's the app's little-things fan, not a form.
- Header: H3 "Try it: send Bun a little something." plus the 44 px sound toggle. Sub: Tap to send. Hold the hug for longer.
- Stage: `youTint`, 250 px tall (340 on desktop), mascots 104 × 84.
- **Fan:** five round buttons in a gentle arc (the ends sit 14 px lower, the next pair 4 px), using the app's own little-things icons (`prototypes/little-things.html`):

| Position | Gesture | How | Size |
|---|---|---|---|
| 1 | Kiss | tap, up to 5 (counter ×n next to the label) | 46–56 px |
| 2 | Morning | tap | 46–56 px |
| 3 | **Hold to hug** | press and hold; a progress ring fills around the button (conic `youText` over `you`) | **60–72 px, `you` fill** |
| 4 | Goodnight | tap | 46–56 px |
| 5 | Miss you | tap | 46–56 px |

  - Labels: DM Sans 600 12 (13 on desktop). The fan's sizes clamp with the viewport so all five fit at 320 px.
  - Hug sits in the centre as the hero gesture. (In the app, the centre holds the time-of-day gesture; the landing page favours the hug.)
  - Reactions, sounds and the "Send real ones tonight →" CTA are as in the Audit section.
- Desktop: copy and fan on the left, the stage on the right spanning the rows.

**FAQ addition (first item):** **Who writes the questions?** We write them, drawing on decades of research into what brings couples closer. Then a relationship therapist reviews every single one before it reaches you.

## Audit 2026-11-11 (alignment, conversion, readability, motion, sound)
Checked at 320 × 640, 375 × 812, 1280 × 800 and 1440 × 900. An automated scan found no horizontal overflow, clipped text or tap target under 44 px after the fixes below.
- **Step tracker on narrow phones (≤ 380 px):** only the current step shows its label; the others show just their number.
- **Small phones (< 375 px):** H1 34/38 and sub 16/24, so the hero note and mascots still fit.
- **Hero copy (shorter):** Sub: One question a day for the two of you. Answer on your own, then open both answers together.
- **Other copy cuts:** Notes caption A sub: Their answer stays folded until you've written yours. So you both answer honestly. Little-moments sub: A good morning. A long-day hug. A goodnight from anywhere. Tiny moments that keep you close. Research intro: Bonded turns well-known findings about closeness into a small daily habit. History scene question 2: What did you notice first?
- **Mobile swipe rows:** below 960 px, the "What you gain" and "More ways to stay close" scene grids become horizontal scroll-snap rows. Each scene is 82% wide so the next one peeks in, and progress dots show the position (the current dot stretches to 20 px in `you`). Desktop keeps the grids. This removes about 1,500 px of vertical scroll on phones.
- **Idle hero note:** before the first scroll, the crumpled note wobbles gently (±3°, 6 px, 3.2 s) to invite scrolling. It stops once scrolling starts and is off with reduced motion.
- **Playground, final version:**
  - Header row: the H3 plus a 44 px **sound toggle** (speaker icon, `aria-pressed`, on by default).
  - Primary row: **Kiss** (tap, up to 5) and **Hold to hug**.
  - Secondary row: three equal chips (44 px): **☀️ Morning**, **🌙 Goodnight**, **💓 Miss you**. Each sends its emoji from Bao to Bun. Bun replies after 0.65 s: Morning, sunshine ☀️ (happy) / Night night 💤 (stage dims to dusk, both sleepy) / Miss you too 🫶 (happy; the heart beats in flight).
  - **CTA after engagement:** after the first gesture, the link **Send real ones tonight →** (Outfit 700 17, `youText`) fades in and goes to `#get`.
  - Desktop: stage on the left spanning the rows; buttons, chips, hint and CTA stacked on the right.
- **Sounds:** the same original sounds as the app's little things (D48, synthesized in `prototypes/little-things.html`): kiss (two-note chirp per tap), hug (soft squeeze plus a warm two-note swell, length follows the hold, chime at the end), morning (four rising notes), goodnight (three falling bell notes), miss you (heartbeat thumps).
  - They play **only after a user gesture in the playground**, never on scroll or load (browsers block autoplay, and surprise sound loses visitors).
  - When the team produces the bundled sound files (MOB-65), the site plays those same files instead of the synthesis, so web and app sound identical.
  - The sound toggle state lives only on the page (no cookie).
- **Known limits (founder to decide):** (1) The crumpled paper is an SVG mesh: good, but less photo-real than the reference video. A rendered frame sequence would match it more closely (see Motion). (2) No social proof yet (none exists; nothing may be invented). Add real ratings or reviews after launch.

## Readability and conversion rules (founder review 2026-11-11)
- **No scroll jail:** the three pinned tracks total 620svh at most (190 + 230 + 200). Never add a fourth.
- **Wayfinding:** during tracks 1–2 a small step tracker sits under the nav: (1) Question, (2) Answer alone, (3) Open together. The current step is `youTint` with an orange number; done steps get a `youText` number. It shows after 22% of track 1 and hides once track 2 ends. The tracks' top padding is 118 so nothing hides under it. Here the numbers carry sequence, so they're allowed.
- **A download path after every persuasion peak:** hero, after the reveal-and-talk story (`try`), after the proof (`try2`), the close (`get`) and the nav pill. Inline CTAs are H2 28/32 (36/40 desktop), a one-line sub and both badges. Desktop puts the copy left and the badges right.
- **Nav "Get the app" (production):** detect the platform and link straight to the App Store on iOS or to Google Play on Android; on desktop, scroll to `#get`.
- **Section rhythm:** `gains`, `why` and `faq` sit on full-bleed `surface` bands (`box-shadow: 0 0 0 100vmax` + `clip-path` trick); the rest sit on `bg`. Alternating bands mark where sections start and end.
- **Scannable copy:** each section is one benefit-led H2 plus a sub of at most 3 lines on mobile. Body measure is at most 62–65ch.
- **FAQ objections** (`details`/`summary`, 56 tall rows, chevron in `youText`). Every answer must stay true at launch:
  - **Is Bonded free?** Yes. Bonded is free to download, and the daily question, your answers, the thread, little moments and your streak are always free. Some extras, like question packs and voice answers, come with an optional upgrade inside the app.
  - **Does my partner need the app too?** Yes, you each answer on your own phone. Download Bonded, then send your partner an invite link or a code. It takes about a minute.
  - **What if one of us misses a day?** Nothing bad happens. Bao and Bun just take a nap, and a new question is waiting tomorrow. No guilt, no nagging.
  - **Who can see our answers?** Only the two of you. Your partner sees your answer only after they've answered too. You can delete your account and your data at any time.
  - **Does it work for long-distance couples?** Yes. You both get the same question on the same day, wherever you are, and you can send a good morning or a goodnight across any distance.
- **Inline CTA copy:** `try`: **Try tonight's question together.** Free on iPhone and Android. Takes a minute to set up, then invite your person. `try2`: **Your first question is one tap away.** Download Bonded free. Both of you answer, then open them together tonight.

## Layout fixes from the review (keep these)
- Speech bubbles use `.bubble.sky` for the partner, so no layout class may be called `.sky` (the day panel is `.daysky`).
- Stages are size containers (`container-type: size`). The paper note is `min(86cqw, 320px, (100cqh − 8px) × .81)`; the notes pair is `min(100cqw, 420px, (100cqh − 150px) × 1.25)`. The note ink scales in `cqw`. Never size these from `svh`.
- On mobile, while the hero copy fades, its block height animates down to the caption's height so the note can grow.
- Mascots and bubbles sit on `.duo.l/.r` and `.bubble.bl/.br`. On desktop they anchor at `50% ± 280px` of the stage, never at the column edges.
- Header logo: Bun behind and Bao in front, each 40 × 32, overlapping (62 × 32 total).

**Copy principle (founder, 2026-11-11):** lead with what the couple gains, then show how it works, then why it works (research + expert review), then answer doubts (FAQ). No Premium section. Copywriting voice: warm, concrete, second person, short sentences, no hype words, never guilt.
| — | `/j/{code}` invite | — | separate page | W1.14–W1.16 |

## 0 · Nav (floating pill)
- Fixed. 10 px from the top (plus the safe area), centred, width `100% − 20px`, max 760, height 56. Fully round. Background `rgba(255,249,241,.55)` with `backdrop-filter: blur(16px) saturate(1.4)`, a 1 px border `rgba(226,207,181,.75)` and the shadow `0 8px 24px rgba(42,20,7,.08)`.
- Left: Bao & Bun together (Bun behind and Bao in front, each 40 × 32, overlapping, breathing and blinking) and the wordmark "bonded" in Outfit 800 21. Links to `/`.
- Middle (≥720 px only): "How it works" → `#notes`, "Why it works" → `#why`, "FAQ" → `#faq`. DM Sans 600 15. Hover fills `surface2` at 80%.
- Right: the "Get the app" pill. `you` fill, `text` label, Outfit 700 15, height 44, scales to 1.04 on hover. Links to `#get`.

## 1 · Hero → today's note (sticky track `paper`)
The frame is sticky (100svh, min 640). Mobile stacks copy above the stage. Desktop (≥960) uses two columns: copy on the left, stage on the right, with a 1120 max content width.

**Copy, layer A (hero, visible at scroll 0):**
- H1: **Closer, one question at a time.** (40/44 mobile, 64/66 desktop, Outfit 800). It replaces "Feel closer in a few minutes a day.", which was too close to a competitor's headline.
- Sub: A few minutes a day, just for the two of you. Answer on your own, open them together, and learn something new about the person you love.
- Store badges: App Store and Google Play.
- Trust line (DM Sans 500 14, `text2`, small orange check): Free to start · Questions reviewed by a relationship therapist
- `<title>`: Bonded · Closer, one question at a time. Meta description: see the SEO section.

**Copy, layer B (fades in mid-track):**
- H2: **A new question every morning.**
- Sub: The same one for both of you. It changes at midnight and never repeats.

**Stage:** the paper note in the centre, Bao at bottom left and Bun at bottom right, and a "Scroll to open" hint (chevron) that fades on the first scroll.

**The note when flat:** the weekday (the visitor's local weekday, e.g. "Wednesday"; fallback "Today"), then "Today's question" (`youText`, Outfit 700 15), then the question **What's a small thing I do that makes your day better?** (Outfit 600, 19–23 px).

**Mascot lines:**

| Scroll | Who | Bubble |
|---|---|---|
| 0–14% | Bao | Something came for us 💌 |
| 30–62% | Bun | Open it, open it! 🤩 |
| 78–100% | Bao | Ooh, I know mine 😊 (both switch to the happy face and bounce twice) |

## 2 · Nobody sees first → open together (sticky track `notes`)
Two notes side by side. Each is split into two halves: the question on top, the answer below. The demo couple is **Bao** (you, orange) and **Bun** (partner, sky), the same seeded couple as the store screenshots. Mark them as illustrative.

- **Bao's note:** "What's a small thing I do that makes your day better?" Her answer types itself as you scroll: **When you leave the last bite for me.** An orange caret shows while it types.
- **Bun's note:** the answer half is folded up over the question. You see the back of the paper (`surface2`) with a sky seal showing a lock and "Bun". It unfolds as you scroll (`rotateX` 180° → 0°, hinge on the centre line) to show **The way you hum when you cook. Every single time.** Until it opens, the answer is `aria-hidden`.
- Caption A: **Answer honestly. Nobody sees first.** Their answer stays folded until you've written yours. So you say what you really think, not what you think they want to hear.
- Caption B: **Then open them together.** Same question, two answers, and often a surprise. Even after years together, there's more to learn.
- At the end ❤️ 🥹 😂 float up from between the notes.
- **Another question** (W1.6b): a ghost pill button under the notes (44 tall, `surface` with `line` border, refresh icon). It fades in after 90% of the track. A tap folds Bun's flap shut (350 ms), swaps the question and both answers, then unfolds again. Reduced motion swaps the text instantly. It cycles through three of our own example pairs (light, playful, deep):
  1. What's a small thing I do that makes your day better? · Bao: When you leave the last bite for me. · Bun: The way you hum when you cook. Every single time.
  2. If we had a theme song, what would it be? · Bao: Anything we can't sing on key 🎤 · Bun: The one from that road trip. You know the one.
  3. When did you first feel at home with me? · Bao: The night the power went out and we just talked. · Bun: The first time you fell asleep on my shoulder on the train.
  - The mascots' closing bubbles follow the pair: 1 "You noticed that? 🥹" / "Every time 😂" · 2 "Road trip again? 🚗" / "Windows down 🎶" · 3 "I remember that 🥹" / "Best nap ever 😴".
  - The questions shown must exist in the real question bank at launch (QA check).

| Scroll | What happens | Bubbles |
|---|---|---|
| 5–38% | Bao's answer types | Bun: No peeking 🙈 (4–42%) |
| 42–58% | Caption A → B | Bao: Done! ✍️ |
| 56–80% | Bun's flap unfolds | — |
| 82–100% | Emoji float up, happy faces, bounce | Bao: You noticed that? 🥹 · Bun: Every time 😂 |

## 3 · What you gain
- H2: **Small questions. Real closeness.** Sub: Life fills up with work, errands and who's picking up what. Bonded gives the two of you a few minutes that are only about each other.
- Five rows. Each has a 72 px mascot still (96 on desktop is fine) with a title (Outfit 700 19) and a line (`text2`):
  - `celebrating.svg`: **Know each other more each year, not less.** Every answer shows you a little more of who they are today, not only who they were when you met.
  - `together.svg`: **Talk about more than logistics.** Swap "did you pay the bill?" for something real to talk about over dinner tonight.
  - `snuggled.svg`: **Feel heard, not judged.** Answers open at the same moment. Nobody goes first, nobody gets graded, and there's a thread to follow up.
  - `waiting.svg`: **Close at any distance.** Long-distance or just busy, you share the same question on the same day, wherever you both are.
  - `napping.svg`: **A habit that's easy to keep.** A few minutes a day and a streak for the two of you. Miss a day? Bao and Bun just nap. No guilt.
- Desktop: title and sub on the left, rows on the right.

## 3b · Made for where you are (`#where`, W1.7b)
- H2: **Made for where you are.** Sub: Every couple is in a different season. The daily question fits into all of them.
- A row of `Chip` tabs (`role="tablist"`, 44 tall, selected = `text` fill with `surface` label; scrolls sideways on mobile). Each tab shows a mascot still with a speech bubble, a line (Outfit 600 19/26, 23/30 desktop) and a tilted mini note headed "A question you might get". The content fades in on change (350 ms; instant with reduced motion). Desktop: mascot left, line and note right.

| Tab | Mascot | Bubble | Line | Example question |
|---|---|---|---|---|
| Long-distance | `saving-a-seat.svg` | Same question, different time zones 🌍 | Something to share every day, even when you can't share a room. | What's something near you right now that you wish you could show me? |
| Busy parents | `napping.svg` | Kids asleep? Our turn 😴 | A few quiet minutes after bedtime that are about the two of you, not the to-do list. | What's one thing you miss doing, just the two of us? |
| Newly together | `snuggled.svg` | Tell me everything 🥰 | Skip the small talk. Learn the things you'd otherwise find out over years. | What did you think of me the first time we met? |
| Years in | `together.svg` | Still surprising each other 💛 | Think you know all their answers? Every question shows there's more. | What's something about you that's changed since we met? |

- Later (not now): each situation can become its own SEO page, and a "For therapists" page can follow once the reviewing therapist agrees.

## 4 · Turn answers into conversations
- H2: **Turn answers into conversations.** Sub: A short thread opens under every question, with replies and reactions. It's often where the best talks start.
- The thread uses `ChatBubble` colours (partner `partnerTint` on the left, me `youTint` on the right). The bubbles pop in **once**, staggered 350 ms, when 40% of the thread is visible.
  - Bun: ok but it's the same song EVERY time 😂
  - Bao: it's a good song!! (reaction pill ❤️ 1)
  - Bun: it really is. hum it tonight?

## 4b · Little moments (sticky track `day`, 260svh, W1.8a–d)
Shows the little-things feature (D48: good morning, hug, kiss, goodnight, miss you) as **why it helps**, not as a feature list. No limits, counters or Premium amounts here.
- H2: **The small moments count most.** Sub: A good morning before work. A hug when the day was long. A goodnight from across town or across the world. Moments like these keep you close between the big conversations.
- **Stage:** a sky panel (radius 32, max 520 × 440) with a time chip (Outfit 700 15, tabular numerals). Bao is on the left and Bun on the right. One day passes as you scroll:

| Scroll | Time chip | Sky | What happens | Bubbles |
|---|---|---|---|---|
| 0–33% | 7:52 am | `youTint` | ☀️ flies in an arc from Bao to Bun (5–18%) | Bao: Good morning ☀️ · Bun: Morning, you 🥱 (both happy) |
| 33–68% | 3:15 pm | `surface` | They slide together and hug (38–48%), 🧡 rises (47–58%), then they part | Bun: Long day? Come here 🤗 · Bao: Needed that 🧡 |
| 68–100% | 10:40 pm | dark `surface` #261C16 with a moon and twinkling stars | 🌙 flies from Bao to Bun (74–86%), sleepy faces after 90% | Bao: Goodnight 🌙 · Bun: Sleep well 💤 |

  - The sun (gold, the art's own colour, not a Premium cue) travels and rotates. Stars fade in with the dusk. The sleepy face has closed curved eyes and a small mouth.
  - Reduced motion: the afternoon hug frame shown still.
- **Research, below the track** (same ruled-list style as §5):
  1. **Small bids, big difference.** Relationship researchers noticed that partners reach for each other all day in tiny ways: a comment, a touch, a smile. They call these "bids for connection". Couples who usually turn toward each other's bids, rather than away, tend to build stronger and happier relationships over time. *In Bonded: a good morning, a hug or a goodnight takes one tap, and turning toward it takes one more.* Sources: Gottman, J. M., & DeClaire, J. (2001). *The Relationship Cure.* Crown. Driver, J. L., & Gottman, J. M. (2004). Daily marital interactions and positive affect during marital conflict among newlywed couples. *Family Process, 43*(3), 301–314. doi:10.1111/j.1545-5300.2004.00024.x
  2. **Feeling thought of keeps you close.** A quick message in the middle of a busy day says "I'm thinking of you" without needing a long talk. Those small, warm moments add up, and they make the bigger conversations easier when they come. *In Bonded: Bao and Bun act out every hug and kiss when it arrives, so it feels like a moment, not a notification.* (Copy, not a research claim; no citation.)
  - The claim rules from §5 apply. The lead verifies both citations before launch.

## 5 · Why it works (`#why`)
- H2: **Built on what research says about closeness.** Sub: Relationship researchers have spent decades studying what brings partners closer. Bonded turns a few of their best-known findings into a small daily habit.
- Three findings as a ruled list (hairline `line` between items; desktop: claim left, explanation right). Each has a claim (Outfit 700 23/28 desktop), an explanation (`text2`), an "In Bonded:" line (semibold with an orange dot) and the source (caption, `text3`, linked by DOI where one exists):
  1. **Asking and answering questions builds closeness.** In a well-known study, pairs who took turns answering gradually more personal questions felt much closer after 45 minutes than pairs who made small talk. *In Bonded: a new question for both of you, every day.* Source: Aron, A., Melinat, E., Aron, E. N., Vallone, R. D., & Bator, R. J. (1997). The experimental generation of interpersonal closeness. *Personality and Social Psychology Bulletin, 23*(4), 363–377. doi:10.1177/0146167297234003
  2. **Knowing their inner world keeps you close.** Couples researcher John Gottman calls it a "love map": what you know about your partner's worries, hopes and everyday life. He describes couples who keep theirs up to date as better able to weather stress and change. *In Bonded: every answer adds to your map, and History keeps it.* Source: Gottman, J. M., & Silver, N. (1999). *The Seven Principles for Making Marriage Work.* Crown.
  3. **Feeling understood is at the heart of intimacy.** Studies of intimacy find that closeness grows when one partner opens up and the other responds with understanding and care. *In Bonded: the thread after every reveal is made for responding.* Sources: Reis, H. T., & Shaver, P. (1988). Intimacy as an interpersonal process. In S. Duck (Ed.), *Handbook of Personal Relationships*. Wiley. Laurenceau, J.-P., Barrett, L. F., & Pietromonaco, P. R. (1998). *Journal of Personality and Social Psychology, 74*(5), 1238–1251. doi:10.1037/0022-3514.74.5.1238
- **Therapist block** (`#expert`, `surface` card with radius 22 and `snuggled.svg`): **Reviewed by a relationship therapist.** Every question in Bonded is reviewed by a relationship therapist before it reaches you, so every day's question is thoughtful and kind to answer together.
  - **Reserved quote slot** (hidden; board frame W1.9b shows it): a quote of 1–2 sentences, then the attribution (name or "Our reviewing therapist", then credential). Show it only when the therapist has **written or approved the exact words in writing**. The founder says the therapist stays unnamed, so the attribution is "Our reviewing therapist" + their real credential.
- **Founder decision 2026-11-12:** all three method cards (research → daily ritual → therapist) use the therapist card's border: `1.5px solid var(--you)` (orange), same `bg` fill. Before, only card 3 had it.
- Honesty line (caption, `text3`): Bonded is a daily habit, not therapy, and the app itself hasn't been studied. If your relationship is going through something hard, a couples therapist can help.
- **Claim rules (release-blocking):**
  - The research describes these ideas, not Bonded. Never write "proven", "clinically shown", "science says Bonded works" or any number about Bonded's effect.
  - Don't put researchers' names or photos in a way that implies they endorse Bonded.
  - "Reviewed by a relationship therapist" stays only while that is true: the founder confirmed it on 2026-11-11 and keeps the therapist's written OK on file. Use the therapist's exact credential (e.g. licensed marriage and family therapist) once confirmed.
  - The lead re-checks every citation (authors, year, title, DOI) against the source before launch.

## 7 · Close + 8 · Footer
- Bao & Bun together with the bubble "See you tomorrow 🧡". H2: **Your first question is waiting.** Sub: Free on iPhone and Android. Download Bonded, invite your person, and open tonight's question together. Then the store badges.
- Footer: "© 2026 Bonded", then Terms (`/terms`), Privacy (`/privacy`) and `support@hellobonded.com` (mailto). Links are 44 px tall.

## `/j/{code}` invite fallback (W1.14–W1.16)
This page appears only when the app is **not** installed. With the app installed, iOS universal links and Android App Links open the app directly (AASA + assetlinks, D07/D30).

- **Founder decision 2026-11-12:** the page uses the landing's header: wordmark left, **Get the app** button right (`you` fill, 44 tall) → `/#get`. The link never carries the code or token.
- **Route:** `/j/BND4827?t=<token>`. The page reads the code from the path in the browser. It is static and calls no API. It can't know the inviter's name, so the copy stays neutral.
- **Valid code (`BND` + 4 digits):**
  - `saving-a-seat.svg` with the bubble "Saved you a seat 🥟".
  - H1 **You're invited to Bonded.** Sub: Someone special wants to answer one question a day with you. Nobody peeks until you both answer.
  - Primary button **Open in Bonded** (56 tall, `you` fill) → `bonded://j/BND4827?t=<token>`. On phones only.
  - Divider "Don't have the app yet?", then the store badges.
  - Code card: "After you install, sign up and enter this code:" **BND·4827** with a **Copy** button (copies `BND4827`). The board shows the code with a middle dot, D01.
  - Note: Invites last 48 hours. If it's stopped working, ask for a new link.
- **On a computer (no mobile user agent):** the "Open in Bonded" button is replaced by "Open this link on your phone to join." Badges and the code stay.
- **Missing or malformed code:** `napping.svg`, H1 **This invite link looks incomplete.** Sub: Ask your partner to send the link again, or get Bonded and enter their code by hand. Then the badges.
- **Expired or used:** the page can't know this. The 48-hour note covers it, and the app shows the real error after sign-in (J-flow).
- **Token rules (D02):** the token is passed only into the `bonded://` link. It is never shown, logged, stored or sent to analytics. `/j/*` sends `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, and the page has no third-party scripts.

## Motion
- **One authored moment per track.** The motion is driven by scroll position, not by time. Progress uses smoothing like ScrollTrigger's `scrub: .5` (eased toward the scroll position, 0.16 per frame).
- **Paper:** a 12 × 15 triangle mesh (inline SVG) morphs from a crumpled ball to a flat sheet. The centre opens first and the edges last, with wrinkles that grow and settle mid-way. Facet shading comes from compression and flipped facets. Faint creases stay on the flat sheet. The ink fades in at 78–95%.
  - **Fidelity:** the prototype's mesh is the baseline. If the founder wants the photo-real crumple from the reference, render a 48–60-frame WebP image sequence from Blender (own artwork) and scrub through it. Keep the HTML question text on top.
- **Mascots:** breathing 2.6 s, blink 4.2 s, happy face + 2× bounce (squish easing) at the payoffs. Production may reuse the app's Rive mascot file (`@rive-app/canvas`, one state machine with mood inputs) once it exists; the inline SVG is fine for launch.
- **Bubbles:** pop in with squish (300 ms) and hide when scrolled out of their range.
- **Recommended build:** GSAP + ScrollTrigger (`pin` + `scrub`) or the prototype's vanilla `position: sticky` + rAF. Either is fine. Keep all JS under ~30 KB gzip.
- **Reduced motion:** no sticky scrubbing. The note shows flat with its question, Bun's note shows open, the bubbles at their final lines show statically, and there's no emoji float, bounce or smooth scroll (frame W1.11).

## Responsive
- Mobile first. Gutter 24. Badges stay side by side down to 320 px (min-width 150, they wrap below that).
- ≥720: nav links show. ≥960: sticky frames use two columns; the talk section uses two columns; scene grids use 3 (gains) or 4 (more) columns; H1 64/66, H2 44/48. Content max width 1120.
- Use `svh` units for the sticky tracks so mobile browser bars don't jump.

## Assets
| Asset | Source |
|---|---|
| Mascot inline SVG (dough + faces) | from `assets/mascot/*.svg` (same paths) |
| Habit row stills | `assets/mascot/together.svg`, `waiting.svg`, `napping.svg` |
| Invite stills | `assets/mascot/saving-a-seat.svg`, `napping.svg` |
| Favicon, apple-touch-icon | `assets/icon/app-icon-light.svg` (export 32, 180, 512) |
| **Store badges** | **Official artwork only:** Apple "Download on the App Store" (Apple Marketing Resources) and Google "Get it on Google Play" (Play badge generator). Same height (48), clear space as per their guidelines. The prototype's black pills are placeholders. |
| OG image 1200 × 630 | from J1 (LEAD-04); not drawn here |
| Fonts | Outfit 600–800, DM Sans 400–600, **self-hosted** woff2 in `web/fonts/` (no Google Fonts request in production) |

## Accessibility
- Text pairs per DESIGN.md (`*Text` shades on cream). Focus ring 3 px `you`. Every link and button is ≥44 px tall.
- The note has `role="img"` with the question as its label. Speech bubbles are decorative (the captions carry the meaning). Mascots are `aria-hidden`. Hidden caption layers get `aria-hidden` + `visibility: hidden`.
- The page works with JS off: the sticky tracks show their final state (do this with a `no-js` class).

## SEO, privacy and hosting (LEAD-04)
- Title "Bonded · One question a day, just for you two"; meta description as in the prototype; OG/Twitter tags with the J1 image.
- No analytics or cookies on launch (so no consent banner needed). If added later, it must be cookieless and never on `/j/*`.
- Cloudflare `_redirects`: `/j/*  /j/index.html  200`. `_headers`: AASA + assetlinks content types, `/j/*` no-referrer + noindex, a strict CSP (self + fonts).

## Open for the founder
1. The support address: is `support@hellobonded.com` right? (The email provider is ACCOUNTS 16.)
2. Store URLs for the badges (after the store records exist).
3. Paper fidelity: the SVG mesh as in the prototype, or a rendered image sequence?
4. Demo couple Bao & Bun on the page: keep, or use unnamed "You / Your person"?
5. The therapist's exact credential for the trust line and the block, and optionally a quote they write and approve for the reserved slot.
