// Pure BE-08 policy: callers supply counts from the ledger and a fixed clock-derived local time.
export type PushRuleInput = {
  type: string;
  localTime: string;
  quietStart: string;
  quietEnd: string;
  preferenceEnabled: boolean;
  dailyCount: number;
  typeCount: number;
  typeCap: number | null;
  groupedCount: number;
};

export const inQuietHours = (time: string, start: string, end: string): boolean =>
  start < end ? time >= start && time < end : time >= start || time < end;

export const suppression = (input: PushRuleInput): string | null => {
  if (!input.preferenceEnabled) return 'preference';
  if (inQuietHours(input.localTime, input.quietStart, input.quietEnd)) return 'quiet_hours';
  if (input.dailyCount >= 4) return 'daily_cap';
  if (input.typeCap !== null && input.typeCount >= input.typeCap) return 'type_cap';
  if (input.type === 'thread_activity' && input.groupedCount > 0) return 'grouped';
  return null;
};
