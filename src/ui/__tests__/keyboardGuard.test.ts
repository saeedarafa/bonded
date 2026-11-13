import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * MOB-86: the keyboard must never cover the focused field or a pinned/primary button. Any file
 * under app/ or src/features/ that renders a text input must get its keyboard handling from a
 * frame (OnboardingFrame, DailyFrame), from the `useFocusedFieldInView` hook, or from a Sheet
 * (which lifts itself above the keyboard). A new screen with a bare field fails here.
 */
const ROOT = join(__dirname, '..', '..', '..');
const INPUT = /<(TextField|AnswerField|CodeInput|Composer|DateField|TextInput)\b/;
const HANDLED = /useFocusedFieldInView|<OnboardingFrame|<DailyFrame|<Sheet\b|<ThreadComposer/;
// Fields placed inside a component that is itself checked (a Sheet body, the frame, a composer).
const WRAPPED_BY_SCREEN = new Set<string>([
  'src/features/thread/components/ThreadComposer.tsx',
  'src/features/onboarding/screens/FirstQuestionScreen.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('keyboard handling (MOB-86)', () => {
  const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src', 'features'))];
  const withInput = files.filter((f) => INPUT.test(readFileSync(f, 'utf8')));

  it('finds the screens with text input', () => {
    expect(withInput.length).toBeGreaterThanOrEqual(8);
  });

  it.each(withInput.map((f) => relative(ROOT, f)))('%s handles the keyboard', (rel) => {
    if (WRAPPED_BY_SCREEN.has(rel)) return;
    expect(readFileSync(join(ROOT, rel), 'utf8')).toMatch(HANDLED);
  });
});
