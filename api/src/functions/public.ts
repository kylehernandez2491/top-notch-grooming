import type { AvailabilityResponse, PetSize, PublicCatalog } from '../shared/types';
import { PET_SIZES } from '../shared/types';
import { serviceDuration } from '../shared/format';
import { ownsAppointment } from '../lib/actions';
import { getPrincipal, isAdmin } from '../lib/auth';
import { buildLockMap, rangeAvailability } from '../lib/availability';
import { getContainers } from '../lib/cosmos';
import { badRequest, forbidden, query, route } from '../lib/http';
import { findAppointment, getAddOns, getService, listClosures, loadCatalog, loadCounts, loadLocks, ratingSummary } from '../lib/repo';
import { addDays, daysBetween, isValidDay, nowIn, todayIn } from '../lib/time';

const MAX_RANGE_DAYS = 93;

/** Shop info + menu for the landing page and booking wizard. Anonymous. */
route(
  'publicCatalog',
  ['GET'],
  'public/catalog',
  async (): Promise<PublicCatalog> => {
    const c = await getContainers();
    const { settings, services, addOns } = await loadCatalog(c);
    const today = todayIn(settings.timeZone);
    const [closures, rating] = await Promise.all([
      listClosures(c, today, addDays(today, settings.bookingHorizonDays)),
      ratingSummary(c),
    ]);
    return {
      settings,
      services: services.filter((s) => s.active),
      addOns: addOns.filter((a) => a.active),
      closures,
      rating,
      today,
    };
  },
  { cacheSeconds: 30 },
);

/**
 * Availability calendar data. Anonymous, so anyone can browse open times.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD&serviceId=full-groom&size=medium&addOns=teeth,facial
 * Optional: &exclude=<appointmentId> (owner's device, its &t= manage token, or staff; treats that
 * appointment's own time as free while rescheduling) and &staff=1 (staff only: ignore notice/horizon/daily cap).
 */
route('publicAvailability', ['GET'], 'public/availability', async (req): Promise<AvailabilityResponse> => {
  const c = await getContainers();
  const { settings } = await loadCatalog(c);
  const today = todayIn(settings.timeZone);
  const from = query(req, 'from') ?? today;
  const to = query(req, 'to') ?? addDays(from, 41);
  if (!isValidDay(from) || !isValidDay(to) || to < from) throw badRequest('Use a valid from/to range (YYYY-MM-DD).');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw badRequest(`Ask for at most ${MAX_RANGE_DAYS} days at a time.`);

  const serviceId = query(req, 'serviceId');
  if (!serviceId) throw badRequest('serviceId is required.');
  const size = (query(req, 'size') ?? 'medium') as PetSize;
  if (!PET_SIZES.includes(size)) throw badRequest('Unknown breed size.');
  const service = await getService(c, serviceId);
  const addOnIds = (query(req, 'addOns') ?? '').split(',').filter(Boolean);
  const addOns = await getAddOns(c, addOnIds);
  const durationMinutes = serviceDuration(service, addOns, size);

  const principal = getPrincipal(req);
  const staff = query(req, 'staff') === '1';
  if (staff && !isAdmin(principal)) throw forbidden('Staff mode is for staff only.');

  let ignore: { id: string; day: string } | undefined;
  const exclude = query(req, 'exclude');
  if (exclude) {
    const appointment = await findAppointment(c, exclude);
    if (!ownsAppointment(req, appointment) && !isAdmin(principal)) throw forbidden();
    ignore = { id: appointment.id, day: appointment.day };
  }

  const [locks, counts, closures] = await Promise.all([loadLocks(c, from, to), loadCounts(c, from, to), listClosures(c, from, to)]);
  if (ignore && counts.has(ignore.day)) counts.set(ignore.day, Math.max(0, counts.get(ignore.day)! - 1));

  const days = rangeAvailability(from, to, {
    settings,
    closures,
    locked: buildLockMap(locks, ignore?.id),
    counts,
    durationMinutes,
    now: nowIn(settings.timeZone),
    staff,
  });
  const first = days.find((d) => d.slots.length);
  return {
    from,
    to,
    timeZone: settings.timeZone,
    durationMinutes,
    days,
    nextAvailable: first ? { day: first.day, time: first.slots[0].time } : undefined,
  };
});

/** Liveness + Cosmos connectivity probe for uptime monitors. */
route('health', ['GET'], 'health', async () => {
  const c = await getContainers();
  await c.catalog.item('settings', 'settings').read();
  return { ok: true, time: new Date().toISOString(), version: process.env.APP_VERSION ?? 'dev' };
});
