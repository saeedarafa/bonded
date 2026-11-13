// LEAD-04: renders web/og-image.png and web/og-invite.png (1200 x 630) from the site's own fonts and mascot SVGs
// (original art, J1 card layout: peach art panel + Bonded copy). Needs playwright-core with a Chromium and the site
// served locally: `npx --yes wrangler@4 pages dev web --port 8788`, then `node scripts/web/og-images.mjs`.
import { fileURLToPath } from 'node:url';
const out = (f) => fileURLToPath(new URL('../../web/' + f, import.meta.url));
import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:8788/404.html');
const css = `
@import url(/assets/fonts/fonts.css);
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{background:#F7EFE3;font-family:'DM Sans',sans-serif;color:#2A1407;display:grid;grid-template-columns:520px 1fr;align-items:center}
.art{height:630px;background:#FFE3D1;display:flex;align-items:center;justify-content:center;position:relative;border-right:2px solid #E2CFB5}
.art img{width:420px;height:420px}
.bub{position:absolute;top:64px;right:48px;background:#FFF9F1;border:2px solid #E2CFB5;border-radius:24px 24px 6px 24px;padding:14px 22px;font:700 28px Outfit,sans-serif}
.copy{padding:0 64px 0 64px;display:flex;flex-direction:column;gap:22px}
.wm{display:flex;align-items:center;gap:14px;font:800 44px Outfit,sans-serif;letter-spacing:-.5px}
.dot{width:18px;height:18px;border-radius:50%;background:#FF8A4C}
h1{font:800 60px/1.06 Outfit,sans-serif;letter-spacing:-1px}
p{font:500 28px/1.35 'DM Sans',sans-serif;color:#6B5442}
.pill{align-self:flex-start;background:#FF8A4C;color:#2A1407;font:700 24px Outfit,sans-serif;padding:14px 26px;border-radius:999px}
`;
const make = async (file, img, bubble, h1, p, pill) => {
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
  <div class="art"><img src="/assets/mascot/${img}" alt="">${bubble ? `<div class="bub">${bubble}</div>` : ''}</div>
  <div class="copy"><div class="wm"><span class="dot"></span>Bonded</div><h1>${h1}</h1><p>${p}</p><span class="pill">${pill}</span></div></body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, type: 'png' });
};
await make(out('og-image.png'), 'together.svg', '', 'Fall for each other a little more, every day.', 'One question a day. Answer on your own, then open both answers together.', 'Free on iPhone and Android');
await make(out('og-invite.png'), 'saving-a-seat.svg', 'Saved you a seat 🥟', 'You’re invited to Bonded.', 'One question a day for the two of you. Nobody peeks until you both answer.', 'Free on iPhone and Android');
await browser.close();
