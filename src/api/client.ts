import type {
  AddOn,
  AdminStats,
  AgendaResponse,
  Appointment,
  AppointmentStatus,
  AvailabilityResponse,
  BookingRequest,
  BookingResult,
  BusinessSettings,
  ClientDetail,
  ClientSummary,
  Closure,
  PetDetails,
  PetSize,
  PublicCatalog,
  ReportCard,
  Service,
  ShopNotice,
  SpecialHours,
  StaffBookingRequest,
  WaitlistEntry,
  WaitlistRequest,
} from '@shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }

  /** Field-level messages from server-side validation, keyed by path ("name", "owner.phone"). */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((d) => [d.path, d.message]));
  }
}

const FALLBACK: Record<number, string> = {
  0: "You're offline. Check your connection and try again.",
  401: 'Please sign in to the staff portal.',
  403: "You don't have access to that.",
  404: "We couldn't find that.",
  409: 'That just changed. Please refresh and try again.',
  503: 'We are a little busy. Please try again in a moment.',
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, FALLBACK[0]);
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json().catch(() => undefined) : undefined;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('api:unauthorized'));
    const error = (data as { error?: { message?: string; code?: string; details?: { path: string; message: string }[] } })?.error;
    throw new ApiError(res.status, error?.message ?? FALLBACK[res.status] ?? 'Something went wrong. Please try again.', error?.code, error?.details);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const del = (path: string) => request<void>('DELETE', path);
const enc = encodeURIComponent;

export interface AvailabilityQuery {
  from: string;
  to: string;
  serviceId: string;
  size: PetSize;
  addOns?: string[];
  exclude?: string;
  /** Manage token from an email link, so a booking opened on another device can still be moved. */
  token?: string;
  staff?: boolean;
}

/** What the pet form produces. photo: undefined keeps the current one, null removes it. */
export type PetInput = PetDetails & { photo?: string | null };
export type ServiceInput = Omit<Service, 'kind' | 'updatedAt'>;
export type AddOnInput = Omit<AddOn, 'kind' | 'updatedAt'>;
export type ClosureInput = Pick<Closure, 'date' | 'start' | 'end' | 'reason'>;
export type SettingsInput = Omit<BusinessSettings, 'id' | 'kind' | 'updatedAt'>;
export type ReportCardInput = Omit<ReportCard, 'createdAt'>;
export type SpecialHoursInput = Pick<SpecialHours, 'open' | 'close' | 'breaks' | 'note'>;
export type NoticeInput = Pick<ShopNotice, 'message' | 'until'>;

/** Appointment URLs carry ?t= when the booking was opened from an email link on another device. */
const appt = (id: string, token?: string, action = '') => `appointments/${enc(id)}${action}${token ? `?t=${enc(token)}` : ''}`;

