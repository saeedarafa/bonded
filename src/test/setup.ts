import type * as ReactModule from 'react';

// Jest setup (MOB-06): fake public env and native-module stand-ins, so anything that imports the
// data layer can run in Node. Real behaviour is checked on devices; logic is tested directly.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

jest.mock('react-native-nitro-modules', () => ({ NitroModules: {} }));

// react-native-reanimated is replaced by src/test/reanimated-stub.tsx through moduleNameMapper (package.json).

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
});

// Sign-in native modules (MOB-08): no native side in Node. Tests that care mock `features/auth/api`.
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  signInAsync: jest.fn(),
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationButtonType: { CONTINUE: 0 },
  AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn() },
  isErrorWithCode: (e: unknown) => typeof (e as { code?: unknown })?.code === 'string',
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 1),
  digestStringAsync: jest.fn((_algorithm: string, value: string) => Promise.resolve(`h(${value})`)),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: (() => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
  })(),
}));

// Push (MOB-15): expo-notifications has no native side in Node. Listeners are kept so tests can
// fire a tap or a foreground push: `jest.requireMock('expo-notifications').__emit.response(r)`.
jest.mock('expo-notifications', () => {
  const listeners = {
    received: new Set<(mockValue: unknown) => void>(),
    response: new Set<(mockValue: unknown) => void>(),
    token: new Set<(mockValue: unknown) => void>(),
  };
  const subscribe =
    (set: Set<(mockValue: unknown) => void>) => (fn: (mockValue: unknown) => void) => {
      set.add(fn);
      return { remove: () => set.delete(fn) };
    };
  let lastResponse: unknown = null;
  return {
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4 },
    IosAuthorizationStatus: {
      NOT_DETERMINED: 0,
      DENIED: 1,
      AUTHORIZED: 2,
      PROVISIONAL: 3,
      EPHEMERAL: 4,
    },
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(() =>
      Promise.resolve({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
        expires: 'never',
      }),
    ),
    requestPermissionsAsync: jest.fn(() =>
      Promise.resolve({ status: 'granted', granted: true, canAskAgain: true, expires: 'never' }),
    ),
    getExpoPushTokenAsync: jest.fn(() =>
      Promise.resolve({ type: 'expo', data: 'ExponentPushToken[test-token]' }),
    ),
    setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
    addNotificationReceivedListener: jest.fn(subscribe(listeners.received)),
    addNotificationResponseReceivedListener: jest.fn(subscribe(listeners.response)),
    addPushTokenListener: jest.fn(subscribe(listeners.token)),
    getLastNotificationResponse: jest.fn(() => lastResponse),
    clearLastNotificationResponse: jest.fn(() => {
      lastResponse = null;
    }),
    __setLastResponse: (r: unknown) => {
      lastResponse = r;
    },
    __emit: {
      received: (n: unknown) => listeners.received.forEach((fn) => fn(n)),
      response: (r: unknown) => listeners.response.forEach((fn) => fn(r)),
      token: (t: unknown) => listeners.token.forEach((fn) => fn(t)),
    },
  };
});

// In-app review (MOB-17): the OS sheet does not exist in Node.
jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  hasAction: jest.fn(() => Promise.resolve(true)),
  requestReview: jest.fn(() => Promise.resolve()),
}));

// RevenueCat (MOB-19): no native side in Node. The enums are the real ones; the SDK calls are
// jest.fn()s. No key is set here, so the app treats purchases as "not available right now"
// unless a test sets EXPO_PUBLIC_REVENUECAT_IOS_KEY and scripts these mocks.
jest.mock('react-native-purchases', () => {
  const internal = jest.requireActual('@revenuecat/purchases-typescript-internal');
  const Purchases = {
    configure: jest.fn(),
    setLogLevel: jest.fn(() => Promise.resolve()),
    logIn: jest.fn(() => Promise.resolve({ customerInfo: {}, created: false })),
    logOut: jest.fn(() => Promise.resolve({})),
    getOfferings: jest.fn(() => Promise.resolve({ all: {}, current: null })),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(() => Promise.resolve({ entitlements: { active: {} } })),
    // Not eligible unless a test says so (the safe answer: no trial copy).
    checkTrialOrIntroductoryPriceEligibility: jest.fn(() => Promise.resolve({})),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(() => true),
  };
  return {
    __esModule: true,
    default: Purchases,
    INTRO_ELIGIBILITY_STATUS: internal.INTRO_ELIGIBILITY_STATUS,
    LOG_LEVEL: internal.LOG_LEVEL,
    PACKAGE_TYPE: internal.PACKAGE_TYPE,
    PURCHASES_ERROR_CODE: internal.PURCHASES_ERROR_CODE,
  };
});

