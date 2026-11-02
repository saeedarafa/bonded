// QA-07 visual + a11y regression over /dev/gallery. Runs in Node (no simulator, no Docker):
//   npx jest -c qa/visual/jest.config.js           check against committed baselines
//   npx jest -c qa/visual/jest.config.js -u        accept a deliberate design change (review the diff)
// Reuses the app's Jest setup so the gallery renders exactly as in src/**/__tests__.
const app = require('../../package.json').jest;

module.exports = {
  ...app,
  rootDir: '../..',
  roots: ['<rootDir>/qa/visual'],
  testMatch: ['<rootDir>/qa/visual/**/*.test.tsx'],
};
