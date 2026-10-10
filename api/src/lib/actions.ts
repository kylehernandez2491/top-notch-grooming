import type { HttpRequest, InvocationContext } from '@azure/functions';
import { DateTime } from 'luxon';
import type { Appointment, BusinessSettings } from '../shared/types';
import { ACTIVE_STATUSES } from '../shared/types';
import { serviceDuration } from '../shared/format';
import { ClientPrincipal, isAdmin } from './auth';
import { assertSlotOffered, isLateChange, locksFor, moveAppointment, releaseAppointment } from './booking';
import { clean, Containers } from './cosmos';
import { templates, sendEmail } from './email';
import { baseUrl, conflict, forbidden, HttpError } from './http';
import { findAppointment, getAddOns, getService, listWaitlist } from './repo';
import { zonedUtcIso } from './time';
import { addMinutes } from '../shared/format';

type WithEtag<T> = T & { _etag?: string };

export async function loadAccessibleAppointment(c: Containers, principal: ClientPrincipal, id: string): Promise<WithEtag<Appointment>> {
  const appointment = await findAppointment(c, id);
  if (appointment.ownerId !== principal.userId && !isAdmin(principal)) throw forbidden();
  return appointment;
}

function stripSystem(a: WithEtag<Appointment>): Appointment {
  return clean(a);
}

export async function cancelAppointment(
  c: Containers,
  ctx: InvocationContext,
  req: HttpRequest,
  appointment: WithEtag<Appointment>,
  settings: BusinessSettings,
  by: 'owner' | 'staff',
  reason?: string,
): Promise<Appointment> {
  if (!ACTIVE_STATUSES.includes(appointment.status)) {
    throw conflict(`This appointment is already ${appointment.status}.`, 'not_active');
  }
  if (by === 'owner' && DateTime.fromISO(appointment.startUtc) < DateTime.now()) {
    throw conflict(`This appointment has already started. Please call us at ${settings.phone}.`, 'started');
  }
  const now = new Date().toISOString();
  const late = by === 'owner' && isLateChange(appointment, settings);
  const next: Appointment = {
    ...stripSystem(appointment),
    status: 'cancelled',
    locks: [],
    cancelReason: reason,
    lateCancellation: late || undefined,
    updatedAt: now,
    history: [...appointment.history, { at: now, event: 'cancelled', by, note: late ? `Late cancellation. ${reason ?? ''}`.trim() : reason }],
  };
  await releaseAppointment(c.bookings, appointment, next, settings.timeZone);

  const appUrl = baseUrl(req);
  await Promise.all([
    sendEmail(ctx, templates.cancelled(next, settings, appUrl, by === 'staff')),
    by === 'owner' ? sendEmail(ctx, templates.staffNotice('cancelled', next, settings, appUrl)) : Promise.resolve(),
    notifyWaitlist(c, ctx, req, settings, appointment.day, appointment.ownerId),
  ]);
  return next;
}

/** Emails everyone waiting on a day when a slot frees up (each entry is notified once). */
export async function notifyWaitlist(
  c: Containers,
  ctx: InvocationContext,
  req: HttpRequest,
  settings: BusinessSettings,
  day: string,
  exceptOwnerId?: string,
) {
  try {
    const entries = (await listWaitlist(c, day)).filter((w) => !w.notifiedAt && w.ownerId !== exceptOwnerId);
    const appUrl = baseUrl(req);
    for (const entry of entries) {
      await sendEmail(ctx, templates.waitlistOpening(entry, settings, appUrl));
      await c.bookings.item(entry.id, day).replace({ ...clean(entry), notifiedAt: new Date().toISOString(), ttl: entry.ttl });
    }
  } catch (err) {
    ctx.warn('Waitlist notification failed', err);
  }
}

export async function rescheduleAppointment(
  c: Containers,
  ctx: InvocationContext,
  req: HttpRequest,
  appointment: WithEtag<Appointment>,
  settings: BusinessSettings,
  target: { day: string; time: string },
  by: 'owner' | 'staff',
): Promise<Appointment> {
  if (appointment.status !== 'booked') throw conflict('Only upcoming, not-yet-arrived appointments can be moved.', 'not_movable');
  if (by === 'owner' && DateTime.fromISO(appointment.startUtc) < DateTime.now()) {
    throw conflict(`This appointment has already started. Please call us at ${settings.phone}.`, 'started');
  }
  if (target.day === appointment.day && target.time === appointment.startTime) return clean(appointment);

  // Recompute duration from the current menu so a reschedule can't lock in a stale, shorter time.
  let duration = appointment.durationMinutes;
  try {
    const service = await getService(c, appointment.serviceId);
    const addOns = await getAddOns(c, appointment.addOns.map((a) => a.id));
    duration = Math.max(duration, serviceDuration(service, addOns, appointment.petSize));
  } catch (err) {
    if (!(err instanceof HttpError)) throw err; // service retired: keep the booked duration
  }

  await assertSlotOffered(c, settings, target.day, target.time, duration, by === 'staff', appointment);

  const now = new Date().toISOString();
  const endTime = addMinutes(target.time, duration);
  const late = by === 'owner' && isLateChange(appointment, settings);
  const moved: Appointment = {
    ...clean(appointment),
    day: target.day,
    startTime: target.time,
    endTime,
    durationMinutes: duration,
    startUtc: zonedUtcIso(target.day, target.time, settings.timeZone),
    endUtc: zonedUtcIso(target.day, endTime, settings.timeZone),
    locks: locksFor({ startTime: target.time, durationMinutes: duration }, settings.bufferMinutes),
    reminderSentAt: undefined,
    updatedAt: now,
    history: [
      ...appointment.history,
      {
        at: now,
        event: 'rescheduled',
        by,
        note: `From ${appointment.day} ${appointment.startTime}${late ? ' (late change)' : ''}`,
      },
    ],
  };

  const result = await moveAppointment(c.bookings, appointment, moved, settings, by === 'owner');
  if (!result.ok) throw conflict('Someone just booked that time — please pick another.', 'slot_taken');

  const appUrl = baseUrl(req);
  await Promise.all([
    sendEmail(ctx, templates.rescheduled(moved, settings, appUrl)),
    by === 'owner' ? sendEmail(ctx, templates.staffNotice('rescheduled', moved, settings, appUrl)) : Promise.resolve(),
    notifyWaitlist(c, ctx, req, settings, appointment.day, appointment.ownerId),
  ]);
  return moved;
}
