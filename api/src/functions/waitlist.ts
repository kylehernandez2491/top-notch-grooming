import { randomUUID } from 'node:crypto';
import type { WaitlistEntry } from '../shared/types';
import { requireUser } from '../lib/auth';
import { clean, getContainers } from '../lib/cosmos';
import { conflict, created, forbidden, notFound, readBody, route } from '../lib/http';
import { ensureProfile, getPet, getService, getSettings, queryAll } from '../lib/repo';
import { addDays, todayIn, ttlAfterDay } from '../lib/time';
import { waitlistInput } from '../lib/validation';

route('waitlistList', ['GET'], 'waitlist', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const rows = await queryAll<WaitlistEntry>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "waitlist" AND c.ownerId = @o AND c.day >= @today',
    [
      { name: '@o', value: principal.userId },
      { name: '@today', value: todayIn(settings.timeZone) },
    ],
  );
  return rows.map(clean).sort((a, b) => a.day.localeCompare(b.day));
});

/** Join the waitlist for a full day. Entries expire automatically (Cosmos TTL) after the day passes. */
route('waitlistJoin', ['POST'], 'waitlist', async (req) => {
  const principal = requireUser(req);
  const input = await readBody(req, waitlistInput);
  const c = await getContainers();
  const settings = await getSettings(c);
  const today = todayIn(settings.timeZone);
  if (input.day < today || input.day > addDays(today, settings.bookingHorizonDays)) {
    throw conflict('Pick a day within the booking window.', 'out_of_range');
  }
  const [profile, pet, service] = await Promise.all([
    ensureProfile(c, principal),
    getPet(c, principal.userId, input.petId),
    getService(c, input.serviceId),
  ]);
  const existing = await queryAll<WaitlistEntry>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "waitlist" AND c.day = @d AND c.petId = @p',
    [
      { name: '@d', value: input.day },
      { name: '@p', value: pet.id },
    ],
    input.day,
  );
  if (existing.length) throw conflict(`${pet.name} is already on the waitlist for that day.`, 'duplicate');

  const entry: WaitlistEntry = {
    id: randomUUID(),
    type: 'waitlist',
    day: input.day,
    ownerId: principal.userId,
    ownerName: profile.displayName,
    ownerEmail: profile.email,
    petId: pet.id,
    petName: pet.name,
    serviceId: service.id,
    serviceName: service.name,
    window: input.window,
    createdAt: new Date().toISOString(),
    ttl: ttlAfterDay(input.day, settings.timeZone, 1),
  };
  await c.bookings.items.create(entry);
  return created(clean(entry));
});

route('waitlistLeave', ['DELETE'], 'waitlist/{day}/{id}', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  const { resource } = await c.bookings.item(req.params.id, req.params.day).read<WaitlistEntry>();
  if (!resource || resource.type !== 'waitlist') throw notFound();
  if (resource.ownerId !== principal.userId) throw forbidden();
  await c.bookings.item(resource.id, resource.day).delete();
  return undefined;
});