// History PDF (MOB-27): no print web view or share sheet in Node. Tests read the HTML from the
// `printToFileAsync` mock's calls and assert what the share sheet was given.
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(() => Promise.resolve({ uri: 'file:///cache/Print/history.pdf' })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
// MOB-27b: the PDF is deleted from the cache afterwards. Spy on `File.prototype.delete` to see it
// (`this.uri` is the file); `exists` is true unless a test overrides it.
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return true;
    }
    // MOB-55: a recorded voice take (bytes only, no audio). Tests override `size` to check limits.
    get size() {
      return 1000;
    }
    arrayBuffer() {
      return Promise.resolve(new ArrayBuffer(8));
    }
    delete() {
      return undefined;
    }
  }
  return { File };
});

// Voice (MOB-55): expo-audio has no native side in Node and throws on import. This stand-in
// records nothing; it keeps a recorder's and a player's state so tests can drive them:
// `jest.requireMock('expo-audio').__audio` (`permission`, `recorders`, `players`).
jest.mock('expo-audio', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const audio = {
    permission: true,
    recorders: [] as FakeRecorder[],
    players: [] as FakePlayer[],
    takes: 0,
  };
  class FakeRecorder {
    uri: string | null = null;
    isRecording = false;
    durationMillis = 0;
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
    prepareToRecordAsync = jest.fn(() => Promise.resolve());
    record = jest.fn(() => {
      this.isRecording = true;
      this.durationMillis = 0;
      audio.takes += 1;
      this.uri = `file:///document/ExpoAudio/take-${audio.takes}.m4a`;
    });
    stop = jest.fn(() => {
      this.isRecording = false;
      return Promise.resolve();
    });
    getStatus() {
      return {
        canRecord: true,
        isRecording: this.isRecording,
        durationMillis: this.durationMillis,
        mediaServicesDidReset: false,
        url: this.uri,
      };
    }
  }
  class FakePlayer {
    playing = false;
    isLoaded = false;
    currentTime = 0;
    duration = 0;
    didJustFinish = false;
    source: unknown = null;
    replace = jest.fn((source: unknown) => {
      this.source = source;
      this.isLoaded = true;
      this.currentTime = 0;
      this.didJustFinish = false;
    });
    play = jest.fn(() => {
      this.playing = true;
    });
    pause = jest.fn(() => {
      this.playing = false;
    });
    // createAudioPlayer (MOB-65 gesture sounds): status listeners and release.
    listeners: ((status: { didJustFinish: boolean }) => void)[] = [];
    addListener = jest.fn((_event: string, cb: (status: { didJustFinish: boolean }) => void) => {
      this.listeners.push(cb);
      return { remove: () => (this.listeners = this.listeners.filter((l) => l !== cb)) };
    });
    remove = jest.fn();
    /** Test helper: fire a playback status update. */
    emit(status: { didJustFinish: boolean }) {
      [...this.listeners].forEach((cb) => cb(status));
    }
  }
  /** Polls a shared object like the real hooks' native events would update them. */
  function usePolled<T>(read: () => T, interval = 100): T {
    const [value, setValue] = React.useState(read);
    React.useEffect(() => {
      const timer = setInterval(() => setValue(read()), interval);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return value;
  }
  return {
    __audio: audio,
    AudioQuality: { MIN: 0, LOW: 0x20, MEDIUM: 0x40, HIGH: 0x60, MAX: 0x7f },
    IOSOutputFormat: { MPEG4AAC: 'aac ' },
    requestRecordingPermissionsAsync: jest.fn(() =>
      Promise.resolve({
        granted: audio.permission,
        status: audio.permission ? 'granted' : 'denied',
      }),
    ),
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    createAudioPlayer: jest.fn((source: unknown) => {
      const p = new FakePlayer();
      p.source = source;
      p.isLoaded = true;
      audio.players.push(p);
      return p;
    }),
    useAudioRecorder: (options: unknown) => {
      const [recorder] = React.useState(() => {
        const r = new FakeRecorder(options);
        audio.recorders.push(r);
        return r;
      });
      return recorder;
    },
    useAudioRecorderState: (recorder: FakeRecorder, interval?: number) =>
      usePolled(() => recorder.getStatus(), interval),
    useAudioPlayer: () => {
      const [player] = React.useState(() => {
        const p = new FakePlayer();
        audio.players.push(p);
        return p;
      });
      return player;
    },
    useAudioPlayerStatus: (player: FakePlayer) =>
      usePolled(() => ({
        playing: player.playing,
        isLoaded: player.isLoaded,
        currentTime: player.currentTime,
        duration: player.duration,
        didJustFinish: player.didJustFinish,
      })),
  };
});
