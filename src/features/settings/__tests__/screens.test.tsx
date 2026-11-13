import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import type * as ReactModule from 'react';

import { useLocalSoundOff } from '@/features/littleThings/hooks';
import { clearHeldCancelOffer, peekHeldCancelOffer } from '@/features/premium/cancelOffer';
import type { EndedCouple, NotificationPrefs } from '@/features/settings/api';
import CoupleSettingsScreen from '@/features/settings/screens/CoupleSettingsScreen';
import DeleteAccountScreen from '@/features/settings/screens/DeleteAccountScreen';
import NotificationsScreen from '@/features/settings/screens/NotificationsScreen';
import PartnerLeftScreen from '@/features/settings/screens/PartnerLeftScreen';
import UsScreen from '@/features/settings/screens/UsScreen';
import { useEndedSeen } from '@/features/settings/partnerLeft';
import { AppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { recordAnalytics } from '@/test/analytics';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui/components/Toast';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof ReactModule>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
    Redirect: ({ href }: { href: string }) => {
      mockRouter.replace(href);
      return null;
    },
  };
});
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/features/auth/api', () => ({ signOut: () => Promise.resolve() }));
// D27: little things are a build switch, off by default (production); on per test.
let mockShipLittleThings = false;
jest.mock('@/features/premium/features', () => {
  const actual = jest.requireActual('@/features/premium/features');
  const shipped = { ...actual.SHIPPED };
  Object.defineProperty(shipped, 'littleThings', {
    get: () => mockShipLittleThings,
    enumerable: true,
  });
  return { ...actual, SHIPPED: shipped };
});

const PAIRED = {
  id: 'couple-1',
  partner_name: null,
  stage: 'long_distance',
  goals: ['deep_talks', 'romance', 'future'],
  created_at: '2026-10-20T10:00:00Z',
  paired_at: '2026-10-21T10:00:00Z',
  timezone: 'UTC',
  couple_members: [
    { user_id: 'u1', left_at: null },
    { user_id: 'u2', left_at: null },
  ],
};
const SOLO = { ...PAIRED, paired_at: null, couple_members: [{ user_id: 'u1', left_at: null }] };
const mockCouple = jest.fn<Promise<object | null>, []>();
const mockUnpair = jest.fn<Promise<void>, []>();
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () => mockCouple(),
  unpair: () => mockUnpair(),
}));
const mockProfiles = jest.fn();
const mockUpdateProfile = jest.fn<Promise<void>, [string, object]>();
jest.mock('@/features/profile/api', () => ({
  getCoupleProfiles: () => mockProfiles(),
  updateMyProfile: (id: string, f: object) => mockUpdateProfile(id, f),
}));
type Row = { user_id: string; is_active: boolean; expires_at: string | null };
const mockEntitlements = jest.fn<Promise<Row[]>, []>();
jest.mock('@/features/premium/api', () => ({ getEntitlements: () => mockEntitlements() }));
// MOB-84: the cancel offer gate (store offer + `open_exit_offer('cancel')`) is tested in
// premium/__tests__/cancelOffer.test.tsx; here only what Us does with its answer.
const mockCancelGate = jest.fn<Promise<unknown>, [string]>(() => Promise.resolve(null));
jest.mock('@/features/premium/hooks', () => ({
  ...jest.requireActual('@/features/premium/hooks'),
  useCancelOfferGate: () => mockCancelGate,
}));
jest.mock('@/features/daily/api', () => ({
  getStreak: () =>
    Promise.resolve({
      current: 12,
      longest: 12,
      last_completed_on: null,
      completed_today: true,
      at_risk: false,
      saver_available: false,
    }),
}));
const mockPrefs = jest.fn<Promise<NotificationPrefs | null>, []>();
const mockSave = jest.fn<Promise<void>, [string, object]>();
const mockUpdateCouple = jest.fn<Promise<void>, [string, object]>();
const mockEnded = jest.fn<Promise<EndedCouple | null>, []>();
const mockProfileName = jest.fn<Promise<string | null>, [string]>();
const mockDelete = jest.fn<Promise<void>, []>();
jest.mock('@/features/settings/api', () => ({
  ...jest.requireActual('@/features/settings/api'),
  getNotificationPrefs: () => mockPrefs(),
  saveNotificationPrefs: (u: string, p: object) => mockSave(u, p),
  updateCoupleSettings: (id: string, f: object) => mockUpdateCouple(id, f),
  getLatestEndedCouple: () => mockEnded(),
  getProfileName: (id: string) => mockProfileName(id),
  deleteAccount: () => mockDelete(),
}));
const mockWipe = jest.fn<Promise<void>, []>();
jest.mock('@/features/settings/localData', () => ({
  wipeLocalAccount: () => mockWipe(),
}));

