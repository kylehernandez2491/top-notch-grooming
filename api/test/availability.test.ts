import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { buildLockMap, dayAvailability, lockBlocks, lockId, rangeAvailability } from '../src/lib/availability';
import { defaultSettings } from '../src/lib/seed';
import type { BusinessSettings, Closure } from '../src/shared/types';

const zone = 'America/Chicago';
// Friday 2026-10-09 07:00 in Chicago. Tue 2026-10-13 is a normal working day.
const now = DateTime.fromISO('2026-10-09T07:00', { zone });
const TUE = '2026-10-13';

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return { ...defaultSettings(), timeZone: zone, ...overrides };
}

function ctx(extra: Partial<Parameters<typeof dayAvailability>[1]> = {}) {
  return {
    settings: settings(),
    closures: [] as Closure[],
    locked: new Map<string, Set<number>>(),
    counts: new Map<string, number>(),
    durationMinutes: 60,
    now,
    ...extra,
  };
}

const times = (day: ReturnType<typeof dayAvailability>) => day.slots.map((s) => s.time);

describe('lockBlocks', () => {
  it('covers service + buffer rounded up to 15-minute blocks', () => {
    // 50 min + 15 buffer = 65 -> 75 min -> 5 blocks
    expect(lockBlocks(540, 50, 15).map(lockId)).toEqual(['lock-09:00', 'lock-09:15', 'lock-09:30', 'lock-09:45', 'lock-10:00']);
  });
});

describe('dayAvailability', () => {
  it('offers every 30-minute start that fits, skipping the lunch break', () => {
    const day = dayAvailability(TUE, ctx());
    expect(day.status).toBe('open');
    // 08:30–17:00 with a 12:30–13:00 break, 60-minute service
    expect(times(day)).toEqual(['08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
    expect(day.slots[0].endTime).toBe('09:30');
  });

  it('is closed on days without hours and on full-day closures', () => {
    expect(dayAvailability('2026-10-12', ctx()).status).toBe('closed'); // Monday
    const closures: Closure[] = [{ id: 'x', kind: 'closure', date: TUE, reason: 'Staff training', createdAt: '' }];
    const day = dayAvailability(TUE, ctx({ closures }));
    expect(day).toMatchObject({ status: 'closed', reason: 'Staff training' });
  });

  it('respects partial closures', () => {
    const closures: Closure[] = [{ id: 'x', kind: 'closure', date: TUE, start: '08:30', end: '11:00', reason: 'Vet visit', createdAt: '' }];
    expect(times(dayAvailability(TUE, ctx({ closures })))[0]).toBe('11:00');
  });

  it('keeps the buffer between an existing booking and new ones', () => {
    // Existing 09:00, 60 min + 15 buffer -> blocks 09:00..10:00
    const locked = new Map([[TUE, new Set(lockBlocks(540, 60, 15))]]);
    const t = times(dayAvailability(TUE, ctx({ locked })));
    expect(t).not.toContain('08:30'); // 08:30 + 75 min would run into 09:00
    expect(t).not.toContain('09:00');
    expect(t).not.toContain('10:00'); // still cleaning up 10:00–10:15
    expect(t).toContain('10:30');
  });

  it('marks a day full when the daily cap is reached (owners only)', () => {
    const counts = new Map([[TUE, 8]]);
    expect(dayAvailability(TUE, ctx({ counts })).status).toBe('full');
    expect(dayAvailability(TUE, ctx({ counts, staff: true })).status).not.toBe('full');
  });

  it('enforces minimum notice', () => {
    // Saturday 10th opens 08:00; with 12h notice from Fri 07:00, earliest is Fri 19:00 -> all Sat ok.
    expect(dayAvailability('2026-10-10', ctx()).slots.length).toBeGreaterThan(0);
    const late = DateTime.fromISO('2026-10-09T23:30', { zone });
    const sat = dayAvailability('2026-10-10', ctx({ now: late }));
    expect(times(sat)[0]).toBe('11:30'); // 23:30 + 12h
  });

  it('reports why nothing is available when notice rules them all out', () => {
    const sat = dayAvailability('2026-10-10', ctx({ now: DateTime.fromISO('2026-10-10T07:00', { zone }) }));
    expect(sat.status).toBe('past');
    expect(sat.reason).toBe('No more times today');
  });

  it('flags days beyond the booking horizon', () => {
    expect(dayAvailability('2027-03-02', ctx()).status).toBe('beyond');
  });

  it('labels days with three or fewer starts as limited', () => {
    const blocks = new Set<number>();
    for (let m = 8 * 60 + 30; m < 15 * 60; m += 15) blocks.add(m);
    expect(dayAvailability(TUE, ctx({ locked: new Map([[TUE, blocks]]) })).status).toBe('limited');
  });

  it('builds a range and can ignore an appointment being rescheduled', () => {
    const locks = lockBlocks(540, 60, 15).map((m) => ({ id: lockId(m), day: TUE, appointmentId: 'mine' }));
    expect(times(dayAvailability(TUE, ctx({ locked: buildLockMap(locks) })))).not.toContain('09:00');
    expect(times(dayAvailability(TUE, ctx({ locked: buildLockMap(locks, 'mine') })))).toContain('09:00');
    expect(rangeAvailability('2026-10-12', '2026-10-18', ctx())).toHaveLength(7);
  });

  it('handles DST transitions (US fall back on 2026-11-01)', () => {
    const s = settings({ weeklyHours: { ...defaultSettings().weeklyHours, sun: { open: '09:00', close: '12:00', breaks: [] } } });
    const day = dayAvailability('2026-11-01', ctx({ settings: s }));
    expect(times(day)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });
});
