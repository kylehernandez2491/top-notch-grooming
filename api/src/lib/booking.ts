import type { Container, JSONObject, OperationInput } from '@azure/cosmos';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type {
  AddOn,
  Appointment,
  BookedPet,
  BookingRequest,
  BookingResult,
  BusinessSettings,
  OwnerDetails,
  PetDetails,
  Service,
  StatusEvent,
} from '../shared/types';
import { ACTIVE_STATUSES } from '../shared/types';
import { addMinutes, addOnApplies, serviceDuration, servicePrice, servicePriceMax, TEMPERAMENT_LABELS, toMinutes } from '../shared/format';
import { buildLockMap, dayAvailability, lockBlocks, lockId } from './availability';
import { Containers } from './cosmos';
import { clientKeyFor, newManageToken } from './device';
import { conflict, forbidden, HttpError } from './http';
import { getAddOns, getService, listClientAppointments, listClosures, listSpecialHours, loadCounts, loadLocks } from './repo';
import { addDays, nowIn, ttlAfterDay, zonedUtcIso } from './time';

type WithEtag<T> = T & { _etag?: string };

interface Summary {
  id: 'summary';
  type: 'summary';
  day: string;
  count: number;
  ttl?: number;
  _etag?: string;
}

export interface BatchOutcome {
  ok: boolean;
  status: number;
  failedIndex: number;
}

/**
 * Runs an atomic transactional batch in one logical partition. A failed batch surfaces either as a
 * thrown error (HTTP status of the failing operation) or as per-operation status codes; both are
 * normalised here. 424 = "failed because a sibling operation failed".
 */
export async function runBatch(container: Container, operations: OperationInput[], partitionKey: string): Promise<BatchOutcome> {
  const inspect = (statuses: number[], fallback: number): BatchOutcome => {
    const failedIndex = statuses.findIndex((s) => s >= 400 && s !== 424);
    const status = failedIndex >= 0 ? statuses[failedIndex] : fallback;
    return { ok: status < 400, status, failedIndex };
  };
  try {
    const response = await container.items.batch(operations, partitionKey);
    return inspect((response.result ?? []).map((r) => r.statusCode), response.code ?? 200);
  } catch (err) {
    const cause = ((err as { cause?: unknown }).cause ?? err) as { code?: number; body?: unknown };
    const body = Array.isArray(cause.body) ? (cause.body as { statusCode?: number }[]) : [];
    const outcome = inspect(body.map((r) => r.statusCode ?? 0), typeof cause.code === 'number' ? cause.code : 500);
    if ([404, 409, 412].includes(outcome.status)) return outcome;
    throw err;
  }
}

const asJson = (doc: object) => doc as unknown as JSONObject;

async function readSummary(bookings: Container, day: string): Promise<Summary | undefined> {
  const { resource } = await bookings.item('summary', day).read<Summary>();
  return resource;
}

function summaryOp(summary: Summary | undefined, day: string, delta: number, timeZone: string): OperationInput {
  if (summary) {
    const { _etag, ...rest } = summary;
    return {
      operationType: 'Replace',
      id: 'summary',
      ifMatch: _etag,
      resourceBody: asJson({ ...stripSystem(rest), count: Math.max(0, summary.count + delta) }),
    };
  }
  return {
    operationType: 'Create',
    resourceBody: asJson({ id: 'summary', type: 'summary', day, count: Math.max(0, delta), ttl: ttlAfterDay(day, timeZone) }),
  };
}

function stripSystem<T extends object>(doc: T): T {
  const copy = { ...(doc as Record<string, unknown>) };
  for (const key of Object.keys(copy)) if (key.startsWith('_')) delete copy[key];
  return copy as T;
}

function lockOps(day: string, ids: string[], appointmentId: string, timeZone: string): OperationInput[] {
  const ttl = ttlAfterDay(day, timeZone);
  return ids.map((id) => ({
    operationType: 'Create' as const,
    resourceBody: asJson({ id, type: 'lock', day, appointmentId, ttl }),
  }));
}

export function locksFor(appointment: Pick<Appointment, 'startTime' | 'durationMinutes'>, bufferMinutes: number): string[] {
  return lockBlocks(toMinutes(appointment.startTime), appointment.durationMinutes, bufferMinutes).map(lockId);
}

export type InsertResult = { ok: true } | { ok: false; reason: 'conflict' | 'full' | 'busy' };

