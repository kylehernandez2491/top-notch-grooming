import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type {
  AddOn,
  AdminStats,
  AgendaResponse,
  Appointment,
  BookedPet,
  BusinessSettings,
  ClientDetail,
  ClientSummary,
  Closure,
  OwnerDetails,
  Service,
  ShopNotice,
  SpecialHours,
  WaitlistEntry,
  Weekday,
} from '../shared/types';
import { ACTIVE_STATUSES, WEEKDAYS } from '../shared/types';
import { specialHoursId } from '../shared/hours';
import { cancelAppointment, rescheduleAppointment } from '../lib/actions';
import { requireAdmin } from '../lib/auth';
import { book, countNoShows, saveAppointment } from '../lib/booking';
import { clean, getContainers } from '../lib/cosmos';
import { sendEmail, templates } from '../lib/email';
import { badRequest, baseUrl, conflict, created, notFound, query, raw, readBody, route } from '../lib/http';
import {
  ClientRow,
  findAppointment,
  getNotice,
  getSettings,
  invalidateCatalog,
  listAppointmentsInRange,
  listClientRows,
  listClosures,
  listSpecialHours,
  loadCatalog,
  queryAll,
} from '../lib/repo';
import { addDays, daysBetween, isValidDay, todayIn, weekdayOf } from '../lib/time';
import {
  addOnInput,
  closureInput,
  noticeInput,
  reportCardInput,
  rescheduleInput,
  serviceInput,
  settingsInput,
  specialHoursInput,
  staffBookingInput,
  staffNotesInput,
  statusInput,
} from '../lib/validation';

function range(req: Parameters<typeof query>[0], today: string, defaultDays: number, maxDays: number) {
  const from = query(req, 'from') ?? today;
  const to = query(req, 'to') ?? addDays(from, defaultDays);
  if (!isValidDay(from) || !isValidDay(to) || to < from) throw badRequest('Use a valid from/to range.');
  if (daysBetween(from, to) > maxDays) throw badRequest(`Ask for at most ${maxDays} days at a time.`);
  return { from, to };
}

// ---------- agenda & appointments ----------

route('adminAgenda', ['GET'], 'staff/agenda', async (req): Promise<AgendaResponse> => {
  requireAdmin(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const today = todayIn(settings.timeZone);
  const { from, to } = range(req, today, 6, 62);
  const [appointments, waitlist, closures, specialHours, notice] = await Promise.all([
    listAppointmentsInRange(c, from, to),
    queryAll<WaitlistEntry>(c.bookings, 'SELECT * FROM c WHERE c.type = "waitlist" AND c.day >= @f AND c.day <= @t', [
      { name: '@f', value: from },
      { name: '@t', value: to },
    ]),
    listClosures(c, from, to),
    listSpecialHours(c, from, to),
    getNotice(c, today),
  ]);
  return { from, to, appointments, waitlist: waitlist.map(clean), closures, specialHours, notice };
});

/** Phone and walk-in bookings for a client from their history. Bypasses notice and horizon, never overlaps. */
route('adminBook', ['POST'], 'staff/appointments', async (req, ctx) => {
  requireAdmin(req);
  const input = await readBody(req, staffBookingInput);
  const c = await getContainers();
  const settings = await getSettings(c);
  const { ownerId, ...request } = input;
  const result = await book(c, { request, ownerId: ownerId ?? `s-${randomUUID()}`, settings, actor: { kind: 'staff' } });
  const appUrl = baseUrl(req);
  for (const appointment of result.appointments) {
    await sendEmail(ctx, templates.confirmed(appointment, settings, appUrl));
  }
  return created(result);
});

route('adminAppointmentGet', ['GET'], 'staff/appointments/{id}', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  return clean(await findAppointment(c, req.params.id));
});

