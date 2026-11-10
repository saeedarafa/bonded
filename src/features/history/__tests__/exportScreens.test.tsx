import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type * as ReactModule from 'react';

import type { EndedRow } from '@/features/history/ended';
import type { ExportQuestion } from '@/features/history/exportPdf';
import EndedHistoryScreen from '@/features/history/screens/EndedHistoryScreen';
import type { EndedCouple } from '@/features/settings/api';
import { useEndedSeen } from '@/features/settings/partnerLeft';
import PartnerLeftScreen from '@/features/settings/screens/PartnerLeftScreen';
import { AppError } from '@/lib/errors';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  Redirect: ({ href }: { href: string }) => {
    mockRouter.replace(href);
    return null;
  },
}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));

const mockEnded = jest.fn<Promise<EndedCouple | null>, []>();
const mockName = jest.fn<Promise<string | null>, [string]>();
jest.mock('@/features/settings/api', () => ({
  ...jest.requireActual('@/features/settings/api'),
  getLatestEndedCouple: () => mockEnded(),
  getProfileName: (id: string) => mockName(id),
}));
const mockExport = jest.fn<Promise<ExportQuestion[]>, [string]>();
const mockPage = jest.fn<Promise<EndedRow[]>, [string, number]>();
jest.mock('@/features/history/api', () => ({
  ...jest.requireActual('@/features/history/api'),
  getHistoryExport: (id: string) => mockExport(id),
  getEndedHistoryPage: (id: string, page: number) => mockPage(id, page),
}));

const DAY = 86_400_000;
const endedDaysAgo = (days: number): EndedCouple => ({
  id: 'c-old',
  ended_at: new Date(Date.now() - days * DAY).toISOString(),
  paired_at: '2026-01-01T10:00:00Z',
  ended_by: 'u2',
  ended_reason: 'unpaired',
  couple_members: [
    { user_id: 'u1', left_at: null },
    { user_id: 'u2', left_at: null },
  ],
});
const ans = (userId: string, body: string) => ({
  userId,
  body,
  createdAt: '2026-10-20T09:00:00Z',
});
const ROWS: ExportQuestion[] = [
  {
    id: 'cq-both',
    source: 'daily',
    assignedFor: '2026-10-20',
    createdAt: '2026-10-20T08:00:00Z',
    question: 'What made you smile?',
    answers: [ans('u1', 'FIXTURE-mine'), ans('u2', 'FIXTURE-sams')],
    messages: [ans('u2', 'FIXTURE-reply')],
  },
  {
    id: 'cq-locked',
    source: 'daily',
    assignedFor: '2026-10-21',
    createdAt: '2026-10-21T08:00:00Z',
    question: 'A locked one',
    answers: [ans('u2', 'FIXTURE-sam-unrevealed')],
    messages: [],
  },
];

function show(ui: ReactModule.ReactElement, opts?: Parameters<typeof renderUi>[1]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderUi(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, opts);
}
const printed = () =>
  (jest.mocked(Print.printToFileAsync).mock.calls[0]?.[0]?.html ?? '') as string;
const PDF = 'file:///cache/Print/history.pdf';
/** The files `File.prototype.delete` was called on (MOB-27b). */
let deleteSpy: jest.SpyInstance;
const deleted = () => deleteSpy.mock.contexts.map((f) => (f as { uri: string }).uri);

beforeEach(() => {
  jest.clearAllMocks();
  mockEnded.mockReset();
  mockExport.mockReset();
  mockName.mockReset();
  mockName.mockResolvedValue('Sam');
  deleteSpy?.mockRestore();
  deleteSpy = jest.spyOn(File.prototype, 'delete');
  mockEnded.mockResolvedValue(endedDaysAgo(1));
  mockExport.mockResolvedValue(ROWS);
  mockPage.mockResolvedValue([]);
  useEndedSeen.setState({ seen: [] });
});

