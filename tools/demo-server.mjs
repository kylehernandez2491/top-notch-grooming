#!/usr/bin/env node
/**
 * Demo server: serves the built front end with an in-memory API so you can click through the whole
 * app (owner and staff views) without Azure or Cosmos DB. It reuses the real availability engine and
 * booking helpers from api/dist, so the calendar behaves exactly like production.
 *
 *   npm run build && npm --prefix api run build && npm run demo
 *   open http://localhost:4280/?as=owner     a returning customer: details and pets saved in this browser
 *        http://localhost:4280/?as=guest     a first visit: nothing saved, booking starts with "Your details"
 *        http://localhost:4280/?as=admin     the groomer, signed in to the staff portal
 *
 * Nothing here is deployed; data resets when the process stops.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'api', 'package.json'));
const PORT = Number(process.env.PORT ?? 4280);
const dist = path.join(root, 'dist');
if (!existsSync(dist) || !existsSync(path.join(root, 'api', 'dist'))) {
  console.error('Build first: npm run build && npm --prefix api run build');
  process.exit(1);
}

const engine = require('./dist/src/lib/availability.js');
const booking = require('./dist/src/lib/booking.js');
const deviceLib = require('./dist/src/lib/device.js');
const seed = require('./dist/src/lib/seed.js');
const fmt = require('./dist/src/shared/format.js');
const { DateTime } = require('luxon');

// Must match STORAGE_KEY in src/stores/account.ts and DEVICE_COOKIE in api/src/lib/device.ts.
const STORAGE_KEY = 'topnotch.owner.v1';
const DEVICE_COOKIE = deviceLib.DEVICE_COOKIE;

// ---------- seed data ----------
const settings = seed.defaultSettings();
const tz = settings.timeZone;
const services = seed.defaultServices();
const addOns = seed.defaultAddOns();
const today = DateTime.now().setZone(tz).toISODate();
const day = (n) => DateTime.fromISO(today).plus({ days: n }).toISODate();
const nextWeekday = (iso, from = 1) => {
  let d = DateTime.fromISO(today).plus({ days: from });
  while (d.weekday !== iso) d = d.plus({ days: 1 });
  return d.toISODate();
};
const nowIso = () => new Date().toISOString();
const toUtc = (d, t) => DateTime.fromISO(`${d}T${t}`, { zone: tz }).toUTC().toISO();

const closures = [{ id: 'c1', kind: 'closure', date: nextWeekday(4, 15), reason: 'Grooming seminar', createdAt: nowIso() }];
// A usual day off (Monday) opened for a few hours, and no chat message until staff add one.
const specialDay = nextWeekday(1, 8);
const specialHours = [{ id: `hours-${specialDay}`, kind: 'hours', date: specialDay, open: '10:00', close: '14:00', breaks: [], note: 'Special Monday opening', updatedAt: nowIso() }];
let notice;

/** Each demo client booked from their own phone; `device` is the key in that phone's cookie. */
const clients = {
  sam: { device: 'demo-sam', displayName: 'Sam Reyes', phone: '0917 201 3344', email: 'sam@example.com', address: '12 Mabini Street, Barangay Uno, Sample City', emailReminders: true },
  ana: { device: 'demo-ana', displayName: 'Ana Santos', phone: '0918 404 1188', email: 'ana@example.com', address: '7 Rizal Avenue, Barangay Dos, Sample City', emailReminders: true },
  dev: { device: 'demo-dev', displayName: 'Dev Mendoza', phone: '0922 777 0102', email: 'dev@example.com', address: '30 Luna Street, Barangay Tres, Sample City', emailReminders: false },
};
const ownerDetails = ({ device: _device, ...owner }) => owner;
const ownerIdOf = (deviceKey) => `d-${deviceKey}`;

