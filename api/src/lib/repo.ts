import type { Container } from '@azure/cosmos';
import type { AddOn, Appointment, BusinessSettings, Closure, RatingSummary, Service, ShopNotice, SpecialHours, WaitlistEntry } from '../shared/types';
import { Containers, clean } from './cosmos';
import { notFound } from './http';
import { defaultSettings } from './seed';

type WithEtag<T> = T & { _etag?: string };

// ---------- catalog (small, read-heavy: cached per instance for a short time) ----------

let catalogCache: { at: number; settings: BusinessSettings; services: Service[]; addOns: AddOn[] } | undefined;
const CATALOG_TTL_MS = 30_000;

export function invalidateCatalog() {
  catalogCache = undefined;
  ratingCache = undefined;
}

export async function loadCatalog(c: Containers) {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache;
  const [settingsRes, services, addOns] = await Promise.all([
    c.catalog.item('settings', 'settings').read<BusinessSettings>(),
    queryAll<Service>(c.catalog, 'SELECT * FROM c WHERE c.kind = "service"', [], 'service'),
    queryAll<AddOn>(c.catalog, 'SELECT * FROM c WHERE c.kind = "addon"', [], 'addon'),
  ]);
  const settings = { ...defaultSettings(), ...(settingsRes.resource ? clean(settingsRes.resource) : {}) };
  catalogCache = {
    at: Date.now(),
    settings,
    services: services.map(clean).sort((a, b) => a.sortOrder - b.sortOrder),
    addOns: addOns.map(clean).sort((a, b) => a.sortOrder - b.sortOrder),
  };
  return catalogCache;
}

export async function getSettings(c: Containers): Promise<BusinessSettings> {
  return (await loadCatalog(c)).settings;
}

export async function getService(c: Containers, id: string): Promise<Service> {
  const service = (await loadCatalog(c)).services.find((s) => s.id === id);
  if (!service) throw notFound('That service is no longer offered.');
  return service;
}

export async function getAddOns(c: Containers, ids: string[]): Promise<AddOn[]> {
  const all = (await loadCatalog(c)).addOns;
  const found = ids.map((id) => all.find((a) => a.id === id && a.active));
  if (found.some((a) => !a)) throw notFound('One of the selected add-ons is no longer offered.');
  return found as AddOn[];
}

export async function listClosures(c: Containers, from: string, to: string): Promise<Closure[]> {
  const rows = await queryAll<Closure>(
    c.catalog,
    'SELECT * FROM c WHERE c.kind = "closure" AND c.date >= @from AND c.date <= @to',
    [
      { name: '@from', value: from },
      { name: '@to', value: to },
    ],
    'closure',
  );
  return rows.map(clean).sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
}

export async function listSpecialHours(c: Containers, from: string, to: string): Promise<SpecialHours[]> {
  const rows = await queryAll<SpecialHours>(
    c.catalog,
    'SELECT * FROM c WHERE c.kind = "hours" AND c.date >= @from AND c.date <= @to',
    [
      { name: '@from', value: from },
      { name: '@to', value: to },
    ],
    'hours',
  );
  return rows.map(clean).sort((a, b) => a.date.localeCompare(b.date));
}

/** The groomer's message for the chat assistant, while it is still showing on `today`. */
export async function getNotice(c: Containers, today: string): Promise<ShopNotice | undefined> {
  const { resource } = await c.catalog.item('notice', 'notice').read<ShopNotice>();
  return resource && resource.until >= today ? clean(resource) : undefined;
}

let ratingCache: { at: number; value?: RatingSummary } | undefined;

export async function ratingSummary(c: Containers): Promise<RatingSummary | undefined> {
  if (ratingCache && Date.now() - ratingCache.at < 10 * 60_000) return ratingCache.value;
  const rows = await queryAll<{ rating: number }>(
    c.bookings,
    'SELECT VALUE { "rating": c.review.rating } FROM c WHERE c.type = "appointment" AND IS_DEFINED(c.review)',
  );
  const value = rows.length
    ? { average: Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10, count: rows.length }
    : undefined;
  ratingCache = { at: Date.now(), value };
  return value;
}

// ---------- bookings ----------

/**
 * Appointments are partitioned by day, so a lookup by id is a cross-partition query. During a
 * cross-day reschedule a stale copy can exist for a moment; the newest copy wins.
 */
