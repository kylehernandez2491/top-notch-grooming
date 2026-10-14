/**
 * How the chat assistant reads a typed question, in English or Taglish ("may slot pa ba bukas ng
 * umaga?"). Pure keyword matching with no AI, so it never makes anything up: it only works out what
 * was asked and for which day, service and dog size. The answers come from the live hours and the
 * availability engine. Runs in the browser; unit-tested in test/chat.test.ts.
 */
import type { BookedPet, BusinessSettings, DayHours, PetSize, Service, Species } from './types';
import { WEEKDAYS } from './types';
import { formatTime12, fromMinutes } from './format';
import { weekdayOfDay } from './hours';

export type ChatIntent = 'greeting' | 'thanks' | 'open' | 'slots' | 'price';
export type DayPart = 'morning' | 'afternoon' | 'evening';

export interface DayRange {
  from: string;
  to: string;
  label: string;
}

export interface ParsedQuestion {
  /** What was asked, in the order the assistant answers. Empty when nothing was recognised. */
  intents: ChatIntent[];
  day?: string;
  /** "this week", "next week", "this weekend". */
  range?: DayRange;
  part?: DayPart;
  time?: string;
  serviceId?: string;
  size?: PetSize;
  species?: Species;
  petId?: string;
}

export interface ParseContext {
  /** The shop's today, YYYY-MM-DD. */
  today: string;
  services: readonly Pick<Service, 'id' | 'name' | 'species'>[];
  /** Pets saved on this device, so "slot for Biscuit" works. */
  pets?: readonly Pick<BookedPet, 'id' | 'name' | 'species' | 'size'>[];
}

// ---------- vocabulary ----------

const GREETINGS = [
  'good morning', 'good afternoon', 'good evening', 'good day', 'gud am', 'gud pm', 'gud morning', 'magandang umaga',
  'magandang hapon', 'magandang gabi', 'magandang araw', 'hi', 'hii', 'hiii', 'hello', 'helo', 'hellow', 'hey', 'kumusta',
  'kamusta', 'musta', 'yo', 'help', 'tulong',
];
const THANKS = ['maraming salamat', 'thank you', 'thank u', 'thankyou', 'thanks', 'thx', 'tnx', 'ty', 'tysm', 'salamat'];
/** Duration and "what's included" questions get the price answer, which covers both. */
const PRICE_WORDS = [
  'how much', 'how long', 'how many hours', 'gaano katagal', 'price list', 'mag kano', 'magkano', 'mgkano', 'magkanu', 'hm',
  'price', 'prices', 'pricing', 'priced', 'pricelist', 'presyo', 'cost', 'costs', 'rate', 'rates', 'fee', 'fees', 'charge',
  'singil', 'bayad', 'halaga', 'tagal', 'duration', 'included', 'inclusions', 'kasama', 'menu', 'services',
];
/** Checked before OPEN_WORDS so "open times" and "openings" mean free times, not opening hours. */
const SLOT_WORDS = [
  'open times', 'open time', 'open slots', 'open slot', 'next opening', 'fully booked', 'pa book', 'magpa book', 'pa sched',
  'openings', 'available', 'availability', 'avail', 'availabe', 'availble', 'slot', 'slots', 'sched', 'schedule', 'free',
  'vacant', 'vacancy', 'bakante', 'book', 'booking', 'pabook', 'magpabook', 'appointment', 'appointments', 'appt', 'reserve',
  'reservation', 'pwede', 'puwede', 'pede', 'puno', 'earliest', 'soonest',
];
/** The shop's own schedule, checked before SLOT_WORDS (which include "schedule"). */
const HOURS_PHRASES = [
  'store hours', 'shop hours', 'business hours', 'office hours', 'opening hours', 'operating hours', 'your schedule',
  'schedule nyo', 'schedule niyo', 'sched nyo', 'sched niyo',
];
const OPEN_WORDS = [
  'open', 'opens', 'opened', 'opening', 'close', 'closes', 'closed', 'closing', 'hours', 'sarado', 'sara', 'operating',
  'operation', 'holiday', 'holidays',
];
/** "What time…" is about hours unless the question is clearly about free times. */
const WEAK_OPEN_WORDS = ['what time', 'anong oras', 'ano oras', 'oras'];