const vax = (months) => [{ name: 'Rabies', expiresOn: DateTime.fromISO(today).plus({ months }).toISODate() }, { name: 'DHPP', expiresOn: DateTime.fromISO(today).plus({ months: months + 2 }).toISODate() }];
const pets = [
  { client: 'sam', id: 'pet-biscuit', name: 'Biscuit', species: 'dog', breed: 'Pembroke Welsh Corgi', size: 'medium', weightKg: 12, birthday: '2021-04-02', sex: 'male', temperament: 'friendly', behaviorNotes: 'Sings during the blow-dry.', groomingPreferences: 'Keep the butt fluff, tidy feet.', vaccinations: vax(8) },
  { client: 'sam', id: 'pet-juniper', name: 'Juniper', species: 'cat', breed: 'Maine Coon', size: 'small', weightKg: 6.5, temperament: 'nervous', allergies: 'Oatmeal shampoo', vaccinations: [{ name: 'Rabies', expiresOn: day(20) }] },
  { client: 'ana', id: 'pet-koda', name: 'Koda', species: 'dog', breed: 'Siberian Husky', size: 'husky_chow', weightKg: 24, temperament: 'calm', vaccinations: vax(5) },
  { client: 'dev', id: 'pet-pepper', name: 'Pepper', species: 'dog', breed: 'Miniature Schnauzer', size: 'small', temperament: 'reactive', behaviorNotes: 'Muzzle for nails', vaccinations: vax(3) },
];
const bookedPet = ({ client: _client, ...pet }) => pet;

/** What ?as=owner puts in localStorage: Sam's details and pets, as the real app saves them. */
const samsDevice = {
  profile: ownerDetails(clients.sam),
  pets: pets.filter((p) => p.client === 'sam').map((p) => ({ ...bookedPet(p), createdAt: nowIso(), updatedAt: nowIso() })),
};

/** Same shape as buildAppointment in api/src/lib/booking.ts. */
function buildAppt({ owner, ownerId, pet, day: d, time, serviceId, addOnIds = [], notes, bookedBy = 'owner', ...extra }) {
  const service = services.find((s) => s.id === serviceId);
  const chosen = addOnIds.map((id) => addOns.find((a) => a.id === id));
  const duration = fmt.serviceDuration(service, chosen, pet.size);
  const endTime = fmt.addMinutes(time, duration);
  const price = fmt.servicePrice(service, chosen, pet.size);
  const priceMax = fmt.servicePriceMax(service, chosen, pet.size);
  const { id: petId, ...details } = pet;
  return {
    id: extra.id ?? randomUUID(), type: 'appointment', day: d, startTime: time, endTime, startUtc: toUtc(d, time), endUtc: toUtc(d, endTime),
    ownerId, clientKey: deviceLib.clientKeyFor(owner.phone), ownerName: owner.displayName, ownerEmail: owner.email, ownerPhone: owner.phone,
    ownerAddress: owner.address, ownerEmergencyContact: owner.emergencyContact, emailReminders: owner.emailReminders,
    petId, petName: pet.name, petSpecies: pet.species, petSize: pet.size, petBreed: pet.breed, petAlerts: booking.petAlerts(pet), pet: details,
    manageToken: deviceLib.newManageToken(),
    serviceId, serviceName: service.name, addOns: chosen.map((a) => ({ id: a.id, name: a.name, price: a.price, durationMinutes: a.durationMinutes })),
    durationMinutes: duration, estimatedPrice: price, estimatedPriceMax: priceMax > price ? priceMax : undefined, status: extra.status ?? 'booked',
    notes, history: [{ at: nowIso(), event: 'created', by: bookedBy }],
    locks: engine.lockBlocks(fmt.toMinutes(time), duration, settings.bufferMinutes).map(engine.lockId),
    bookedBy, reportCard: extra.reportCard, review: extra.review, finalPrice: extra.finalPrice,
    createdAt: `${d < today ? d : today}T01:00:00.000Z`, updatedAt: nowIso(),
  };
}

