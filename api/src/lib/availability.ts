/**
 * Pure availability engine (no I/O) — unit-tested in test/availability.test.ts.
 *
 * Model: a day is cut into LOCK_MINUTES blocks. Every booked appointment owns one lock document per
 * block it occupies (service time + clean-up buffer). A start time is offered when the service fits
 * inside opening hours (that date's special hours, else the weekly hours), avoids breaks and partial
 * closures, respects minimum notice, and none of the blocks it would need are already locked.
 */
import type { DateTime } from 'luxon';
import type { BusinessSettings, Closure, DayAvailability, SlotOption, SpecialHours } from '../shared/types';
import { LOCK_MINUTES } from '../shared/types';
import { fromMinutes, roundUp, toMinutes } from '../shared/format';
import { hoursOn } from '../shared/hours';
import { addDays, eachDay, zoned } from './time';

export interface AvailabilityContext {
  settings: BusinessSettings;
  closures: Closure[];
  /** Dates whose hours replace the weekly hours. */
  specialHours?: SpecialHours[];
  /** day -> minute-of-day of every locked block. */
  locked: Map<string, Set<number>>;
  /** day -> active appointments already on that day. */
  counts: Map<string, number>;
  durationMinutes: number;
  now: DateTime;
  /** Staff bookings skip notice, horizon and daily-cap rules (but never overlap). */
  staff?: boolean;
}

/** Minute-of-day of every lock block an appointment starting at startMin needs. */
export function lockBlocks(startMin: number, durationMinutes: number, bufferMinutes: number): number[] {
  const span = roundUp(durationMinutes + bufferMinutes, LOCK_MINUTES);
  const blocks: number[] = [];
  for (let m = startMin; m < startMin + span; m += LOCK_MINUTES) blocks.push(m);
  return blocks;
}

export function lockId(minute: number): string {
  return `lock-${fromMinutes(minute)}`;
}

export function lockMinute(id: string): number {
  return toMinutes(id.replace('lock-', ''));
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function dayAvailability(day: string, ctx: AvailabilityContext): DayAvailability {
  const { settings, now } = ctx;
  const zone = settings.timeZone;
  const today = now.setZone(zone).toISODate()!;

  if (day < today) return { day, status: 'past', slots: [] };
  if (!ctx.staff && day > addDays(today, settings.bookingHorizonDays)) {
    return { day, status: 'beyond', slots: [], reason: `Bookings open ${settings.bookingHorizonDays} days ahead` };
  }

  const hours = hoursOn(day, settings.weeklyHours, ctx.specialHours);
  if (!hours) return { day, status: 'closed', slots: [], reason: 'Closed' };

  const dayClosures = ctx.closures.filter((c) => c.date === day);
  const fullClosure = dayClosures.find((c) => !c.start || !c.end);
  if (fullClosure) return { day, status: 'closed', slots: [], reason: fullClosure.reason || 'Closed' };

  const count = ctx.counts.get(day) ?? 0;
  if (!ctx.staff && settings.maxAppointmentsPerDay > 0 && count >= settings.maxAppointmentsPerDay) {
    return { day, status: 'full', slots: [], reason: 'Fully booked' };
  }

  const blocked = [
    ...hours.breaks.map((b) => [toMinutes(b.start), toMinutes(b.end)] as const),
    ...dayClosures.map((c) => [toMinutes(c.start!), toMinutes(c.end!)] as const),
  ];
  const locked = ctx.locked.get(day) ?? new Set<number>();
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  const step = Math.max(LOCK_MINUTES, settings.slotIncrementMinutes);
  const earliest = ctx.staff ? now : now.plus({ hours: settings.minNoticeHours });

  const slots: SlotOption[] = [];
  let tooSoon = 0;
  let capacity = 0;
  for (let start = open; start + ctx.durationMinutes <= close; start += step) {
    const end = start + ctx.durationMinutes;
    if (blocked.some(([bs, be]) => overlaps(start, end, bs, be))) continue;
    capacity++;
    const blocks = lockBlocks(start, ctx.durationMinutes, settings.bufferMinutes);
    if (blocks.some((b) => locked.has(b))) continue;
    if (zoned(day, fromMinutes(start), zone) < earliest) {
      tooSoon++;
      continue;
    }
    slots.push({ time: fromMinutes(start), endTime: fromMinutes(end) });
  }

  if (!slots.length) {
    if (tooSoon > 0) {
      return {
        day,
        status: 'past',
        slots,
        capacity,
        reason: day === today ? 'No more times today' : `Online booking closes ${settings.minNoticeHours}h ahead`,
      };
    }
    return { day, status: 'full', slots, capacity, reason: 'Fully booked' };
  }
  return { day, status: slots.length <= 3 ? 'limited' : 'open', slots, capacity };
}

export function rangeAvailability(from: string, to: string, ctx: AvailabilityContext): DayAvailability[] {
  return eachDay(from, to).map((day) => dayAvailability(day, ctx));
}

/** Locked block map, optionally ignoring one appointment's own locks (used while rescheduling it). */
export function buildLockMap(
  locks: { day: string; id: string; appointmentId: string }[],
  ignoreAppointmentId?: string,
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const lock of locks) {
    if (ignoreAppointmentId && lock.appointmentId === ignoreAppointmentId) continue;
    if (!map.has(lock.day)) map.set(lock.day, new Set());
    map.get(lock.day)!.add(lockMinute(lock.id));
  }
  return map;
}