const PREFS: NotificationPrefs = {
  ritual_time: '21:00:00',
  daily_reminder: true,
  partner_answered: true,
  replies: true,
  last_call: true,
  nudges: true,
  little_things: true,
  little_things_sound: true,
  tips: false,
  quiet_start: '23:00:00',
  quiet_end: '07:00:00',
};
const ENDED: EndedCouple = {
  id: 'c-old',
  ended_at: '2026-11-09T10:00:00Z',
  paired_at: '2026-10-21T10:00:00Z',
  ended_by: 'u2',
  ended_reason: 'unpaired',
  couple_members: [
    { user_id: 'u1', left_at: '2026-11-09T10:00:00Z' },
    { user_id: 'u2', left_at: '2026-11-09T10:00:00Z' },
  ],
};

function withQuery(ui: ReactModule.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
// `isAccountGone` (real) asks Auth once after a 401 from delete-account.
type GetUser = Awaited<ReturnType<typeof supabase.auth.getUser>>;
const mockGetUser = jest.spyOn(supabase.auth, 'getUser');
const userIs = (error: Error | null) =>
  mockGetUser.mockResolvedValueOnce({
    data: { user: null },
    error,
  } as unknown as GetUser);
const USER_GONE = () =>
  new AuthApiError('User from sub claim in JWT does not exist', 403, 'user_not_found');
const DELETED = 'Your account is deleted.';
const SIGNED_OUT = "You've been signed out. Sign in again to finish deleting your account.";

const show = (ui: ReactModule.ReactElement, opts?: Parameters<typeof renderUi>[1]) =>
  renderUi(withQuery(ui), opts);

beforeEach(() => {
  jest.clearAllMocks();
  // Queued `…Once` values must not leak into the next test.
  for (const m of [
    mockCouple,
    mockPrefs,
    mockEnded,
    mockSave,
    mockDelete,
    mockProfileName,
    mockWipe,
  ]) {
    m.mockReset();
  }
  mockGetUser.mockReset();
  mockCouple.mockResolvedValue(PAIRED);
  mockProfiles.mockResolvedValue([
    { id: 'u1', display_name: 'Maya', avatar_url: null },
    { id: 'u2', display_name: 'Sam', avatar_url: null },
  ]);
  mockEntitlements.mockResolvedValue([]);
  mockPrefs.mockResolvedValue(PREFS);
  mockSave.mockResolvedValue(undefined);
  mockUpdateCouple.mockResolvedValue(undefined);
  mockUpdateProfile.mockResolvedValue(undefined);
  mockUnpair.mockResolvedValue(undefined);
  mockEnded.mockResolvedValue(ENDED);
  mockProfileName.mockResolvedValue('Sam');
  mockDelete.mockResolvedValue(undefined);
  mockWipe.mockResolvedValue(undefined);
  useToast.setState({ toast: null });
  useEndedSeen.setState({ seen: [] });
});

describe('40 Us & settings', () => {
  it.each(['light', 'dark'] as const)(
    'shows the pair, streak and every row (%s)',
    async (scheme) => {
      await show(<UsScreen />, { scheme });
      expect(await screen.findByText('Maya & Sam')).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByTestId('40-subtitle').props.children).toContain('12-day streak'),
      );
      for (const id of ['ritual', 'notifications', 'couple', 'premium', 'restore', 'help']) {
        expect(screen.getByTestId(`40-${id}`)).toBeTruthy();
      }
      expect(screen.getByTestId('40-delete').props.accessibilityLabel).toBe('Delete account');
    },
  );

  it('keeps every row at 200% text', async () => {
    await show(<UsScreen />, { fontScale: 2 });
    expect(await screen.findByText('Maya & Sam')).toBeTruthy();
    expect(screen.getByTestId('40-delete')).toBeTruthy();
  });

  it('a solo couple waits for the partner', async () => {
    mockCouple.mockResolvedValue(SOLO);
    await show(<UsScreen />);
    expect(await screen.findByText('Waiting for Sam to join')).toBeTruthy();
  });

  it('loading, then an error with Try again', async () => {
    mockCouple.mockReturnValueOnce(new Promise(() => undefined));
    const first = await show(<UsScreen />);
    expect(screen.getByTestId('40-loading')).toBeTruthy();
    await first.unmount();
    mockCouple.mockRejectedValueOnce(new AppError('NETWORK', 'You seem to be offline.'));
    await show(<UsScreen />);
    expect(await screen.findByTestId('40-error')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Maya & Sam')).toBeTruthy();
  });

  it('my own plan opens the store page; a partner plan is only shown', async () => {
    mockEntitlements.mockResolvedValue([{ user_id: 'u1', is_active: true, expires_at: null }]);
    const first = await show(<UsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('40-premium').props.accessibilityLabel).toBe(
        'Premium, Active · covers you both',
      ),
    );
    expect(screen.getByTestId('40-premium').props.accessibilityRole).toBe('button');
    await first.unmount();
    mockEntitlements.mockResolvedValue([{ user_id: 'u2', is_active: true, expires_at: null }]);
    await show(<UsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('40-premium').props.accessibilityLabel).toBe(
        "Premium, On Sam's plan",
      ),
    );
    expect(screen.getByTestId('40-premium').props.accessibilityRole).toBe('text');
  });

  it('Manage subscription (MOB-84, D61): an offer opens the offer screen, none the store page', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockEntitlements.mockResolvedValue([{ user_id: 'u1', is_active: true, expires_at: null }]);
    const offer = { regularPrice: 'Y', offerPrice: 'C', percent: 30 };
    mockCancelGate.mockResolvedValueOnce(offer);
    await show(<UsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('40-premium').props.accessibilityRole).toBe('button'),
    );
    await fireEvent.press(screen.getByTestId('40-premium'));
    if (Platform.OS === 'ios') {
      await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/subscription/offer'));
      expect(peekHeldCancelOffer()).toBe(offer);
      expect(open).not.toHaveBeenCalled();
      clearHeldCancelOffer();
      // No offer (shown before, Monthly, partner's plan…): the store page, no screen.
      mockRouter.push.mockClear();
      await fireEvent.press(screen.getByTestId('40-premium'));
      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      expect(mockRouter.push).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      expect(mockCancelGate).not.toHaveBeenCalled();
    }
    open.mockRestore();
  });

  it('a failed ritual time save says so in the sheet', async () => {
    mockSave.mockRejectedValue(new AppError('NETWORK', 'x'));
    await show(<UsScreen />);
    await fireEvent.press(await screen.findByTestId('40-ritual'));
    await fireEvent.press(await screen.findByTestId('40-ritual-lunch'));
    expect(await screen.findByTestId('40-ritual-error')).toBeTruthy();
  });
});