function seedAppt(petId, d, time, serviceId, extra = {}) {
  const pet = pets.find((p) => p.id === petId);
  const client = clients[pet.client];
  return buildAppt({ owner: ownerDetails(client), ownerId: ownerIdOf(client.device), pet: bookedPet(pet), day: d, time, serviceId, ...extra });
}

const workdays = [];
for (let i = 0; i < 40; i++) {
  const d = day(i);
  const wd = DateTime.fromISO(d).toFormat('ccc').toLowerCase();
  if (settings.weeklyHours[wd]) workdays.push(d);
}
const appointments = [
  seedAppt('pet-biscuit', workdays[1], '09:00', 'full-grooming', { id: 'a-next', notes: 'He has a small hot spot on his left hip.' }),
  seedAppt('pet-juniper', workdays[6], '13:00', 'cat-grooming'),
  seedAppt('pet-biscuit', day(-42), '10:00', 'full-grooming', {
    status: 'completed', finalPrice: 600,
    reportCard: { behavior: 'Happy and wiggly, great for nails.', coat: 'Heavy undercoat shedding, skin looks healthy.', notes: 'Full deshed, sanitary trim, tidy feet.', recommendations: 'Brush twice a week during shedding season.', nextVisitWeeks: 6, createdAt: nowIso() },
  }),
  seedAppt('pet-juniper', day(-30), '11:00', 'cat-grooming', { status: 'completed' }),
  seedAppt('pet-koda', day(-20), '09:00', 'bath-blow-dry', { status: 'no-show' }),
];
// Fill the shop so the water lines vary from day to day.
const fillers = [['pet-koda', 'full-grooming'], ['pet-pepper', 'basic-grooming'], ['pet-koda', 'bath-blow-dry'], ['pet-pepper', 'bath-blow-dry']];
workdays.forEach((d, i) => {
  const busy = [3, 1, 2, 3, 4, 3, 1, 5, 2, 0, 4, 2][i % 12];
  const times = ['08:30', '11:00', '13:00', '14:30', '10:00'];
  for (let k = 0; k < busy; k++) {
    const [petId, serviceId] = fillers[(i + k) % fillers.length];
    const todayStatus = ['completed', 'in-progress', 'booked'][k] ?? 'booked';
    const candidate = seedAppt(petId, d, times[k], serviceId, { status: d === today ? todayStatus : 'booked' });
    const taken = new Set(appointments.filter((a) => a.day === d && a.status !== 'cancelled').flatMap((a) => a.locks));
    if (!candidate.locks.some((l) => taken.has(l))) appointments.push(candidate);
  }
});
// A full day so the "full" state and waitlist show up.
const fullDay = workdays[3];
for (const t of ['08:30', '10:00', '11:30', '13:00', '14:30', '15:45']) {
  const candidate = seedAppt('pet-pepper', fullDay, t, 'bath-blow-dry');
  const taken = new Set(appointments.filter((a) => a.day === fullDay).flatMap((a) => a.locks));
  if (!candidate.locks.some((l) => taken.has(l))) appointments.push(candidate);
}
settings.maxAppointmentsPerDay = 6;
const waitlist = [];

// ---------- helpers ----------
const sorted = (list) => list.slice().sort((a, b) => a.startUtc.localeCompare(b.startUtc));
const active = (a) => ['booked', 'checked-in', 'in-progress'].includes(a.status);
const error = (status, message, code) => [status, { error: { message, code } }];

