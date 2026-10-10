#!/usr/bin/env node
/**
 * Demo server: serves the built front end with an in-memory API so you can click through the whole
 * app (owner and staff views) without Azure, Cosmos DB or Entra. It reuses the real availability
 * engine from api/dist, so the calendar behaves exactly like production.
 *
 *   npm run build && npm --prefix api run build && npm run demo
 *   open http://localhost:4280/?as=owner     (or ?as=admin, ?as=guest, ?as=new for a first sign-in)
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
const engine = require('./dist/src/lib/availability.js');
const seed = require('./dist/src/lib/seed.js');
const fmt = require('./dist/src/shared/format.js');
const { DateTime } = require('luxon');

const PORT = Number(process.env.PORT ?? 4280);
const dist = path.join(root, 'dist');
if (!existsSync(dist) || !existsSync(path.join(root, 'api', 'dist'))) {
  console.error('Build first: npm run build && npm --prefix api run build');
  process.exit(1);
}

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

const closures = [{ id: 'c1', kind: 'closure', date: nextWeekday(4, 15), reason: 'Grooming seminar', createdAt: nowIso() }];

const OWNER = 'owner-sam';
const profiles = new Map([
  [OWNER, { id: OWNER, type: 'profile', ownerId: OWNER, email: 'sam@example.com', displayName: 'Sam Reyes', phone: '0917 201 3344', address: '12 Mabini Street, Barangay Uno, Sample City', emailReminders: true, emailMarketing: false, onboarded: true, noShowCount: 0, createdAt: day(-200) + 'T15:00:00.000Z', updatedAt: nowIso() }],
  ['owner-ana', { id: 'owner-ana', type: 'profile', ownerId: 'owner-ana', email: 'ana@example.com', displayName: 'Ana Santos', phone: '0918 404 1188', address: '7 Rizal Avenue, Barangay Dos, Sample City', emailReminders: true, emailMarketing: true, onboarded: true, noShowCount: 1, createdAt: day(-20) + 'T15:00:00.000Z', updatedAt: nowIso() }],
  ['owner-dev', { id: 'owner-dev', type: 'profile', ownerId: 'owner-dev', email: 'dev@example.com', displayName: 'Dev Mendoza', phone: '0922 777 0102', address: '30 Luna Street, Barangay Tres, Sample City', emailReminders: false, emailMarketing: false, onboarded: true, noShowCount: 0, createdAt: day(-90) + 'T15:00:00.000Z', updatedAt: nowIso() }],
]);

// ?as=new signs in as someone who hasn't filled in their details yet, to see the welcome screen.
const newcomer = { id: 'owner-new', type: 'profile', ownerId: 'owner-new', email: 'jo@example.com', displayName: 'jo', emailReminders: true, emailMarketing: false, onboarded: false, noShowCount: 0, createdAt: nowIso(), updatedAt: nowIso() };

const vax = (months) => [{ name: 'Rabies', expiresOn: DateTime.fromISO(today).plus({ months }).toISODate() }, { name: 'DHPP', expiresOn: DateTime.fromISO(today).plus({ months: months + 2 }).toISODate() }];
const pets = [
  { id: 'p-biscuit', type: 'pet', ownerId: OWNER, name: 'Biscuit', species: 'dog', breed: 'Pembroke Welsh Corgi', size: 'medium', weightKg: 12, birthday: '2021-04-02', sex: 'male', temperament: 'friendly', behaviorNotes: 'Sings during the blow-dry.', groomingPreferences: 'Keep the butt fluff, tidy feet.', vaccinations: vax(8), createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'p-juniper', type: 'pet', ownerId: OWNER, name: 'Juniper', species: 'cat', breed: 'Maine Coon', size: 'small', weightKg: 6.5, temperament: 'nervous', allergies: 'Oatmeal shampoo', vaccinations: [{ name: 'Rabies', expiresOn: day(20) }], createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'p-koda', type: 'pet', ownerId: 'owner-ana', name: 'Koda', species: 'dog', breed: 'Siberian Husky', size: 'husky_chow', weightKg: 24, temperament: 'calm', vaccinations: vax(5), createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'p-pepper', type: 'pet', ownerId: 'owner-dev', name: 'Pepper', species: 'dog', breed: 'Miniature Schnauzer', size: 'small', temperament: 'reactive', behaviorNotes: 'Muzzle for nails', vaccinations: vax(3), createdAt: nowIso(), updatedAt: nowIso() },
];

function makeAppointment(petId, d, time, serviceId, extra = {}) {
  const pet = pets.find((p) => p.id === petId);
  const profile = profiles.get(pet.ownerId);
  const service = services.find((s) => s.id === serviceId);
  const chosen = (extra.addOnIds ?? []).map((id) => addOns.find((a) => a.id === id));
  const duration = fmt.serviceDuration(service, chosen, pet.size);
  const endTime = fmt.addMinutes(time, duration);
  const toUtc = (t) => DateTime.fromISO(`${d}T${t}`, { zone: tz }).toUTC().toISO();
  return {
    id: extra.id ?? randomUUID(), type: 'appointment', day: d, startTime: time, endTime, startUtc: toUtc(time), endUtc: toUtc(endTime),
    ownerId: profile.ownerId, ownerName: profile.displayName, ownerEmail: profile.email, ownerPhone: profile.phone,
    petId, petName: pet.name, petSpecies: pet.species, petSize: pet.size, petBreed: pet.breed,
    petAlerts: [pet.temperament === 'nervous' || pet.temperament === 'reactive' ? fmt.TEMPERAMENT_LABELS[pet.temperament] : null, pet.allergies ? `Allergies: ${pet.allergies}` : null, pet.behaviorNotes && pet.temperament === 'reactive' ? `Behavior: ${pet.behaviorNotes}` : null].filter(Boolean),
    serviceId, serviceName: service.name, addOns: chosen.map((a) => ({ id: a.id, name: a.name, price: a.price, durationMinutes: a.durationMinutes })),
    durationMinutes: duration, estimatedPrice: fmt.servicePrice(service, chosen, pet.size), estimatedPriceMax: fmt.servicePriceMax(service, chosen, pet.size) > fmt.servicePrice(service, chosen, pet.size) ? fmt.servicePriceMax(service, chosen, pet.size) : undefined, status: extra.status ?? 'booked',
    notes: extra.notes, history: [{ at: nowIso(), event: 'created', by: 'owner' }],
    locks: engine.lockBlocks(fmt.toMinutes(time), duration, settings.bufferMinutes).map(engine.lockId),
    bookedBy: 'owner', reportCard: extra.reportCard, review: extra.review, finalPrice: extra.finalPrice, createdAt: nowIso(), updatedAt: nowIso(),
  };
}

const workdays = [];
for (let i = 0; i < 40; i++) {
  const d = day(i);
  const wd = DateTime.fromISO(d).toFormat('ccc').toLowerCase();
  if (settings.weeklyHours[wd]) workdays.push(d);
}
const appointments = [
  makeAppointment('p-biscuit', workdays[1], '09:00', 'full-grooming', { id: 'a-next', notes: 'He has a small hot spot on his left hip.' }),
  makeAppointment('p-juniper', workdays[6], '13:00', 'cat-grooming'),
  makeAppointment('p-biscuit', day(-42), '10:00', 'full-grooming', {
    status: 'completed', finalPrice: 90,
    reportCard: { behavior: 'Happy and wiggly, great for nails.', coat: 'Heavy undercoat shedding, skin looks healthy.', notes: 'Full deshed, sanitary trim, tidy feet.', recommendations: 'Brush twice a week during shedding season.', nextVisitWeeks: 6, createdAt: nowIso() },
  }),
  makeAppointment('p-juniper', day(-30), '11:00', 'cat-grooming', { status: 'completed' }),
];
// Fill the shop so the water lines vary from day to day.
const fillers = [['p-koda', 'full-grooming'], ['p-pepper', 'basic-grooming'], ['p-koda', 'bath-blow-dry'], ['p-pepper', 'bath-blow-dry']];
workdays.forEach((d, i) => {
  const busy = [3, 1, 2, 3, 4, 3, 1, 5, 2, 0, 4, 2][i % 12];
  const times = ['08:30', '11:00', '13:00', '14:30', '10:00'];
  for (let k = 0; k < busy; k++) {
    const [petId, serviceId] = fillers[(i + k) % fillers.length];
    const todayStatus = ['completed', 'in-progress', 'booked'][k] ?? 'booked';
    const candidate = makeAppointment(petId, d, times[k], serviceId, { status: d === today ? todayStatus : 'booked' });
    const taken = new Set(appointments.filter((a) => a.day === d && a.status !== 'cancelled').flatMap((a) => a.locks));
    if (!candidate.locks.some((l) => taken.has(l))) appointments.push(candidate);
  }
});
// A full day so the "full" state and waitlist show up.
const fullDay = workdays[3];
for (const t of ['08:30', '10:00', '11:30', '13:00', '14:30', '15:45']) {
  const candidate = makeAppointment('p-pepper', fullDay, t, 'bath-blow-dry');
  const taken = new Set(appointments.filter((a) => a.day === fullDay).flatMap((a) => a.locks));
  if (!candidate.locks.some((l) => taken.has(l))) appointments.push(candidate);
}
settings.maxAppointmentsPerDay = 6;
const waitlist = [];

// ---------- helpers ----------
const sorted = (list) => list.slice().sort((a, b) => a.startUtc.localeCompare(b.startUtc));
const active = (a) => ['booked', 'checked-in', 'in-progress'].includes(a.status);

function availability(q, as) {
  const service = services.find((s) => s.id === q.get('serviceId'));
  if (!service) return [404, { error: { message: 'Unknown service' } }];
  const chosen = (q.get('addOns') ?? '').split(',').filter(Boolean).map((id) => addOns.find((a) => a.id === id));
  const durationMinutes = fmt.serviceDuration(service, chosen, q.get('size') ?? 'medium');
  const from = q.get('from') ?? today;
  const to = q.get('to') ?? from;
  const exclude = q.get('exclude');
  const locks = appointments.filter((a) => active(a)).flatMap((a) => a.locks.map((id) => ({ id, day: a.day, appointmentId: a.id })));
  const counts = new Map();
  for (const a of appointments) if (a.status !== 'cancelled' && a.id !== exclude) counts.set(a.day, (counts.get(a.day) ?? 0) + 1);
  const days = engine.rangeAvailability(from, to, {
    settings, closures, locked: engine.buildLockMap(locks, exclude ?? undefined), counts, durationMinutes,
    now: DateTime.now().setZone(tz), staff: q.get('staff') === '1' && as === 'admin',
  });
  const first = days.find((d) => d.slots.length);
  return [200, { from, to, timeZone: tz, durationMinutes, days, nextAvailable: first ? { day: first.day, time: first.slots[0].time } : undefined }];
}

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

// ---------- API ----------
async function api(req, url, as) {
  const p = url.pathname.replace(/^\/api\//, '');
  const m = req.method;
  const q = url.searchParams;
  const authed = as !== 'guest';
  const admin = as === 'admin';
  let match;

  if (p === 'public/catalog') return [200, { settings, services, addOns, closures, rating: { average: 4.9, count: 38 }, today }];
  if (p === 'public/availability') return availability(q, as);
  if (!authed) return [401, { error: { message: 'Please sign in.' } }];

  const me = as === 'new' ? newcomer : profiles.get(OWNER);
  if (p === 'me' && m === 'GET') return [200, { profile: me, roles: admin ? ['authenticated', 'admin'] : ['authenticated'], isAdmin: admin }];
  if (p === 'me' && m === 'PUT') return [200, { profile: Object.assign(me, await body(req), { onboarded: true }), roles: ['authenticated'], isAdmin: admin }];
  if (p === 'pets' && m === 'GET') return [200, pets.filter((x) => x.ownerId === OWNER && !x.archived)];
  if (p === 'pets' && m === 'POST') {
    const pet = { ...(await body(req)), id: randomUUID(), type: 'pet', ownerId: OWNER, createdAt: nowIso(), updatedAt: nowIso() };
    pets.push(pet);
    return [201, pet];
  }
  if ((match = p.match(/^pets\/([^/]+)$/))) {
    const pet = pets.find((x) => x.id === match[1]);
    if (!pet) return [404, { error: { message: 'Pet not found.' } }];
    if (m === 'PUT') Object.assign(pet, await body(req), { updatedAt: nowIso() });
    if (m === 'DELETE') pet.archived = true;
    return m === 'DELETE' ? [204] : [200, pet];
  }
  if (p === 'appointments' && m === 'GET') return [200, sorted(appointments.filter((a) => a.ownerId === OWNER))];
  if (p === 'appointments' && m === 'POST') {
    const input = await body(req);
    const [, avail] = availability(new URLSearchParams({ serviceId: input.serviceId, size: pets.find((x) => x.id === input.petId).size, addOns: (input.addOnIds ?? []).join(','), from: input.day, to: input.day }), as);
    if (!avail.days[0].slots.some((s) => s.time === input.time)) return [409, { error: { message: 'Someone just booked that time.', code: 'slot_taken' } }];
    const appt = makeAppointment(input.petId, input.day, input.time, input.serviceId, { addOnIds: input.addOnIds, notes: input.notes });
    appointments.push(appt);
    return [201, { appointments: [appt], skipped: [] }];
  }
  if ((match = p.match(/^(?:admin\/)?appointments\/([^/]+)(?:\/(\w[\w-]*))?$/))) {
    const appt = appointments.find((a) => a.id === match[1]);
    if (!appt) return [404, { error: { message: 'Appointment not found.' } }];
    const action = match[2];
    if (action === 'ics') return [200, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'text/calendar'];
    if (action === 'cancel' || (action === 'status' && (await body(req)).status === 'cancelled')) Object.assign(appt, { status: 'cancelled', locks: [] });
    return [200, appt];
  }
  if (p === 'waitlist') return [200, waitlist];

  if (!admin) return [403, { error: { message: 'Staff access only.' } }];
  if (p === 'admin/agenda') {
    const from = q.get('from'), to = q.get('to');
    return [200, { from, to, appointments: sorted(appointments.filter((a) => a.day >= from && a.day <= to)), waitlist: [], closures: closures.filter((c) => c.date >= from && c.date <= to) }];
  }
  if (p === 'admin/settings') return [200, settings];
  if ((match = p.match(/^admin\/catalog\/(service|addon|closure)$/))) return [200, { service: services, addon: addOns, closure: closures }[match[1]]];
  if (p === 'admin/clients') return [200, [...profiles.values()].map((profile) => ({ profile, petCount: pets.filter((x) => x.ownerId === profile.ownerId).length }))];
  if ((match = p.match(/^admin\/clients\/([^/]+)$/))) {
    const profile = profiles.get(match[1]);
    return [200, { profile, pets: pets.filter((x) => x.ownerId === profile.ownerId), appointments: sorted(appointments.filter((a) => a.ownerId === profile.ownerId)) }];
  }
  if (p === 'admin/stats') return [200, stats(q.get('from'), q.get('to'))];
  return [404, { error: { message: `Demo server has no handler for ${m} /api/${p}` } }];
}

// ---------- HTTP ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cookieAs = /mockas=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
    const as = url.searchParams.get('as') ?? cookieAs ?? 'guest';
    if (url.searchParams.get('as')) res.setHeader('Set-Cookie', `mockas=${as}; Path=/`);

    if (url.pathname === '/.auth/me') {
      const principal = as === 'guest' ? null : { identityProvider: 'entraExternalId', userId: as === 'new' ? 'owner-new' : OWNER, userDetails: as === 'new' ? 'jo@example.com' : 'sam@example.com', userRoles: as === 'admin' ? ['anonymous', 'authenticated', 'admin'] : ['anonymous', 'authenticated'] };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ clientPrincipal: principal }));
      return;
    }
    if (url.pathname.startsWith('/.auth/login')) {
      res.writeHead(302, { Location: url.searchParams.get('post_login_redirect_uri') ?? '/', 'Set-Cookie': 'mockas=owner; Path=/' }).end();
      return;
    }
    if (url.pathname.startsWith('/.auth/logout')) {
      res.writeHead(302, { Location: '/', 'Set-Cookie': 'mockas=guest; Path=/' }).end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        const [status, payload, type] = await api(req, url, as);
        res.writeHead(status, { 'Content-Type': type ?? 'application/json' });
        res.end(payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: String(err) } }));
      }
      return;
    }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  })
  .listen(PORT, () => console.log(`Top Notch Dog Grooming demo on http://localhost:${PORT}  (?as=guest | owner | admin)`));