describe('40 Send feedback (D62, MOB-85)', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
  });

  it('hidden while no support address is configured', async () => {
    delete process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
    await show(<UsScreen />);
    expect(await screen.findByText('Maya & Sam')).toBeTruthy();
    expect(screen.queryByTestId('40-send-feedback')).toBeNull();
  });

  it.each(['someone@example.com', 'support@hellobonded.com.evil.io', 'not an email'])(
    'hidden for an address outside the app domain (%s)',
    async (address) => {
      process.env.EXPO_PUBLIC_SUPPORT_EMAIL = address;
      await show(<UsScreen />);
      expect(await screen.findByText('Maya & Sam')).toBeTruthy();
      expect(screen.queryByTestId('40-send-feedback')).toBeNull();
    },
  );

  it('opens an email with the app version and platform only, and sends feedback_opened', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'support@hellobonded.com';
    const rec = recordAnalytics();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    try {
      await show(<UsScreen />);
      expect(await screen.findByText('Maya & Sam')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('40-send-feedback'));
      expect(open).toHaveBeenCalledTimes(1);
      const url = open.mock.calls[0]![0];
      expect(url.startsWith('mailto:support@hellobonded.com?subject=')).toBe(true);
      const body = decodeURIComponent(/[?&]body=([^&]*)/.exec(url)![1]!);
      expect(body).toMatch(/App version: \S+/);
      expect(body).toContain(`Platform: ${Platform.OS === 'ios' ? 'iOS' : 'Android'}`);
      // No account data: names, user id, email.
      for (const secret of ['Maya', 'Sam', 'u1', '@']) expect(body).not.toContain(secret);
      expect(rec.captured.filter((c) => c.event === 'feedback_opened')).toEqual([
        { event: 'feedback_opened', props: {} },
      ]);
    } finally {
      open.mockRestore();
      rec.stop();
    }
  });
});

