import {
  applyEase,
  cubicBezier,
  motion,
  MOTIONS,
  sampleMotion,
  type Motion,
} from '../mascot/motion';

const close = (a: number, b: number, digits = 3) => expect(a).toBeCloseTo(b, digits);

describe('mascot keyframes (MOB-31)', () => {
  it('CSS timing functions: endpoints, symmetry and known points', () => {
    for (const ease of ['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(applyEase(ease, 0)).toBe(0);
      expect(applyEase(ease, 1)).toBe(1);
      for (let t = 0.1; t < 1; t += 0.1) {
        expect(applyEase(ease, t)).toBeGreaterThanOrEqual(applyEase(ease, t - 0.1));
      }
    }
    close(applyEase('easeInOut', 0.5), 0.5);
    close(applyEase('easeIn', 0.5) + applyEase('easeOut', 0.5), 1);
    // cubic-bezier(.25,.1,.25,1) ("ease") at x = .5 is about .8024.
    close(cubicBezier(0.25, 0.1, 0.25, 1, 0.5), 0.8024, 3);
  });

  it('samples each stop exactly and clamps outside 0..1', () => {
    const { keyframes, ease } = MOTIONS.bounce;
    keyframes.at.forEach((at, i) => {
      const pose = sampleMotion(keyframes, ease, at);
      close(pose.ty, keyframes.ty[i] ?? 0);
      close(pose.sx, keyframes.sx[i] ?? 1);
      close(pose.sy, keyframes.sy[i] ?? 1);
    });
    expect(sampleMotion(keyframes, ease, -1)).toEqual(sampleMotion(keyframes, ease, 0));
    expect(sampleMotion(keyframes, ease, 2)).toEqual(sampleMotion(keyframes, ease, 1));
  });

  it('matches the board: breathe squashes at half time, blink closes at 94 %', () => {
    const breathe = sampleMotion(MOTIONS.breathe.keyframes, MOTIONS.breathe.ease, 0.5);
    close(breathe.sx, 1.04);
    close(breathe.sy, 0.95);
    expect(sampleMotion(MOTIONS.blink.keyframes, 'ease', 0.5).sy).toBe(1);
    close(sampleMotion(MOTIONS.blink.keyframes, 'ease', 0.94).sy, 0.1);
    // Untouched channels stay at identity.
    expect(breathe).toMatchObject({ tx: 0, ty: 0, rot: 0, op: 1 });
  });

  it.each(Object.keys(MOTIONS))('%s is well formed and loops without a visible jump', (name) => {
    const m: Motion = MOTIONS[name as keyof typeof MOTIONS];
    const { at } = m.keyframes;
    expect(at[0]).toBe(0);
    expect(at[at.length - 1]).toBe(1);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1] ?? 0);
    for (const track of ['tx', 'ty', 'sx', 'sy', 'rot', 'op'] as const) {
      const values = m.keyframes[track];
      if (values) expect(values).toHaveLength(at.length);
    }
    const first = sampleMotion(m.keyframes, m.ease, 0);
    const last = sampleMotion(m.keyframes, m.ease, 1);
    // Either it ends where it starts, or it is invisible at both ends (steam, z's, seeds, heart).
    if (first.op === 0) expect(last.op).toBe(0);
    else expect(last).toEqual(first);
    // DESIGN.md §6 "never sad": small, gentle motions only.
    expect(m.duration).toBeGreaterThanOrEqual(1600);
    expect(m.duration).toBeLessThanOrEqual(4200);
  });

  it('motion() keeps the board numbers and adds the delay', () => {
    expect(motion('steam', 1200)).toEqual({ ...MOTIONS.steam, delay: 1200 });
  });
});
