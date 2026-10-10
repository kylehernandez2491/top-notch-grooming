import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type {
  AddOn,
  AdminStats,
  AgendaResponse,
  Appointment,
  BusinessSettings,
  ClientDetail,
  ClientSummary,
  Closure,
  OwnerProfile,
  Service,
  WaitlistEntry,
  Weekday,
} from '../shared/types';
import { ACTIVE_STATUSES, WEEKDAYS } from '../shared/types';
import { cancelAppointment, rescheduleAppointment } from '../lib/actions';
import { requireAdmin } from '../lib/auth';
import { saveAppointment } from '../lib/booking';
import { clean, getContainers } from '../lib/cosmos';
import { sendEmail, templates } from '../lib/email';
import { badRequest, baseUrl, conflict, created, notFound, query, raw, readBody, route } from '../lib/http';
import {
  findAppointment,
  getProfile,
  getSettings,
  invalidateCatalog,
  listAppointmentsInRange,
  listClosures,
  listOwnerAppointments,
  listPets,
  loadCatalog,
  queryAll,
} from '../lib/repo';
import { addDays, daysBetween, isValidDay, todayIn, weekdayOf } from '../lib/time';
import {
  addOnInput,
  clientInput,
  closureInput,
  reportCardInput,
  rescheduleInput,
  serviceInput,
  settingsInput,
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

route('adminAgenda', ['GET'], 'admin/agenda', async (req): Promise<AgendaResponse> => {
  requireAdmin(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const { from, to } = range(req, todayIn(settings.timeZone), 6, 62);
  const [appointments, waitlist, closures] = await Promise.all([
    listAppointmentsInRange(c, from, to),
    queryAll<WaitlistEntry>(c.bookings, 'SELECT * FROM c WHERE c.type = "waitlist" AND c.day >= @f AND c.day <= @t', [
      { name: '@f', value: from },
      { name: '@t', value: to },
    ]),
    listClosures(c, from, to),
  ]);
  return { from, to, appointments, waitlist: waitlist.map(clean), closures };
});

route('adminAppointmentGet', ['GET'], 'admin/appointments/{id}', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  return clean(await findAppointment(c, req.params.id));
});

route('adminAppointmentStatus', ['POST'], 'admin/appointments/{id}/status', async (req, ctx) => {
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
    updatedAt: now,
    history: [...appointment.history, { at: now, event: input.status, by: 'staff', note: input.note }],
  };
  const saved = await saveAppointment(c.bookings, appointment, next);

  // Keep the owner's no-show tally in step (it drives the online-booking pause).
  const delta = (input.status === 'no-show' ? 1 : 0) - (appointment.status === 'no-show' ? 1 : 0);
  if (delta) {
    const profile = await getProfile(c, appointment.ownerId);
    if (profile) {
      await c.owners.items.upsert<OwnerProfile>({
        ...clean(profile),
        noShowCount: Math.max(0, profile.noShowCount + delta),
        updatedAt: now,
      });
    }
  }
  return saved;
});

route('adminAppointmentNotes', ['PUT'], 'admin/appointments/{id}/staff-notes', async (req) => {
  requireAdmin(req);
  const { staffNotes } = await readBody(req, staffNotesInput);
  const c = await getContainers();
  const appointment = await findAppointment(c, req.params.id);
  return saveAppointment(c.bookings, appointment, { ...clean(appointment), staffNotes, updatedAt: new Date().toISOString() });
});

