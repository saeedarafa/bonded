import { reloadWidgetsNow, setWidgetModuleForTests } from '../bridge';
import { requestWidgetReload, resetWidgetReloadForTests, widgetReloadTiming } from '../reload';

/** MOB-78c (QA-49b): one debounced native reload; foreground reloads throttled; never throws. */

const setSnapshot = jest.fn();
const reloadWidgets = jest.fn();
const { debounceMs, foregroundMinIntervalMs } = widgetReloadTiming;

let clock = 0;
const now = () => clock;
function advance(ms: number) {
  clock += ms;
  jest.advanceTimersByTime(ms);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  clock = 1_000_000;
  resetWidgetReloadForTests();
  setWidgetModuleForTests({ setSnapshot, reloadWidgets });
});

afterEach(() => {
  resetWidgetReloadForTests();
  jest.useRealTimers();
});

afterAll(() => setWidgetModuleForTests(undefined));

describe('reloadWidgetsNow', () => {
  it('calls the native function once', () => {
    expect(reloadWidgetsNow()).toBe(true);
    expect(reloadWidgets).toHaveBeenCalledTimes(1);
  });

  it('no-op without the module (Expo Go, web, Jest) or in an older build without the function', () => {
    setWidgetModuleForTests(null);
    expect(reloadWidgetsNow()).toBe(false);
    setWidgetModuleForTests({ setSnapshot });
    expect(reloadWidgetsNow()).toBe(false);
  });

  it('never throws when the native side does', () => {
    reloadWidgets.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => reloadWidgetsNow()).not.toThrow();
    expect(reloadWidgetsNow()).toBe(true);
  });
});

describe('requestWidgetReload', () => {
  it('debounces a burst into one reload', () => {
    requestWidgetReload('state', now);
    requestWidgetReload('foreground', now);
    requestWidgetReload('state', now);
    advance(debounceMs - 1);
    expect(reloadWidgets).not.toHaveBeenCalled();
    advance(1);
    expect(reloadWidgets).toHaveBeenCalledTimes(1);
  });

  it('throttles foreground reloads, but a state change always reloads', () => {
    requestWidgetReload('foreground', now);
    advance(debounceMs);
    expect(reloadWidgets).toHaveBeenCalledTimes(1);

    requestWidgetReload('foreground', now); // app switched away and back at once
    advance(debounceMs);
    expect(reloadWidgets).toHaveBeenCalledTimes(1);

    requestWidgetReload('state', now); // e.g. the plan lapsed
    advance(debounceMs);
    expect(reloadWidgets).toHaveBeenCalledTimes(2);

    advance(foregroundMinIntervalMs);
    requestWidgetReload('foreground', now);
    advance(debounceMs);
    expect(reloadWidgets).toHaveBeenCalledTimes(3);
  });

  it('a state change during a pending foreground reload forces it', () => {
    requestWidgetReload('foreground', now);
    advance(debounceMs);
    requestWidgetReload('foreground', now);
    requestWidgetReload('state', now);
    advance(debounceMs);
    expect(reloadWidgets).toHaveBeenCalledTimes(2);
  });

  it('without the native function: nothing happens and nothing throws', () => {
    setWidgetModuleForTests(null);
    expect(() => {
      requestWidgetReload('state', now);
      advance(debounceMs);
    }).not.toThrow();
  });

  it('a throwing native reload stays quiet and does not stop later ones', () => {
    reloadWidgets.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    requestWidgetReload('state', now);
    expect(() => advance(debounceMs)).not.toThrow();
    requestWidgetReload('foreground', now);
    advance(debounceMs);
    expect(reloadWidgets).toHaveBeenCalledTimes(2);
  });
});