function availability(q, as) {
  const service = services.find((s) => s.id === q.get('serviceId'));
  if (!service) return error(404, 'Unknown service');
  const chosen = (q.get('addOns') ?? '').split(',').filter(Boolean).map((id) => addOns.find((a) => a.id === id));
  const durationMinutes = fmt.serviceDuration(service, chosen, q.get('size') ?? 'medium');
  const from = q.get('from') ?? today;
  const to = q.get('to') ?? from;
  const exclude = q.get('exclude');
  const locks = appointments.filter((a) => active(a)).flatMap((a) => a.locks.map((id) => ({ id, day: a.day, appointmentId: a.id })));
  const counts = new Map();
  for (const a of appointments) if (a.status !== 'cancelled' && a.id !== exclude) counts.set(a.day, (counts.get(a.day) ?? 0) + 1);
  const days = engine.rangeAvailability(from, to, {
    settings, closures, specialHours, locked: engine.buildLockMap(locks, exclude ?? undefined), counts, durationMinutes,
    now: DateTime.now().setZone(tz), staff: q.get('staff') === '1' && as === 'admin',
  });
  const first = days.find((d) => d.slots.length);
  return [200, { from, to, timeZone: tz, durationMinutes, days, nextAvailable: first ? { day: first.day, time: first.slots[0].time } : undefined }];
}

function bookFrom(input, ownerId, bookedBy, as) {
  const params = { serviceId: input.serviceId, size: input.pet.size, addOns: (input.addOnIds ?? []).join(','), from: input.day, to: input.day };
  const [, avail] = availability(new URLSearchParams(bookedBy === 'staff' ? { ...params, staff: '1' } : params), as);
  if (!avail.days[0].slots.some((s) => s.time === input.time)) return error(409, 'Someone just booked that time.', 'slot_taken');
  const appt = buildAppt({ ...input, ownerId, bookedBy });
  appointments.push(appt);
  return [201, { appointments: [appt], skipped: [] }];
}

/** Owner and staff actions on one appointment, kept simple: no emails, no policy checks. */
function act(appt, action, input) {
  if (!action) return [200, appt];
  if (action === 'ics') return [200, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'text/calendar'];
  if (action === 'cancel' || (action === 'status' && input.status === 'cancelled')) {
    Object.assign(appt, { status: 'cancelled', locks: [], cancelReason: input.reason ?? input.note });
  } else if (action === 'status') {
    Object.assign(appt, { status: input.status, finalPrice: input.finalPrice ?? appt.finalPrice, noShowExcused: input.status === 'no-show' ? undefined : appt.noShowExcused });
  } else if (action === 'reschedule') {
    const endTime = fmt.addMinutes(input.time, appt.durationMinutes);
    Object.assign(appt, {
      day: input.day, startTime: input.time, endTime, startUtc: toUtc(input.day, input.time), endUtc: toUtc(input.day, endTime),
      locks: engine.lockBlocks(fmt.toMinutes(input.time), appt.durationMinutes, settings.bufferMinutes).map(engine.lockId),
    });
  } else if (action === 'notes') appt.notes = input.notes;
  else if (action === 'staff-notes') appt.staffNotes = input.staffNotes;
  else if (action === 'review') appt.review = { ...input, createdAt: nowIso() };
  else if (action === 'report-card') appt.reportCard = { ...input, createdAt: nowIso() };
  appt.updatedAt = nowIso();
  return [200, appt];
}

/** Staff "Clients": built from bookings, newest details first, like api/src/functions/admin.ts. */
function clientSummary(clientKey, list) {
  const newest = list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = newest[0];
  return {
    clientKey,
    owner: { displayName: latest.ownerName, phone: latest.ownerPhone, email: latest.ownerEmail, address: latest.ownerAddress, emergencyContact: latest.ownerEmergencyContact, emailReminders: latest.emailReminders },
    petNames: [...new Map(newest.map((a) => [a.petId, a.petName])).values()],
    noShows: booking.countNoShows(list),
    firstVisit: newest[newest.length - 1].createdAt,
  };
}

const byClient = () => {
  const groups = new Map();
  for (const a of appointments) groups.set(a.clientKey, [...(groups.get(a.clientKey) ?? []), a]);
  return groups;
};

