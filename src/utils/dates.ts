import { DateTime } from 'luxon';

const fromDay = (day: string) => DateTime.fromISO(day);

/** "Tue, Oct 13" */
export const shortDay = (day: string) => fromDay(day).toFormat('ccc, LLL d');
/** "Tuesday, October 13" */
export const longDay = (day: string) => fromDay(day).toFormat('cccc, LLLL d');
/** "October 2026" */
export const monthLabel = (month: string) => DateTime.fromISO(`${month}-01`).toFormat('LLLL yyyy');
export const monthOf = (day: string) => day.slice(0, 7);
export const addDays = (day: string, n: number) => fromDay(day).plus({ days: n }).toISODate()!;
export const addMonths = (month: string, n: number) => DateTime.fromISO(`${month}-01`).plus({ months: n }).toFormat('yyyy-LL');
export const startOfWeek = (day: string) => fromDay(day).startOf('week').toISODate()!;
export const weekdayShort = (day: string) => fromDay(day).toFormat('ccc');
export const dayNumber = (day: string) => fromDay(day).day;

/** Monday-first weeks covering a month, padded with neighbouring days. */
export function monthGrid(month: string): string[][] {
  const first = DateTime.fromISO(`${month}-01`);
  let cursor = first.startOf('week');
  const end = first.endOf('month').endOf('week');
  const weeks: string[][] = [];
  while (cursor <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor.toISODate()!);
      cursor = cursor.plus({ days: 1 });
    }
    weeks.push(week);
  }
  return weeks;
}

export function monthRange(month: string): { from: string; to: string } {
  const grid = monthGrid(month);
  return { from: grid[0][0], to: grid[grid.length - 1][6] };
}

/** "Today", "Tomorrow", "In 5 days", "Tue, Oct 13" */
export function relativeDay(day: string, today: string): string {
  const diff = Math.round(fromDay(day).diff(fromDay(today), 'days').days);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  return shortDay(day);
}

/** Today's date in the shop's time zone (so a late-evening visitor in another zone sees the right day). */
export const todayIn = (timeZone: string) => DateTime.now().setZone(timeZone).toISODate()!;

export function ageFrom(birthday?: string): string | undefined {
  if (!birthday) return undefined;
  const diff = DateTime.now().diff(DateTime.fromISO(birthday), ['years', 'months']);
  if (diff.years >= 1) return `${Math.floor(diff.years)} yr`;
  return `${Math.max(1, Math.floor(diff.months))} mo`;
}

export const timestamp = (iso: string) => DateTime.fromISO(iso).toFormat("LLL d, h:mm a");
