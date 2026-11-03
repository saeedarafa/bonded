/** Ritual time presets (supabase/content/notifications.json `default_ritual_times`, board 09). */
export const RITUAL_TIMES = [
  { id: 'morning', time: '08:00' },
  { id: 'lunch', time: '12:30' },
  { id: 'evening', time: '21:00' },
] as const;

export type RitualTimeId = (typeof RITUAL_TIMES)[number]['id'];

/** The board's preselected row (and the server default, D23). */
export const DEFAULT_RITUAL: RitualTimeId = 'evening';

export function ritualTime(id: RitualTimeId): string {
  return RITUAL_TIMES.find((r) => r.id === id)?.time ?? '21:00';
}

/** `21:00:00` (Postgres `time`) to `21:00`. */
export function shortTime(value: string): string {
  return /^\d{2}:\d{2}/.exec(value)?.[0] ?? value;
}
