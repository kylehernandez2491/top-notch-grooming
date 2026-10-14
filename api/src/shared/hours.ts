/**
 * Which hours apply on a given date, shared by the availability engine, the staff screens and the chat
 * assistant. Pure calendar arithmetic on YYYY-MM-DD and HH:mm strings in the shop's zone.
 */
import type { BusinessSettings, Closure, DayHours, SpecialHours, TimeRange, Weekday } from './types';
import { WEEKDAYS } from './types';
import { fromMinutes, toMinutes } from './format';

/** Weekday of a YYYY-MM-DD date. */
export function weekdayOfDay(day: string): Weekday {
  return WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
}

export function specialHoursId(day: string): string {
  return `hours-${day}`;
}

/** That date's special hours if it has any, otherwise its weekday's hours (null: closed that weekday). */
export function hoursOn(day: string, weeklyHours: BusinessSettings['weeklyHours'], specialHours: readonly SpecialHours[] = []): DayHours | null {
  const special = specialHours.find((s) => s.date === day);
  if (special) return { open: special.open, close: special.close, breaks: special.breaks };
  return weeklyHours[weekdayOfDay(day)];
}

export interface DayPlan {
  day: string;
  /** Hours after special hours are applied; null when closed that weekday. */
  hours: DayHours | null;
  special?: SpecialHours;
  /** A full-day closure (time off), which wins over any hours. */
  closure?: Closure;
  /** Blocked windows inside the day, e.g. a vet run. */
  partial: Closure[];
}

export function dayPlan(day: string, weeklyHours: BusinessSettings['weeklyHours'], closures: readonly Closure[], specialHours: readonly SpecialHours[] = []): DayPlan {
  const dayClosures = closures.filter((c) => c.date === day);
  return {
    day,
    hours: hoursOn(day, weeklyHours, specialHours),
    special: specialHours.find((s) => s.date === day),
    closure: dayClosures.find((c) => !c.start || !c.end),
    partial: dayClosures.filter((c) => c.start && c.end),
  };
}

export function isOpenDay(plan: DayPlan): boolean {
  return !!plan.hours && !plan.closure;
}

/** The stretches of the day the shop is open: hours minus breaks and blocked windows. */
export function openPeriods(plan: DayPlan): TimeRange[] {
  if (!plan.hours || plan.closure) return [];
  const blocked = [...plan.hours.breaks, ...plan.partial.map((c) => ({ start: c.start!, end: c.end! }))]
    .map((b) => [toMinutes(b.start), toMinutes(b.end)] as const)
    .sort((a, b) => a[0] - b[0]);
  const periods: TimeRange[] = [];
  let cursor = toMinutes(plan.hours.open);
  const close = toMinutes(plan.hours.close);
  for (const [start, end] of blocked) {
    if (start > cursor && cursor < close) periods.push({ start: fromMinutes(cursor), end: fromMinutes(Math.min(start, close)) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < close) periods.push({ start: fromMinutes(cursor), end: fromMinutes(close) });
  return periods;
}

export type OpenState =
  | { state: 'closed' }
  | { state: 'before'; opensAt: string }
  | { state: 'open'; until: string }
  | { state: 'break'; until: string }
  | { state: 'after' };

/** Whether the shop is open at a minute of the day, and what happens next. */
export function stateAt(plan: DayPlan, minute: number): OpenState {
  const periods = openPeriods(plan);
  if (!periods.length) return { state: 'closed' };
  if (minute < toMinutes(periods[0].start)) return { state: 'before', opensAt: periods[0].start };
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (minute >= toMinutes(p.start) && minute < toMinutes(p.end)) return { state: 'open', until: p.end };
    const next = periods[i + 1];
    if (next && minute >= toMinutes(p.end) && minute < toMinutes(next.start)) return { state: 'break', until: next.start };
  }
  return { state: 'after' };
}
