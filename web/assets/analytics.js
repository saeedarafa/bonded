// Website analytics + cookie banner (LEAD-04, docs/ANALYTICS.md §5, SEC-23 B, PO 2026-11-14). PostHog EU.
// Before a choice, and after "Reject": cookieless mode (posthog-js `cookieless_mode: 'on_reject'`): no cookies, no
// storage, no session replay; PostHog's servers count visitors with a daily-rotating hash.
// After "Accept": PostHog persistence (`ph_<key>_posthog` cookie + localStorage, 365 days), session replay (all inputs
// masked, no network data, no console logs), returning visitors. The choice itself is kept in localStorage
// `bonded_consent` (1 = accepted, 0 = rejected; a strictly necessary preference). The banner is shown until a choice
// is made; every footer has a "Cookie settings" link (`[data-cookie-settings]`, href /privacy/#cookies without JS).
// posthog-js is a pinned self-hosted copy (assets/vendor/posthog-js-1.448.0.js, the npm "array.js" build);
// its lazy extensions (recorder, dead clicks, web vitals, exceptions) and the project's remote config load from
// https://eu-assets.i.posthog.com (static/1.448.0/*.js, array/<key>/config.js).
// The key is PostHog's public client ("phc_") key of the app's project. It is public by design, but it is injected at
// deploy time (repo variable POSTHOG_PUBLIC_KEY) so the repo's secret scan stays clean. Without it this file does
// nothing (no banner either: there is nothing to consent to), and the footer link just opens the privacy policy.
(() => {
  'use strict';
  // Invite links carry codes and tokens: never load PostHog on /j/* (the /j/ page does not include this file either).
  if (/^\/j(\/|$)/i.test(location.pathname)) return;
  const KEY = '__POSTHOG_PUBLIC_KEY__'; // replaced at deploy time by web-deploy.yml from the repo variable POSTHOG_PUBLIC_KEY
  const VERSION = '1.448.0';
  const CONSENT_KEY = 'bonded_consent';
  if (!/^phc_/.test(KEY)) return;

  // Drop every query parameter except utm_*; drop fragments too. Used on all URL-ish properties.
  const clean = (u) => {
    if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return u; // e.g. '$direct' stays as it is
    try {
      const url = new URL(u, location.origin);
      if (!/^https?:$/.test(url.protocol)) return u;
      const keep = new URLSearchParams();
      url.searchParams.forEach((v, k) => { if (/^utm_[a-z_]+$/i.test(k)) keep.append(k, v); });
      if (/^\/j(\/|$)/i.test(url.pathname)) return url.origin + '/j/';
      const qs = keep.toString();
      return url.origin + url.pathname + (qs ? '?' + qs : '');
    } catch (_) { return u.split(/[?#]/)[0]; }
  };
  // Walk every property (web vitals attribution, $elements, $set_once...) and clean each absolute URL string.
  const deepClean = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    Object.keys(o).forEach((key) => {
      let k = key;
      // $heatmap_data is keyed by URL: re-key it (merging lists that now share a key).
      if (/^https?:\/\//i.test(key) && /[?#]/.test(key)) {
        k = clean(key);
        const moved = o[key]; delete o[key];
        o[k] = Array.isArray(o[k]) && Array.isArray(moved) ? o[k].concat(moved) : moved;
      }
      const v = o[k];
      if (typeof v === 'string') { if (/^https?:\/\//i.test(v) && /[?#]/.test(v)) o[k] = clean(v); }
      else if (v && typeof v === 'object') deepClean(v, depth + 1);
    });
  };
  const sanitize = (ev) => {
    if (!ev || !ev.properties) return ev;
    // Never report anything from an invite page, even if this script were loaded there by mistake.
    if (/^\/j(\/|$)/i.test(location.pathname)) return null;
    deepClean(ev.properties, 0);
    if (ev.$set_once) deepClean(ev.$set_once, 0);
    if (ev.$set) deepClean(ev.$set, 0);
    return ev;
  };

  let ph = null;
  const send = (name, props) => { if (ph) ph.capture(name, props); };
  const sectionOf = (el) => { const s = el.closest('section[id], header, footer'); return s ? (s.id || s.tagName.toLowerCase()) : 'unknown'; };

  // Custom events (ANALYTICS §5). Properties are fixed ids only, never page text typed by anyone.
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const badge = t.closest('a.badge');
    if (badge) {
      send('store_badge_click', { store: /google play/i.test(badge.getAttribute('aria-label') || '') ? 'play_store' : 'app_store', page: location.pathname, section: sectionOf(badge) });
      return;
    }
    const cta = t.closest('[data-cta]');
    if (cta) { send('cta_click', { label: cta.dataset.cta, section: sectionOf(cta) }); }
    const share = t.closest('[data-share]');
    if (share) { send('share_click', { channel: share.dataset.share }); }
    const g = t.closest('.fb[data-g]');
    if (g) pose(g.dataset.g);
    const a = t.closest('a[href]');
    if (a && /^https?:$/.test(a.protocol) && a.hostname && a.hostname !== location.hostname) send('outbound_link_click', { host: a.hostname });
  }, true);
  // Mascots turning happy when a store badge is hovered (site.js) count as a pose, once per pose per page view.
  const posed = new Set();
  const pose = (p) => { if (!posed.has(p)) { posed.add(p); send('mascot_interaction', { pose: p }); } };
  document.addEventListener('pointerenter', (e) => { const t = e.target; if (t instanceof Element && t.matches('#get a.badge')) pose('happy'); }, true);
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d instanceof HTMLDetailsElement && d.open && d.dataset.q) send('faq_opened', { question_id: d.dataset.q });
  }, true);
  const seen = new Set();
  const watchSections = () => {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      const id = en.target.id;
      if (!en.isIntersecting || seen.has(id)) return;
      const need = Math.min(innerHeight * 0.4, en.boundingClientRect.height * 0.5);
      if (en.intersectionRect.height >= need) { seen.add(id); send('section_viewed', { section: id }); io.unobserve(en.target); }
    }), { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    document.querySelectorAll('main section[id]').forEach((s) => io.observe(s));
  };

  // Cookie banner. Built here (no inline script, works under the CSP); not shown with JS off, then nothing is tracked.
  let banner = null;
  let opener = null;
  const choice = () => (ph ? ph.get_explicit_consent_status() : 'pending'); // granted | denied | pending
  const closeBanner = () => {
    if (!banner) return;
    banner.hidden = true;
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  };
  const decide = (accept) => {
    if (!ph) return;
    if (accept) {
      if (choice() !== 'granted') ph.opt_in_capturing();
    } else if (choice() !== 'denied') {
      ph.opt_out_capturing(); // back to cookieless: PostHog drops its cookie/storage and stops the recording
      // posthog-js keeps its tab-scoped replay window ids in sessionStorage; drop them too, so "Reject" leaves nothing.
      try { Object.keys(sessionStorage).forEach((k) => { if (k.indexOf('ph_') === 0) sessionStorage.removeItem(k); }); } catch (_) { /* storage blocked */ }
    }
    closeBanner();
  };
  const buildBanner = () => {
    if (!document.querySelector('link[href="/assets/consent.css"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/assets/consent.css';
      document.head.appendChild(css);
    }
    const b = document.createElement('div');
    b.className = 'bc';
    b.id = 'cookie-banner';
    b.setAttribute('role', 'region');
    b.setAttribute('aria-label', 'Cookie choice');
    b.hidden = true;
    const p = document.createElement('p');
    p.className = 'bc-text';
    p.append('Can we use cookies to see how people use this site, with recordings of clicks and scrolls? We never record what you type. ');
    const more = document.createElement('a');
    more.href = '/privacy/#cookies';
    more.textContent = 'Cookie details';
    p.append(more);
    const now = document.createElement('p');
    now.className = 'bc-now';
    const row = document.createElement('div');
    row.className = 'bc-actions';
    [['Reject', false], ['Accept', true]].forEach(([label, accept]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bc-btn';
      btn.textContent = label;
      btn.dataset.consent = accept ? 'accept' : 'reject';
      btn.addEventListener('click', () => decide(accept));
      row.appendChild(btn);
    });
    b.append(p, now, row);
    // Escape closes the banner only when it was reopened from "Cookie settings" (the first time, a choice is asked).
    b.addEventListener('keydown', (e) => { if (e.key === 'Escape' && opener) { e.preventDefault(); closeBanner(); } });
    document.body.appendChild(b);
    return b;
  };
  const openBanner = (from) => {
    if (!ph) return;
    if (!banner) banner = buildBanner();
    const c = choice();
    const now = banner.querySelector('.bc-now');
    now.textContent = c === 'granted' ? 'You accepted cookies.' : c === 'denied' ? 'You rejected cookies.' : '';
    now.hidden = c === 'pending';
    opener = from || null;
    banner.hidden = false;
    if (from) banner.querySelector('.bc-btn').focus(); // reopened on purpose: move focus in; on first view, don't steal it
  };
  // Footer "Cookie settings" links reopen the banner (without JS, or before PostHog has loaded, they open the policy).
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('[data-cookie-settings]') : null;
    if (!link || !ph) return;
    e.preventDefault();
    openBanner(link);
  });

  const start = () => {
    const s = document.createElement('script');
    s.src = '/assets/vendor/posthog-js-' + VERSION + '.js';
    s.async = true;
    s.onload = () => {
      if (!window.posthog || typeof window.posthog.init !== 'function') return;
      window.posthog.init(KEY, {
        api_host: 'https://eu.i.posthog.com',
        ui_host: 'https://eu.posthog.com',
        // Cookieless until "Accept"; "pending" counts as rejected, so visits before a choice are still counted cookieless.
        cookieless_mode: 'on_reject',
        opt_out_capturing_by_default: true,
        consent_persistence_name: CONSENT_KEY,
        opt_out_capturing_persistence_type: 'localStorage',
        persistence: 'localStorage+cookie', // used only after "Accept" (posthog-js disables persistence while not opted in)
        cookie_expiration: 365,
        person_profiles: 'never',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: { capture_copied_text: false, capture_value_css_selector_allowlist: [] },
        mask_all_text: false,
        rageclick: true,
        capture_dead_clicks: true,
        enable_heatmaps: true,
        capture_heatmaps: true,
        capture_performance: { web_vitals: true, network_timing: false },
        capture_exceptions: true,
        // Session replay: only after "Accept" (posthog-js never records in cookieless mode). Every input masked,
        // no request/response headers or bodies, no console logs, no cross-origin iframes.
        disable_session_recording: false,
        enable_recording_console_log: false,
        session_recording: {
          maskAllInputs: true,
          maskInputOptions: { password: true, email: true, tel: true, text: true, textarea: true, search: true },
          recordHeaders: false,
          recordBody: false,
          recordCrossOriginIframes: false,
        },
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_web_experiments: true,
        // Remote config (array/<key>/config.js) stays on: replay needs the project's recording settings from it.
        // Feature flags stay off (no /flags call).
        advanced_disable_feature_flags: true,
        advanced_disable_feature_flags_on_first_load: true,
        save_referrer: true,
        before_send: sanitize,
      });
      ph = window.posthog;
      if (choice() === 'pending') openBanner(null);
      watchSections();
    };
    document.head.appendChild(s);
  };
  // Load after the page is interactive so analytics never competes with LCP.
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
})();