function stats(from, to) {
  const list = appointments.filter((a) => a.day >= from && a.day <= to);
  const completed = list.filter((a) => a.status === 'completed');
  const kept = list.filter((a) => a.status !== 'cancelled');
  const revenue = completed.reduce((s, a) => s + (a.finalPrice ?? a.estimatedPrice), 0);
  const svc = new Map();
  kept.forEach((a) => {
    const e = svc.get(a.serviceId) ?? { name: a.serviceName, count: 0, revenue: 0 };
    e.count++;
    if (a.status === 'completed') e.revenue += a.finalPrice ?? a.estimatedPrice;
    svc.set(a.serviceId, e);
  });
  const wd = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const byHour = new Map();
  kept.forEach((a) => byHour.set(Number(a.startTime.slice(0, 2)), (byHour.get(Number(a.startTime.slice(0, 2))) ?? 0) + 1));
  return {
    from, to, total: list.length, completed: completed.length + 24, cancelled: list.filter((a) => a.status === 'cancelled').length,
    lateCancellations: 0, noShows: 0, noShowRate: 0, upcoming: list.filter((a) => active(a) && a.startUtc > nowIso()).length,
    revenue: revenue + 2140, averageTicket: (revenue + 2140) / (completed.length + 24),
    rating: { average: 4.9, count: 38 }, newClients: 7, topServices: [...svc.values()].sort((a, b) => b.count - a.count),
    byWeekday: wd.map((w) => ({ weekday: w, count: kept.filter((a) => DateTime.fromISO(a.day).toFormat('ccc').toLowerCase() === w).length })),
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, count]) => ({ hour, count })),
  };
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const readCookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.headers.cookie ?? '')?.[1] || undefined;
const deviceCookie = (key, maxAge = 400 * 24 * 3600) => `${DEVICE_COOKIE}=${key}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

// ---------- API ----------
async function api(req, url, as, cookies) {
  const p = url.pathname.replace(/^\/api\//, '');
  const m = req.method;
  const q = url.searchParams;
  const admin = as === 'admin';
  let match;

  if (p === 'public/catalog') {
    const showing = notice && notice.until >= today ? notice : undefined;
    return [200, { settings, services: services.filter((s) => s.active), addOns: addOns.filter((a) => a.active), closures: closures.filter((c) => c.date >= today), specialHours: specialHours.filter((s) => s.date >= today), notice: showing, rating: { average: 4.9, count: 38 }, today }];
  }
  if (p === 'public/availability') return availability(q, as);

  // Pet owners: no sign-in, just this browser's device cookie (or the ?t= token from an email link).
  const deviceKey = readCookie(req, DEVICE_COOKIE);
  const ownerId = deviceKey ? ownerIdOf(deviceKey) : undefined;
  const ensureDevice = () => {
    const key = deviceKey ?? randomUUID();
    cookies.push(deviceCookie(key));
    return ownerIdOf(key);
  };
  const owns = (a) => (!!ownerId && a.ownerId === ownerId) || q.get('t') === a.manageToken;

  if (p === 'device/forget' && m === 'POST') {
    cookies.push(deviceCookie('', 0));
    return [204];
  }
  if (p === 'appointments' && m === 'GET') return [200, ownerId ? sorted(appointments.filter((a) => a.ownerId === ownerId)) : []];
  if (p === 'appointments' && m === 'POST') return bookFrom(await body(req), ensureDevice(), 'owner', as);
  if ((match = p.match(/^appointments\/([^/]+)(?:\/(\w[\w-]*))?$/))) {
    const appt = appointments.find((a) => a.id === match[1]);
    if (!appt) return error(404, 'Appointment not found.');
    if (!owns(appt) && !admin) return error(403, 'Open this booking from the link in your confirmation email, or call us to change it.');
    return act(appt, match[2], m === 'GET' ? {} : await body(req));
  }
  if (p === 'waitlist' && m === 'GET') return [200, waitlist.filter((w) => w.ownerId === ownerId)];
  if (p === 'waitlist' && m === 'POST') {
    const input = await body(req);
    const service = services.find((s) => s.id === input.serviceId);
    const entry = {
      id: randomUUID(), type: 'waitlist', day: input.day, ownerId: ensureDevice(), ownerName: input.owner.displayName, ownerEmail: input.owner.email,
      ownerPhone: input.owner.phone, petId: input.pet.id, petName: input.pet.name, serviceId: service.id, serviceName: service.name, window: input.window, createdAt: nowIso(),
    };
    waitlist.push(entry);
    return [201, entry];
  }
  if ((match = p.match(/^waitlist\/([^/]+)\/([^/]+)$/)) && m === 'DELETE') {
    const index = waitlist.findIndex((w) => w.id === match[2] && w.ownerId === ownerId);
    if (index >= 0) waitlist.splice(index, 1);
    return [204];
  }

  if (!admin) return error(403, 'Staff access only.');
  if (p === 'staff/appointments' && m === 'POST') {
    const { ownerId: clientDevice, ...input } = await body(req);
    return bookFrom(input, clientDevice ?? `s-${randomUUID()}`, 'staff', as);
  }
  if ((match = p.match(/^staff\/appointments\/([^/]+)(?:\/(\w[\w-]*))?$/))) {
    const appt = appointments.find((a) => a.id === match[1]);
    if (!appt) return error(404, 'Appointment not found.');
    return act(appt, match[2], m === 'GET' ? {} : await body(req));
  }
  if (p === 'staff/agenda') {
    const from = q.get('from'), to = q.get('to');
    return [200, {
      from, to,
      appointments: sorted(appointments.filter((a) => a.day >= from && a.day <= to)),
      waitlist: waitlist.filter((w) => w.day >= from && w.day <= to),
      closures: closures.filter((c) => c.date >= from && c.date <= to),
      specialHours: specialHours.filter((s) => s.date >= from && s.date <= to),
      notice: notice && notice.until >= today ? notice : undefined,
    }];
  }
  if (p === 'staff/settings') return [200, settings];
  // Special hours, the chat message, time off and price edits, kept simple: no validation.
  if (p === 'staff/special-hours') return [200, specialHours];
  if ((match = p.match(/^staff\/special-hours\/(\d{4}-\d{2}-\d{2})$/))) {
    const date = match[1];
    const index = specialHours.findIndex((s) => s.date === date);
    if (index >= 0) specialHours.splice(index, 1);
    if (m === 'DELETE') return [204];
    const saved = { ...(await body(req)), id: `hours-${date}`, kind: 'hours', date, updatedAt: nowIso() };
    specialHours.push(saved);
    specialHours.sort((a, b) => a.date.localeCompare(b.date));
    return [200, saved];
  }
  if (p === 'staff/notice') {
    notice = m === 'DELETE' ? undefined : { ...(await body(req)), id: 'notice', kind: 'notice', updatedAt: nowIso() };
    return notice ? [200, notice] : [204];
  }
  if (p === 'staff/catalog/closure' && m === 'POST') {
    const saved = { ...(await body(req)), id: randomUUID(), kind: 'closure', createdAt: nowIso() };
    closures.push(saved);
    return [201, saved];
  }
  if ((match = p.match(/^staff\/catalog\/(service|addon|closure)\/([^/]+)$/)) && ['PUT', 'DELETE'].includes(m)) {
    const list = { service: services, addon: addOns, closure: closures }[match[1]];
    const index = list.findIndex((x) => x.id === decodeURIComponent(match[2]));
    if (index < 0) return error(404, 'Not found.');
    if (m === 'DELETE') {
      list.splice(index, 1);
      return [204];
    }
    list[index] = { ...(await body(req)), id: list[index].id, kind: match[1], updatedAt: nowIso() };
    return [200, list[index]];
  }
  if ((match = p.match(/^staff\/catalog\/(service|addon|closure)$/))) return [200, { service: services, addon: addOns, closure: closures }[match[1]]];
  if (p === 'staff/clients') {
    const term = (q.get('q') ?? '').toLowerCase();
    const list = [...byClient().entries()].map(([key, rows]) => clientSummary(key, rows));
    return [200, list
      .filter((c) => !term || [c.owner.displayName, c.owner.email, c.owner.phone, ...c.petNames].join(' ').toLowerCase().includes(term))
      .sort((a, b) => a.owner.displayName.localeCompare(b.owner.displayName))];
  }
  if ((match = p.match(/^staff\/clients\/([^/]+)\/excuse-no-shows$/))) {
    const noShows = (byClient().get(decodeURIComponent(match[1])) ?? []).filter((a) => a.status === 'no-show');
    noShows.forEach((a) => (a.noShowExcused = true));
    return [200, { excused: noShows.length }];
  }
  if ((match = p.match(/^staff\/clients\/([^/]+)$/))) {
    const key = decodeURIComponent(match[1]);
    const rows = byClient().get(key);
    if (!rows) return error(404, 'Client not found.');
    const newest = rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const petsById = new Map();
    for (const a of newest) if (!petsById.has(a.petId)) petsById.set(a.petId, { ...a.pet, id: a.petId });
    return [200, { ...clientSummary(key, rows), ownerId: newest[0].ownerId, pets: [...petsById.values()], appointments: sorted(rows) }];
  }
  if (p === 'staff/stats') return [200, stats(q.get('from'), q.get('to'))];
  return error(404, `Demo server has no handler for ${m} /api/${p}`);
}

// ---------- HTTP ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain' };

/** ?as= sets up this browser before the app starts: what a returning customer's phone would have saved. */
function demoSetup(as) {
  if (as === 'owner') return `<script>try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(samsDevice))})}catch(e){}</script>`;
  if (as === 'guest') return `<script>try{localStorage.removeItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}</script>`;
  return '';
}

const server = http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const asParam = url.searchParams.get('as');
    const as = asParam ?? readCookie(req, 'mockas') ?? 'guest';
    const cookies = [];
    if (asParam) {
      cookies.push(`mockas=${as}; Path=/`);
      if (as === 'owner') cookies.push(deviceCookie(clients.sam.device));
      if (as === 'guest') cookies.push(deviceCookie('', 0));
    }

    // Only staff sign in. Owners and guests are anonymous, as in production.
    if (url.pathname === '/.auth/me') {
      const principal = as === 'admin' ? { identityProvider: 'aad', userId: 'staff-1', userDetails: 'groomer@example.com', userRoles: ['anonymous', 'authenticated', 'admin'] } : null;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ clientPrincipal: principal }));
      return;
    }
    if (url.pathname.startsWith('/.auth/login')) {
      res.writeHead(302, { Location: url.searchParams.get('post_login_redirect_uri') ?? '/admin', 'Set-Cookie': 'mockas=admin; Path=/' }).end();
      return;
    }
    if (url.pathname.startsWith('/.auth/logout')) {
      res.writeHead(302, { Location: '/', 'Set-Cookie': 'mockas=guest; Path=/' }).end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        const [status, payload, type] = await api(req, url, as, cookies);
        res.writeHead(status, { 'Content-Type': type ?? 'application/json', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
        res.end(payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: String(err) } }));
      }
      return;
    }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    const headers = { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) };
    if (file.endsWith('index.html') && asParam) {
      res.writeHead(200, headers).end(readFileSync(file, 'utf8').replace('<head>', `<head>${demoSetup(as)}`));
      return;
    }
    res.writeHead(200, headers).end(readFileSync(file));
  });

async function listen(port) {
  try {
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port);
    });
    console.log(`Top Notch Dog Grooming demo on http://localhost:${port}  (?as=guest | owner | admin)`);
  } catch (err) {
    if (err.code === 'EADDRINUSE' && !process.env.PORT && port < 65535) {
      console.warn(`Port ${port} is already in use; trying ${port + 1}.`);
      return listen(port + 1);
    }
    console.error(`Could not start the demo server on port ${port}: ${err.message}`);
    process.exitCode = 1;
  }
}

listen(PORT);
