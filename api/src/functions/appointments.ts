import type { Appointment, BookingResult, OwnerProfile } from '../shared/types';
import { buildIcs } from '../shared/ics';
import { cancelAppointment, loadAccessibleAppointment, rescheduleAppointment } from '../lib/actions';
import { isAdmin, requireUser } from '../lib/auth';
import { book, saveAppointment } from '../lib/booking';
import { clean, getContainers } from '../lib/cosmos';
import { sendEmail, templates } from '../lib/email';
import { baseUrl, conflict, created, forbidden, notFound, raw, readBody, route } from '../lib/http';
import { ensureProfile, getPet, getProfile, getSettings, invalidateCatalog, listOwnerAppointments } from '../lib/repo';
import { bookingInput, cancelInput, notesInput, rescheduleInput, reviewInput } from '../lib/validation';

route('appointmentsList', ['GET'], 'appointments', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  return listOwnerAppointments(c, principal.userId);
});

/** Book (owners), or book on behalf of a client (staff, with ownerId). Supports recurring series. */
route('appointmentsCreate', ['POST'], 'appointments', async (req, ctx) => {
  const principal = requireUser(req);
  const input = await readBody(req, bookingInput);
  const c = await getContainers();
  const settings = await getSettings(c);

  const staff = !!input.ownerId && input.ownerId !== principal.userId;
  if (staff && !isAdmin(principal)) throw forbidden('Only staff can book for another client.');

  let profile: OwnerProfile;
  if (staff) {
    const found = await getProfile(c, input.ownerId!);
    if (!found) throw notFound('Client not found.');
    profile = clean(found);
  } else {
    profile = await ensureProfile(c, principal);
    if (!profile.onboarded) throw conflict('Please finish your profile before booking.', 'not_onboarded');
  }
  const pet = clean(await getPet(c, profile.ownerId, input.petId));

  const result: BookingResult = await book(c, {
    request: input,
    profile,
    pet,
    settings,
    actor: { kind: staff ? 'staff' : 'owner' },
  });

  const appUrl = baseUrl(req);
  for (const appointment of result.appointments) {
    await sendEmail(ctx, templates.confirmed(appointment, settings, appUrl));
  }
  if (!staff && result.appointments[0]) {
    await sendEmail(ctx, templates.staffNotice('booked', result.appointments[0], settings, appUrl));
  }
  return created(result);
});

route('appointmentsGet', ['GET'], 'appointments/{id}', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  return clean(await loadAccessibleAppointment(c, principal, req.params.id));
});

/** Calendar file served with text/calendar so iOS/Android open "Add to calendar" directly. */
route('appointmentsIcs', ['GET'], 'appointments/{id}/ics', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([loadAccessibleAppointment(c, principal, req.params.id), getSettings(c)]);
  const appUrl = baseUrl(req);
  const ics = buildIcs({
    uid: `${appointment.id}@topnotchgrooming`,
    startUtc: appointment.startUtc,
    endUtc: appointment.endUtc,
    summary: `${appointment.petName}: ${appointment.serviceName} at ${settings.shopName}`,
    description: `Manage your booking: ${appUrl}/appointments/${appointment.id}`,
    location: settings.address,
    url: `${appUrl}/appointments/${appointment.id}`,
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
  const principal = requireUser(req);
  const { reason } = await readBody(req, cancelInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([loadAccessibleAppointment(c, principal, req.params.id), getSettings(c)]);
  if (appointment.ownerId !== principal.userId) throw forbidden('Use the staff portal to cancel client bookings.');
  return cancelAppointment(c, ctx, req, appointment, settings, 'owner', reason);
});

route('appointmentsReschedule', ['POST'], 'appointments/{id}/reschedule', async (req, ctx) => {
  const principal = requireUser(req);
  const target = await readBody(req, rescheduleInput);
  const c = await getContainers();
  const [appointment, settings] = await Promise.all([loadAccessibleAppointment(c, principal, req.params.id), getSettings(c)]);
  if (appointment.ownerId !== principal.userId) throw forbidden('Use the staff portal to move client bookings.');
  return rescheduleAppointment(c, ctx, req, appointment, settings, target, 'owner');
});

route('appointmentsNotes', ['PUT'], 'appointments/{id}/notes', async (req) => {
  const principal = requireUser(req);
  const { notes } = await readBody(req, notesInput);
  const c = await getContainers();
  const appointment = await loadAccessibleAppointment(c, principal, req.params.id);
  if (appointment.ownerId !== principal.userId) throw forbidden();
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
  const principal = requireUser(req);
  const review = await readBody(req, reviewInput);
  const c = await getContainers();
  const appointment = await loadAccessibleAppointment(c, principal, req.params.id);
  if (appointment.ownerId !== principal.userId) throw forbidden();
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
