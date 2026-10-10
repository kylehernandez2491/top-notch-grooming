/**
 * Shared domain types — the single source of truth for both the API and the Vue front end.
 * Keep this folder free of Node/Azure imports so the browser bundle can use it too.
 */

export type Species = 'dog' | 'cat';
/** Dog size chosen by the owner; it sets the price and how long the groom takes. Cats are always 'small'. */
export type PetSize = 'small' | 'medium' | 'large' | 'husky_chow';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Temperament = 'calm' | 'friendly' | 'nervous' | 'reactive' | 'senior';

export const PET_SIZES: readonly PetSize[] = ['small', 'medium', 'large', 'husky_chow'];
/** Cats have one flat price, so they don't pick a size; they are stored as 'small'. */
export const CAT_SIZE: PetSize = 'small';
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const SPECIES: readonly Species[] = ['dog', 'cat'];
export const TEMPERAMENTS: readonly Temperament[] = ['calm', 'friendly', 'nervous', 'reactive', 'senior'];

/** Locks are always written at this granularity so a later slot-increment change can never misalign them. */
export const LOCK_MINUTES = 15;

/** "HH:mm" in the shop's time zone. */
export interface TimeRange {
  start: string;
  end: string;
}

export interface DayHours {
  open: string;
  close: string;
  breaks: TimeRange[];
}

export interface ShopPolicies {
  cancellation: string;
  vaccination: string;
  lateArrival: string;
}

export interface BusinessSettings {
  id: 'settings';
  kind: 'settings';
  shopName: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  /** IANA zone, e.g. Asia/Manila. All day/time strings are wall-clock in this zone. */
  timeZone: string;
  /** Start-time granularity offered to owners: 15, 30 or 60. */
  slotIncrementMinutes: number;
  /** Clean-up time after every appointment. */
  bufferMinutes: number;
  minNoticeHours: number;
  bookingHorizonDays: number;
  cancellationWindowHours: number;
  /** 0 = unlimited. */
  maxAppointmentsPerDay: number;
  /** 0 = unlimited. */
  maxUpcomingPerOwner: number;
  /** Block online booking after this many no-shows. 0 = never block. */
  noShowLimit: number;
  requireVaccinations: boolean;
  weeklyHours: Record<Weekday, DayHours | null>;
  policies: ShopPolicies;
  /** Version of the built-in service menu last applied to this database (see upgradeMenu). */
  menuVersion?: number;
  updatedAt?: string;
}

export interface Service {
  id: string;
  kind: 'service';
  name: string;
  description: string;
  species: Species[];
  /** What the service includes, listed on the price menu. */
  inclusions?: string[];
  durationBySize: Record<PetSize, number>;
  /** Price in pesos; the lower end when a size has a range. */
  priceBySize: Record<PetSize, number>;
  /** Upper end of the price when it depends on coat volume; the groomer confirms the final price at pick-up. */
  priceMaxBySize?: Partial<Record<PetSize, number>>;
  /** Short note shown with a size's price, e.g. "Shaved / summer cut" or "Depends on coat volume". */
  priceNoteBySize?: Partial<Record<PetSize, string>>;
  active: boolean;
  popular?: boolean;
  sortOrder: number;
  updatedAt?: string;
}

export interface AddOn {
  id: string;
  kind: 'addon';
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  species: Species[];
  /** Only offered with these services; empty or missing means every service. */
  serviceIds?: string[];
  /** Only offered for these sizes; empty or missing means every size. */
  sizes?: PetSize[];
  active: boolean;
  sortOrder: number;
  updatedAt?: string;
}

/** Full-day closure when start/end are omitted, otherwise a blocked window on that day. */
export interface Closure {
  id: string;
  kind: 'closure';
  date: string;
  start?: string;
  end?: string;
  reason: string;
  createdAt: string;
}

export type CatalogDoc = BusinessSettings | Service | AddOn | Closure;

export interface Vaccination {
  name: string;
  /** YYYY-MM-DD */
  expiresOn: string;
}

