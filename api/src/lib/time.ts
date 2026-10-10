import { DateTime } from 'luxon';
import type { Weekday } from '../shared/types';
import { WEEKDAYS } from '../shared/types';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDay(value: string): boolean {
  return DAY_RE.test(value) && DateTime.fromISO(value).isValid;
}

export function nowIn(timeZone: string): DateTime {
  return DateTime.now().setZone(timeZone);
}

export function todayIn(timeZone: string, now: DateTime = DateTime.now()): string {
  return now.setZone(timeZone).toISODate()!;
}

export function weekdayOf(day: string): Weekday {
  return WEEKDAYS[DateTime.fromISO(day).weekday - 1];
}

export function addDays(day: string, days: number): string {
  return DateTime.fromISO(day).plus({ days }).toISODate()!;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  while (cursor <= end) {
    out.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days);
}

/** Wall-clock day + time in the shop's zone -> DateTime in that zone. */
export function zoned(day: string, time: string, timeZone: string): DateTime {
  return DateTime.fromISO(`${day}T${time}`, { zone: timeZone });
}

export function zonedUtcIso(day: string, time: string, timeZone: string): string {
  return zoned(day, time, timeZone).toUTC().toISO()!;
}

/** TTL (seconds) that keeps a day-scoped helper document until a week after that day. */
export function ttlAfterDay(day: string, timeZone: string, keepDays = 8): number {
  const expires = zoned(day, '00:00', timeZone).plus({ days: keepDays });
  return Math.max(3600, Math.round(expires.diffNow('seconds').seconds));
}

export function friendlyDate(day: string): string {
  return DateTime.fromISO(day).toFormat('cccc, LLLL d');
}
