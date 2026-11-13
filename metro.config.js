// MOB-24: Expo's default Metro config plus Sentry's debug ids, so the source maps uploaded at build
// time (SENTRY_AUTH_TOKEN on EAS) match the bundle. Nothing else changes.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
