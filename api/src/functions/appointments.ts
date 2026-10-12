import type { Appointment, BookingResult } from '../shared/types';
import { buildIcs } from '../shared/ics';
import { cancelAppointment, loadOwnedAppointment, rescheduleAppointment } from '../lib/actions';
import { book, saveAppointment } from '../lib/booking';
import { clean, getContainers } from '../lib/cosmos';
import { deviceOwnerId, ensureDevice, forgetDeviceCookie } from '../lib/device';
import { manageUrl, sendEmail, templates } from '../lib/email';
import { baseUrl, conflict, raw, readBody, route } from '../lib/http';
import { getSettings, invalidateCatalog, listOwnerAppointments } from '../lib/repo';
import { bookingInput, cancelInput, notesInput, rescheduleInput, reviewInput } from '../lib/validation';

/** This device's bookings. A device that has never booked has none. */
route('appointmentsList', ['GET'], 'appointments', async (req) => {
  const ownerId = deviceOwnerId(req);
  if (!ownerId) return [];
  const c = await getContainers();
  return listOwnerAppointments(c, ownerId);
});

/** Book online. The owner's details and pet come from their device; supports recurring series. */
route('appointmentsCreate', ['POST'], 'appointments', async (req, ctx) => {
  const input = await readBody(req, bookingInput);
  const device = ensureDevice(req);
  const c = await getContainers();
  const settings = await getSettings(c);

  const result: BookingResult = await book(c, { request: input, ownerId: device.ownerId, settings, actor: { kind: 'owner' } });

  const appUrl = baseUrl(req);
  for (const appointment of result.appointments) {
    await sendEmail(ctx, templates.confirmed(appointment, settings, appUrl));
  }
  if (result.appointments[0]) {
    await sendEmail(ctx, templates.staffNotice('booked', result.appointments[0], settings, appUrl));
  }
  return raw({ status: 201, jsonBody: result, cookies: [device.cookie] });
});

/** Owner (device or ?t= link) or staff. */
route('appointmentsGet', ['GET'], 'appointments/{id}', async (req) => {
  const c = await getContainers();
  return clean(await loadOwnedAppointment(c, req, req.params.id, true));
});

/** Calendar file served with text/calendar so iOS/Android open "Add to calendar" directly. */
route('appointmentsIcs', ['GET'], 'appointments/{id}/ics', async (req) => {
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([loadOwnedAppointment(c, req, req.params.id, true), getSettings(c)]);
  const appUrl = baseUrl(req);
  const ics = buildIcs({
    uid: `${appointment.id}@topnotchgrooming`,
    startUtc: appointment.startUtc,
    endUtc: appointment.endUtc,
    summary: `${appointment.petName}: ${appointment.serviceName} at ${settings.shopName}`,
    description: `Manage your booking: ${manageUrl(appointment, appUrl)}`,
    location: settings.address,
    url: manageUrl(appointment, appUrl),
    method: appointment.status === 'cancelled' ? 'CANCEL' : 'PUBLISH',
  });
  return raw({
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="grooming-${appointment.day}.ics"`,
    },
    body: ics,
  });
});

route('appointmentsCancel', ['POST'], 'appointments/{id}/cancel', async (req, ctx) => {
  const { reason } = await readBody(req, cancelInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([loadOwnedAppointment(c, req, req.params.id), getSettings(c)]);
  return cancelAppointment(c, ctx, req, appointment, settings, 'owner', reason);
});

route('appointmentsReschedule', ['POST'], 'appointments/{id}/reschedule', async (req, ctx) => {
  const target = await readBody(req, rescheduleInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([loadOwnedAppointment(c, req, req.params.id), getSettings(c)]);
  return rescheduleAppointment(c, ctx, req, appointment, settings, target, 'owner');
});

route('appointmentsNotes', ['PUT'], 'appointments/{id}/notes', async (req) => {
  const { notes } = await readBody(req, notesInput);
  const c = await getContainers();
  const appointment = await loadOwnedAppointment(c, req, req.params.id);
  if (appointment.status !== 'booked') throw conflict('Notes can only be changed before drop-off.', 'not_editable');
  const now = new Date().toISOString();
  const next: Appointment = {
    ...clean(appointment),
    notes,
    updatedAt: now,
    history: [...appointment.history, { at: now, event: 'notes', by: 'owner' }],
  };
  return saveAppointment(c.bookings, appointment, next);
});

route('appointmentsReview', ['POST'], 'appointments/{id}/review', async (req) => {
  const review = await readBody(req, reviewInput);
  const c = await getContainers();
  const appointment = await loadOwnedAppointment(c, req, req.params.id);
  if (appointment.status !== 'completed') throw conflict('You can review a visit once it is completed.', 'not_completed');
  if (appointment.review) throw conflict('You already reviewed this visit — thank you!', 'already_reviewed');
  const next: Appointment = {
    ...clean(appointment),
    review: { ...review, createdAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
  const saved = await saveAppointment(c.bookings, appointment, next);
  invalidateCatalog(); // refresh the public rating summary
  return saved;
});

/** "Forget me on this device": drops the device key. Bookings stay; their email links still work. */
route('deviceForget', ['POST'], 'device/forget', async () => raw({ status: 204, cookies: [forgetDeviceCookie()] }));