export interface Pet {
  id: string;
  type: 'pet';
  ownerId: string;
  name: string;
  species: Species;
  breed: string;
  size: PetSize;
  weightKg?: number;
  birthday?: string;
  sex?: 'male' | 'female' | 'unknown';
  coat?: string;
  temperament: Temperament;
  behaviorNotes?: string;
  medicalNotes?: string;
  allergies?: string;
  vetName?: string;
  vetPhone?: string;
  vaccinations: Vaccination[];
  groomingPreferences?: string;
  /** Small JPEG data URL, resized in the browser before upload. */
  photo?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerProfile {
  id: string;
  type: 'profile';
  ownerId: string;
  email: string;
  displayName: string;
  phone?: string;
  /** Home address, entered by the owner. */
  address?: string;
  emergencyContact?: string;
  emailReminders: boolean;
  emailMarketing: boolean;
  onboarded: boolean;
  noShowCount: number;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatus = 'booked' | 'checked-in' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['booked', 'checked-in', 'in-progress'];

export interface StatusEvent {
  at: string;
  event: AppointmentStatus | 'created' | 'rescheduled' | 'notes';
  by: 'owner' | 'staff' | 'system';
  note?: string;
}

export interface ReportCard {
  behavior: string;
  coat: string;
  notes: string;
  recommendations: string;
  nextVisitWeeks?: number;
  createdAt: string;
}

export interface Review {
  rating: number;
  comment?: string;
  createdAt: string;
}

export interface BookedAddOn {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
}

export interface Appointment {
  id: string;
  type: 'appointment';
  /** Partition key: YYYY-MM-DD in the shop's zone. */
  day: string;
  startTime: string;
  /** When the groom itself finishes (pick-up time). */
  endTime: string;
  startUtc: string;
  endUtc: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  petId: string;
  petName: string;
  petSpecies: Species;
  petSize: PetSize;
  petBreed: string;
  /** Allergies, temperament and medical flags copied at booking time for the groomer. */
  petAlerts: string[];
  serviceId: string;
  serviceName: string;
  addOns: BookedAddOn[];
  durationMinutes: number;
  estimatedPrice: number;
  /** Upper end of the estimate when the price depends on coat volume. */
  estimatedPriceMax?: number;
  /** What was actually charged, entered by staff at check-out. */
  finalPrice?: number;
  notes?: string;
  staffNotes?: string;
  status: AppointmentStatus;
  history: StatusEvent[];
  /** Ids of the slot-lock documents that reserve this appointment's time. */
  locks: string[];
  seriesId?: string;
  bookedBy: 'owner' | 'staff';
  lateCancellation?: boolean;
  cancelReason?: string;
  reminderSentAt?: string;
  reportCard?: ReportCard;
  review?: Review;
  createdAt: string;
  updatedAt: string;
}

export type WaitlistWindow = 'any' | 'morning' | 'afternoon';

export interface WaitlistEntry {
  id: string;
  type: 'waitlist';
  day: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  petId: string;
  petName: string;
  serviceId: string;
  serviceName: string;
  window: WaitlistWindow;
  notifiedAt?: string;
  createdAt: string;
  ttl?: number;
}

// ---------- API contracts ----------

export type DayStatus = 'open' | 'limited' | 'full' | 'closed' | 'past' | 'beyond';

export interface SlotOption {
  time: string;
  endTime: string;
}

export interface DayAvailability {
  day: string;
  status: DayStatus;
  slots: SlotOption[];
  /** Starts the day would offer if it were empty — lets the calendar show how full a day is. */
  capacity?: number;
  reason?: string;
}

export interface AvailabilityResponse {
  from: string;
  to: string;
  timeZone: string;
  durationMinutes: number;
  days: DayAvailability[];
  nextAvailable?: { day: string; time: string };
}

export interface RatingSummary {
  average: number;
  count: number;
}

export interface PublicCatalog {
  settings: BusinessSettings;
  services: Service[];
  addOns: AddOn[];
  closures: Closure[];
  rating?: RatingSummary;
  today: string;
}

export interface MeResponse {
  profile: OwnerProfile;
  roles: string[];
  isAdmin: boolean;
}

export interface BookingRequest {
  petId: string;
  serviceId: string;
  addOnIds: string[];
  day: string;
  time: string;
  notes?: string;
  repeat?: { everyWeeks: number; count: number };
  /** Staff only: book on behalf of this owner. */
  ownerId?: string;
}

export interface BookingResult {
  appointments: Appointment[];
  skipped: { day: string; reason: string }[];
}

export interface AgendaResponse {
  from: string;
  to: string;
  appointments: Appointment[];
  waitlist: WaitlistEntry[];
  closures: Closure[];
}

export interface ClientSummary {
  profile: OwnerProfile;
  petCount: number;
}

export interface ClientDetail {
  profile: OwnerProfile;
  pets: Pet[];
  appointments: Appointment[];
}

export interface AdminStats {
  from: string;
  to: string;
  total: number;
  completed: number;
  cancelled: number;
  lateCancellations: number;
  noShows: number;
  noShowRate: number;
  upcoming: number;
  revenue: number;
  averageTicket: number;
  rating?: RatingSummary;
  newClients: number;
  topServices: { name: string; count: number; revenue: number }[];
  byWeekday: { weekday: Weekday; count: number }[];
  byHour: { hour: number; count: number }[];
}

export interface ApiErrorBody {
  error: { message: string; code?: string; details?: unknown };
}
