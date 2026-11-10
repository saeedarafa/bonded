import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type * as ReactModule from 'react';

import type { FeedbackInput } from '@/features/feedback/api';
import FeedbackScreen from '@/features/feedback/screens/FeedbackScreen';
import { AppError } from '@/lib/errors';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui/components/Toast';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
let mockUserId: string | null = 'u1';
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: mockUserId }) }));
const mockSend = jest.fn<Promise<void>, [FeedbackInput]>();
jest.mock('@/features/feedback/api', () => ({
  ...jest.requireActual('@/features/feedback/api'),
  sendFeedback: (input: FeedbackInput) => mockSend(input),
}));

function withQuery(ui: ReactModule.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
const show = (opts?: Parameters<typeof renderUi>[1]) =>
  renderUi(withQuery(<FeedbackScreen />), opts);

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'u1';
  mockSend.mockResolvedValue(undefined);
  useToast.setState({ toast: null });
});

describe('27 Private feedback', () => {
  it('renders the board: title, five tags, note field, send and the promise', async () => {
    await show();
    expect(screen.getByTestId('27-screen')).toBeTruthy();
    expect(screen.getByText('What would make it better?')).toBeTruthy();
    expect(screen.getByText('Pick anything that fits.')).toBeTruthy();
    for (const label of [
      'Repetitive questions',
      'Partner forgets to answer',
      'Reminders at the wrong time',
      'Something broke',
      'Something else',
    ])
      expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByLabelText('Tell us more (optional)')).toBeTruthy();
    expect(screen.getByText('Send to the team')).toBeTruthy();
    expect(screen.getByText('Read by a real person. We reply by email.')).toBeTruthy();
    expect(screen.queryByTestId('27-count')).toBeNull();
  });

  it('tags are checkboxes and the count follows them', async () => {
    await show();
    const pill = screen.getByTestId('27-tag-partner_forgets');
    expect(pill.props.accessibilityState).toEqual({ checked: false });
    await fireEvent.press(pill);
    expect(screen.getByTestId('27-tag-partner_forgets').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(screen.getByTestId('27-count')).toHaveTextContent('1 selected');
    await fireEvent.press(screen.getByTestId('27-tag-something_broke'));
    expect(screen.getByTestId('27-count')).toHaveTextContent('2 selected');
    await fireEvent.press(screen.getByTestId('27-tag-partner_forgets'));
    expect(screen.getByTestId('27-count')).toHaveTextContent('1 selected');
  });

  it('sends tags and the trimmed note as my feedback row, then thanks and goes back', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('27-tag-something_broke'));
    await fireEvent.press(screen.getByTestId('27-tag-partner_forgets'));
    await fireEvent.changeText(screen.getByTestId('27-body'), '  Sam travels a lot.  ');
    await fireEvent.press(screen.getByTestId('27-send'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockSend).toHaveBeenCalledWith({
      userId: 'u1',
      kind: 'feedback',
      score: null,
      tags: ['partner_forgets', 'something_broke'],
      body: 'Sam travels a lot.',
    });
    expect(useToast.getState().toast?.message).toBe(
      'Thanks. A real person on our team will read it.',
    );
  });

  it('a note alone is enough', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('27-body'), 'More date questions please');
    await fireEvent.press(screen.getByTestId('27-send'));
    await waitFor(() => expect(mockSend).toHaveBeenCalled());
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [],
        body: 'More date questions please',
      }),
    );
  });

  it('nothing picked or written: says so inline and sends nothing', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('27-body'), '   ');
    await fireEvent.press(screen.getByTestId('27-send'));
    expect(await screen.findByTestId('27-body-error')).toHaveTextContent(
      'Pick one or write a line first.',
    );
    expect(mockSend).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('27-tag-something_else'));
    expect(screen.queryByTestId('27-body-error')).toBeNull();
  });

  it('a failed send keeps what was written, says why and can be sent again', async () => {
    mockSend.mockRejectedValueOnce(new AppError('NETWORK', 'You seem to be offline.'));
    await show();
    await fireEvent.press(screen.getByTestId('27-tag-something_broke'));
    await fireEvent.changeText(screen.getByTestId('27-body'), 'The app crashed');
    await fireEvent.press(screen.getByTestId('27-send'));
    expect(await screen.findByTestId('27-error')).toBeTruthy();
    expect(screen.getByText('You seem to be offline.')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(screen.getByTestId('27-body').props.value).toBe('The app crashed');
    await fireEvent.press(screen.getByTestId('27-send'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('signed out: never calls the server', async () => {
    mockUserId = null;
    await show();
    await fireEvent.press(screen.getByTestId('27-tag-something_broke'));
    await fireEvent.press(screen.getByTestId('27-send'));
    expect(await screen.findByTestId('27-error')).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('never logs the note', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {}),
    );
    mockSend.mockRejectedValueOnce(new AppError('UNKNOWN', 'Something went wrong.'));
    await show();
    await fireEvent.changeText(screen.getByTestId('27-body'), 'FIXTURE-SECRET-NOTE');
    await fireEvent.press(screen.getByTestId('27-send'));
    await screen.findByTestId('27-error');
    await act(async () => {});
    for (const spy of spies) {
      for (const call of spy.mock.calls)
        expect(JSON.stringify(call)).not.toContain('FIXTURE-SECRET-NOTE');
      spy.mockRestore();
    }
  });

  it('back leaves without sending', async () => {
    await show();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([
    ['dark', { scheme: 'dark' as const }],
    ['200% text', { fontScale: 2 }],
  ])('renders in %s', async (_name, opts) => {
    await show(opts);
    expect(screen.getByText('What would make it better?')).toBeTruthy();
    expect(screen.getByTestId('27-send')).toBeTruthy();
  });
});