route('adminAppointmentStatus', ['POST'], 'staff/appointments/{id}/status', async (req, ctx) => {
  requireAdmin(req);
  const input = await readBody(req, statusInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([findAppointment(c, req.params.id), getSettings(c)]);

  if (input.status === 'cancelled') return cancelAppointment(c, ctx, req, appointment, settings, 'staff', input.note);
  if (appointment.status === 'cancelled') throw conflict('Cancelled appointments cannot be reopened — book a new one.', 'cancelled');
  if (input.status === 'completed' && input.finalPrice === undefined && appointment.status === 'completed') {
    return clean(appointment);
  }

  const now = new Date().toISOString();
  const next: Appointment = {
    ...clean(appointment),
    status: input.status,
    finalPrice: input.status === 'completed' ? input.finalPrice ?? appointment.finalPrice : appointment.finalPrice,
    // A fresh no-show counts again even if an earlier one on this visit was excused.
    noShowExcused: input.status === 'no-show' ? undefined : appointment.noShowExcused,
    updatedAt: now,
    history: [...appointment.history, { at: now, event: input.status, by: 'staff', note: input.note }],
  };
  return saveAppointment(c.bookings, appointment, next);
});

route('adminAppointmentNotes', ['PUT'], 'staff/appointments/{id}/staff-notes', async (req) => {
  requireAdmin(req);
  const { staffNotes } = await readBody(req, staffNotesInput);
  const c = await getContainers();
  const appointment = await findAppointment(c, req.params.id);
  return saveAppointment(c.bookings, appointment, { ...clean(appointment), staffNotes, updatedAt: new Date().toISOString() });
});

route('adminReportCard', ['PUT'], 'staff/appointments/{id}/report-card', async (req, ctx) => {
  requireAdmin(req);
  const input = await readBody(req, reportCardInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([findAppointment(c, req.params.id), getSettings(c)]);
  const firstTime = !appointment.reportCard;
  const saved = await saveAppointment(c.bookings, appointment, {
    ...clean(appointment),
    reportCard: { ...input, createdAt: appointment.reportCard?.createdAt ?? new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  });
  if (firstTime) await sendEmail(ctx, templates.reportCard(saved, settings, baseUrl(req)));
  return saved;
});

route('adminReschedule', ['POST'], 'staff/appointments/{id}/reschedule', async (req, ctx) => {
  requireAdmin(req);
  const target = await readBody(req, rescheduleInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([findAppointment(c, req.params.id), getSettings(c)]);
  return rescheduleAppointment(c, ctx, req, appointment, settings, target, 'staff');
});

// ---------- settings & catalog ----------

route('adminSettingsGet', ['GET'], 'staff/settings', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  invalidateCatalog();
  return getSettings(c);
});

route('adminSettingsPut', ['PUT'], 'staff/settings', async (req) => {
  requireAdmin(req);
  const input = await readBody(req, settingsInput);
  const c = await getContainers();
  const current = await getSettings(c);
  const settings: BusinessSettings = {
    ...input,
    id: 'settings',
    kind: 'settings',
    menuVersion: current.menuVersion,
    updatedAt: new Date().toISOString(),
  };
  await c.catalog.items.upsert(settings);
  invalidateCatalog();
  return settings;
});

const catalogSchemas = { service: serviceInput, addon: addOnInput, closure: closureInput } as const;
type CatalogKind = keyof typeof catalogSchemas;

function kindOf(value: string | undefined): CatalogKind {
  if (value === 'service' || value === 'addon' || value === 'closure') return value;
  throw notFound('Unknown catalog type.');
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || randomUUID().slice(0, 8)
  );
}

route('adminCatalogList', ['GET'], 'staff/catalog/{kind}', async (req) => {
  requireAdmin(req);
  const kind = kindOf(req.params.kind);
  const c = await getContainers();
  invalidateCatalog();
  if (kind === 'closure') {
    const settings = await getSettings(c);
    const today = todayIn(settings.timeZone);
    return listClosures(c, addDays(today, -30), addDays(today, 400));
  }
  const catalog = await loadCatalog(c);
  return kind === 'service' ? catalog.services : catalog.addOns;
});

route('adminCatalogCreate', ['POST'], 'staff/catalog/{kind}', async (req) => {
  requireAdmin(req);
  const kind = kindOf(req.params.kind);
  const c = await getContainers();
  const now = new Date().toISOString();
  let doc: Service | AddOn | Closure;
  if (kind === 'closure') {
    const input = await readBody(req, closureInput);
    doc = { ...input, id: randomUUID(), kind: 'closure', createdAt: now };
  } else if (kind === 'service') {
    const input = await readBody(req, serviceInput);
    doc = { ...input, id: input.id ?? slug(input.name), kind: 'service', updatedAt: now };
  } else {
    const input = await readBody(req, addOnInput);
    doc = { ...input, id: input.id ?? slug(input.name), kind: 'addon', updatedAt: now };
  }
  const { resource: existing } = await c.catalog.item(doc.id, kind).read();
  if (existing) throw conflict('Something with that id already exists.', 'duplicate');
  await c.catalog.items.create(doc);
  invalidateCatalog();
  return created(doc);
});

route('adminCatalogUpdate', ['PUT'], 'staff/catalog/{kind}/{id}', async (req) => {
  requireAdmin(req);
  const kind = kindOf(req.params.kind);
  const id = req.params.id;
  const c = await getContainers();
  const { resource: existing } = await c.catalog.item(id, kind).read<Service | AddOn | Closure>();
  if (!existing) throw notFound();
  const now = new Date().toISOString();
  let doc: Service | AddOn | Closure;
  if (kind === 'closure') {
    doc = { ...(await readBody(req, closureInput)), id, kind: 'closure', createdAt: (existing as Closure).createdAt };
  } else if (kind === 'service') {
    doc = { ...(await readBody(req, serviceInput)), id, kind: 'service', updatedAt: now };
  } else {
    doc = { ...(await readBody(req, addOnInput)), id, kind: 'addon', updatedAt: now };
  }
  await c.catalog.item(id, kind).replace(doc);
  invalidateCatalog();
  return doc;
});

route('adminCatalogDelete', ['DELETE'], 'staff/catalog/{kind}/{id}', async (req) => {
  requireAdmin(req);
  const kind = kindOf(req.params.kind);
  const c = await getContainers();
  await c.catalog.item(req.params.id, kind).delete();
  invalidateCatalog();
  return undefined;
});

// ---------- special hours & the chat assistant's message ----------

route('adminSpecialHoursList', ['GET'], 'staff/special-hours', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  const today = todayIn((await getSettings(c)).timeZone);
  return listSpecialHours(c, addDays(today, -30), addDays(today, 400));
});

/** One set of hours per date, so saving a date again replaces it. */
route('adminSpecialHoursPut', ['PUT'], 'staff/special-hours/{date}', async (req) => {
  requireAdmin(req);
  const date = req.params.date;
  if (!isValidDay(date)) throw badRequest('Use a valid date (YYYY-MM-DD).');
  const input = await readBody(req, specialHoursInput);
  const c = await getContainers();
  const doc: SpecialHours = { ...input, id: specialHoursId(date), kind: 'hours', date, updatedAt: new Date().toISOString() };
  await c.catalog.items.upsert(doc);
  invalidateCatalog();
  return doc;
});

route('adminSpecialHoursDelete', ['DELETE'], 'staff/special-hours/{date}', async (req) => {
  requireAdmin(req);
  const date = req.params.date;
  if (!isValidDay(date)) throw badRequest('Use a valid date (YYYY-MM-DD).');
  const c = await getContainers();
  const { resource } = await c.catalog.item(specialHoursId(date), 'hours').read();
  if (resource) await c.catalog.item(specialHoursId(date), 'hours').delete();
  invalidateCatalog();
  return undefined;
});

route('adminNoticePut', ['PUT'], 'staff/notice', async (req) => {
  requireAdmin(req);
  const input = await readBody(req, noticeInput);
  const c = await getContainers();
  if (input.until < todayIn((await getSettings(c)).timeZone)) throw badRequest('Choose today or a later day.');
  const doc: ShopNotice = { ...input, id: 'notice', kind: 'notice', updatedAt: new Date().toISOString() };
  await c.catalog.items.upsert(doc);
  invalidateCatalog();
  return doc;
});

route('adminNoticeDelete', ['DELETE'], 'staff/notice', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  const { resource } = await c.catalog.item('notice', 'notice').read();
  if (resource) await c.catalog.item('notice', 'notice').delete();
  invalidateCatalog();
  return undefined;
});

