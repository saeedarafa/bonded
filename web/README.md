# web/ · hellobonded.com

Static site for `https://hellobonded.com` (LEAD-04), built from `design-handoff/specs/W1-landing.md` and the prototypes in `design-handoff/prototypes/` (W01-landing, W01-invite). No build step: these files are served as they are.

- `index.html`: the landing page. `j/index.html`: the `/j/{code}` invite fallback (rewritten by `_redirects`; `noindex`, `no-referrer`, no third-party scripts; the token only goes into the `bonded://` link).
- `assets/fonts/`: self-hosted Outfit and DM Sans (SIL OFL), latin + latin-ext.
- `_headers`: security headers. **Pre-launch the whole site is `noindex`**; remove that line from the `/*` block on launch day.
- Deploy: `.github/workflows/web-deploy.yml` runs `wrangler pages deploy web` on `main` pushes that touch `web/` (Pages project `hellobonded`).

Local preview: `python3 -m http.server -d web 8080`, then open `http://localhost:8080/` (the `/j/` rewrite works only on Pages; locally open `/j/index.html`).

Before launch (BACKLOG LEAD-04): official store badges + store URLs, platform-aware "Get the app", `/.well-known/apple-app-site-association` (Team ID) and `/.well-known/assetlinks.json` (release SHA-256), `/terms`, `/privacy` (+ sitemap), OG image 1200 × 630 from J1, support mailbox, citation check, remove pre-launch `noindex`.
