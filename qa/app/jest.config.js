// QA-06: QA's app-level Jest suite (qa/app). Same preset, mappers and setup as the app's own Jest
// config (package.json "jest", owned by mobile), plus a fetch seam so the real Supabase client and
// the real premium api/hooks talk to a fake PostgREST server inside the test.
//   npx jest -c qa/app/jest.config.js        (from the repo root; qa/ci/app.sh runs it)
const path = require('node:path');

const app = require('../../package.json').jest;

module.exports = {
  ...app,
  rootDir: path.resolve(__dirname, '..', '..'),
  roots: ['<rootDir>/qa/app'],
  setupFiles: [...(app.setupFiles ?? []), '<rootDir>/qa/app/fetch-seam.ts'],
  // The real Supabase client (src/lib/supabase.ts) keeps auth timers alive after the run; the app's
  // own tests mock it away. Exit once the tests are done instead of waiting on them.
  forceExit: true,
};