/** Creates the appointment, its slot locks and bumps the day counter in ONE transaction. */
export async function insertAppointment(
  bookings: Container,
  appointment: Appointment,
  settings: BusinessSettings,
  enforceDailyCap: boolean,
): Promise<InsertResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const summary = await readSummary(bookings, appointment.day);
    if (enforceDailyCap && settings.maxAppointmentsPerDay > 0 && (summary?.count ?? 0) >= settings.maxAppointmentsPerDay) {
      return { ok: false, reason: 'full' };
    }
    const operations: OperationInput[] = [
      summaryOp(summary, appointment.day, 1, settings.timeZone),
      { operationType: 'Create', resourceBody: asJson(appointment) },
      ...lockOps(appointment.day, appointment.locks, appointment.id, settings.timeZone),
    ];
    const outcome = await runBatch(bookings, operations, appointment.day);
    if (outcome.ok) return { ok: true };
    // Someone else updated the day counter at the same moment — re-read and try again.
    if (outcome.failedIndex === 0 && (outcome.status === 412 || outcome.status === 409)) continue;
    if (outcome.status === 409) return { ok: false, reason: 'conflict' };
    throw new HttpError(500, `Booking transaction failed with status ${outcome.status}`);
  }
  return { ok: false, reason: 'busy' };
}

/**
 * Releases an appointment's time: replaces (or deletes) the appointment document, deletes its locks
 * and decrements the day counter atomically. The ETag guards against two people acting at once.
 */
export async function releaseAppointment(
  bookings: Container,
  current: WithEtag<Appointment>,
  next: Appointment | null,
  timeZone: string,
): Promise<void> {
  let lockIds = [...current.locks];
  for (let attempt = 0; attempt < 5; attempt++) {
    const summary = await readSummary(bookings, current.day);
    const operations: OperationInput[] = [];
    if (summary) operations.push(summaryOp(summary, current.day, -1, timeZone));
    operations.push(
      next
        ? { operationType: 'Replace', id: current.id, ifMatch: current._etag, resourceBody: asJson(next) }
        : { operationType: 'Delete', id: current.id },
    );
    operations.push(...lockIds.map((id) => ({ operationType: 'Delete' as const, id })));
    const outcome = await runBatch(bookings, operations, current.day);
    if (outcome.ok) return;
    const appointmentIndex = summary ? 1 : 0;
    if (summary && outcome.failedIndex === 0 && outcome.status === 412) continue;
    if (outcome.failedIndex === appointmentIndex && outcome.status === 412) {
      throw conflict('This appointment was just changed by someone else. Please refresh and try again.', 'stale');
    }
    if (outcome.status === 404 && outcome.failedIndex > appointmentIndex) {
      lockIds = []; // locks already expired (old appointment) — release without them
      continue;
    }
    throw new HttpError(500, `Release transaction failed with status ${outcome.status}`);
  }
  throw new HttpError(503, 'We could not update that appointment right now. Please try again.');
}

/** Replaces the appointment document only (status changes, notes, report cards, reviews). */
export async function saveAppointment(bookings: Container, current: WithEtag<Appointment>, next: Appointment): Promise<Appointment> {
  try {
    const { resource } = await bookings
      .item(current.id, current.day)
      .replace<Appointment>(next, current._etag ? { accessCondition: { type: 'IfMatch', condition: current._etag } } : {});
    return stripSystem(resource ?? next);
  } catch (err) {
    if ((err as { code?: number }).code === 412) {
      throw conflict('This appointment was just changed by someone else. Please refresh and try again.', 'stale');
    }
    throw err;
  }
}

/** Moves an appointment to a new time. Same day = one batch; new day = create there, then release here. */
export async function moveAppointment(
  bookings: Container,
  current: WithEtag<Appointment>,
  moved: Appointment,
  settings: BusinessSettings,
  enforceDailyCap: boolean,
): Promise<InsertResult> {
  if (moved.day === current.day) {
    const oldLocks = new Set(current.locks);
    const newLocks = new Set(moved.locks);
    const operations: OperationInput[] = [
      { operationType: 'Replace', id: current.id, ifMatch: current._etag, resourceBody: asJson(moved) },
      ...current.locks.filter((l) => !newLocks.has(l)).map((id) => ({ operationType: 'Delete' as const, id })),
      ...lockOps(moved.day, moved.locks.filter((l) => !oldLocks.has(l)), moved.id, settings.timeZone),
    ];
    const outcome = await runBatch(bookings, operations, moved.day);
    if (outcome.ok) return { ok: true };
    if (outcome.failedIndex === 0 && outcome.status === 412) {
      throw conflict('This appointment was just changed. Please refresh and try again.', 'stale');
    }
    if (outcome.status === 409) return { ok: false, reason: 'conflict' };
    throw new HttpError(500, `Reschedule transaction failed with status ${outcome.status}`);
  }

  const inserted = await insertAppointment(bookings, moved, settings, enforceDailyCap);
  if (!inserted.ok) return inserted;
  try {
    await releaseAppointment(bookings, current, null, settings.timeZone);
  } catch (err) {
    // The new booking stands; reads prefer the newest copy. Surface in logs for follow-up.
    console.error(`Reschedule of ${current.id}: new slot booked but old slot release failed`, err);
  }
  return { ok: true };
}

