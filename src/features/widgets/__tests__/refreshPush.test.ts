/**
 * MOB-78d (BE-64, CONTRACTS §5 "Widget token refresh"): the silent data-only push
 * `{type: "widget_refresh"}` runs `runWidgetRefreshTask()` from the expo-notifications background
 * task; every other push and every tap response is left alone; nothing is logged.
 */

// The executor passed to defineTask at import time is captured before the test body runs.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
// Registered at import time too, so the mock function lives inside the factory (no TDZ).
jest.mock('expo-notifications', () => ({
  registerTaskAsync: jest.fn(() => Promise.resolve(null)),
}));
const mockRun = jest.fn(() => Promise.resolve(1));
jest.mock('../backgroundRefresh', () => ({
  runWidgetRefreshTask: () => mockRun(),
  TASK_SUCCESS: 1,
  TASK_FAILED: 2,
}));

/* eslint-disable import/first */
import {
  handleWidgetRefreshPushTask,
  isWidgetRefreshData,
  PUSH_TASK_FAILED,
  PUSH_TASK_NEW_DATA,
  PUSH_TASK_NO_DATA,
  WIDGET_REFRESH_PUSH_TASK,
} from '../refreshPush';
import { widgetRefreshPushTaskDefined } from '../refreshPushTask';
/* eslint-enable import/first */

const mockDefineTask = jest.requireMock<{ defineTask: jest.Mock }>('expo-task-manager').defineTask;
const definedAtImport = mockDefineTask.mock.calls.map(
  (c) => c as [string, (body: { data?: unknown }) => Promise<number>],
);
const registeredAtImport = [
  ...jest.requireMock<{ registerTaskAsync: jest.Mock }>('expo-notifications').registerTaskAsync.mock
    .calls,
];

const BODY = JSON.stringify({ type: 'widget_refresh' });
/** What the background task receives on each platform (expo-notifications 58). */
const ANDROID = { notification: null, data: { body: BODY, dataString: BODY, scopeKey: 'x' } };
const IOS = {
  notification: null,
  data: { body: { type: 'widget_refresh' }, dataString: BODY, experienceId: 'x' },
  aps: { 'content-available': 1 },
};

beforeEach(() => {
  mockRun.mockReset().mockResolvedValue(1);
});

describe('isWidgetRefreshData', () => {
  it.each([
    ['foreground content.data', { type: 'widget_refresh' }],
    ['Android task data (dataString)', ANDROID.data],
    ['iOS task data (body object)', { body: { type: 'widget_refresh' } }],
    ['iOS task data (dataString only)', { dataString: BODY }],
    ['body as a JSON string', { body: BODY }],
  ])('%s: yes', (_name, data) => {
    expect(isWidgetRefreshData(data)).toBe(true);
  });

  it.each([
    ['another push', { type: 'partner_answered', url: 'bonded://today' }],
    ['another push in dataString', { dataString: JSON.stringify({ type: 'nudge' }) }],
    ['broken JSON', { dataString: '{type' }],
    ['empty', {}],
    ['null', null],
    ['a string', 'widget_refresh'],
    ['an array', [{ type: 'widget_refresh' }]],
  ])('%s: no', (_name, data) => {
    expect(isWidgetRefreshData(data)).toBe(false);
  });
});

describe('handleWidgetRefreshPushTask', () => {
  it.each([
    ['Android', ANDROID],
    ['iOS', IOS],
  ])('%s silent push: runs the refresh once, NewData', async (_name, payload) => {
    await expect(handleWidgetRefreshPushTask(payload)).resolves.toBe(PUSH_TASK_NEW_DATA);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('a failed refresh reports Failed (the OS may retry)', async () => {
    mockRun.mockResolvedValueOnce(2);
    await expect(handleWidgetRefreshPushTask(ANDROID)).resolves.toBe(PUSH_TASK_FAILED);
  });

  it('never throws', async () => {
    mockRun.mockRejectedValueOnce(new Error('boom'));
    await expect(handleWidgetRefreshPushTask(IOS)).resolves.toBe(PUSH_TASK_FAILED);
  });

  it.each([
    ['another push', { notification: null, data: { dataString: '{"type":"nudge"}' } }],
    [
      'a tap response',
      {
        actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
        notification: { request: { content: { data: { type: 'widget_refresh' } } } },
      },
    ],
    ['no payload', undefined],
  ])('%s: NoData, no refresh', async (_name, payload) => {
    await expect(handleWidgetRefreshPushTask(payload)).resolves.toBe(PUSH_TASK_NO_DATA);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('logs nothing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    await handleWidgetRefreshPushTask(ANDROID);
    mockRun.mockRejectedValueOnce(new Error('boom'));
    await handleWidgetRefreshPushTask(IOS);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('the background task (refreshPushTask, imported by index.ts)', () => {
  it('is defined and registered with expo-notifications when the bundle loads', () => {
    expect(widgetRefreshPushTaskDefined).toBe(true);
    expect(definedAtImport.map(([name]) => name)).toEqual([WIDGET_REFRESH_PUSH_TASK]);
    expect(registeredAtImport).toEqual([[WIDGET_REFRESH_PUSH_TASK]]);
  });

  it('the executor hands the task payload to the handler', async () => {
    const executor = definedAtImport[0]?.[1];
    await expect(executor?.({ data: IOS })).resolves.toBe(PUSH_TASK_NEW_DATA);
    await expect(executor?.({ data: { notification: null, data: {} } })).resolves.toBe(
      PUSH_TASK_NO_DATA,
    );
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('index.ts imports the task before expo-router', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
    const entry = fs.readFileSync(`${process.cwd()}/index.ts`, 'utf8');
    const task = entry.indexOf("import './src/features/widgets/refreshPushTask'");
    expect(task).toBeGreaterThan(-1);
    expect(task).toBeLessThan(entry.indexOf("import 'expo-router/entry'"));
  });
});
