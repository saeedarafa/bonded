// QA-47: layout invariants of the landing page's scroll-story tracks and the /j/ invite page,
// measured from element rects on every profile in playwright.config.ts.
//
// Bugs this guards (PO, 2026-11-12, fixed in #341 / 5d031f1 / 1b13ba0):
//  - short Android phones: note text spilled out of the notes;
//  - iPhone 402x874: the notes covered the "Then open them together." subtitle;
//  - "The small moments count most." copy sat under the sky card;
//  - the reaction emojis froze half-transparent when the scroll stopped.
//
// A real layout bug found by this suite goes in FIXME below with its issue number (the lead owns
// web/): the matching violations are reported as annotations instead of failing the run.
import { expect, test, type Page } from '@playwright/test';

const TRACKS = ['paper', 'notes', 'day'] as const;
type Track = (typeof TRACKS)[number];
const POINTS = [0.05, 0.4, 0.65, 1] as const;

// { project, track, point, rule, issue }: a known bug, reported but not failing. Empty = none known.
type Fixme = { project: RegExp; track: Track | '*'; point?: number; rule: string; issue: string };
const FIXME: Fixme[] = [
  // the two reaction bubbles overlap on 320px-wide phones
  { project: /^(galaxy-s9plus|iphone-se)$/, track: 'notes', point: 1, rule: 'bubble-over-bubble', issue: '#346' },
  // 320x568: frame min-height 640 > viewport, so at a track's end the headline slides under the step pill
  { project: /^iphone-se$/, track: '*', point: 1, rule: 'steps-over-copy', issue: '#347' },
];
// /j/: the "Saved you a seat" bubble spills off phones up to 390px wide (sideways scroll)
const FIXME_J_BUBBLE = { maxWidth: 390, issue: '#345' };

async function open(page: Page, path = '/') {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
}

/** Scrolls to `point` of the track's scroll range (0 = track top at viewport top, 1 = end). */
async function scrollTrack(page: Page, track: Track, point: number) {
  await page.evaluate(
    ([id, pt]) => {
      const t = document.getElementById(id)!;
      const top = t.getBoundingClientRect().top + scrollY;
      const range = Math.max(0, t.offsetHeight - innerHeight);
      // the site sets scroll-behavior: smooth; jump instead
      document.documentElement.style.scrollBehavior = 'auto';
      scrollTo({ top: Math.round(top + range * pt), behavior: 'instant' as ScrollBehavior });
    },
    [track, point] as const,
  );
}