// ---------- clients (built from bookings: there are no client accounts) ----------

/** The owner's details as they gave them on their most recent booking. */
function ownerFrom(row: ClientRow): OwnerDetails {
  return {
    displayName: row.ownerName,
    phone: row.ownerPhone ?? '',
    email: row.ownerEmail,
    address: row.ownerAddress ?? '',
    emergencyContact: row.ownerEmergencyContact,
    emailReminders: row.emailReminders !== false,
  };
}

function summarise(clientKey: string, rows: ClientRow[]): ClientSummary {
  const byNewest = rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    clientKey,
    owner: ownerFrom(byNewest[0]),
    petNames: [...new Map(byNewest.map((r) => [r.petId, r.petName])).values()],
    noShows: countNoShows(rows),
    firstVisit: byNewest[byNewest.length - 1].createdAt,
  };
}

function groupByClient<T extends { clientKey: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.clientKey, [...(groups.get(row.clientKey) ?? []), row]);
  return groups;
}

route('adminClients', ['GET'], 'staff/clients', async (req): Promise<ClientSummary[]> => {
  requireAdmin(req);
  const c = await getContainers();
  const q = (query(req, 'q') ?? '').toLowerCase();
  const clients = [...groupByClient(await listClientRows(c)).entries()].map(([key, rows]) => summarise(key, rows));
  return clients
    .filter(({ owner, petNames }) => {
      if (!q) return true;
      return [owner.displayName, owner.email, owner.phone, ...petNames].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.owner.displayName.localeCompare(b.owner.displayName))
    .slice(0, 200);
});

route('adminClient', ['GET'], 'staff/clients/{clientKey}', async (req): Promise<ClientDetail> => {
  requireAdmin(req);
  const c = await getContainers();
  const appointments = await queryAll<Appointment>(c.bookings, 'SELECT * FROM c WHERE c.type = "appointment" AND c.clientKey = @k', [
    { name: '@k', value: req.params.clientKey },
  ]);
  if (!appointments.length) throw notFound('Client not found.');
  const visits = [...new Map(appointments.map((a) => [a.id, clean(a)])).values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const byNewest = visits.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Each pet's profile as the owner last sent it.
  const pets = new Map<string, BookedPet>();
  for (const a of byNewest) {
    if (!pets.has(a.petId)) {
      pets.set(a.petId, a.pet ? { ...a.pet, id: a.petId } : { id: a.petId, name: a.petName, species: a.petSpecies, breed: a.petBreed, size: a.petSize, temperament: 'friendly' });
    }
  }
  return {
    ...summarise(req.params.clientKey, visits),
    ownerId: byNewest.find((a) => a.bookedBy === 'owner')?.ownerId ?? byNewest[0].ownerId,
    pets: [...pets.values()],
    appointments: visits,
  };
});

/** Forgive a client's no-shows so online booking opens for them again. The visits keep their status. */
route('adminClientExcuse', ['POST'], 'staff/clients/{clientKey}/excuse-no-shows', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  const noShows = await queryAll<Appointment & { _etag?: string }>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "appointment" AND c.clientKey = @k AND c.status = "no-show"',
    [{ name: '@k', value: req.params.clientKey }],
  );
  for (const a of noShows.filter((x) => !x.noShowExcused)) {
    await saveAppointment(c.bookings, a, { ...clean(a), noShowExcused: true, updatedAt: new Date().toISOString() });
  }
  return { excused: noShows.length };
});