const WEEKDAY_WORDS: Record<(typeof WEEKDAYS)[number], string[]> = {
  mon: ['monday', 'mon', 'lunes'],
  tue: ['tuesday', 'tues', 'tue', 'martes'],
  wed: ['wednesday', 'weds', 'wed', 'miyerkules', 'miyerkoles', 'myerkules'],
  thu: ['thursday', 'thurs', 'thur', 'thu', 'huwebes'],
  fri: ['friday', 'fri', 'biyernes', 'byernes', 'biernes'],
  sat: ['saturday', 'sat', 'sabado'],
  // "linggo" is also "week"; week phrases are taken out before weekdays are read.
  sun: ['sunday', 'sun', 'linggo'],
};
const NEXT_WEEK = ['sa susunod na linggo', 'susunod na linggo', 'next week', 'nextweek', 'next linggo'];
const THIS_WEEK = ['ngayong linggo', 'itong linggo', 'sa linggong ito', 'this week', 'within the week'];
const WEEKEND = ['this weekend', 'weekend'];
const DAY_AFTER = ['day after tomorrow', 'sa makalawa', 'makalawa', 'samakalawa'];
const TOMORROW = ['tomorrow', 'tomorow', 'tommorow', 'tommorrow', 'tomorro', 'tmrw', 'tmr', 'tmrow'];
const TODAY = ['ngayong araw', 'today', 'tonight', 'now', 'ngayon', 'mamaya'];

/**
 * Month names. Plain "may" is left out because it is everyday Tagalog ("may slot ba?" = "is there a
 * slot?"); "Mayo 5" and 5/5 still work.
 */
const MONTH_WORDS = [
  ['january', 'jan', 'enero'],
  ['february', 'feb', 'pebrero', 'febrero'],
  ['march', 'mar', 'marso'],
  ['april', 'apr', 'abril'],
  ['mayo'],
  ['june', 'jun', 'hunyo'],
  ['july', 'jul', 'hulyo'],
  ['august', 'aug', 'agosto'],
  ['september', 'sept', 'sep', 'setyembre', 'septiyembre'],
  ['october', 'oct', 'oktubre', 'octubre'],
  ['november', 'nov', 'nobyembre', 'noviembre'],
  ['december', 'dec', 'disyembre', 'diciembre'],
];

const PARTS: Record<DayPart, string[]> = {
  morning: ['this morning', 'morning', 'umaga', 'maaga'],
  afternoon: ['this afternoon', 'afternoon', 'hapon', 'tanghali', 'lunchtime'],
  evening: ['evening', 'gabi', 'night', 'tonight'],
};

/** "alas dos" = two o'clock. */
const SPANISH_HOURS: Record<string, number> = {
  una: 1, dos: 2, tres: 3, kwatro: 4, kuwatro: 4, singko: 5, sinko: 5, sais: 6, siyete: 7, syete: 7,
  otso: 8, nuwebe: 9, nwebe: 9, diyes: 10, dyes: 10, dies: 10, onse: 11, dose: 12,
};

/** Service words beyond the service's own name, keyed by the built-in service ids. */
const SERVICE_ALIASES: Record<string, string[]> = {
  'basic-grooming': ['basic'],
  'full-grooming': ['full', 'haircut', 'hair cut', 'gupit'],
  'cat-grooming': ['cat', 'cats', 'pusa', 'kitty', 'kitten', 'feline'],
  'bath-blow-dry': ['bath', 'blow dry', 'blowdry', 'blow', 'ligo', 'paligo', 'bathe', 'shower'],
};
const NAME_STOPWORDS = new Set(['grooming', 'groom', 'and', 'the', 'dry', 'with', 'for', 'service', 'package']);

