import { randomUUID } from 'node:crypto';
import type { WaitlistEntry } from '../shared/types';
import { clean, getContainers } from '../lib/cosmos';
import { deviceOwnerId, ensureDevice } from '../lib/device';
import { conflict, forbidden, notFound, raw, readBody, route } from '../lib/http';
import { getService, getSettings, queryAll } from '../lib/repo';
import { addDays, todayIn, ttlAfterDay } from '../lib/time';
import { waitlistInput } from '../lib/validation';

/** This device's waitlist entries. */
route('waitlistList', ['GET'], 'waitlist', async (req) => {
  const ownerId = deviceOwnerId(req);
  if (!ownerId) return [];
  const c = await getContainers();
  const settings = await getSettings(c);
  const rows = await queryAll<WaitlistEntry>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "waitlist" AND c.ownerId = @o AND c.day >= @today',
    [
      { name: '@o', value: ownerId },
      { name: '@today', value: todayIn(settings.timeZone) },
    ],
  );
  return rows.map(clean).sort((a, b) => a.day.localeCompare(b.day));
});

/** Join the waitlist for a full day. Entries expire automatically (Cosmos TTL) after the day passes. */
route('waitlistJoin', ['POST'], 'waitlist', async (req) => {
  const input = await readBody(req, waitlistInput);
  const device = ensureDevice(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const today = todayIn(settings.timeZone);
  if (input.day < today || input.day > addDays(today, settings.bookingHorizonDays)) {
    throw conflict('Pick a day within the booking window.', 'out_of_range');
  }
  const service = await getService(c, input.serviceId);
  const existing = await queryAll<WaitlistEntry>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "waitlist" AND c.day = @d AND c.petId = @p AND c.ownerId = @o',
    [
      { name: '@d', value: input.day },
      { name: '@p', value: input.pet.id },
      { name: '@o', value: device.ownerId },
    ],
    input.day,
  );
  if (existing.length) throw conflict(`${input.pet.name} is already on the waitlist for that day.`, 'duplicate');

  const entry: WaitlistEntry = {
    id: randomUUID(),
    type: 'waitlist',
    day: input.day,
    ownerId: device.ownerId,
    ownerName: input.owner.displayName,
    ownerEmail: input.owner.email,
    ownerPhone: input.owner.phone,
    petId: input.pet.id,
    petName: input.pet.name,
    serviceId: service.id,
    serviceName: service.name,
    window: input.window,
    createdAt: new Date().toISOString(),
    ttl: ttlAfterDay(input.day, settings.timeZone, 1),
  };
  await c.bookings.items.create(entry);
  return raw({ status: 201, jsonBody: clean(entry), cookies: [device.cookie] });
});

route('waitlistLeave', ['DELETE'], 'waitlist/{day}/{id}', async (req) => {
  const c = await getContainers();
  const { resource } = await c.bookings.item(req.params.id, req.params.day).read<WaitlistEntry>();
  if (!resource || resource.type !== 'waitlist') throw notFound();
  if (resource.ownerId !== deviceOwnerId(req)) throw forbidden();
  await c.bookings.item(resource.id, resource.day).delete();
  return undefined;
});
