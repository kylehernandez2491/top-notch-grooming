import { describe, expect, it } from 'vitest';
import { dayName, parseQuestion, weeklySummary } from '../src/shared/chat';
import { dayPlan, openPeriods, stateAt } from '../src/shared/hours';
import { defaultServices, defaultSettings } from '../src/lib/seed';
import type { BookedPet, Closure, SpecialHours } from '../src/shared/types';

const TODAY = '2026-10-13'; // a Tuesday
const services = defaultServices();
const pets: Pick<BookedPet, 'id' | 'name' | 'species' | 'size'>[] = [{ id: 'pet-1', name: 'Biscuit', species: 'dog', size: 'medium' }];
const ask = (text: string) => parseQuestion(text, { today: TODAY, services, pets });

describe('chat assistant: reading questions', () => {
  it('understands "are you open" in English and Taglish', () => {
    expect(ask('Are you open today?')).toMatchObject({ intents: ['open'], day: TODAY });
    expect(ask('Bukas po ba kayo ngayon?')).toMatchObject({ intents: ['open'], day: TODAY });
    expect(ask('bukas ba kayo bukas?')).toMatchObject({ intents: ['open'], day: '2026-10-14' });
    expect(ask('What time do you close on Saturday?')).toMatchObject({ intents: ['open'], day: '2026-10-17' });
    expect(ask('ano schedule nyo?').intents).toEqual(['open']);
  });

  it('reads "bukas" as tomorrow when asking about a slot', () => {
    expect(ask('May slot pa ba bukas ng umaga?')).toMatchObject({ intents: ['slots'], day: '2026-10-14', part: 'morning' });
    expect(ask('Bukas ba may bakante?')).toMatchObject({ intents: ['slots'], day: '2026-10-14' });
  });

  it('tells free times apart from opening hours', () => {
    expect(ask('Any open times this week for a full groom?')).toMatchObject({
      intents: ['slots'],
      serviceId: 'full-grooming',
      range: { from: TODAY, to: '2026-10-18' },
    });
    expect(ask('what time is available on sabado?')).toMatchObject({ intents: ['slots'], day: '2026-10-17' });
  });

  it('reads dates, weekdays and times', () => {
    expect(ask('slot on Oct 20 at 2pm')).toMatchObject({ day: '2026-10-20', time: '14:00' });
    expect(ask('10/31 alas dos y media')).toMatchObject({ day: '2026-10-31', time: '14:30' });
    expect(ask('pwede ba sa Lunes 10:30?')).toMatchObject({ intents: ['slots'], day: '2026-10-19', time: '10:30' });
    expect(ask('January 5').day).toBe('2027-01-05');
    expect(ask('sa susunod na linggo').range).toEqual({ from: '2026-10-19', to: '2026-10-25', label: 'next week' });
    expect(ask('sa linggo').day).toBe('2026-10-18');
    expect(ask('next tuesday').day).toBe('2026-10-20');
    expect(ask('next week thursday').day).toBe('2026-10-22');
    // "may" is everyday Tagalog, never the month.
    const may = ask('may 2pm slot ba?');
    expect(may.time).toBe('14:00');
    expect(may.day).toBeUndefined();
  });

  it('picks the service and dog size from words, breeds or a saved pet', () => {
    expect(ask('magkano po ang full grooming sa golden retriever?')).toMatchObject({
      intents: ['price'],
      serviceId: 'full-grooming',
      size: 'large',
      species: 'dog',
    });
    expect(ask('how much for a cat bath')).toMatchObject({ intents: ['price'], serviceId: 'cat-grooming', species: 'cat' });
    expect(ask('hm basic shih tzu')).toMatchObject({ intents: ['price'], serviceId: 'basic-grooming', size: 'small' });
    expect(ask('slot for Biscuit tomorrow')).toMatchObject({ intents: ['slots'], petId: 'pet-1', size: 'medium', day: '2026-10-14' });
  });

  it('greets and thanks without inventing a question', () => {
    expect(ask('Hello!').intents).toEqual(['greeting']);
    const greeting = ask('Good morning, may slot ba?');
    expect(greeting.intents).toEqual(['greeting', 'slots']);
    expect(greeting.part).toBeUndefined();
    expect(ask('salamat po').intents).toEqual(['thanks']);
    expect(ask('Saturday')).toMatchObject({ intents: [], day: '2026-10-17' });
  });
});

describe('chat assistant: shop hours on a day', () => {
  const weekly = defaultSettings().weeklyHours;

  it('knows when the shop is open, on a break, or closed for the day', () => {
    const plan = dayPlan(TODAY, weekly, []);
    expect(openPeriods(plan)).toEqual([
      { start: '08:30', end: '12:30' },
      { start: '13:00', end: '17:00' },
    ]);
    expect(stateAt(plan, 8 * 60)).toEqual({ state: 'before', opensAt: '08:30' });
    expect(stateAt(plan, 10 * 60)).toEqual({ state: 'open', until: '12:30' });
    expect(stateAt(plan, 12 * 60 + 45)).toEqual({ state: 'break', until: '13:00' });
    expect(stateAt(plan, 17 * 60)).toEqual({ state: 'after' });
    expect(stateAt(dayPlan('2026-10-12', weekly, []), 10 * 60)).toEqual({ state: 'closed' });
  });

  it('applies special hours, blocked windows and time off', () => {
    const special: SpecialHours[] = [{ id: 'hours-2026-10-12', kind: 'hours', date: '2026-10-12', open: '10:00', close: '14:00', breaks: [], updatedAt: '' }];
    expect(openPeriods(dayPlan('2026-10-12', weekly, [], special))).toEqual([{ start: '10:00', end: '14:00' }]);
    const vet: Closure = { id: 'v', kind: 'closure', date: TODAY, start: '14:00', end: '15:00', reason: 'Vet run', createdAt: '' };
    expect(openPeriods(dayPlan(TODAY, weekly, [vet])).map((p) => p.start)).toEqual(['08:30', '13:00', '15:00']);
    const off: Closure = { id: 'o', kind: 'closure', date: '2026-10-12', reason: 'Holiday', createdAt: '' };
    expect(openPeriods(dayPlan('2026-10-12', weekly, [off], special))).toEqual([]);
  });

  it('describes the usual week and days in words', () => {
    expect(weeklySummary(weekly)).toEqual([
      { label: 'Tue to Fri', value: '8:30 AM to 5:00 PM' },
      { label: 'Sat', value: '8:00 AM to 2:00 PM' },
      { label: 'Mon and Sun', value: 'Closed' },
    ]);
    expect(dayName(TODAY, TODAY)).toBe('today');
    expect(dayName('2026-10-14', TODAY)).toBe('tomorrow');
    expect(dayName('2026-10-17', TODAY)).toBe('Saturday, October 17');
  });
});
