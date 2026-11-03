// Static Auth checks: no Supabase stack, credentials, or emails required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import TOML from '@iarna/toml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = TOML.parse(fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'));

test('email OTP stays six digits and local confirmation behavior is unchanged', () => {
  assert.equal(config.auth.email.enabled, true);
  assert.equal(config.auth.email.otp_length, 6);
  assert.equal(config.auth.email.enable_confirmations, false);
});

test('Auth explicitly allows the app callback and preserves supported redirects', () => {
  for (const redirect of [
    'bonded://auth/callback',
    'bonded://**',
    'exp://127.0.0.1:8081/--/**',
    'exp://localhost:8081/--/**',
  ]) {
    assert.ok(config.auth.additional_redirect_urls.includes(redirect), `Missing redirect: ${redirect}`);
  }
});

for (const name of ['magic_link', 'confirmation']) {
  test(`${name} email has a tappable verification URL and a visible OTP`, () => {
    const template = config.auth.email.template[name];
    assert.ok(template.subject.trim(), 'Template needs a subject');
    assert.equal(template.content_path, `./supabase/templates/${name}.html`);
    // Supabase CLI resolves content_path relative to the project root, not config.toml.
    const html = fs.readFileSync(path.join(root, template.content_path), 'utf8');
    assert.match(html, /<a\s+href="{{\s*\.ConfirmationURL\s*}}">[^<]+<\/a>/);
    assert.match(html, /<strong>{{\s*\.Token\s*}}<\/strong>/);
    assert.match(html, /six-digit code in the Bonded app/);
    assert.doesNotMatch(html, /\.TokenHash|\.SiteURL|\.RedirectTo/);
    assert.doesNotMatch(html, /<script\b/i);
  });
}
