// App entry (MOB-78b). The background widget-token refresh task must be defined when the bundle
// loads, before expo-router: a headless start (Android WorkManager, iOS BGTaskScheduler with the
// app closed) never renders the root layout, so a definition there would be missing.
import './src/features/widgets/backgroundRefresh';
import 'expo-router/entry';
