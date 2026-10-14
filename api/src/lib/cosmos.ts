import { Container, CosmosClient, IndexingPolicy } from '@azure/cosmos';
import type { AddOn, BusinessSettings, Service } from '../shared/types';
import { defaultAddOns, defaultServices, defaultSettings, MENU_VERSION } from './seed';

/**
 * Containers (owner profiles and pets live on the owner's device; each appointment carries a copy)
 *  - bookings (pk /day):     appointments, slot locks, a per-day summary and waitlist entries.
 *                            Same partition => a transactional batch can create an appointment and
 *                            every lock it needs atomically (no double booking, ever).
 *  - catalog  (pk /kind):    settings, services, add-ons and closures.
 */
export interface Containers {
  bookings: Container;
  catalog: Container;
}

const DATABASE = process.env.COSMOS_DATABASE ?? 'grooming';

const bookingsIndexing: IndexingPolicy = {
  indexingMode: 'consistent',
  automatic: true,
  includedPaths: [{ path: '/*' }],
  // Pet profiles and free-text notes are never filtered on — skip them to save RU on writes.
  excludedPaths: [
    { path: '/notes/?' },
    { path: '/staffNotes/?' },
    { path: '/history/*' },
    { path: '/reportCard/*' },
    { path: '/pet/*' },
    { path: '/"_etag"/?' },
  ],
};

let ready: Promise<Containers> | undefined;

export function getContainers(): Promise<Containers> {
  if (!ready) {
    ready = init().catch((err) => {
      ready = undefined; // let the next request retry a failed cold start
      throw err;
    });
  }
  return ready;
}

function createClient(): CosmosClient {
  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  if (connectionString) return new CosmosClient(connectionString);
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) {
    throw new Error('Cosmos DB is not configured. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT + COSMOS_KEY.');
  }
  // Managed functions in SWA cannot use managed identity, so key auth is required here.
  return new CosmosClient({ endpoint, key });
}

async function init(): Promise<Containers> {
  const client = createClient();
  const db = client.database(DATABASE);

  if (process.env.COSMOS_SKIP_INIT === 'true') {
    return { bookings: db.container('bookings'), catalog: db.container('catalog') };
  }

  const { database } = await client.databases.createIfNotExists({ id: DATABASE });
  const [bookings, catalog] = await Promise.all([
    database.containers.createIfNotExists({
      id: 'bookings',
      partitionKey: { paths: ['/day'] },
      indexingPolicy: bookingsIndexing,
      defaultTtl: -1, // TTL on, per-document only (locks, summaries, waitlist entries expire; appointments don't)
    }),
    database.containers.createIfNotExists({ id: 'catalog', partitionKey: { paths: ['/kind'] } }),
  ]);

  const containers = { bookings: bookings.container, catalog: catalog.container };
  await seedCatalog(containers.catalog);
  return containers;
}

/** First run: default business settings and the shop's service menu. Later runs: apply menu upgrades once. */
async function seedCatalog(catalog: Container) {
  const { resource } = await catalog.item('settings', 'settings').read<BusinessSettings>();
  if (resource) return upgradeMenu(catalog, resource);
  await catalog.items.upsert(defaultSettings());
  for (const service of defaultServices()) await catalog.items.upsert(service);
  for (const addOn of defaultAddOns()) await catalog.items.upsert(addOn);
}

/**
 * Brings a database seeded with an older built-in menu up to MENU_VERSION, once. A service is only
 * replaced if it is still the untouched dollar-priced original; anything the groomer edited is kept and
 * just gains the new "what's included" list. Missing built-in add-ons are added, and the previous
 * default shop address and hours are updated to the current settings.
 */
async function upgradeMenu(catalog: Container, settings: BusinessSettings) {
  if ((settings.menuVersion ?? 1) >= MENU_VERSION) return;
  for (const service of defaultServices()) {
    const { resource: existing } = await catalog.item(service.id, 'service').read<Service>();
    const stillOriginal = existing && !existing.inclusions && Math.max(...Object.values(existing.priceBySize)) < 200;
    if (!existing || stillOriginal) await catalog.items.upsert(service);
    else if (!existing.inclusions) await catalog.items.upsert({ ...clean(existing), inclusions: service.inclusions });
  }
  for (const addOn of defaultAddOns()) {
    const { resource: existing } = await catalog.item(addOn.id, 'addon').read<AddOn>();
    if (!existing) await catalog.items.upsert(addOn);
  }
  const defaults = defaultSettings();
  const weeklyHours = { ...settings.weeklyHours };
  const previousHours: BusinessSettings['weeklyHours'] = {
    mon: null,
    tue: { open: '08:30', close: '17:00', breaks: [{ start: '12:30', end: '13:00' }] },
    wed: { open: '08:30', close: '17:00', breaks: [{ start: '12:30', end: '13:00' }] },
    thu: { open: '08:30', close: '17:00', breaks: [{ start: '12:30', end: '13:00' }] },
    fri: { open: '08:30', close: '17:00', breaks: [{ start: '12:30', end: '13:00' }] },
    sat: { open: '08:00', close: '14:00', breaks: [] },
    sun: null,
  };
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const) {
    const current = weeklyHours[day];
    const previous = previousHours[day];
    const isUnchangedDefault = current === null
      ? previous === null
      : previous !== null &&
        current.open === previous.open &&
        current.close === previous.close &&
        current.breaks.length === previous.breaks.length &&
        current.breaks.every((b, index) => b.start === previous.breaks[index]?.start && b.end === previous.breaks[index]?.end);
    if (isUnchangedDefault) weeklyHours[day] = { open: '08:00', close: '17:00', breaks: [] };
  }
  const updatedSettings = {
    ...clean(settings),
    address: settings.address === 'Purok 3, Calipahan, Talavera, Nueva Ecija, Philippines' ? defaults.address : settings.address,
    weeklyHours,
    menuVersion: MENU_VERSION,
  };
  await catalog.items.upsert(updatedSettings);
}

/** Strip Cosmos system properties before returning documents to clients. */
export function clean<T extends object>(doc: T): T {
  const copy: Record<string, unknown> = { ...(doc as Record<string, unknown>) };
  for (const key of Object.keys(copy)) if (key.startsWith('_')) delete copy[key];
  delete copy.ttl;
  return copy as T;
}
