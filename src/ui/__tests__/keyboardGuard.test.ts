import { readSource, sourceFiles } from '@/test/sourceFiles';

/**
 * MOB-86: the keyboard must never cover the focused field or a pinned/primary button. Any file
 * under app/ or src/features/ that renders a text input must get its keyboard handling from a
 * frame (OnboardingFrame, DailyFrame), from the `useFocusedFieldInView` hook, or from a Sheet
 * (which lifts itself above the keyboard). A new screen with a bare field fails here.
 */
const INPUT = /<(TextField|AnswerField|CodeInput|Composer|DateField|TextInput)\b/;
const HANDLED = /useFocusedFieldInView|<OnboardingFrame|<DailyFrame|<Sheet\b|<ThreadComposer/;
// Fields placed inside a component that is itself checked (a Sheet body, the frame, a composer).
const WRAPPED_BY_SCREEN = new Set<string>([
  'src/features/thread/components/ThreadComposer.tsx',
  'src/features/onboarding/screens/FirstQuestionScreen.tsx',
]);

describe('keyboard handling (MOB-86)', () => {
  const files = [...sourceFiles('app', /\.tsx$/), ...sourceFiles('src/features', /\.tsx$/)];
  const withInput = files.filter((f) => INPUT.test(readSource(f)));

  it('finds the screens with text input', () => {
    expect(withInput.length).toBeGreaterThanOrEqual(8);
  });

  it.each(withInput)('%s handles the keyboard', (rel) => {
    if (WRAPPED_BY_SCREEN.has(rel)) return;
    expect(readSource(rel)).toMatch(HANDLED);
  });
});