route('adminReportCard', ['PUT'], 'admin/appointments/{id}/report-card', async (req, ctx) => {
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

route('adminReschedule', ['POST'], 'admin/appointments/{id}/reschedule', async (req, ctx) => {
  requireAdmin(req);
  const target = await readBody(req, rescheduleInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([findAppointment(c, req.params.id), getSettings(c)]);
  return rescheduleAppointment(c, ctx, req, appointment, settings, target, 'staff');
});

// ---------- settings & catalog ----------

route('adminSettingsGet', ['GET'], 'admin/settings', async (req) => {
  requireAdmin(req);
  const c = await getContainers();
  invalidateCatalog();
  return getSettings(c);
});

route('adminSettingsPut', ['PUT'], 'admin/settings', async (req) => {
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

route('adminCatalogList', ['GET'], 'admin/catalog/{kind}', async (req) => {
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

route('adminCatalogCreate', ['POST'], 'admin/catalog/{kind}', async (req) => {
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

route('adminCatalogUpdate', ['PUT'], 'admin/catalog/{kind}/{id}', async (req) => {
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

route('adminCatalogDelete', ['DELETE'], 'admin/catalog/{kind}/{id}', async (req) => {
  requireAdmin(req);
  const kind = kindOf(req.params.kind);
  const c = await getContainers();
  await c.catalog.item(req.params.id, kind).delete();
  invalidateCatalog();
  return undefined;
});

// ---------- clients ----------

route('adminClients', ['GET'], 'admin/clients', async (req): Promise<ClientSummary[]> => {
  requireAdmin(req);
  const c = await getContainers();
  const q = (query(req, 'q') ?? '').toLowerCase();
  const [profiles, pets] = await Promise.all([
    queryAll<OwnerProfile>(c.owners, 'SELECT * FROM c WHERE c.type = "profile"'),
    queryAll<{ ownerId: string; name: string }>(
      c.owners,
      'SELECT c.ownerId, c.name FROM c WHERE c.type = "pet" AND (NOT IS_DEFINED(c.archived) OR c.archived = false)',
    ),
  ]);
  const petsByOwner = new Map<string, string[]>();
  for (const p of pets) petsByOwner.set(p.ownerId, [...(petsByOwner.get(p.ownerId) ?? []), p.name.toLowerCase()]);
  return profiles
    .map(clean)
    .filter((p) => {
      if (!q) return true;
      const haystack = [p.displayName, p.email, p.phone ?? '', ...(petsByOwner.get(p.ownerId) ?? [])].join(' ').toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, 200)
    .map((profile) => ({ profile, petCount: petsByOwner.get(profile.ownerId)?.length ?? 0 }));
});

route('adminClient', ['GET'], 'admin/clients/{ownerId}', async (req): Promise<ClientDetail> => {
  requireAdmin(req);
  const c = await getContainers();
  const profile = await getProfile(c, req.params.ownerId);
  if (!profile) throw notFound('Client not found.');
  const [pets, appointments] = await Promise.all([listPets(c, profile.ownerId), listOwnerAppointments(c, profile.ownerId)]);
  return { profile: clean(profile), pets, appointments };
});

route('adminClientUpdate', ['PATCH'], 'admin/clients/{ownerId}', async (req) => {
  requireAdmin(req);
  const { noShowCount } = await readBody(req, clientInput);
  const c = await getContainers();
  const profile = await getProfile(c, req.params.ownerId);
  if (!profile) throw notFound('Client not found.');
  const next = { ...clean(profile), noShowCount, updatedAt: new Date().toISOString() };
  await c.owners.items.upsert(next);
  return next;
});

// ---------- reporting ----------

route('adminStats', ['GET'], 'admin/stats', async (req): Promise<AdminStats> => {
  requireAdmin(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const today = todayIn(settings.timeZone);
  const { from, to } = range(req, DateTime.fromISO(today).startOf('month').toISODate()!, 30, 400);
  const [appointments, newClients] = await Promise.all([
    listAppointmentsInRange(c, from, to),
    queryAll<number>(c.owners, 'SELECT VALUE COUNT(1) FROM c WHERE c.type = "profile" AND c.createdAt >= @f AND c.createdAt < @t', [
      { name: '@f', value: from },
      { name: '@t', value: addDays(to, 1) },
    ]),
  ]);
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
    newClients: newClients[0] ?? 0,
    topServices: [...services.values()].sort((a, b) => b.count - a.count).slice(0, 6),
    byWeekday: WEEKDAYS.map((weekday) => ({ weekday, count: byWeekday.get(weekday) ?? 0 })),
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, n]) => ({ hour, count: n })),
  };
});

route('adminExport', ['GET'], 'admin/export', async (req) => {
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
