// BE-49: every Edge Function directory is declared in config.toml, so the Supabase GitHub
// integration deploys it, with the intended gateway JWT setting.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import TOML from '@iarna/toml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = TOML.parse(fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'));
const functionsDir = path.join(root, 'supabase/functions');
const deployable = fs
  .readdirSync(functionsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'node_modules')
  .filter((d) => fs.existsSync(path.join(functionsDir, d.name, 'index.ts')))
  .map((d) => d.name)
  .sort();

// Server-to-server or pre-sign-in endpoints check their own secret / capability; app endpoints
// carry the user's JWT.
const expected = {
  notify: false,
  'daily-reminder': false,
  'invite-preview': false,
  revenuecat: false,
  'revenuecat-sync': true,
  'delete-account': true,
  'voice-cleanup': false,
  'analytics-deletions': false,
};

test('every function directory is declared in config.toml', () => {
  const declared = Object.keys(config.functions ?? {}).sort();
  assert.deepEqual(declared, deployable);
});

for (const [name, verifyJwt] of Object.entries(expected)) {
  test(`${name} has verify_jwt = ${verifyJwt}`, () => {
    assert.ok(deployable.includes(name), `${name} has no index.ts`);
    assert.equal(config.functions[name].verify_jwt, verifyJwt);
  });
}

test('every deployable function has an expected verify_jwt entry in this test', () => {
  assert.deepEqual(Object.keys(expected).sort(), deployable);
});
