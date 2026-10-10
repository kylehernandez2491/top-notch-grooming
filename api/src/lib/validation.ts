import { z } from 'zod';
import { DAY_RE, TIME_RE } from './time';

export const day = z.string().regex(DAY_RE, 'Use YYYY-MM-DD');
export const time = z.string().regex(TIME_RE, 'Use HH:mm');
/** Opening hours, breaks and closures must sit on the 15-minute lock grid. */
export const gridTime = time.refine((t) => Number(t.slice(3)) % 15 === 0, 'Use a 15-minute boundary (:00, :15, :30, :45)');
const id = z.string().min(1).max(100);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().transform((v) => (v ? v : undefined));

const species = z.enum(['dog', 'cat']);
const size = z.enum(['small', 'medium', 'large', 'husky_chow'], { message: 'Choose a dog size' });
const bySize = z.object({ small: z.number().min(0), medium: z.number().min(0), large: z.number().min(0), husky_chow: z.number().min(0) });
const price = z.number().min(0).max(100_000);
/** Accepts local and international formats: 0917 123 4567, +63 917 123 4567, (02) 8123 4567. */
export const phoneNumber = text(30).refine((v) => {
  const digits = v.replace(/\D/g, '');
  return /^[0-9+()\s.-]+$/.test(v) && digits.length >= 7 && digits.length <= 15;
}, 'Enter a valid contact number, e.g. 0917 123 4567');

export const petInput = z.object({
  name: text(40).min(1, 'Name is required'),
  species,
  breed: text(60).default(''),
  size,
  weightKg: z.number().positive().max(150).optional(),
  birthday: day.optional(),
  sex: z.enum(['male', 'female', 'unknown']).optional(),
  coat: optionalText(60),
  temperament: z.enum(['calm', 'friendly', 'nervous', 'reactive', 'senior']).default('friendly'),
  behaviorNotes: optionalText(600),
  medicalNotes: optionalText(600),
  allergies: optionalText(200),
  vetName: optionalText(80),
  vetPhone: optionalText(30),
  vaccinations: z.array(z.object({ name: text(40).min(1), expiresOn: day })).max(12).default([]),
  groomingPreferences: optionalText(600),
  photo: z
    .string()
    .max(300_000, 'Photo is too large')
    .refine((v) => /^data:image\/(jpeg|png|webp);base64,/.test(v), 'Photo must be an image')
    .nullable()
    .optional(),
})
  // Cats have one flat price, so their size is always stored as small.
  .transform((p) => (p.species === 'cat' ? { ...p, size: 'small' as const } : p));

export const profileInput = z.object({
  displayName: text(60).min(1, 'Name is required'),
  phone: phoneNumber,
  email: z.email('Enter a valid email address').max(254),
  address: text(200).min(5, 'Enter your address'),
  emergencyContact: optionalText(120),
  emailReminders: z.boolean(),
  emailMarketing: z.boolean(),
});

export const bookingInput = z.object({
  petId: id,
  serviceId: id,
  addOnIds: z.array(id).max(10).default([]),
  day,
  time,
  notes: optionalText(500),
  repeat: z.object({ everyWeeks: z.number().int().min(1).max(16), count: z.number().int().min(2).max(12) }).optional(),
  ownerId: id.optional(),
});

export const rescheduleInput = z.object({ day, time });
export const cancelInput = z.object({ reason: optionalText(300) });
export const notesInput = z.object({ notes: optionalText(500) });
export const reviewInput = z.object({ rating: z.number().int().min(1).max(5), comment: optionalText(1000) });
export const waitlistInput = z.object({ day, petId: id, serviceId: id, window: z.enum(['any', 'morning', 'afternoon']) });

export const statusInput = z.object({
  status: z.enum(['booked', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show']),
  note: optionalText(300),
  finalPrice: price.optional(),
});
export const clientInput = z.object({ noShowCount: z.number().int().min(0).max(100) });
export const staffNotesInput = z.object({ staffNotes: optionalText(1000) });
export const reportCardInput = z.object({
  behavior: text(300),
  coat: text(300),
  notes: text(1000),
  recommendations: text(600),
  nextVisitWeeks: z.number().int().min(1).max(26).optional(),
});

const dayHours = z
  .object({
    open: gridTime,
    close: gridTime,
    breaks: z.array(z.object({ start: gridTime, end: gridTime })).max(4),
  })
  .refine((h) => h.open < h.close, 'Closing time must be after opening time')
  .refine((h) => h.breaks.every((b) => b.start < b.end && b.start >= h.open && b.end <= h.close), 'Breaks must fall within opening hours')
  .nullable();

export const settingsInput = z.object({
  shopName: text(60).min(1),
  tagline: text(120),
  phone: text(30),
  email: z.union([z.email(), z.literal('')]),
  address: text(160),
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone'),
  slotIncrementMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  bufferMinutes: z.number().int().min(0).max(120),
  minNoticeHours: z.number().int().min(0).max(168),
  bookingHorizonDays: z.number().int().min(7).max(365),
  cancellationWindowHours: z.number().int().min(0).max(168),
  maxAppointmentsPerDay: z.number().int().min(0).max(50),
  maxUpcomingPerOwner: z.number().int().min(0).max(50),
  noShowLimit: z.number().int().min(0).max(20),
  requireVaccinations: z.boolean(),
  weeklyHours: z.object({ mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours }),
  policies: z.object({ cancellation: text(800), vaccination: text(800), lateArrival: text(800) }),
});

export const serviceInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Use lowercase letters, numbers and dashes').optional(),
  name: text(60).min(1),
  description: text(400),
  species: z.array(species).min(1),
  durationBySize: bySize.refine((d) => Object.values(d).every((m) => m >= 5 && m <= 480 && m % 5 === 0), 'Durations must be 5–480 minutes in steps of 5'),
  priceBySize: bySize,
  priceMaxBySize: bySize.partial().optional(),
  priceNoteBySize: z
    .object({ small: optionalText(60), medium: optionalText(60), large: optionalText(60), husky_chow: optionalText(60) })
    .partial()
    .optional(),
  inclusions: z.array(text(80).min(1)).max(15).default([]),
  active: z.boolean(),
  popular: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999),
}).refine(
  (s) => Object.entries(s.priceMaxBySize ?? {}).every(([k, max]) => max === undefined || max >= s.priceBySize[k as keyof typeof s.priceBySize]),
  { message: 'An "up to" price must be at least the starting price', path: ['priceMaxBySize'] },
);

export const addOnInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  name: text(60).min(1),
  description: text(300),
  durationMinutes: z.number().int().min(0).max(120).refine((m) => m % 5 === 0, 'Use steps of 5 minutes'),
  price,
  species: z.array(species).min(1),
  serviceIds: z.array(id).max(20).optional(),
  sizes: z.array(size).max(4).optional(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});

export const closureInput = z
  .object({ date: day, start: gridTime.optional(), end: gridTime.optional(), reason: text(120).default('Closed') })
  .refine((c) => (!c.start && !c.end) || (c.start && c.end && c.start < c.end), 'Provide both a start and end time, or neither for a full day');
