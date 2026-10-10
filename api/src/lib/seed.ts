import type { AddOn, BusinessSettings, Service } from '../shared/types';

export function defaultSettings(): BusinessSettings {
  const workday = { open: '08:30', close: '17:00', breaks: [{ start: '12:30', end: '13:00' }] };
  return {
    id: 'settings',
    kind: 'settings',
    shopName: 'Top Notch Dog Grooming',
    tagline: 'Top-notch grooming since 2013',
    phone: '(555) 010-0199',
    email: 'hello@topnotchgrooming.example',
    address: '123 Bark Avenue, Springfield',
    timeZone: process.env.SHOP_TIME_ZONE ?? 'Asia/Manila',
    slotIncrementMinutes: 30,
    bufferMinutes: 15,
    minNoticeHours: 12,
    bookingHorizonDays: 60,
    cancellationWindowHours: 24,
    maxAppointmentsPerDay: 8,
    maxUpcomingPerOwner: 6,
    noShowLimit: 3,
    requireVaccinations: true,
    weeklyHours: {
      mon: null,
      tue: workday,
      wed: workday,
      thu: workday,
      fri: workday,
      sat: { open: '08:00', close: '14:00', breaks: [] },
      sun: null,
    },
    menuVersion: MENU_VERSION,
    policies: {
      cancellation:
        'Please cancel or reschedule at least 24 hours ahead so another pup can have your spot. Late cancellations are noted on your account.',
      vaccination:
        'Dogs need a current rabies vaccination (and we recommend DHPP and Bordetella). Cats need a current rabies vaccination. Please keep the dates on your pet profile up to date.',
      lateArrival:
        'Running late? Call us. Arrivals more than 15 minutes late may need to be rescheduled so we can stay on time for the next client.',
    },
  };
}

/** Small, medium, large, Husky / Chow Chow */
const bySize = (small: number, medium: number, large: number, huskyChow: number) => ({ small, medium, large, husky_chow: huskyChow });

const COAT_VOLUME = 'Depends on coat volume';
const HYGIENE = ['Bath and blow dry', 'Nail cut', 'Ear cleaning', 'Sanitary cleaning', 'Paw pad trimming'];

/**
 * The shop's price list, in Philippine pesos. Ranges depend on coat volume and are confirmed at pick-up.
 * Times are starting values; the groomer edits everything in Shop settings.
 */
export function defaultServices(): Service[] {
  return [
    {
      id: 'basic-grooming',
      kind: 'service',
      name: 'Basic Grooming',
      description: 'Our everyday groom: everything your dog needs to look and feel clean.',
      species: ['dog'],
      inclusions: [...HYGIENE, 'Toothbrush', 'Anal drain'],
      durationBySize: bySize(60, 75, 90, 120),
      priceBySize: bySize(380, 480, 650, 750),
      priceMaxBySize: { husky_chow: 850 },
      priceNoteBySize: { small: 'Shaved / summer cut', medium: 'Shaved / summer cut', husky_chow: COAT_VOLUME },
      active: true,
      sortOrder: 1,
    },
    {
      id: 'full-grooming',
      kind: 'service',
      name: 'Full Grooming',
      description: 'The complete treatment: a full haircut with design, plus all of our grooming care.',
      species: ['dog'],
      inclusions: ['Full haircut with design', ...HYGIENE, 'Toothbrush', 'Anal drain'],
      durationBySize: bySize(90, 120, 150, 180),
      priceBySize: bySize(500, 600, 700, 800),
      priceMaxBySize: { husky_chow: 850 },
      priceNoteBySize: { husky_chow: COAT_VOLUME },
      active: true,
      popular: true,
      sortOrder: 2,
    },
    {
      id: 'cat-grooming',
      kind: 'service',
      name: 'Cat Grooming',
      description: 'Gentle, unhurried grooming for cats, at one price for every cat.',
      species: ['cat'],
      inclusions: HYGIENE,
      // Cats are always stored as 'small'; the other sizes mirror it so the price grid stays complete.
      durationBySize: bySize(75, 75, 75, 75),
      priceBySize: bySize(500, 500, 500, 500),
      active: true,
      sortOrder: 3,
    },
    {
      id: 'bath-blow-dry',
      kind: 'service',
      name: 'Bath / Blow Dry',
      description: 'A fresh bath and blow dry only: a quick refresh between full grooms.',
      species: ['dog'],
      inclusions: ['Bath', 'Blow dry'],
      durationBySize: bySize(45, 60, 75, 105),
      priceBySize: bySize(250, 350, 450, 450),
      priceMaxBySize: { large: 550, husky_chow: 550 },
      priceNoteBySize: { large: COAT_VOLUME, husky_chow: COAT_VOLUME },
      active: true,
      sortOrder: 4,
    },
  ];
}

/** Basic Grooming for small and medium dogs can be a summer cut with a face design, ₱50 more. */
export function defaultAddOns(): AddOn[] {
  return [
    {
      id: 'face-design',
      kind: 'addon',
      name: 'Face design',
      description: 'Summer cut finished with a styled face.',
      durationMinutes: 15,
      price: 50,
      species: ['dog'],
      serviceIds: ['basic-grooming'],
      sizes: ['small', 'medium'],
      active: true,
      sortOrder: 1,
    },
  ];
}

/** Bump when the built-in menu changes so existing databases pick it up once (see upgradeMenu in cosmos.ts). */
export const MENU_VERSION = 2;