describe('41 Notification settings', () => {
  it('names the partner and the ritual time, with tips off by default', async () => {
    await show(<NotificationsScreen />, { scheme: 'dark' });
    const daily = await screen.findByTestId('41-daily_reminder');
    expect(daily.props.accessibilityLabel).toBe('Daily reminder. At 21:00, your ritual time');
    expect(screen.getByTestId('41-partner_answered').props.accessibilityLabel).toBe(
      "Sam answered. When it's your turn",
    );
    expect(screen.getByTestId('41-tips').props.accessibilityState).toMatchObject({
      checked: false,
    });
    // PO 2026-11-11 (MOB-68): tips also cover offers.
    expect(screen.getByTestId('41-tips').props.accessibilityLabel).toBe(
      'Tips and news. New packs, offers and occasional updates',
    );
    expect(screen.getByTestId('41-quiet').props.accessibilityLabel).toBe(
      'Quiet hours, 23:00 – 07:00',
    );
  });

  it('a missing row shows the contract defaults and saves through the upsert', async () => {
    mockPrefs.mockResolvedValue(null);
    await show(<NotificationsScreen />);
    // A null row is data, so the switches show; the defaults have tips off.
    await waitFor(() => expect(screen.getByTestId('41-toggles')).toBeTruthy());
  });

  it('loading skeleton, then error with Try again', async () => {
    mockPrefs.mockReturnValueOnce(new Promise(() => undefined));
    const first = await show(<NotificationsScreen />);
    expect(screen.getByTestId('41-loading')).toBeTruthy();
    await first.unmount();
    mockPrefs.mockRejectedValueOnce(new AppError('UNKNOWN', ''));
    await show(<NotificationsScreen />);
    expect(await screen.findByTestId('41-error')).toBeTruthy();
    expect(screen.getByText("We couldn't load your notification settings.")).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('41-toggles')).toBeTruthy();
  });

  it('OS never asked: offers to turn notifications on', async () => {
    await show(<NotificationsScreen />);
    expect(await screen.findByTestId('41-turn-on')).toBeTruthy();
  });

  it('works at 200% text', async () => {
    await show(<NotificationsScreen />, { fontScale: 2 });
    expect(await screen.findByTestId('41-nudges')).toBeTruthy();
  });

  describe('little things rows (MOB-59, D48/D53)', () => {
    beforeEach(() => {
      useLocalSoundOff.setState({ pending: false });
    });
    afterEach(() => {
      mockShipLittleThings = false;
    });

    it('are hidden until little things ship (D27)', async () => {
      await show(<NotificationsScreen />);
      expect(await screen.findByTestId('41-nudges')).toBeTruthy();
      expect(screen.queryByTestId('41-little_things')).toBeNull();
      expect(screen.queryByTestId('41-little_things_sound')).toBeNull();
    });

    it('both on by default, after Nudges and before Tips, naming the partner', async () => {
      mockShipLittleThings = true;
      await show(<NotificationsScreen />);
      const push = await screen.findByTestId('41-little_things');
      expect(push.props.accessibilityLabel).toBe(
        'Little things. Hugs, kisses and goodnights from Sam',
      );
      expect(push.props.accessibilityState).toMatchObject({ checked: true });
      const sound = screen.getByTestId('41-little_things_sound');
      expect(sound.props.accessibilityLabel).toBe(
        'Little things sounds. A short sound for each one',
      );
      expect(sound.props.accessibilityState).toMatchObject({ checked: true });
      const ids = screen
        .getAllByTestId(/^41-(nudges|little_things|little_things_sound|tips)$/)
        .map((n) => n.props.testID as string);
      expect(ids).toEqual(['41-nudges', '41-little_things', '41-little_things_sound', '41-tips']);
    });

    it('the push switch saves notification_prefs.little_things (BE-45)', async () => {
      mockShipLittleThings = true;
      await show(<NotificationsScreen />);
      await fireEvent.press(await screen.findByTestId('41-little_things'));
      await waitFor(() => expect(mockSave).toHaveBeenCalledWith('u1', { little_things: false }));
    });

    /** The server keeps what was saved, so the refetch after a save reads it back. */
    const serverKeepsSaves = () =>
      mockSave.mockImplementation((_u, patch) => {
        mockPrefs.mockResolvedValue({ ...PREFS, ...patch });
        return Promise.resolve();
      });

    it('the sound switch saves notification_prefs.little_things_sound (BE-53, MOB-67)', async () => {
      mockShipLittleThings = true;
      serverKeepsSaves();
      await show(<NotificationsScreen />);
      await fireEvent.press(await screen.findByTestId('41-little_things_sound'));
      await waitFor(() =>
        expect(mockSave).toHaveBeenCalledWith('u1', { little_things_sound: false }),
      );
      expect(screen.getByTestId('41-little_things_sound').props.accessibilityState).toMatchObject({
        checked: false,
      });
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('reads the sound switch from the server row', async () => {
      mockShipLittleThings = true;
      mockPrefs.mockResolvedValue({ ...PREFS, little_things_sound: false });
      await show(<NotificationsScreen />);
      const sound = await screen.findByTestId('41-little_things_sound');
      expect(sound.props.accessibilityState).toMatchObject({ checked: false });
      await fireEvent.press(sound);
      await waitFor(() =>
        expect(mockSave).toHaveBeenCalledWith('u1', { little_things_sound: true }),
      );
    });

    it('a failed sound save flips back and says so', async () => {
      mockShipLittleThings = true;
      mockSave.mockRejectedValue(new AppError('NETWORK', 'x'));
      await show(<NotificationsScreen />);
      await fireEvent.press(await screen.findByTestId('41-little_things_sound'));
      expect(await screen.findByTestId('41-save-error')).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByTestId('41-little_things_sound').props.accessibilityState).toMatchObject(
          { checked: true },
        ),
      );
    });

    it('a sound "off" saved on this phone (MOB-59) is copied to the server once', async () => {
      mockShipLittleThings = true;
      serverKeepsSaves();
      useLocalSoundOff.setState({ pending: true });
      await show(<NotificationsScreen />);
      await waitFor(() =>
        expect(mockSave).toHaveBeenCalledWith('u1', { little_things_sound: false }),
      );
      await waitFor(() => expect(useLocalSoundOff.getState().pending).toBe(false));
      expect(screen.getByTestId('41-little_things_sound').props.accessibilityState).toMatchObject({
        checked: false,
      });
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('nothing is copied when the server is already off', async () => {
      mockShipLittleThings = true;
      useLocalSoundOff.setState({ pending: true });
      mockPrefs.mockResolvedValue({ ...PREFS, little_things_sound: false });
      await show(<NotificationsScreen />);
      await screen.findByTestId('41-little_things_sound');
      await waitFor(() => expect(useLocalSoundOff.getState().pending).toBe(false));
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('a failed copy keeps the local "off" for next time', async () => {
      mockShipLittleThings = true;
      useLocalSoundOff.setState({ pending: true });
      mockSave.mockRejectedValue(new AppError('NETWORK', 'x'));
      await show(<NotificationsScreen />);
      await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
      expect(useLocalSoundOff.getState().pending).toBe(true);
      expect(screen.getByTestId('41-little_things_sound').props.accessibilityState).toMatchObject({
        checked: false,
      });
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
  });
});

describe('42 Couple settings', () => {
  it('shows the partner, stage, names and topics, and the unpair card', async () => {
    await show(<CoupleSettingsScreen />);
    expect(await screen.findByTestId('42-unpair-card')).toBeTruthy();
    expect(screen.getByTestId('42-stage').props.accessibilityLabel).toBe(
      'Relationship stage, Long-distance',
    );
    expect(screen.getByTestId('42-names').props.accessibilityLabel).toBe('Our names, Maya & Sam');
    expect(screen.getByTestId('42-topics').props.accessibilityLabel).toBe(
      'Question topics, 3 selected',
    );
    expect(screen.getByText('Unpair from Sam')).toBeTruthy();
  });

  it('changes the stage from the sheet', async () => {
    await show(<CoupleSettingsScreen />);
    await fireEvent.press(await screen.findByTestId('42-stage'));
    await fireEvent.press(await screen.findByTestId('42-stage-dating'));
    await waitFor(() =>
      expect(mockUpdateCouple).toHaveBeenCalledWith('couple-1', { stage: 'dating' }),
    );
  });

  it('topics need at least one; then saves the new list', async () => {
    await show(<CoupleSettingsScreen />);
    await fireEvent.press(await screen.findByTestId('42-topics'));
    for (const g of ['deep_talks', 'romance', 'future']) {
      await fireEvent.press(screen.getByTestId(`42-topic-${g}`));
    }
    await fireEvent.press(screen.getByTestId('42-topics-save'));
    expect(await screen.findByText('Pick at least one topic.')).toBeTruthy();
    expect(mockUpdateCouple).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('42-topic-laughing'));
    await fireEvent.press(screen.getByTestId('42-topics-save'));
    await waitFor(() =>
      expect(mockUpdateCouple).toHaveBeenCalledWith('couple-1', { goals: ['laughing'] }),
    );
  });

  it('"Our names" edits my name only, never empty', async () => {
    await show(<CoupleSettingsScreen />);
    await fireEvent.press(await screen.findByTestId('42-names'));
    await fireEvent.changeText(screen.getByTestId('42-name-input'), '  ');
    await fireEvent.press(screen.getByTestId('42-name-save'));
    expect(await screen.findByText('Add your name to save.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('42-name-input'), 'Mia');
    await fireEvent.press(screen.getByTestId('42-name-save'));
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith('u1', { displayName: 'Mia' }),
    );
  });

  it('a failed save is said in the sheet', async () => {
    mockUpdateCouple.mockRejectedValue(new AppError('NETWORK', 'x'));
    await show(<CoupleSettingsScreen />);
    await fireEvent.press(await screen.findByTestId('42-stage'));
    await fireEvent.press(await screen.findByTestId('42-stage-engaged_married'));
    expect(await screen.findByTestId('42-sheet-error')).toBeTruthy();
  });

  it('no couple any more: back to the front door', async () => {
    mockCouple.mockResolvedValue(null);
    await show(<CoupleSettingsScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
  });

  it('dark and 200% text render the unpair card', async () => {
    await show(<CoupleSettingsScreen />, { scheme: 'dark', fontScale: 2 });
    expect(await screen.findByTestId('42-unpair')).toBeTruthy();
  });
});

describe('43 Delete account', () => {
  it.each(['light', 'dark'] as const)('names the partner in the bullets (%s)', async (scheme) => {
    await show(<DeleteAccountScreen />, { scheme, fontScale: scheme === 'dark' ? 2 : 1 });
    expect(
      await screen.findByText(
        'Sam keeps their own answers. Yours disappear from your shared history.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('43-manage')).toBeTruthy();
  });

  it('nothing is deleted until DELETE is typed', async () => {
    await show(<DeleteAccountScreen />);
    await fireEvent.press(await screen.findByTestId('43-confirm'));
    expect(screen.getByText('Type DELETE in capital letters to confirm.')).toBeTruthy();
    expect(mockDelete).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('43-input'), 'DELETE');
    expect(screen.queryByText('Type DELETE in capital letters to confirm.')).toBeNull();
    await fireEvent.press(screen.getByTestId('43-confirm'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
  });

  it('a server failure is shown inline with the mapped message', async () => {
    mockDelete.mockRejectedValue(new AppError('UNKNOWN', 'Something went wrong. Try again.'));
    await show(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
    await fireEvent.press(screen.getByTestId('43-confirm'));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(mockWipe).not.toHaveBeenCalled();
  });

  const pressDelete = async () => {
    await fireEvent.press(screen.getByTestId('43-confirm'));
  };

  it('a lost answer: network error, then 401 + Auth says the user is gone -> deleted', async () => {
    mockDelete
      .mockRejectedValueOnce(new AppError('NETWORK', 'No connection. Try again.'))
      .mockRejectedValueOnce(new AppError('SIGNED_OUT', 'Please sign in again.'));
    userIs(USER_GONE());
    await show(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
    await pressDelete();
    expect(await screen.findByTestId('43-error')).toBeTruthy();
    expect(mockWipe).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();

    await pressDelete();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockWipe).toHaveBeenCalledTimes(1));
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    // Counted as done: no error, the "deleted" toast, and the wipe's local sign-out sends the
    // auth gate to onboarding.
    await waitFor(() => expect(useToast.getState().toast?.message).toBe(DELETED));
    expect(screen.queryByTestId('43-error')).toBeNull();
  });

  it('401 on the first press with an expired/invalid session: wipe, signed out, not deleted', async () => {
    mockDelete.mockRejectedValueOnce(new AppError('SIGNED_OUT', 'Please sign in again.'));
    userIs(
      new AuthApiError(
        'Invalid Refresh Token: Refresh Token Not Found',
        400,
        'refresh_token_not_found',
      ),
    );
    await show(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
    await pressDelete();
    await waitFor(() => expect(mockWipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useToast.getState().toast?.message).toBe(SIGNED_OUT));
    expect(screen.queryByTestId('43-error')).toBeNull();
  });

  it('401 while Auth is unreachable: wipe, signed out, not deleted', async () => {
    mockDelete.mockRejectedValueOnce(new AppError('SIGNED_OUT', 'Please sign in again.'));
    userIs(new AuthRetryableFetchError('Network request failed', 0));
    await show(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
    await pressDelete();
    await waitFor(() => expect(mockWipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useToast.getState().toast?.message).toBe(SIGNED_OUT));
  });

  it.each([
    [
      'the user still exists',
      () =>
        mockGetUser.mockResolvedValueOnce({
          data: { user: { id: 'u1' } },
          error: null,
        } as unknown as GetUser),
    ],
    ['getUser throws', () => mockGetUser.mockRejectedValueOnce(new Error('boom'))],
    [
      'the session is gone (session_not_found)',
      () => userIs(new AuthApiError('Session not found', 403, 'session_not_found')),
    ],
  ])('401 when %s: signed out, not deleted', async (_name, arrange) => {
    mockDelete.mockRejectedValueOnce(new AppError('SIGNED_OUT', 'Please sign in again.'));
    arrange();
    await show(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
    await pressDelete();
    await waitFor(() => expect(mockWipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useToast.getState().toast?.message).toBe(SIGNED_OUT));
  });

  it('503 AUTH_UNAVAILABLE (BE-39): keeps the session, shows a retry, the retry deletes', async () => {
    const UNAVAILABLE =
      "We couldn't reach our sign-in service, so nothing was deleted. You're still signed in. Try again in a moment.";
    mockDelete.mockRejectedValueOnce(new AppError('UNKNOWN', UNAVAILABLE));
    await show(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
    await pressDelete();
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    // No sign-out, no local wipe, Auth not asked, no toast.
    expect(mockWipe).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(useToast.getState().toast).toBeNull();
    // Still on 43 with DELETE typed: "Delete forever" retries.
    await pressDelete();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockWipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useToast.getState().toast?.message).toBe(DELETED));
  });

  it('success wipes everything local once', async () => {
    await show(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
    await fireEvent.press(screen.getByTestId('43-confirm'));
    await waitFor(() => expect(mockWipe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useToast.getState().toast?.message).toBe(DELETED));
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

describe('58 Partner left', () => {
  it('names the partner and offers a new start (the PDF card: history/exportScreens.test)', async () => {
    await show(<PartnerLeftScreen />);
    expect(await screen.findByText('Sam has unpaired')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('58-invite'));
    expect(useEndedSeen.getState().seen).toEqual(['c-old']);
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('after an account deletion (no partner row) the copy says "Your partner"', async () => {
    mockEnded.mockResolvedValue({
      ...ENDED,
      ended_by: null,
      ended_reason: 'deleted',
      couple_members: [ENDED.couple_members[0]!],
    });
    await show(<PartnerLeftScreen />, { scheme: 'dark', fontScale: 2 });
    expect(await screen.findByText('Your partner has unpaired')).toBeTruthy();
    expect(mockProfileName).not.toHaveBeenCalled();
  });

  it('ended_reason deleted never reads a name, even if a member row is still there', async () => {
    mockEnded.mockResolvedValue({ ...ENDED, ended_by: null, ended_reason: 'deleted' });
    await show(<PartnerLeftScreen />);
    expect(await screen.findByText('Your partner has unpaired')).toBeTruthy();
    expect(mockProfileName).not.toHaveBeenCalled();
  });

  it('a missing former profile (no name) falls back', async () => {
    mockProfileName.mockResolvedValue(null);
    await show(<PartnerLeftScreen />);
    expect(await screen.findByText('Your partner has unpaired')).toBeTruthy();
    expect(mockProfileName).toHaveBeenCalledWith('u2');
  });

  it('I ended it myself (another phone): no 58, back to the front door', async () => {
    mockEnded.mockResolvedValue({ ...ENDED, ended_by: 'u1' });
    await show(<PartnerLeftScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByTestId('58-title')).toBeNull();
  });

  it('an unreadable former profile also falls back', async () => {
    mockProfileName.mockRejectedValue(new AppError('UNKNOWN', 'x'));
    await show(<PartnerLeftScreen />);
    expect(await screen.findByText('Your partner has unpaired')).toBeTruthy();
  });

  it('loading, then nothing to tell: back to the front door', async () => {
    mockEnded.mockReturnValueOnce(new Promise(() => undefined));
    const first = await show(<PartnerLeftScreen />);
    expect(screen.getByTestId('58-loading')).toBeTruthy();
    await first.unmount();
    useEndedSeen.setState({ seen: ['c-old'] });
    await show(<PartnerLeftScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
  });
});