const SIZE_WORDS: Record<PetSize, string[]> = {
  small: [
    'small', 'maliit', 'maliliit', 'liit', 'toy', 'tiny', 'mini', 'shih tzu', 'shihtzu', 'shitzu', 'pomeranian', 'pom',
    'maltese', 'chihuahua', 'poodle', 'yorkie', 'pug', 'dachshund',
  ],
  medium: ['medium', 'katamtaman', 'mid', 'beagle', 'corgi', 'cocker', 'spaniel', 'aspin', 'askal', 'bulldog', 'spitz'],
  large: [
    'large', 'big', 'malaki', 'laki', 'golden', 'retriever', 'labrador', 'lab', 'german shepherd', 'shepherd', 'rottweiler',
    'doberman', 'malinois', 'dalmatian',
  ],
  husky_chow: ['husky', 'huskies', 'chow chow', 'chow', 'samoyed', 'malamute', 'akita', 'double coat'],
};
const DOG_WORDS = ['dog', 'dogs', 'aso', 'doggy', 'doggo', 'puppy', 'pup', 'tuta'];
const CAT_WORDS = ['cat', 'cats', 'pusa', 'kitty', 'kitten', 'feline'];

// ---------- text helpers ----------

/** Lowercase, no accents or punctuation (":" and "/" kept for times and dates), padded with spaces. */
function normalize(text: string): string {
  const cleaned = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b([ap])\.\s?m\b\.?/g, '$1m')
    .replace(/(\d)\.([0-5]\d)/g, '$1:$2')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9:/]+/g, ' ')
    .trim();
  return ` ${cleaned} `;
}

const has = (text: string, phrase: string) => text.includes(` ${phrase} `);
const hasAny = (text: string, phrases: readonly string[]) => phrases.some((p) => has(text, p));