/** Waits until the scrub easing has caught up and finite CSS animations/transitions are done. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    const sig = () =>
      [...document.querySelectorAll('[data-track] .layer, [data-track] .bubble, .pair, .note, #sky, #sheet, #steps')]
        .map((e) => {
          const r = e.getBoundingClientRect();
          return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)},${getComputedStyle(e).opacity}`;
        })
        .join('|');
    let last = '';
    let same = 0;
    const t0 = performance.now();
    while (same < 8 && performance.now() - t0 < 5000) {
      await raf();
      const s = sig();
      same = s === last ? same + 1 : 0;
      last = s;
    }
    const finite = document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming();
      return t && t.iterations !== Infinity && a.playState === 'running';
    });
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    await raf();
    await raf();
  });
}

type Violation = { rule: string; detail: string };

/** Runs in the page: every rule returns "rule: detail" strings. Keep it self-contained. */
function measure(track: string): Violation[] {
  const V: { rule: string; detail: string }[] = [];
  const W = innerWidth;
  const H = innerHeight;
  const TOL = 1;
  const T = document.getElementById(track)!;
  const name = (e: Element) => {
    const id = e.id ? `#${e.id}` : '';
    const cls = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '';
    const txt = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return `${e.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const shown = (e: Element) => {
    for (let x: Element | null = e; x && x !== document.documentElement; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const rect = (e: Element) => e.getBoundingClientRect();
  // line boxes of a text element, its own box otherwise
  const lines = (e: Element): DOMRect[] => {
    if (!/^(H1|H2|P)$/.test(e.tagName)) return [rect(e)];
    const r = document.createRange();
    r.selectNodeContents(e);
    const rs = [...r.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    return rs.length ? rs : [rect(e)];
  };
  const hits = (a: Element, b: Element) => lines(a).some((x) => lines(b).some((y) => overlap(x, y)));
  // b is really painted under a: hit-test a grid of points where their boxes meet (bounding boxes of the
  // tilted notes and the rotated paper mesh are bigger than what is drawn)
  const covers = (a: Element, b: Element) => {
    const rb = rect(b);
    for (const ra of lines(a)) {
      const l = Math.max(ra.left, rb.left, 0) + 1, r = Math.min(ra.right, rb.right, W) - 1;
      const t = Math.max(ra.top, rb.top, 0) + 1, bt = Math.min(ra.bottom, rb.bottom, H) - 1;
      if (r - l <= TOL || bt - t <= TOL) continue;
      for (let y = t; y <= bt; y += 3)
        for (let x = l; x <= r; x += 3)
          if (document.elementsFromPoint(x, y).some((h) => h !== b.parentElement && b.contains(h))) return true;
    }
    return false;
  };
  const fmt = (r: DOMRect) => `[${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`;
  const overlap = (a: DOMRect, b: DOMRect) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOL && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOL;
  const inViewport = (r: DOMRect) => r.left >= -TOL && r.right <= W + TOL && r.top >= -TOL && r.bottom <= H + TOL;
  const all = (sel: string, root: ParentNode = T) => [...root.querySelectorAll(sel)].filter(shown);

  // 1. nothing scrolls sideways
  const sw = document.documentElement.scrollWidth;
  if (sw > W + TOL) V.push({ rule: 'h-overflow', detail: `page scrollWidth ${sw} > viewport ${W}` });

  // the copy column (headline, subtitle, store badges, proof lines) and what it must never sit on.
  // Text is measured by its line boxes (a centred <p> box is much wider than its text).
  const copy = all('.copy h1, .copy h2, .copy p, .copy .badge, .copy .proof li');
  // paper: the drawn mesh (the #sheet box is the flat sheet's size even while it is a crumpled ball)
  const stageSel: Record<string, string> = { paper: '#mesh', notes: '.note', day: '#sky' };
  // (hit-testing needs them to take pointer events; none of the three sets pointer-events: none)
  const stage = all(stageSel[track]);
  const bubbles = all('.bubble.on');
  const another = all('#another.on');

  for (const e of [...copy, ...bubbles, ...another]) {
    const r = rect(e);
    if (r.left < -TOL || r.right > W + TOL) V.push({ rule: 'h-overflow', detail: `${name(e)} ${fmt(r)} outside 0..${W}` });
  }

  // 2. copy never under (or over) the stage: paper sheet, notes, sky card
  for (const c of copy) for (const s of stage)
    if (covers(c, s)) V.push({ rule: 'copy-over-stage', detail: `${name(c)} ${fmt(rect(c))} overlaps ${name(s).slice(0, 40)} ${fmt(rect(s))}` });

  // the step pill (fixed, under the nav) never covers the copy
  const steps = document.getElementById('steps');
  if (steps && steps.classList.contains('on') && shown(steps))
    for (const c of copy)
      if (hits(c, steps)) V.push({ rule: 'steps-over-copy', detail: `#steps ${fmt(rect(steps))} overlaps ${name(c)} ${fmt(rect(c))}` });

  // 3. buttons and bubbles fully on screen; the button never under a bubble; bubbles never on the copy or the notes
  for (const e of [...bubbles, ...another])
    if (!inViewport(rect(e))) V.push({ rule: 'off-screen', detail: `${name(e)} ${fmt(rect(e))} outside ${W}x${H}` });
  for (const a of another) for (const b of bubbles)
    if (overlap(rect(a), rect(b))) V.push({ rule: 'button-under-bubble', detail: `${name(b)} ${fmt(rect(b))} overlaps the button ${fmt(rect(a))}` });
  for (const b of bubbles) for (const c of copy)
    if (hits(b, c)) V.push({ rule: 'bubble-over-copy', detail: `${name(b)} ${fmt(rect(b))} overlaps ${name(c)} ${fmt(rect(c))}` });
  for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++)
    if (overlap(rect(bubbles[i]), rect(bubbles[j])))
      V.push({ rule: 'bubble-over-bubble', detail: `${name(bubbles[i])} ${fmt(rect(bubbles[i]))} overlaps ${name(bubbles[j])} ${fmt(rect(bubbles[j]))}` });
  if (track === 'notes')
    for (const b of bubbles) for (const s of stage)
      if (covers(b, s)) V.push({ rule: 'bubble-over-notes', detail: `${name(b)} ${fmt(rect(b))} overlaps ${name(s).slice(0, 40)} ${fmt(rect(s))}` });

  // 4. note text stays inside its note half (layout box, so the 3deg tilt and the flap turn don't matter)
  if (track === 'notes')
    for (const face of all('.note .face, .note .back')) {
      const fw = (face as HTMLElement).clientWidth;
      const fh = (face as HTMLElement).clientHeight;
      for (const t of [...face.querySelectorAll('.name, .nq, .ans, .seal')] as HTMLElement[]) {
        if (getComputedStyle(t).display === 'none') continue;
        // offsetParent is the absolutely positioned .face / .back
        const bottom = t.offsetTop + t.offsetHeight;
        const right = t.offsetLeft + t.offsetWidth;
        if (bottom > fh + TOL || right > fw + TOL || t.scrollWidth > t.clientWidth + TOL)
          V.push({ rule: 'note-text-overflow', detail: `${name(t)} box ${t.offsetLeft},${t.offsetTop} ${t.offsetWidth}x${t.offsetHeight} (scrollW ${t.scrollWidth}) outside its note half ${fw}x${fh}` });
      }
    }

  // 5. no element frozen half-transparent: CSS-driven opacity (not the scroll-scrubbed inline styles) must be settled
  for (const e of [...T.querySelectorAll('*'), ...(steps ? [steps, ...steps.querySelectorAll('*')] : [])] as HTMLElement[]) {
    if (e.style.opacity !== '') continue; // scrubbed by the page script on purpose
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const o = Number(cs.opacity);
    if (o > 0.05 && o < 0.95 && shown(e.parentElement || e))
      V.push({ rule: 'frozen-opacity', detail: `${name(e)} opacity ${o.toFixed(2)} after animations settled` });
  }
  return V;
}

for (const track of TRACKS) {
  test(`landing #${track}: layout invariants at ${POINTS.map((p) => p * 100 + '%').join(' / ')}`, async ({ page }, info) => {
    await open(page);
    const failures: string[] = [];
    for (const point of POINTS) {
      await test.step(`${Math.round(point * 100)}%`, async () => {
        await scrollTrack(page, track, point);
        await settle(page);
        const found = await page.evaluate(measure, track);
        const known = (v: Violation) =>
          FIXME.find((f) => f.project.test(info.project.name) && (f.track === '*' || f.track === track) && (f.point === undefined || f.point === point) && f.rule === v.rule);
        const real: Violation[] = [];
        for (const v of found) {
          const k = known(v);
          if (k) info.annotations.push({ type: 'fixme', description: `${k.issue}: #${track} ${point * 100}% ${v.rule}: ${v.detail}` });
          else real.push(v);
        }
        if (found.length) {
          const file = info.outputPath(`${track}-${Math.round(point * 100)}.png`);
          await page.screenshot({ path: file });
          await info.attach(`${track}-${Math.round(point * 100)}%`, { path: file, contentType: 'image/png' });
        }
        for (const v of real) failures.push(`#${track} ${Math.round(point * 100)}% ${v.rule}: ${v.detail}`);
      });
    }
    expect(failures, `layout violations on ${info.project.name}`).toEqual([]);
  });
}

test('landing: no sideways scroll from top to bottom', async ({ page }) => {
  await open(page);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.max(400, page.viewportSize()!.height);
  const wide: string[] = [];
  for (let y = 0; y < total; y += step) {
    await page.evaluate((top) => scrollTo({ top, behavior: 'instant' as ScrollBehavior }), y);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    if (sw[0] > sw[1] + 1) wide.push(`y=${y}: scrollWidth ${sw[0]} > ${sw[1]}`);
  }
  expect(wide).toEqual([]);
});

for (const [path, state] of [['/j/BND4827', 'valid'], ['/j/not-a-code', 'invalid']] as const) {
  test(`/j/ invite page (${state}): served by the /j/:code rule, fits the viewport`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('h1:visible')).toHaveText(state === 'valid' ? "You're invited to Bonded." : 'This invite link looks incomplete.');
    if (state === 'valid') await expect(page.locator('#code')).toHaveText('BND·4827');
    // let the bubble's pop-in animation finish
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const v = await page.evaluate(() => {
      const out: string[] = [];
      const W = innerWidth;
      if (document.documentElement.scrollWidth > W + 1) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
      const shown = (e: Element) => {
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      for (const e of [...document.querySelectorAll('main h1, main p, main a, main button, main .code, main .bubble, main img')].filter(shown)) {
        const r = e.getBoundingClientRect();
        if (r.left < -1 || r.right > W + 1) out.push(`${e.tagName} "${(e.textContent || '').trim().slice(0, 30)}" [${Math.round(r.left)}..${Math.round(r.right)}] outside 0..${W}`);
      }
      const code = document.querySelector('.code');
      if (code && shown(code)) {
        const cr = code.getBoundingClientRect();
        for (const c of [...code.children].filter(shown)) {
          const r = c.getBoundingClientRect();
          if (r.left < cr.left - 1 || r.right > cr.right + 1) out.push(`${c.tagName} "${(c.textContent || '').trim()}" spills out of the code box`);
        }
      }
      return out;
    });
    // known bug: only the bubble (and the page width it causes) may be off-screen, and only up to 390px
    const vw = page.viewportSize()!.width;
    const known = (x: string) => state === 'valid' && vw <= FIXME_J_BUBBLE.maxWidth && (/^SPAN "Saved you a seat/.test(x) || /^page scrollWidth/.test(x));
    for (const x of v.filter(known)) test.info().annotations.push({ type: 'fixme', description: `${FIXME_J_BUBBLE.issue}: ${x}` });
    expect(v.filter((x) => !known(x))).toEqual([]);
  });
}