// ---------- booking orchestration ----------

export interface BookingActor {
  kind: 'owner' | 'staff';
}

export interface BookingInput {
  request: BookingRequest;
  /** The booking device (hashed key), or the client's last device when staff book for them. */
  ownerId: string;
  settings: BusinessSettings;
  actor: BookingActor;
}

export function petAlerts(pet: PetDetails): string[] {
  const alerts: string[] = [];
  if (pet.temperament === 'nervous' || pet.temperament === 'reactive' || pet.temperament === 'senior') {
    alerts.push(TEMPERAMENT_LABELS[pet.temperament]);
  }
  if (pet.behaviorNotes) alerts.push(`Behavior: ${pet.behaviorNotes}`);
  return alerts;
}

export function buildAppointment(args: {
  id?: string;
  day: string;
  time: string;
  pet: BookedPet;
  owner: OwnerDetails;
  ownerId: string;
  service: Service;
  addOns: AddOn[];
  settings: BusinessSettings;
  notes?: string;
  seriesId?: string;
  bookedBy: 'owner' | 'staff';
}): Appointment {
  const { pet, owner, service, addOns, settings } = args;
  const { id: petId, ...petDetails } = pet;
  const duration = serviceDuration(service, addOns, pet.size);
  const price = servicePrice(service, addOns, pet.size);
  const priceMax = servicePriceMax(service, addOns, pet.size);
  const now = new Date().toISOString();
  const endTime = addMinutes(args.time, duration);
  const created: StatusEvent = { at: now, event: 'created', by: args.bookedBy };
  return {
    id: args.id ?? randomUUID(),
    type: 'appointment',
    day: args.day,
    startTime: args.time,
    endTime,
    startUtc: zonedUtcIso(args.day, args.time, settings.timeZone),
    endUtc: zonedUtcIso(args.day, endTime, settings.timeZone),
    ownerId: args.ownerId,
    clientKey: clientKeyFor(owner.phone),
    ownerName: owner.displayName,
    ownerEmail: owner.email,
    ownerPhone: owner.phone,
    ownerAddress: owner.address,
    ownerEmergencyContact: owner.emergencyContact,
    emailReminders: owner.emailReminders,
    petId,
    petName: pet.name,
    petSpecies: pet.species,
    petSize: pet.size,
    petBreed: pet.breed,
    petAlerts: petAlerts(pet),
    pet: petDetails,
    manageToken: newManageToken(),
    serviceId: service.id,
    serviceName: service.name,
    addOns: addOns.map((a) => ({ id: a.id, name: a.name, price: a.price, durationMinutes: a.durationMinutes })),
    durationMinutes: duration,
    estimatedPrice: price,
    // Only set when the price depends on coat volume, so fixed-price bookings stay unchanged.
    estimatedPriceMax: priceMax > price ? priceMax : undefined,
    notes: args.notes,
    status: 'booked',
    history: [created],
    locks: locksFor({ startTime: args.time, durationMinutes: duration }, settings.bufferMinutes),
    seriesId: args.seriesId,
    bookedBy: args.bookedBy,
    createdAt: now,
    updatedAt: now,
  };
}

/** Checks a requested start against the live availability engine (hours, breaks, notice, locks). */
export async function assertSlotOffered(
  c: Containers,
  settings: BusinessSettings,
  day: string,
  time: string,
  durationMinutes: number,
  staff: boolean,
  ignoreAppointment?: Appointment,
): Promise<void> {
  const [locks, counts, closures, specialHours] = await Promise.all([
    loadLocks(c, day, day),
    loadCounts(c, day, day),
    listClosures(c, day, day),
    listSpecialHours(c, day, day),
  ]);
  if (ignoreAppointment?.day === day) counts.set(day, Math.max(0, (counts.get(day) ?? 1) - 1));
  const availability = dayAvailability(day, {
    settings,
    closures,
    specialHours,
    locked: buildLockMap(locks, ignoreAppointment?.id),
    counts,
    durationMinutes,
    now: nowIn(settings.timeZone),
    staff,
  });
  if (!availability.slots.some((s) => s.time === time)) {
    throw conflict(
      availability.reason ? `${availability.reason} — please choose another time.` : 'That time is no longer available — please choose another.',
      'slot_unavailable',
    );
  }
}

