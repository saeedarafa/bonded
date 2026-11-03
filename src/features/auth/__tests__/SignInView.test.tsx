import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { SignInView } from '@/features/auth/SignInView';
import * as api from '@/features/auth/api';
import { AppError } from '@/lib/errors';
import { renderUi } from '@/test/render';

jest.mock('@/features/auth/api', () => ({
  isAppleSignInAvailable: jest.fn(() => Promise.resolve(true)),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  sendEmailCode: jest.fn(),
  verifyEmailCode: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

async function renderView(overrides: Partial<Parameters<typeof SignInView>[0]> = {}) {
  const onSignedIn = jest.fn();
  const onBack = jest.fn();
  const qc = new QueryClient({ defaultOptions: { mutations: { gcTime: 0, retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <SignInView
        screenId="08"
        step={4}
        total={4}
        title="Save your bond"
        body="So your answers are safe."
        mascotSize={140}
        onBack={onBack}
        onSignedIn={onSignedIn}
        {...overrides}
      />
    </QueryClientProvider>
  );
  const view = await renderUi(ui);
  return { ...view, onSignedIn, onBack, qc };
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.isAppleSignInAvailable.mockResolvedValue(true);
});

describe('SignInView', () => {
  it('shows the three options, the legal line and the step', async () => {
    const { qc } = await renderView();
    expect(screen.getByText('Save your bond')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.getByText('Continue with email')).toBeTruthy();
    expect(screen.getByLabelText('Step 4 of 4')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('08-apple')).toBeTruthy());
    expect(screen.getByText('Terms')).toBeTruthy();
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    qc.clear();
  });

  it('hides Apple where it is not available (Android)', async () => {
    mocked.isAppleSignInAvailable.mockResolvedValue(false);
    const { qc } = await renderView();
    await act(async () => undefined);
    expect(screen.queryByTestId('08-apple')).toBeNull();
    expect(screen.getByTestId('08-google')).toBeTruthy();
    qc.clear();
  });

  it('Google success reports signed in; cancel shows nothing', async () => {
    mocked.signInWithGoogle.mockResolvedValueOnce('cancelled');
    const { onSignedIn, qc } = await renderView();
    await fireEvent.press(screen.getByTestId('08-google'));
    await waitFor(() => expect(mocked.signInWithGoogle).toHaveBeenCalledTimes(1));
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.queryByTestId('08-error')).toBeNull();

    mocked.signInWithGoogle.mockResolvedValueOnce('signedIn');
    await fireEvent.press(screen.getByTestId('08-google'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    qc.clear();
  });

  it('shows a provider failure as a banner', async () => {
    mocked.signInWithGoogle.mockRejectedValueOnce(new AppError('NETWORK', "You're offline."));
    const { qc } = await renderView();
    await fireEvent.press(screen.getByTestId('08-google'));
    await waitFor(() => expect(screen.getByTestId('08-error')).toBeTruthy());
    expect(screen.getByText("You're offline.")).toBeTruthy();
    qc.clear();
  });

  it.each(['08', 'J4'] as const)(
    '%s visibly labels the email field before and after typing',
    async (screenId) => {
      const { qc } = await renderView({ screenId });
      await fireEvent.press(screen.getByTestId(`${screenId}-email`));

      expect(screen.getByText("What's your email?")).toBeTruthy();
      expect(screen.getByText('Email')).toBeTruthy();
      const input = screen.getByLabelText('Email');
      expect(input.props.keyboardType).toBe('email-address');
      expect(input.props.autoComplete).toBe('email');
      expect(input.props.value).toBe('');

      await fireEvent.changeText(input, 'maya@example.com');
      expect(screen.getByText('Email')).toBeTruthy();
      expect(screen.getByLabelText('Email').props.value).toBe('maya@example.com');
      qc.clear();
    },
  );

  it('email: validates, sends a code, verifies it, reports signed in', async () => {
    mocked.sendEmailCode.mockResolvedValue();
    mocked.verifyEmailCode.mockResolvedValue();
    const { onSignedIn, qc } = await renderView();

    await fireEvent.press(screen.getByTestId('08-email'));
    expect(screen.getByText("What's your email?")).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('08-email-field'), 'nope');
    await fireEvent.press(screen.getByTestId('08-send-code'));
    expect(screen.getByText("That doesn't look like an email address.")).toBeTruthy();
    expect(mocked.sendEmailCode).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('08-email-field'), 'maya@example.com');
    await fireEvent.press(screen.getByTestId('08-send-code'));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
    expect(mocked.sendEmailCode.mock.calls[0]?.[0]).toBe('maya@example.com');
    expect(
      screen.getByText(
        'Tap the sign-in link or enter the 6-digit code we sent to maya@example.com.',
      ),
    ).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('08-code-field'), '12ab34');
    await fireEvent.press(screen.getByTestId('08-verify'));
    expect(screen.getByText('The code has 6 digits.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('08-code-field'), '123456');
    await fireEvent.press(screen.getByTestId('08-verify'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(mocked.verifyEmailCode).toHaveBeenCalledWith('maya@example.com', '123456');
    qc.clear();
  });

  it('email: a wrong code shows the error, resend confirms, back steps out', async () => {
    mocked.sendEmailCode.mockResolvedValue();
    mocked.verifyEmailCode.mockRejectedValueOnce(
      new AppError('UNKNOWN', "That code isn't right, or it has expired."),
    );
    const { onBack, onSignedIn, qc } = await renderView();
    await fireEvent.press(screen.getByTestId('08-email'));
    await fireEvent.changeText(screen.getByTestId('08-email-field'), 'maya@example.com');
    await fireEvent.press(screen.getByTestId('08-send-code'));
    await waitFor(() => expect(screen.getByTestId('08-code-field')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('08-code-field'), '000000');
    await fireEvent.press(screen.getByTestId('08-verify'));
    await waitFor(() => expect(screen.getByText(/isn't right/)).toBeTruthy());
    expect(onSignedIn).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('08-resend'));
    await waitFor(() => expect(screen.getByText('New code sent.')).toBeTruthy());
    expect(mocked.sendEmailCode).toHaveBeenCalledTimes(2);

    await fireEvent.press(screen.getByTestId('08-top-back')); // code -> email
    expect(screen.getByTestId('08-send-code')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('08-top-back')); // email -> options
    expect(screen.getByTestId('08-google')).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('08-top-back')); // options -> leave
    expect(onBack).toHaveBeenCalledTimes(1);
    qc.clear();
  });

  it('J4 variant: 1 of 3', async () => {
    const { qc } = await renderView({ screenId: 'J4', step: 1, total: 3 });
    expect(screen.getByLabelText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByTestId('J4-google')).toBeTruthy();
    qc.clear();
  });
});
