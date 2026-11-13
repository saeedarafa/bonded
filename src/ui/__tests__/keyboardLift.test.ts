import { keyboardLift } from '../components/Sheet';

describe('keyboardLift (MOB-86)', () => {
  it('iOS: height and top edge agree', () => {
    // 932 pt window, 336 pt keyboard whose top edge is at 596.
    expect(keyboardLift({ height: 336, screenY: 596 }, 932)).toBe(336);
  });

  it('Android edge-to-edge: the height leaves out the nav bar, the top edge does not', () => {
    // Keyboard reported 300 dp tall, but it starts 324 dp above the window bottom (24 dp nav bar).
    expect(keyboardLift({ height: 300, screenY: 590 }, 914)).toBe(324);
  });

  it('never less than the reported height (a window taller than the screen)', () => {
    expect(keyboardLift({ height: 280, screenY: 700 }, 900)).toBe(280);
  });

  it('a keyboard below the window (hidden, floating off-screen) lifts nothing', () => {
    expect(keyboardLift({ height: 0, screenY: 960 }, 932)).toBe(0);
  });

  it('never negative', () => {
    expect(keyboardLift({ height: -10, screenY: 1000 }, 932)).toBe(0);
  });
});
