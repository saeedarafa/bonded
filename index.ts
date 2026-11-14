// App entry (MOB-78b). The background widget-token refresh task must be defined when the bundle
// loads, before expo-router: a headless start (Android WorkManager, iOS BGTaskScheduler with the
// app closed) never renders the root layout, so a definition there would be missing.
import './src/features/widgets/backgroundRefresh';
// MOB-78d (BE-64, CONTRACTS §5): the silent `widget_refresh` push runs the same refresh from the
// expo-notifications background task, which also has to be defined and registered at load time.
import './src/features/widgets/refreshPushTask';
import 'expo-router/entry';
