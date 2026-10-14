import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { DateTime } from 'luxon';
import type { DayAvailability, Pet, PetSize, Service, SlotOption, Species } from '@shared/types';
import { CAT_SIZE, PET_SIZES } from '@shared/types';
import { formatDuration, formatPriceRange, formatTime12, partOfDay, priceRange, SIZE_LABELS, sizePhrase, sizePrice, sizesFor, toMinutes } from '@shared/format';
import { dayName, hoursText, parseQuestion, shortDayName, weeklySummary, type DayPart, type DayRange } from '@shared/chat';
import { dayPlan, isOpenDay, openPeriods, stateAt, type DayPlan } from '@shared/hours';
import { api } from '@/api/client';
import { addDays, startOfWeek } from '@/utils/dates';
import { telUrl } from '@/utils/device';
import { useAccount } from './account';
import { useCatalog } from './catalog';

type Topic = 'open' | 'slots' | 'price';

/** What the assistant is answering. Built from typed questions and button taps, remembered between turns. */
export interface ChatQuery {
  topic: Topic;
  day?: string;
  range?: DayRange;
  part?: DayPart;
  time?: string;
  serviceId?: string;
  size?: PetSize;
  species?: Species;
  petId?: string;
}

export interface ChatChoice {
  label: string;
  query: ChatQuery;
}

export interface ChatMessage {
  id: number;
  from: 'bot' | 'user';
  lines: string[];
  rows?: { label: string; value: string }[];
  /** Open start times, each a link into booking with everything filled in. */
  slots?: { label: string; to: RouteLocationRaw }[];
  links?: { label: string; to?: RouteLocationRaw; href?: string }[];
  /** Quick replies; only the newest message's are shown. */
  choices?: ChatChoice[];
}

type Reply = Omit<ChatMessage, 'id' | 'from'>;

const MAX_SLOTS = 12;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const t12 = formatTime12;

/**
 * The chat assistant on the customer pages. Rule-based: it reads the question with parseQuestion
 * (@shared/chat) and answers only from the shop's live hours, the availability engine and the price
 * list, so it can't make anything up. The conversation lives in memory and is gone on reload.
 */
