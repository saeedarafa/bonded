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