/** Validates business rules, then books one appointment (or a recurring series). */
export async function book(c: Containers, input: BookingInput): Promise<BookingResult> {
  const { request, ownerId, settings, actor } = input;
  const { owner, pet } = request;
  const staff = actor.kind === 'staff';
  const service = await getService(c, request.serviceId);
  if (!service.active) throw conflict('That service is not currently offered.', 'service_inactive');
  if (!service.species.includes(pet.species)) throw conflict(`${service.name} isn't available for ${pet.species}s.`, 'species_mismatch');
  const addOns = await getAddOns(c, request.addOnIds);
  const wrongSpecies = addOns.find((a) => !a.species.includes(pet.species));
  if (wrongSpecies) throw conflict(`${wrongSpecies.name} isn't available for ${pet.species}s.`, 'species_mismatch');
  const notOffered = addOns.find((a) => !addOnApplies(a, service.id, pet.species, pet.size));
  if (notOffered) throw conflict(`${notOffered.name} isn't offered with ${service.name} for ${pet.name}'s size.`, 'addon_not_offered');

  const dates = [request.day];
  if (request.repeat) {
    for (let i = 1; i < request.repeat.count; i++) dates.push(addDays(request.day, i * request.repeat.everyWeeks * 7));
  }

  // Per-client rules match on the contact number and on the device, so neither alone gets around them.
  const needsHistory = !staff && (settings.noShowLimit > 0 || settings.maxUpcomingPerOwner > 0);
  const history = needsHistory ? await listClientAppointments(c, clientKeyFor(owner.phone), ownerId) : [];

  if (!staff && settings.noShowLimit > 0 && countNoShows(history) >= settings.noShowLimit) {
    throw forbidden(`Online booking is paused for you. Please call us at ${settings.phone} to book.`);
  }

  if (!staff && settings.maxUpcomingPerOwner > 0) {
    const today = nowIn(settings.timeZone).toISODate()!;
    const upcoming = history.filter((a) => a.day >= today && ACTIVE_STATUSES.includes(a.status)).length;
    if (upcoming + dates.length > settings.maxUpcomingPerOwner) {
      throw conflict(
        `You can have up to ${settings.maxUpcomingPerOwner} upcoming appointments. You have ${upcoming}.`,
        'too_many_upcoming',
      );
    }
  }

  const seriesId = dates.length > 1 ? randomUUID() : undefined;
  const result: BookingResult = { appointments: [], skipped: [] };

  for (const [index, day] of dates.entries()) {
    const isFirst = index === 0;
    try {
      const appointment = buildAppointment({
        day,
        time: request.time,
        pet,
        owner,
        ownerId,
        service,
        addOns,
        settings,
        notes: request.notes,
        seriesId,
        bookedBy: actor.kind,
      });
      await assertSlotOffered(c, settings, day, request.time, appointment.durationMinutes, staff);
      const inserted = await insertAppointment(c.bookings, appointment, settings, !staff);
      if (!inserted.ok) {
        const message =
          inserted.reason === 'full'
            ? 'That day just filled up.'
            : inserted.reason === 'busy'
              ? 'We are busy right now — please try again.'
              : 'Someone just booked that time.';
        throw conflict(message, 'slot_taken');
      }
      result.appointments.push(appointment);
    } catch (err) {
      // The first date is what the owner picked — fail loudly. Later repeats are best effort.
      if (isFirst) throw err;
      result.skipped.push({ day, reason: err instanceof HttpError ? err.message : 'Could not book this date' });
    }
  }
  return result;
}

/** No-shows that still count toward the online-booking pause (staff can excuse them). */
export function countNoShows(appointments: Pick<Appointment, 'status' | 'noShowExcused'>[]): number {
  return appointments.filter((a) => a.status === 'no-show' && !a.noShowExcused).length;
}

/** True when the start is inside the cancellation window (a "late" change). */
export function isLateChange(appointment: Appointment, settings: BusinessSettings): boolean {
  const start = DateTime.fromISO(appointment.startUtc);
  return start.diffNow('hours').hours < settings.cancellationWindowHours;
}