export const api = {
  catalog: () => get<PublicCatalog>('public/catalog'),
  availability(q: AvailabilityQuery) {
    const params = new URLSearchParams({ from: q.from, to: q.to, serviceId: q.serviceId, size: q.size });
    if (q.addOns?.length) params.set('addOns', q.addOns.join(','));
    if (q.exclude) params.set('exclude', q.exclude);
    if (q.token) params.set('t', q.token);
    if (q.staff) params.set('staff', '1');
    return get<AvailabilityResponse>(`public/availability?${params}`);
  },

  /** This device's bookings (the server knows the device by an HttpOnly cookie). */
  appointments: () => get<Appointment[]>('appointments'),
  appointment: (id: string, token?: string) => get<Appointment>(appt(id, token)),
  book: (input: BookingRequest) => post<BookingResult>('appointments', input),
  cancel: (id: string, reason?: string, token?: string) => post<Appointment>(appt(id, token, '/cancel'), { reason }),
  reschedule: (id: string, day: string, time: string, token?: string) => post<Appointment>(appt(id, token, '/reschedule'), { day, time }),
  updateNotes: (id: string, notes?: string, token?: string) => put<Appointment>(appt(id, token, '/notes'), { notes }),
  review: (id: string, rating: number, comment?: string, token?: string) => post<Appointment>(appt(id, token, '/review'), { rating, comment }),
  icsUrl: (id: string, token?: string) => `/api/${appt(id, token, '/ics')}`,
  /** Drops the device cookie. The device's saved details are cleared by the account store. */
  forgetDevice: () => post<void>('device/forget'),

  waitlist: () => get<WaitlistEntry[]>('waitlist'),
  joinWaitlist: (input: WaitlistRequest) => post<WaitlistEntry>('waitlist', input),
  leaveWaitlist: (entry: WaitlistEntry) => del(`waitlist/${enc(entry.day)}/${enc(entry.id)}`),

  admin: {
    book: (input: StaffBookingRequest) => post<BookingResult>('staff/appointments', input),
    agenda: (from: string, to: string) => get<AgendaResponse>(`staff/agenda?from=${from}&to=${to}`),
    appointment: (id: string) => get<Appointment>(`staff/appointments/${enc(id)}`),
    setStatus: (id: string, status: AppointmentStatus, note?: string, finalPrice?: number) =>
      post<Appointment>(`staff/appointments/${enc(id)}/status`, { status, note, finalPrice }),
    staffNotes: (id: string, staffNotes?: string) => put<Appointment>(`staff/appointments/${enc(id)}/staff-notes`, { staffNotes }),
    reportCard: (id: string, input: ReportCardInput) => put<Appointment>(`staff/appointments/${enc(id)}/report-card`, input),
    reschedule: (id: string, day: string, time: string) => post<Appointment>(`staff/appointments/${enc(id)}/reschedule`, { day, time }),
    settings: () => get<BusinessSettings>('staff/settings'),
    saveSettings: (input: SettingsInput) => put<BusinessSettings>('staff/settings', input),
    services: () => get<Service[]>('staff/catalog/service'),
    addOns: () => get<AddOn[]>('staff/catalog/addon'),
    closures: () => get<Closure[]>('staff/catalog/closure'),
    createService: (input: ServiceInput) => post<Service>('staff/catalog/service', input),
    updateService: (id: string, input: ServiceInput) => put<Service>(`staff/catalog/service/${enc(id)}`, input),
    deleteService: (id: string) => del(`staff/catalog/service/${enc(id)}`),
    createAddOn: (input: AddOnInput) => post<AddOn>('staff/catalog/addon', input),
    updateAddOn: (id: string, input: AddOnInput) => put<AddOn>(`staff/catalog/addon/${enc(id)}`, input),
    deleteAddOn: (id: string) => del(`staff/catalog/addon/${enc(id)}`),
    createClosure: (input: ClosureInput) => post<Closure>('staff/catalog/closure', input),
    deleteClosure: (id: string) => del(`staff/catalog/closure/${enc(id)}`),
    specialHours: () => get<SpecialHours[]>('staff/special-hours'),
    /** One set of hours per date: saving a date again replaces it. */
    saveSpecialHours: (date: string, input: SpecialHoursInput) => put<SpecialHours>(`staff/special-hours/${enc(date)}`, input),
    deleteSpecialHours: (date: string) => del(`staff/special-hours/${enc(date)}`),
    saveNotice: (input: NoticeInput) => put<ShopNotice>('staff/notice', input),
    clearNotice: () => del('staff/notice'),
    clients: (q = '') => get<ClientSummary[]>(`staff/clients?q=${enc(q)}`),
    client: (clientKey: string) => get<ClientDetail>(`staff/clients/${enc(clientKey)}`),
    excuseNoShows: (clientKey: string) => post<{ excused: number }>(`staff/clients/${enc(clientKey)}/excuse-no-shows`),
    stats: (from: string, to: string) => get<AdminStats>(`staff/stats?from=${from}&to=${to}`),
    exportUrl: (from: string, to: string) => `/api/staff/export?from=${from}&to=${to}`,
  },
};

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

/** SWA's built-in endpoint: which staff member is signed in (null for everyone else). */
export async function fetchPrincipal(): Promise<ClientPrincipal | null> {
  try {
    const res = await fetch('/.auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { clientPrincipal: ClientPrincipal | null };
    return data.clientPrincipal;
  } catch {
    return null;
  }
}
