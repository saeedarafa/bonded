import { renderHook } from '@testing-library/react-native';

import { usePinnedQuestion } from '@/features/daily/usePinnedQuestion';

type Q = { id: string; answerCount: number };

const setup = (initial: Q | undefined, held: Set<string>) =>
  renderHook(({ live }: { live: Q | undefined }) => usePinnedQuestion(live, (id) => held.has(id)), {
    initialProps: { live: initial },
  });

describe('usePinnedQuestion (#258: 19 stays on the question it opened)', () => {
  const day1: Q = { id: 'cq-1', answerCount: 0 };
  const day2: Q = { id: 'cq-2', answerCount: 0 };

  it('waits for the first question, then shows it', async () => {
    const { result, rerender } = await setup(undefined, new Set());
    expect(result.current).toEqual({ question: undefined, stale: false });
    await rerender({ live: day1 });
    expect(result.current).toEqual({ question: day1, stale: false });
  });

  it('takes updates of the same row (who has answered)', async () => {
    const { result, rerender } = await setup(day1, new Set(['cq-1']));
    const answered = { ...day1, answerCount: 1 };
    await rerender({ live: answered });
    expect(result.current).toEqual({ question: answered, stale: false });
  });

  it('keeps the opened question while it holds a draft, and says it is no longer the live one', async () => {
    const { result, rerender } = await setup(day1, new Set(['cq-1']));
    await rerender({ live: day2 });
    expect(result.current).toEqual({ question: day1, stale: true });
    // Still pinned on the next refetch.
    await rerender({ live: { ...day2 } });
    expect(result.current.question).toBe(day1);
  });

  it('moves on to the new question when nothing is held', async () => {
    const { result, rerender } = await setup(day1, new Set());
    await rerender({ live: day2 });
    expect(result.current).toEqual({ question: day2, stale: false });
  });

  it('moves on once the held work is gone (the draft cleared)', async () => {
    const held = new Set(['cq-1']);
    const { result, rerender } = await setup(day1, held);
    await rerender({ live: day2 });
    expect(result.current.question).toBe(day1);
    held.delete('cq-1');
    await rerender({ live: day2 });
    expect(result.current).toEqual({ question: day2, stale: false });
  });

  it('keeps the question while the live row is briefly missing', async () => {
    const { result, rerender } = await setup(day1, new Set());
    await rerender({ live: undefined });
    expect(result.current).toEqual({ question: day1, stale: false });
  });
});
