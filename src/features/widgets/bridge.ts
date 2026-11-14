import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { WidgetSnapshot } from './snapshot';

/**
 * The native side of the widgets (`plugins/widgets/modules/bonded-widgets`, MOB-30): writes the
 * snapshot where the widgets read it (iOS App Group defaults, Android shared preferences) and asks
 * the system to redraw them. Absent in Expo Go, on the web and in Jest: every call is then a no-op.
 */
type BondedWidgetsModule = {
  setSnapshot(json: string): void;
  /**
   * iOS (MOB-77, SEC-21): the shared keychain access group the app and the widget extensions
   * both hold (`$(AppIdentifierPrefix)…widget`), set by the widget plugin. Absent until the
   * plugin adds the entitlement: without it the app never mints a widget token.
   */
  keychainAccessGroup?: string | null;
  /**
   * MOB-77 (SEC L1): true only in a build whose widgets read the widget token (iOS: the premium
   * widget extension with the shared keychain group; Android: false until the MOB-78 receivers).
   * The free widgets ship the module too, so its presence alone must not trigger a mint.
   */
  hasTokenReader?: boolean;
  /**
   * MOB-77: the `{widget_kind, action}` entries the widget extensions queued in the shared app
   * group since the last call, as a JSON array, and the queue emptied. Absent until the plugin has
   * it.
   */
  takeActionQueue?: () => string | null;
};

let native: BondedWidgetsModule | null | undefined;

function load(): BondedWidgetsModule | null {
  if (native === undefined) {
    native =
      Platform.OS === 'ios' || Platform.OS === 'android'
        ? requireOptionalNativeModule<BondedWidgetsModule>('BondedWidgets')
        : null;
  }
  return native;
}

/** True when this build has the widget module (a dev or store build after prebuild). */
export function widgetsAvailable(): boolean {
  return load() !== null;
}

/** The shared keychain group for the widget token (iOS), or null when this build has none. */
export function widgetKeychainGroup(): string | null {
  const group = load()?.keychainAccessGroup;
  return typeof group === 'string' && group.length > 0 ? group : null;
}

/** True when this build's widgets read the widget token (the native module says so). */
export function widgetHasTokenReader(): boolean {
  return load()?.hasTokenReader === true;
}

/** The queued widget actions (JSON), emptying the queue; null without a queue. Never throws. */
export function takeWidgetActionQueue(): string | null {
  try {
    return load()?.takeActionQueue?.() ?? null;
  } catch {
    return null;
  }
}

/** Hand the snapshot to the widgets. Never throws: a widget must not break the app. */
export function writeWidgetSnapshot(snapshot: WidgetSnapshot): boolean {
  const mod = load();
  if (!mod) return false;
  try {
    mod.setSnapshot(JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/** Tests: use a fake native module (null = none). */
export function setWidgetModuleForTests(mod: BondedWidgetsModule | null | undefined): void {
  native = mod;
}