describe('58 Download your history (MOB-27)', () => {
  it('makes the PDF of the ended couple and opens the share sheet', async () => {
    await show(<PartnerLeftScreen />);
    // Deterministic: the name has loaded (the title says so) before the tap.
    expect(await screen.findByTestId('58-title')).toHaveTextContent('Sam has unpaired');
    const card = screen.getByTestId('58-download');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe(
      'Download your history. A PDF of your answers and replies',
    );
    expect(screen.queryByText('Coming soon')).toBeNull();
    await fireEvent.press(card);
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(mockExport).toHaveBeenCalledWith('c-old');
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/Print/history.pdf', {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Save your History',
    });
    // The reveal rule in the file: my answer, Sam's revealed one and the reply; never the locked one.
    const html = printed();
    expect(html).toContain('Our History: you and Sam');
    expect(html).toContain('FIXTURE-mine');
    expect(html).toContain('FIXTURE-sams');
    expect(html).toContain('FIXTURE-reply');
    expect(html).not.toContain('FIXTURE-sam-unrevealed');
    expect(html).not.toContain('A locked one');
    expect(html).toContain('1 question you answered, from Bonded.');
    expect(screen.queryByTestId('58-download-error')).toBeNull();
    // MOB-27b: the share sheet has closed, so the file is gone from the cache.
    await waitFor(() => expect(deleted()).toEqual([PDF]));
    expect(deleteSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(Sharing.shareAsync).mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('a tap before the name has loaded still prints it (MOB-27b)', async () => {
    let giveName: (name: string) => void = () => undefined;
    mockName.mockReturnValue(new Promise((r) => (giveName = r)));
    await show(<PartnerLeftScreen />);
    const card = await screen.findByTestId('58-download');
    expect(screen.getByTestId('58-title')).toHaveTextContent('Your partner has unpaired');
    await fireEvent.press(card);
    // The export waits for the same read (one request, not two) instead of using the fallback.
    expect(Print.printToFileAsync).not.toHaveBeenCalled();
    giveName('Sam');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(printed()).toContain('Our History: you and Sam');
    expect(printed()).not.toContain('your partner');
    expect(mockName).toHaveBeenCalledTimes(1);
  });

  it('the name read fails: the PDF is still made, with "your partner" (MOB-27b)', async () => {
    mockName.mockRejectedValue(new AppError('UNKNOWN', 'x'));
    await show(<PartnerLeftScreen />);
    await fireEvent.press(await screen.findByTestId('58-download'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(printed()).toContain('Our History: you and your partner');
    expect(screen.queryByTestId('58-download-error')).toBeNull();
  });

  it('a deleted account keeps no name (D09): no read, "your partner"', async () => {
    mockEnded.mockResolvedValue({ ...endedDaysAgo(1), ended_reason: 'deleted' });
    await show(<PartnerLeftScreen />);
    await fireEvent.press(await screen.findByTestId('58-download'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(printed()).toContain('Our History: you and your partner');
    expect(mockName).not.toHaveBeenCalled();
  });

  it('says it is working, and a second tap meanwhile does nothing', async () => {
    let finish: (rows: ExportQuestion[]) => void = () => undefined;
    mockExport.mockReturnValueOnce(new Promise((r) => (finish = r)));
    await show(<PartnerLeftScreen />);
    const card = await screen.findByTestId('58-download');
    await fireEvent.press(card);
    await waitFor(() =>
      expect(screen.getByTestId('58-download-caption')).toHaveTextContent('Making your PDF…'),
    );
    expect(screen.getByTestId('58-download').props.accessibilityState).toMatchObject({
      busy: true,
    });
    await fireEvent.press(screen.getByTestId('58-download'));
    finish(ROWS);
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(mockExport).toHaveBeenCalledTimes(1);
  });

  it('offline: the network message, and a tap tries again', async () => {
    mockExport.mockRejectedValueOnce(
      new AppError('NETWORK', "You're offline. We'll try again when you're back."),
    );
    await show(<PartnerLeftScreen />);
    await fireEvent.press(await screen.findByTestId('58-download'));
    expect(await screen.findByTestId('58-download-error')).toHaveProp(
      'accessibilityLabel',
      "You're offline. We'll try again when you're back.",
    );
    await fireEvent.press(screen.getByTestId('58-download'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('58-download-error')).toBeNull());
  });

  it.each([
    [
      'printing fails',
      () => jest.mocked(Print.printToFileAsync).mockRejectedValueOnce(new Error('x')),
      [] as string[],
    ],
    [
      'no share sheet',
      () => jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false),
      [PDF],
    ],
    [
      'the share sheet fails',
      () => jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error(`share ${PDF}`)),
      [PDF],
    ],
  ])('%s: our own error copy, never the native message', async (_name, arrange, removed) => {
    arrange();
    await show(<PartnerLeftScreen />);
    await fireEvent.press(await screen.findByTestId('58-download'));
    expect(await screen.findByTestId('58-download-error')).toHaveProp(
      'accessibilityLabel',
      "We couldn't make the PDF. Try again.",
    );
    // MOB-27b: a PDF that was written is deleted on failure too (none when printing failed).
    expect(deleted()).toEqual(removed);
  });

  it('a delete that fails is ignored: no error shown, nothing logged (MOB-27b)', async () => {
    const spies = (['log', 'warn', 'error'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    deleteSpy.mockImplementation(() => {
      throw new Error(`cannot delete ${PDF}`);
    });
    await show(<PartnerLeftScreen />);
    await fireEvent.press(await screen.findByTestId('58-download'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('58-download-error')).toBeNull();
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain('history.pdf');
    spies.forEach((s) => s.mockRestore());
  });

  it('never logs answer or reply text', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    jest.mocked(Print.printToFileAsync).mockRejectedValueOnce(new Error('FIXTURE-mine'));
    await show(<PartnerLeftScreen />);
    await fireEvent.press(await screen.findByTestId('58-download'));
    await screen.findByTestId('58-download-error');
    await fireEvent.press(screen.getByTestId('58-download'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toMatch(/FIXTURE-/);
    spies.forEach((s) => s.mockRestore());
  });

  it('after the 30 days there is no card (RLS would return nothing)', async () => {
    mockEnded.mockResolvedValue(endedDaysAgo(31));
    await show(<PartnerLeftScreen />);
    expect(await screen.findByTestId('58-title')).toBeTruthy();
    expect(screen.queryByTestId('58-download')).toBeNull();
    expect(screen.queryByTestId('58-history')).toBeNull();
  });

  it('dark at 200% text still offers it', async () => {
    await show(<PartnerLeftScreen />, { scheme: 'dark', fontScale: 2 });
    expect(await screen.findByTestId('58-download')).toBeTruthy();
  });
});

describe('/ended archive keeps the download (MOB-27)', () => {
  const ROW: EndedRow = {
    id: 'cq-both',
    source: 'daily',
    assignedFor: '2026-10-20',
    createdAt: '2026-10-20T08:00:00Z',
    question: 'What made you smile?',
    answeredBy: ['u1', 'u2'],
    replies: 1,
  };

  it('offers the PDF above the list', async () => {
    mockPage.mockResolvedValue([ROW]);
    await show(<EndedHistoryScreen />);
    await fireEvent.press(await screen.findByTestId('ended-download'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(mockExport).toHaveBeenCalledWith('c-old');
    expect(printed()).toContain('Our History: you and Sam');
    await waitFor(() => expect(deleted()).toEqual([PDF]));
  });

  it('not when there is nothing of mine to save', async () => {
    mockPage.mockResolvedValue([{ ...ROW, answeredBy: ['u2'] }]);
    await show(<EndedHistoryScreen />);
    expect(await screen.findByTestId('ended-empty')).toBeTruthy();
    expect(screen.queryByTestId('ended-download')).toBeNull();
  });
});