export async function findAppointment(c: Containers, id: string): Promise<WithEtag<Appointment>> {
  const rows = await queryAll<WithEtag<Appointment>>(c.bookings, 'SELECT * FROM c WHERE c.type = "appointment" AND c.id = @id', [
    { name: '@id', value: id },
  ]);
  if (!rows.length) throw notFound('Appointment not found.');
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Everything booked from one device (its hashed device key). */
export async function listOwnerAppointments(c: Containers, ownerId: string): Promise<Appointment[]> {
  const rows = await queryAll<Appointment>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "appointment" AND c.ownerId = @o',
    [{ name: '@o', value: ownerId }],
  );
  return dedupe(rows).map(clean).sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

/** One client's visits: booked under their contact number, or from the device they're booking on. */
export async function listClientAppointments(c: Containers, clientKey: string, ownerId?: string): Promise<Appointment[]> {
  const rows = await queryAll<Appointment>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "appointment" AND (c.clientKey = @k OR c.ownerId = @o)',
    [
      { name: '@k', value: clientKey },
      { name: '@o', value: ownerId ?? clientKey },
    ],
  );
  return dedupe(rows).map(clean).sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

/** The few fields the client list and reports need, across every appointment ever booked. */
export type ClientRow = Pick<
  Appointment,
  'id' | 'clientKey' | 'ownerName' | 'ownerEmail' | 'ownerPhone' | 'ownerAddress' | 'ownerEmergencyContact' | 'emailReminders' | 'petId' | 'petName' | 'status' | 'noShowExcused' | 'createdAt' | 'updatedAt'
>;

export async function listClientRows(c: Containers): Promise<ClientRow[]> {
  const rows = await queryAll<ClientRow>(
    c.bookings,
    `SELECT c.id, c.clientKey, c.ownerName, c.ownerEmail, c.ownerPhone, c.ownerAddress, c.ownerEmergencyContact,
            c.emailReminders, c.petId, c.petName, c.status, c.noShowExcused, c.createdAt, c.updatedAt
       FROM c WHERE c.type = "appointment"`,
  );
  return dedupe(rows);
}

export async function listAppointmentsInRange(c: Containers, from: string, to: string): Promise<Appointment[]> {
  const rows = await queryAll<Appointment>(
    c.bookings,
    'SELECT * FROM c WHERE c.type = "appointment" AND c.day >= @from AND c.day <= @to',
    [
      { name: '@from', value: from },
      { name: '@to', value: to },
    ],
  );
  return dedupe(rows).map(clean).sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

export async function loadLocks(c: Containers, from: string, to: string) {
  return queryAll<{ id: string; day: string; appointmentId: string }>(
    c.bookings,
    'SELECT c.id, c.day, c.appointmentId FROM c WHERE c.type = "lock" AND c.day >= @from AND c.day <= @to',
    [
      { name: '@from', value: from },
      { name: '@to', value: to },
    ],
  );
}

export async function loadCounts(c: Containers, from: string, to: string): Promise<Map<string, number>> {
  const rows = await queryAll<{ day: string; count: number }>(
    c.bookings,
    'SELECT c.day, c.count FROM c WHERE c.type = "summary" AND c.day >= @from AND c.day <= @to',
    [
      { name: '@from', value: from },
      { name: '@to', value: to },
    ],
  );
  return new Map(rows.map((r) => [r.day, r.count]));
}

export async function listWaitlist(c: Containers, day: string): Promise<WithEtag<WaitlistEntry>[]> {
  return queryAll<WithEtag<WaitlistEntry>>(c.bookings, 'SELECT * FROM c WHERE c.type = "waitlist" AND c.day = @d', [{ name: '@d', value: day }], day);
}

// ---------- helpers ----------

export async function queryAll<T>(
  container: Container,
  query: string,
  parameters: { name: string; value: string | number | boolean }[] = [],
  partitionKey?: string,
): Promise<T[]> {
  const iterator = container.items.query<T>({ query, parameters }, partitionKey ? { partitionKey } : {});
  const { resources } = await iterator.fetchAll();
  return resources;
}

function dedupe<T extends { id: string; updatedAt: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || existing.updatedAt < row.updatedAt) byId.set(row.id, row);
  }
  return [...byId.values()];
}