/** Finds the phrases, then blanks them out so later rules don't read them again. */
function take(text: string, phrases: readonly string[]): { text: string; found: boolean } {
  let found = false;
  for (const phrase of phrases) {
    while (has(text, phrase)) {
      text = text.replace(` ${phrase} `, '  ');
      found = true;
    }
  }
  return { text, found };
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validDay(year: number, month: number, date: number): string | undefined {
  const day = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day ? day : undefined;
}

/** A month and date without a year means the next time it comes round. */
function upcoming(today: string, month: number, date: number, year?: number): string | undefined {
  if (year) return validDay(year < 100 ? 2000 + year : year, month, date);
  const thisYear = Number(today.slice(0, 4));
  const day = validDay(thisYear, month, date);
  return day && day >= today ? day : validDay(thisYear + 1, month, date);
}

/** Without am/pm, 1 to 6 o'clock means the afternoon, since the shop isn't open before 7. */
function clock(hour: number, minute: number, meridiem?: string): string | undefined {
  if (hour > 23 || minute > 59) return undefined;
  let h = hour;
  if (meridiem === 'pm' && h < 12) h += 12;
  else if (meridiem === 'am' && h === 12) h = 0;
  else if (!meridiem && h >= 1 && h <= 6) h += 12;
  return fromMinutes(h * 60 + minute);
}

// ---------- parser ----------

export function parseQuestion(input: string, ctx: ParseContext): ParsedQuestion {
  const intents = new Set<ChatIntent>();
  const result: ParsedQuestion = { intents: [] };
  let text = normalize(input);

  let step = take(text, GREETINGS);
  text = step.text;
  if (step.found) intents.add('greeting');
  step = take(text, THANKS);
  text = step.text;
  if (step.found) intents.add('thanks');

  // What the pet and service are: read before dates and times so breed names stay intact.
  const about = text;
  const pet = ctx.pets?.find((p) => p.name.trim().length > 1 && has(about, normalize(p.name).trim()));
  if (pet) {
    result.petId = pet.id;
    result.species = pet.species;
    result.size = pet.size;
  }
  if (!result.species) {
    if (hasAny(about, CAT_WORDS)) result.species = 'cat';
    else if (hasAny(about, DOG_WORDS)) result.species = 'dog';
  }
  if (!result.size) {
    const size = (Object.keys(SIZE_WORDS) as PetSize[]).find((s) => hasAny(about, SIZE_WORDS[s]));
    if (size) {
      result.size = size;
      result.species ??= 'dog';
    }
  }
  result.serviceId = matchService(about, ctx.services, result.species);

  const price = hasAny(text, PRICE_WORDS);
  step = take(text, HOURS_PHRASES);
  text = step.text;
  const hoursAsked = step.found;
  step = take(text, SLOT_WORDS);
  text = step.text;
  const slots = step.found;

  // "bukas" is both "open" ("bukas ba kayo?") and "tomorrow" ("may slot ba bukas?").
  let openSense = false;
  let tomorrow = false;
  const tokens = text.trim().split(/\s+/);
  tokens.forEach((token, i) => {
    if (token !== 'bukas') return;
    const next = tokens.slice(i + 1).filter((t) => t !== 'po');
    const askingOpen =
      ['kayo', 'nyo', 'niyo'].includes(next[0]) ||
      (['ba', 'pa', 'na'].includes(next[0]) && (next[1] === 'kayo' || next[1] === 'ba' || (!slots && !price)));
    if (askingOpen) openSense = true;
    else tomorrow = true;
    tokens[i] = '';
  });
  text = ` ${tokens.join(' ')} `;

  if (openSense || hoursAsked || hasAny(text, OPEN_WORDS) || (!slots && hasAny(text, WEAK_OPEN_WORDS))) intents.add('open');
  if (slots) intents.add('slots');
  if (price) intents.add('price');

  // Dates: week phrases first, so "susunod na linggo" isn't read as Sunday.
  const weekStart = shiftDay(ctx.today, -WEEKDAYS.indexOf(weekdayOfDay(ctx.today)));
  if ((step = take(text, NEXT_WEEK)).found) {
    result.range = { from: shiftDay(weekStart, 7), to: shiftDay(weekStart, 13), label: 'next week' };
  } else if ((step = take(text, THIS_WEEK)).found) {
    result.range = { from: ctx.today, to: shiftDay(weekStart, 6), label: 'this week' };
  } else if ((step = take(text, WEEKEND)).found) {
    const saturday = shiftDay(weekStart, 5);
    result.range = { from: saturday < ctx.today ? ctx.today : saturday, to: shiftDay(weekStart, 6), label: 'this weekend' };
  }
  text = step.text;

  const explicit = explicitDay(text, ctx.today);
  if (explicit) {
    result.day = explicit.day;
    text = explicit.text;
  } else if ((step = take(text, DAY_AFTER)).found) {
    result.day = shiftDay(ctx.today, 2);
    text = step.text;
  } else if (tomorrow || (step = take(text, TOMORROW)).found) {
    result.day = shiftDay(ctx.today, 1);
    if (!tomorrow) text = step.text;
  } else if (hasAny(text, TODAY)) {
    result.day = ctx.today;
  } else {
    // A weekday counts from today, or from the start of "next week" when that was said too.
    const base = result.range?.from ?? ctx.today;
    const baseIndex = WEEKDAYS.indexOf(weekdayOfDay(base));
    for (const [index, weekday] of WEEKDAYS.entries()) {
      const word = WEEKDAY_WORDS[weekday].find((w) => has(text, w));
      if (!word) continue;
      let ahead = (index - baseIndex + 7) % 7;
      if (ahead === 0 && !result.range && (has(text, `next ${word}`) || has(text, `susunod na ${word}`))) ahead = 7;
      result.day = shiftDay(base, ahead);
      break;
    }
  }
  if (result.day && result.range) delete result.range;

  result.time = parseTime(text);
  if (!result.time) result.part = (Object.keys(PARTS) as DayPart[]).find((p) => hasAny(text, PARTS[p]));

  // A bare day, time or service with no question word: the caller decides from the conversation.
  result.intents = (['greeting', 'thanks', 'open', 'slots', 'price'] as const).filter((i) => intents.has(i));
  return result;
}

function matchService(text: string, services: ParseContext['services'], species?: Species): string | undefined {
  let best: { id: string; score: number; fits: boolean } | undefined;
  for (const service of services) {
    const words = new Set([
      ...(SERVICE_ALIASES[service.id] ?? []),
      ...normalize(service.name).trim().split(' ').filter((w) => w.length > 2 && !NAME_STOPWORDS.has(w)),
    ]);
    const score = [...words].filter((w) => has(text, w)).length;
    if (!score) continue;
    const fits = !species || service.species.includes(species);
    if (!best || score > best.score || (score === best.score && fits && !best.fits)) best = { id: service.id, score, fits };
  }
  return best?.id;
}

function explicitDay(text: string, today: string): { day: string; text: string } | undefined {
  const months = MONTH_WORDS.flatMap((words, i) => words.map((w) => [w, i + 1] as const)).sort((a, b) => b[0].length - a[0].length);
  const names = months.map(([w]) => w).join('|');
  const monthOf = (word: string) => months.find(([w]) => w === word)![1];
  const patterns: [RegExp, (m: RegExpMatchArray) => string | undefined][] = [
    [new RegExp(` (${names}) (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))? `), (m) => upcoming(today, monthOf(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined)],
    [new RegExp(` (\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${names})(?: (\\d{4}))? `), (m) => upcoming(today, monthOf(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined)],
    [/ (\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))? /, (m) => upcoming(today, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined)],
    [
      / (?:the |sa )?(\d{1,2})(?:st|nd|rd|th) /,
      (m) => {
        const [y, mo] = today.split('-').map(Number);
        const date = Number(m[1]);
        const thisMonth = validDay(y, mo, date);
        if (thisMonth && thisMonth >= today) return thisMonth;
        return mo === 12 ? validDay(y + 1, 1, date) : validDay(y, mo + 1, date);
      },
    ],
  ];
  for (const [pattern, toDay] of patterns) {
    const match = text.match(pattern);
    const day = match && toDay(match);
    if (day) return { day, text: text.replace(match[0], '  ') };
  }
  return undefined;
}

function parseTime(text: string): string | undefined {
  let m = text.match(/ (\d{1,2})(?::([0-5]\d))? ?(am|pm) /);
  if (m) return clock(Number(m[1]), Number(m[2] ?? 0), m[3]);
  const spanish = Object.keys(SPANISH_HOURS).join('|');
  m = text.match(new RegExp(` alas ?(\\d{1,2}|${spanish})(?::([0-5]\\d))?( y media)?(?: (am|pm))? `));
  if (m) return clock(SPANISH_HOURS[m[1]] ?? Number(m[1]), m[3] ? 30 : Number(m[2] ?? 0), m[4]);
  m = text.match(/ (\d{1,2}):([0-5]\d) /);
  if (m) return clock(Number(m[1]), Number(m[2]));
  if (hasAny(text, ['noon', 'tanghaling tapat'])) return '12:00';
  return undefined;
}

// ---------- wording shared by the assistant's answers ----------

const dateText = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

/** "today", "tomorrow" or "Saturday, October 17". */
export function dayName(day: string, today: string): string {
  if (day === today) return 'today';
  if (day === shiftDay(today, 1)) return 'tomorrow';
  return dateText(day, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "Sat, Oct 17" */
export function shortDayName(day: string): string {
  return dateText(day, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "8:30 AM to 5:00 PM, break 12:30 PM to 1:00 PM" */
export function hoursText(hours: DayHours): string {
  const breaks = hours.breaks.map((b) => `break ${formatTime12(b.start)} to ${formatTime12(b.end)}`);
  return [`${formatTime12(hours.open)} to ${formatTime12(hours.close)}`, ...breaks].join(', ');
}

const WEEKDAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' } as const;

/** The usual week in a few rows: "Tue to Fri: 8:30 AM to 5:00 PM", "Sat: …", "Mon and Sun: Closed". */
export function weeklySummary(weeklyHours: BusinessSettings['weeklyHours']): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const closed: string[] = [];
  let run: { first: string; last: string; value: string } | undefined;
  const flush = () => {
    if (run) rows.push({ label: run.first === run.last ? run.first : `${run.first} to ${run.last}`, value: run.value });
    run = undefined;
  };
  for (const weekday of WEEKDAYS) {
    const hours = weeklyHours[weekday];
    if (!hours) {
      flush();
      closed.push(WEEKDAY_SHORT[weekday]);
      continue;
    }
    const value = `${formatTime12(hours.open)} to ${formatTime12(hours.close)}`;
    if (run && run.value === value) run.last = WEEKDAY_SHORT[weekday];
    else {
      flush();
      run = { first: WEEKDAY_SHORT[weekday], last: WEEKDAY_SHORT[weekday], value };
    }
  }
  flush();
  if (closed.length) rows.push({ label: closed.length > 1 ? `${closed.slice(0, -1).join(', ')} and ${closed.at(-1)}` : closed[0], value: 'Closed' });
  return rows;
}