// ---------- reporting ----------

route('adminStats', ['GET'], 'staff/stats', async (req): Promise<AdminStats> => {
  requireAdmin(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const today = todayIn(settings.timeZone);
  const { from, to } = range(req, DateTime.fromISO(today).startOf('month').toISODate()!, 30, 400);
  const [appointments, clientRows] = await Promise.all([listAppointmentsInRange(c, from, to), listClientRows(c)]);
  // A new client is one whose first booking was made in the range.
  const newClients = [...groupByClient(clientRows).entries()]
    .map(([key, rows]) => summarise(key, rows).firstVisit.slice(0, 10))
    .filter((first) => first >= from && first <= to).length;
  const nowIso = new Date().toISOString();
  const count = (status: Appointment['status']) => appointments.filter((a) => a.status === status).length;
  const completed = appointments.filter((a) => a.status === 'completed');
  const kept = appointments.filter((a) => a.status !== 'cancelled');
  const revenue = completed.reduce((sum, a) => sum + (a.finalPrice ?? a.estimatedPrice), 0);
  const noShows = count('no-show');
  const reviews = appointments.filter((a) => a.review).map((a) => a.review!.rating);

  const services = new Map<string, { name: string; count: number; revenue: number }>();
  for (const a of kept) {
    const entry = services.get(a.serviceId) ?? { name: a.serviceName, count: 0, revenue: 0 };
    entry.count++;
    if (a.status === 'completed') entry.revenue += a.finalPrice ?? a.estimatedPrice;
    services.set(a.serviceId, entry);
  }
  const byWeekday = new Map<Weekday, number>(WEEKDAYS.map((d) => [d, 0]));
  const byHour = new Map<number, number>();
  for (const a of kept) {
    byWeekday.set(weekdayOf(a.day), (byWeekday.get(weekdayOf(a.day)) ?? 0) + 1);
    const hour = Number(a.startTime.slice(0, 2));
    byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
  }

  return {
    from,
    to,
    total: appointments.length,
    completed: completed.length,
    cancelled: count('cancelled'),
    lateCancellations: appointments.filter((a) => a.lateCancellation).length,
    noShows,
    noShowRate: completed.length + noShows ? noShows / (completed.length + noShows) : 0,
    upcoming: appointments.filter((a) => ACTIVE_STATUSES.includes(a.status) && a.startUtc > nowIso).length,
    revenue,
    averageTicket: completed.length ? revenue / completed.length : 0,
    rating: reviews.length
      ? { average: Math.round((reviews.reduce((s, r) => s + r, 0) / reviews.length) * 10) / 10, count: reviews.length }
      : undefined,
    newClients,
    topServices: [...services.values()].sort((a, b) => b.count - a.count).slice(0, 6),
    byWeekday: WEEKDAYS.map((weekday) => ({ weekday, count: byWeekday.get(weekday) ?? 0 })),
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, n]) => ({ hour, count: n })),
  };
});

