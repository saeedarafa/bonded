// QA-07: route-level accessibility + structure regression for every built screen (qa/a11y).
// Same preset, mappers and setup as the app's Jest config (package.json "jest", owned by mobile),
// plus the fakes in qa/a11y/setup.ts. Node only: no simulator, no Docker.
//   npx jest -c qa/a11y/jest.config.js        (from the repo root; qa/ci/app.sh runs it)
//   npx jest -c qa/a11y/jest.config.js -u     accept a deliberate design change (review the diff)
const path = require('node:path');

const app = require('../../package.json').jest;

// Dates and day numbers render in UTC everywhere (CI runners and laptops alike).
process.env.TZ = 'UTC';

module.exports = {
  ...app,
  rootDir: path.resolve(__dirname, '..', '..'),
  roots: ['<rootDir>/qa/a11y'],
  testMatch: ['<rootDir>/qa/a11y/**/*.test.ts?(x)'],
  setupFiles: [...(app.setupFiles ?? []), '<rootDir>/qa/a11y/setup.ts'],
  // The first renderRouter() transforms the whole app graph; give it room on a cold cache.
  testTimeout: 60_000,
};
