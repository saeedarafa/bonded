// Website analytics (LEAD-04, docs/ANALYTICS.md §5, SEC-23 B). PostHog EU, cookieless, no banner.
// posthog-js is a pinned self-hosted copy (assets/vendor/posthog-js-1.448.0.js, the npm "array.js" build);
// its lazy extensions (dead clicks, web vitals, exceptions) load from https://eu-assets.i.posthog.com/static/*.js?v=1.448.0.
// The key is PostHog's public client ("phc_") key of the app's project. It is public by design, but it is injected at
// deploy time (repo variable POSTHOG_PUBLIC_KEY) so the repo's secret scan stays clean. Without it this file does nothing.
(() => {
  'use strict';
  // Invite links carry codes and tokens: never load PostHog on /j/* (the /j/ page does not include this file either).
  if (/^\/j(\/|$)/i.test(location.pathname)) return;
  const KEY = '__POSTHOG_PUBLIC_KEY__'; // replaced at deploy time by web-deploy.yml from the repo variable POSTHOG_PUBLIC_KEY
  const VERSION = '1.448.0';
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

  const start = () => {
    const s = document.createElement('script');
    s.src = '/assets/vendor/posthog-js-' + VERSION + '.js';
    s.async = true;
    s.onload = () => {
      if (!window.posthog || typeof window.posthog.init !== 'function') return;
      ph = window.posthog;
      ph.init(KEY, {
        api_host: 'https://eu.i.posthog.com',
        ui_host: 'https://eu.posthog.com',
        cookieless_mode: 'always',
        persistence: 'memory',
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
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_web_experiments: true,
        advanced_disable_flags: true,
        save_referrer: true,
        before_send: sanitize,
      });
      watchSections();
    };
    document.head.appendChild(s);
  };
  // Load after the page is interactive so analytics never competes with LCP.
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
})();