route('adminExport', ['GET'], 'staff/export', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const today = todayIn(settings.timeZone);
  const { from, to } = range(req, addDays(today, -30), 30, 400);
  const rows = await listAppointmentsInRange(c, from, to);
  const header = [
    'day', 'start', 'end', 'status', 'owner', 'email', 'phone', 'pet', 'breed', 'size', 'service', 'add_ons',
    'estimated_price', 'final_price', 'owner_notes', 'staff_notes', 'late_cancellation', 'rating', 'booked_by',
  ];
  const cell = (value: unknown) => {
    const text = value === undefined || value === null ? '' : String(value);
    // Quote everything; neutralise spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((a) =>
    [
      a.day, a.startTime, a.endTime, a.status, a.ownerName, a.ownerEmail, a.ownerPhone, a.petName, a.petBreed, a.petSize,
      a.serviceName, a.addOns.map((x) => x.name).join('; '), a.estimatedPrice, a.finalPrice, a.notes, a.staffNotes,
      a.lateCancellation ? 'yes' : '', a.review?.rating, a.bookedBy,
    ]
      .map(cell)
      .join(','),
  );
  return raw({
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointments-${from}-to-${to}.csv"`,
    },
    body: '﻿' + [header.join(','), ...lines].join('\r\n'),
  });
});