export const useChat = defineStore('chat', () => {
  const catalog = useCatalog();
  const account = useAccount();
  const messages = ref<ChatMessage[]>([]);
  const busy = ref(false);
  let last: ChatQuery | undefined;
  let seq = 0;

  function push(from: ChatMessage['from'], reply: Reply) {
    messages.value.push({ ...reply, from, id: ++seq });
  }

  /** The shop's today and minute of the day, in its own time zone. */
  function clock() {
    const now = DateTime.now().setZone(catalog.settings?.timeZone ?? 'Asia/Manila');
    return { today: now.toISODate()!, minute: now.hour * 60 + now.minute };
  }

  /** Called each time the chat opens: refreshes today's hours and the shop's message, greets once. */
  async function start() {
    const fresh = catalog.load(true).catch(() => undefined);
    if (messages.value.length) return;
    await fresh;
    if (messages.value.length) return;
    push('bot', catalog.settings ? greeting(false) : { lines: ["I can't reach the shop right now. Check your connection and try again."] });
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy.value) return;
    push('user', { lines: [question] });
    await run(() => answerText(question));
  }

  async function choose(choice: ChatChoice) {
    if (busy.value) return;
    push('user', { lines: [choice.label] });
    await run(() => answer([choice.query]));
  }

  async function run(work: () => Promise<Reply[]>) {
    busy.value = true;
    try {
      await catalog.load();
      for (const reply of await work()) push('bot', reply);
    } catch (err) {
      push('bot', {
        lines: [`Sorry, I couldn't check that just now. ${(err as Error).message}`],
        links: [{ label: 'See open times', to: '/availability' }, ...callLinks()],
      });
    } finally {
      busy.value = false;
    }
  }

  // ---------- understanding the question ----------

  async function answerText(text: string): Promise<Reply[]> {
    const { today } = clock();
    const parsed = parseQuestion(text, { today, services: catalog.services, pets: account.pets });
    const { intents, ...details } = parsed;
    const topics = intents.filter((i): i is Topic => i === 'open' || i === 'slots' || i === 'price');
    const hasDetails = Object.values(details).some((v) => v !== undefined);
    if (!topics.length) {
      if (!hasDetails) {
        if (intents.includes('thanks')) return [{ lines: ["You're welcome! Anything else I can check?"], choices: menu() }];
        if (intents.includes('greeting')) return [greeting(true)];
        return [fallback()];
      }
      topics.push(guessTopic(parsed));
    }
    return answer(topics.map((topic) => withContext({ topic, ...details })));
  }

  /**
   * A bare "tomorrow?" or "for a husky?" continues the conversation: a day after talking about a
   * service means free times for it; a day on its own means opening hours.
   */
  function guessTopic(q: Omit<ChatQuery, 'topic'>): Topic {
    if (last?.topic === 'slots') return 'slots';
    const dated = !!(q.day || q.range || q.part || q.time);
    if (!dated) return 'price';
    const aboutService = q.serviceId || q.size || q.petId || (last?.topic === 'price' && last.serviceId);
    return last?.topic === 'open' || !aboutService ? 'open' : 'slots';
  }

  /** Keeps the pet, service and day from earlier in the conversation unless this question changes them. */
  function withContext(q: ChatQuery): ChatQuery {
    if (!last) return q;
    const next = { ...q };
    if (!(q.species && last.species && q.species !== last.species)) {
      next.serviceId ??= last.serviceId;
      next.species ??= last.species;
      if (!q.size && !q.petId) {
        next.size = last.size;
        next.petId = last.petId;
      }
    }
    if (!q.day && !q.range) {
      next.day = last.day;
      next.range = last.range;
      if (!q.part && !q.time) {
        next.part = last.part;
        next.time = last.time;
      }
    }
    return next;
  }

  async function answer(queries: ChatQuery[]): Promise<Reply[]> {
    const replies: Reply[] = [];
    for (const q of queries) {
      if (q.topic === 'open') replies.push(openAnswer(q));
      else if (q.topic === 'price') replies.push(priceAnswer(q));
      else replies.push(await slotsAnswer(q));
    }
    return replies;
  }

  /** Which pet, service and size the question is about, filling gaps from the pets saved on this device. */
  function subject(q: ChatQuery): { service?: Service; size?: PetSize; species?: Species; pet?: Pet } {
    let pet = q.petId ? account.pets.find((p) => p.id === q.petId) : undefined;
    let service = q.serviceId ? catalog.serviceById(q.serviceId) : undefined;
    let species = pet?.species ?? q.species ?? (service?.species.length === 1 ? service.species[0] : undefined);
    if (service && species && !service.species.includes(species)) service = undefined;
    if (!pet && !q.size) {
      // One saved pet that fits the question: use it without asking.
      const fitting = account.pets.filter((p) => (!species || p.species === species) && (!service || service.species.includes(p.species)));
      if (fitting.length === 1) pet = fitting[0];
    }
    species ??= pet?.species;
    if (!service) {
      const options = catalog.servicesFor(species);
      if (options.length === 1) service = options[0];
    }
    const size = species === 'cat' ? CAT_SIZE : (pet?.size ?? q.size);
    return { service, size, species, pet };
  }

  // ---------- answers ----------

  function notice(today: string) {
    const n = catalog.data?.notice;
    return n && n.until >= today ? n : undefined;
  }

  function callLinks() {
    const phone = catalog.settings?.phone;
    return phone ? [{ label: `Call ${phone}`, href: telUrl(phone) }] : [];
  }

  function menu(): ChatChoice[] {
    const { today } = clock();
    return [
      { label: 'Are you open today?', query: { topic: 'open', day: today } },
      { label: 'Next free time', query: { topic: 'slots' } },
      { label: 'Prices', query: { topic: 'price' } },
      { label: "This week's hours", query: { topic: 'open', range: { from: today, to: addDays(startOfWeek(today), 6), label: 'this week' } } },
    ];
  }

  function greeting(again: boolean): Reply {
    const { today } = clock();
    const n = notice(today);
    return {
      lines: [
        again ? 'Hi! How can I help?' : `Hi! I'm the ${catalog.settings?.shopName ?? 'Top Notch'} assistant. I can tell you when we're open, find free grooming times and share our prices.`,
        ...(n ? [`Note from the shop: ${n.message}`] : []),
        'Tap a question below or type your own, in English or Taglish.',
      ],
      choices: menu(),
    };
  }

  function fallback(): Reply {
    return {
      lines: ["Sorry, I didn't get that. I can help with our hours, free grooming times and prices. For anything else, please call us."],
      links: callLinks(),
      choices: menu(),
    };
  }

  function plan(day: string): DayPlan {
    return dayPlan(day, catalog.settings!.weeklyHours, catalog.data?.closures ?? [], catalog.data?.specialHours ?? []);
  }

  /** "tomorrow" or "on Saturday, October 17", for use mid-sentence. */
  function onDay(day: string, today: string) {
    const name = dayName(day, today);
    return name === 'today' || name === 'tomorrow' ? name : `on ${name}`;
  }

  function hoursValue(p: DayPlan): string {
    if (p.closure) return p.closure.reason && p.closure.reason !== 'Closed' ? `Closed (${p.closure.reason})` : 'Closed';
    if (!p.hours) return 'Closed';
    const extras = [p.special?.note, ...p.partial.map((c) => `closed ${t12(c.start!)} to ${t12(c.end!)}${c.reason ? ` (${c.reason})` : ''}`)];
    return [hoursText(p.hours), ...extras.filter(Boolean)].join(', ');
  }

  function nextOpen(after: string, today: string): string {
    for (let i = 1; i <= 21; i++) {
      const p = plan(addDays(after, i));
      if (isOpenDay(p)) return ` We're next open ${dayName(p.day, today)}, ${t12(p.hours!.open)} to ${t12(p.hours!.close)}.`;
    }
    return '';
  }

  function openAnswer(q: ChatQuery): Reply {
    const settings = catalog.settings!;
    const { today, minute } = clock();
    last = q;
    const n = notice(today);
    const lines = n ? [`Note from the shop: ${n.message}`] : [];
    let rows: Reply['rows'];
    let slotsDay: string | undefined;

    if (q.range) {
      lines.push(`Our hours ${q.range.label}:`);
      rows = [];
      for (let day = q.range.from < today ? today : q.range.from; day <= q.range.to; day = addDays(day, 1)) {
        rows.push({ label: shortDayName(day), value: hoursValue(plan(day)) });
      }
    } else if (!q.day || q.day === today) {
      const p = plan(today);
      lines.push(nowLine(p, minute, today));
      if (isOpenDay(p) && p.partial.length) lines.push(`Today: ${hoursValue(p)}.`);
      else if (isOpenDay(p) && p.special?.note) lines.push(`Special hours today: ${p.special.note}.`);
      if (isOpenDay(p) && stateAt(p, minute).state !== 'after') slotsDay = today;
      if (!q.day) {
        lines.push('Our usual hours:');
        rows = weeklySummary(settings.weeklyHours);
      }
    } else if (q.day < today) {
      lines.push('That day has already passed.');
    } else {
      const p = plan(q.day);
      // Time off and special hours are known a year ahead (see the public catalog).
      const usually = q.day > addDays(today, 365) ? 'usually ' : '';
      if (!isOpenDay(p)) {
        const why = p.closure?.reason && p.closure.reason !== 'Closed' ? ` (${p.closure.reason})` : '';
        lines.push(`We're ${usually}closed ${onDay(q.day, today)}${why}.${nextOpen(q.day, today)}`);
      } else {
        lines.push(`${cap(onDay(q.day, today))} we're ${usually}open ${hoursValue(p)}.`);
        if (q.day <= addDays(today, settings.bookingHorizonDays)) slotsDay = q.day;
        else lines.push(`Online booking opens ${settings.bookingHorizonDays} days ahead.`);
      }
    }

    return {
      lines,
      rows,
      choices: [
        slotsDay ? { label: `Free times ${dayName(slotsDay, today)}`, query: { ...q, topic: 'slots', day: slotsDay, range: undefined } } : { label: 'Next free time', query: { ...q, topic: 'slots', day: undefined, range: undefined } },
        { label: 'Prices', query: { ...q, topic: 'price' } },
      ],
      links: callLinks(),
    };
  }

  function nowLine(p: DayPlan, minute: number, today: string): string {
    const state = stateAt(p, minute);
    const later = openPeriods(p).filter((period) => toMinutes(period.start) > minute);
    const then = later.length ? ` Then again ${later.map((period) => `${t12(period.start)} to ${t12(period.end)}`).join(' and ')}.` : '';
    switch (state.state) {
      case 'open':
        return `Yes, we're open now until ${t12(state.until)}.${then}`;
      case 'break':
        return `We're on a short break until ${t12(state.until)}, then open until ${t12(later[0].end)}.`;
      case 'before':
        return `We're not open yet. Today's hours: ${hoursText(p.hours!)}.`;
      case 'after':
        return `We're closed for the day.${nextOpen(today, today)}`;
      default: {
        const why = p.closure?.reason && p.closure.reason !== 'Closed' ? ` (${p.closure.reason})` : '';
        return `We're closed today${why}.${nextOpen(today, today)}`;
      }
    }
  }

  function priceAnswer(q: ChatQuery): Reply {
    const { service, size, species, pet } = subject(q);
    const links = [{ label: 'Full price list', to: '/services' }];
    if (service) {
      const forCat = !service.species.includes('dog') || species === 'cat';
      const sz = forCat ? CAT_SIZE : size;
      if (sz) {
        const price = sizePrice(service, sz);
        const who = pet?.name ?? (forCat ? 'a cat' : `a ${sizePhrase(sz)}`);
        const lines = [
          `${service.name} for ${who}: ${formatPriceRange(price.min, price.max)}${price.note ? ` (${price.note.toLowerCase()})` : ''}. It takes about ${formatDuration(service.durationBySize[sz])}.`,
          ...catalog
            .addOnsFor(forCat ? 'cat' : 'dog', service.id, sz)
            .map((a) => `With ${a.name.toLowerCase()}: ${formatPriceRange(price.min + a.price, price.max + a.price)}.`),
        ];
        if (service.inclusions?.length) lines.push(`Includes ${listText(service.inclusions.map((i) => i.charAt(0).toLowerCase() + i.slice(1)))}.`);
        if (price.max > price.min) lines.push('The groomer confirms the final price at pick-up.');
        last = { ...q, serviceId: service.id, size: sz, species: forCat ? 'cat' : 'dog', petId: pet?.id };
        return {
          lines,
          links,
          choices: [
            { label: `Free times for ${service.name}`, query: { ...last, topic: 'slots' } },
            { label: 'Other services', query: { ...last, topic: 'price', serviceId: undefined } },
          ],
        };
      }
      last = { ...q, serviceId: service.id };
      return {
        lines: [`${service.name} by dog size:`],
        rows: sizesFor(service).map((s) => {
          const price = sizePrice(service, s);
          return { label: SIZE_LABELS[s], value: formatPriceRange(price.min, price.max) };
        }),
        links,
        choices: [
          ...PET_SIZES.map((s) => ({ label: SIZE_LABELS[s], query: { ...q, serviceId: service.id, size: s, species: 'dog' as const } })),
          { label: `Free times for ${service.name}`, query: { ...q, topic: 'slots' as const, serviceId: service.id } },
        ],
      };
    }
    if (size || species === 'cat') {
      const forCats = species === 'cat';
      const list = catalog.servicesFor(forCats ? 'cat' : 'dog');
      last = { ...q, size, species, petId: pet?.id };
      return {
        lines: [`Our prices for ${pet?.name ?? (forCats ? 'cats' : `a ${sizePhrase(size!)}`)}:`],
        rows: list.map((s) => {
          const price = sizePrice(s, forCats || !s.species.includes('dog') ? CAT_SIZE : size!);
          return { label: s.name, value: formatPriceRange(price.min, price.max) };
        }),
        links,
        choices: list.map((s) => ({ label: s.name, query: { ...last!, serviceId: s.id } })),
      };
    }
    last = q;
    return {
      lines: ['Our prices. Dog prices depend on size; cats are one price.'],
      rows: catalog.services.map((s) => ({ label: s.name, value: priceRange(s) })),
      links,
      choices: catalog.services.map((s) => ({ label: s.name, query: { ...q, serviceId: s.id } })),
    };
  }

  async function slotsAnswer(q: ChatQuery): Promise<Reply> {
    const settings = catalog.settings!;
    const { today } = clock();
    const { service, size: knownSize, species, pet } = subject(q);
    if (!service) {
      last = q;
      return {
        lines: [pet ? `Which service for ${pet.name}?` : 'Which service would you like?'],
        choices: catalog.servicesFor(species).map((s) => ({ label: s.name, query: { ...q, serviceId: s.id, petId: pet?.id } })),
      };
    }
    const forDog = service.species.includes('dog') && species !== 'cat';
    const size = forDog ? knownSize : CAT_SIZE;
    if (!size) {
      last = { ...q, serviceId: service.id };
      return {
        lines: ['What size is your dog? The grooming time depends on it.'],
        links: [{ label: 'Size guide', to: '/services#sizes' }],
        choices: [
          ...account.pets.filter((p) => p.species === 'dog').map((p) => ({ label: p.name, query: { ...last!, petId: p.id, size: p.size, species: 'dog' as const } })),
          ...PET_SIZES.map((s) => ({ label: SIZE_LABELS[s], query: { ...last!, size: s, species: 'dog' as const, petId: undefined } })),
          ...(service.species.includes('cat') ? [{ label: 'A cat', query: { ...last!, size: CAT_SIZE, species: 'cat' as const } }] : []),
        ],
      };
    }

    const resolved: ChatQuery = { ...q, serviceId: service.id, size, species: forDog ? 'dog' : 'cat', petId: pet?.id };
    last = resolved;
    const what = `${service.name} for ${pet?.name ?? (forDog ? `a ${sizePhrase(size)}` : 'a cat')}`;
    const horizon = addDays(today, Math.min(settings.bookingHorizonDays, 92));
    const nextChoice = { label: 'Next free time', query: { ...resolved, day: undefined, range: undefined, part: undefined, time: undefined } };

    if (q.day && q.day < today) return { lines: ['That day has already passed.'], choices: [nextChoice] };
    const first = q.day ?? (q.range && q.range.from > today ? q.range.from : today);
    if (first > horizon) {
      return { lines: [`We take online bookings up to ${settings.bookingHorizonDays} days ahead, so until ${dayName(horizon, today)}.`], choices: [nextChoice] };
    }

    const fits = (slot: SlotOption) => (q.time ? slot.time === q.time : !q.part || partOfDay(slot.time) === q.part);
    const lookup = (from: string, to: string) => api.availability({ from, to, serviceId: service.id, size }).then((r) => r.days);
    const reply = (day: string, slots: SlotOption[], lines: string[], others: DayAvailability[] = []): Reply => ({
      lines: [...lines, 'Tap a time to book it.'],
      slots: slots.slice(0, MAX_SLOTS).map((slot) => ({
        label: t12(slot.time),
        to: { path: '/book', query: { serviceId: service.id, day, time: slot.time, ...(pet ? { petId: pet.id } : {}) } },
      })),
      links: [
        ...(slots.length > MAX_SLOTS ? [{ label: `See all ${slots.length} times`, to: { path: '/availability', query: { serviceId: service.id, size, day } } }] : []),
      ],
      choices: [
        ...others.slice(0, 4).map((d) => ({ label: shortDayName(d.day), query: { ...resolved, day: d.day, range: undefined } })),
        { label: 'Prices', query: { ...resolved, topic: 'price' as const } },
      ],
    });
    const partText = q.part ? ` in the ${q.part}` : '';
    const otherDays = (days: DayAvailability[], except: string) => days.filter((d) => d.day !== except && d.slots.length);

    // A specific day: its times, or why there are none and the next day that has some.
    if (q.day) {
      const [day] = await lookup(q.day, q.day);
      const matches = day.slots.filter(fits);
      if (matches.length) {
        const lead = q.time ? `Yes, ${t12(q.time)} ${onDay(q.day, today)} is free for ${what}.` : `Free times for ${what} ${onDay(q.day, today)}${partText}:`;
        return reply(q.day, q.time ? day.slots : matches, [lead]);
      }
      if (day.slots.length) {
        const why = q.time ? `${t12(q.time)} isn't free ${onDay(q.day, today)}.` : `Nothing is free ${onDay(q.day, today)}${partText}.`;
        return reply(q.day, day.slots, [why, `Other times for ${what} that day:`]);
      }
      const why = closedReason(day, today);
      if (q.day >= horizon) return { lines: [why], choices: [nextChoice], links: callLinks() };
      const ahead = await lookup(addDays(q.day, 1), horizon);
      const next = ahead.find((d) => d.slots.some(fits)) ?? ahead.find((d) => d.slots.length);
      if (!next) return { lines: [why, `Nothing else is free for ${what} in the next ${settings.bookingHorizonDays} days.`], links: callLinks() };
      return reply(next.day, next.slots, [why, `The next free time for ${what} is ${dayName(next.day, today)} at ${t12(next.slots.find(fits)?.time ?? next.slots[0].time)}.`], otherDays(ahead, next.day));
    }

    // A week, or "the next free time": the first day that has what was asked for.
    const to = q.range && q.range.to < horizon ? q.range.to : horizon;
    let days = await lookup(first, to);
    let next = days.find((d) => d.slots.some(fits));
    const lines: string[] = [];
    if (!next && q.range) {
      lines.push(`Nothing is free for ${what} ${q.range.label}${partText}.`);
      if (to < horizon) days = await lookup(addDays(to, 1), horizon);
      next = days.find((d) => d.slots.some(fits)) ?? days.find((d) => d.slots.length);
    } else if (!next && (q.time || q.part)) {
      lines.push(q.time ? `${t12(q.time)} isn't free on any day soon.` : `Nothing is free${partText} soon.`);
      next = days.find((d) => d.slots.length);
    }
    if (!next) {
      return {
        lines: [...lines, `We're fully booked for the next ${settings.bookingHorizonDays} days. Please call us, or check again later.`],
        links: [{ label: 'See open times', to: { path: '/availability', query: { serviceId: service.id, size } } }, ...callLinks()],
      };
    }
    const shown = next.slots.some(fits) ? next.slots.filter(fits) : next.slots;
    const lead = q.time && shown[0].time === q.time ? `Yes, ${t12(q.time)} is free ${onDay(next.day, today)} for ${what}.` : `The next free time for ${what}${lines.length ? '' : partText} is ${dayName(next.day, today)} at ${t12(shown[0].time)}.`;
    return reply(next.day, q.time ? next.slots : shown, [...lines, lead], otherDays(days, next.day));
  }

  function closedReason(day: DayAvailability, today: string): string {
    const name = dayName(day.day, today);
    if (day.status === 'full') return `${cap(name)} is fully booked.`;
    if (day.status === 'past') {
      return day.day === today ? 'There are no more online times today.' : `Online booking for ${name} has closed: we need ${catalog.settings!.minNoticeHours} hours' notice.`;
    }
    if (day.status === 'beyond') return `Online booking isn't open for ${name} yet.`;
    return `We're closed ${onDay(day.day, today)}${day.reason && day.reason !== 'Closed' ? ` (${day.reason})` : ''}.`;
  }

  return { messages, busy, start, send, choose };
});

function listText(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];
}
