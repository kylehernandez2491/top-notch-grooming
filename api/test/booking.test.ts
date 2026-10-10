import { describe, expect, it } from 'vitest';
import type { Container, OperationInput } from '@azure/cosmos';
import { buildAppointment, insertAppointment, moveAppointment, releaseAppointment } from '../src/lib/booking';
import { defaultAddOns, defaultServices, defaultSettings } from '../src/lib/seed';
import { addOnApplies, formatMoney, formatPriceRange, servicePrice, sizePrice, sizesFor } from '../src/shared/format';
import type { Appointment, OwnerProfile, Pet } from '../src/shared/types';
import { PET_SIZES } from '../src/shared/types';

/**
 * In-memory stand-in for a Cosmos container that honours the parts of transactional batch semantics
 * the booking engine relies on: all-or-nothing, 409 on duplicate ids, 412 on stale ETags, 404 on
 * missing deletes, and a thrown error carrying per-operation status codes.
 */
class FakeContainer {
  docs = new Map<string, Record<string, unknown>>();
  private etag = 0;
  private key = (pk: string, id: string) => `${pk}|${id}`;

  item(id: string, pk: string) {
    return {
      read: async () => ({ resource: this.docs.get(this.key(pk, id)) }),
    };
  }

  items = {
    batch: async (operations: OperationInput[], pk: string) => {
      const draft = new Map(this.docs);
      const statuses: number[] = [];
      let failed = 0;
      for (const op of operations) {
        if (failed) {
          statuses.push(424);
          continue;
        }
        const body = 'resourceBody' in op ? (op.resourceBody as Record<string, unknown>) : undefined;
        const id = ('id' in op ? op.id : (body!.id as string)) as string;
        const k = this.key(pk, id);
        const existing = draft.get(k);
        let status = 200;
        if (op.operationType === 'Create') {
          if (existing) status = 409;
          else draft.set(k, { ...body, _etag: `e${++this.etag}` });
          if (status === 200) status = 201;
        } else if (op.operationType === 'Replace') {
          if (!existing) status = 404;
          else if (op.ifMatch && existing._etag !== op.ifMatch) status = 412;
          else draft.set(k, { ...body, _etag: `e${++this.etag}` });
        } else if (op.operationType === 'Delete') {
          if (!existing) status = 404;
          else draft.delete(k);
          if (status === 200) status = 204;
        }
        statuses.push(status);
        if (status >= 400) {
          failed = status;
          for (let i = 0; i < statuses.length - 1; i++) statuses[i] = 424;
        }
      }
      if (failed) {
        const err = new Error('Batch request error') as Error & { cause: unknown };
        err.cause = { code: failed, body: statuses.map((statusCode) => ({ statusCode })) };
        throw err;
      }
      this.docs = draft;
      return { code: 200, result: statuses.map((statusCode) => ({ statusCode, requestCharge: 1 })) };
    },
  };

  find(pk: string, id: string) {
    return this.docs.get(this.key(pk, id)) as (Appointment & { _etag?: string }) | undefined;
  }
}

const settings = { ...defaultSettings(), timeZone: 'America/Chicago', maxAppointmentsPerDay: 2 };
const service = defaultServices().find((s) => s.id === 'basic-grooming')!;
const profile: OwnerProfile = {
  id: 'o1', type: 'profile', ownerId: 'o1', email: 'a@b.c', displayName: 'Sam', emailReminders: true,
  emailMarketing: false, onboarded: true, noShowCount: 0, createdAt: '', updatedAt: '',
};
const pet: Pet = {
  id: 'p1', type: 'pet', ownerId: 'o1', name: 'Biscuit', species: 'dog', breed: 'Corgi', size: 'medium',
  temperament: 'friendly', vaccinations: [], createdAt: '', updatedAt: '',
};
const DAY = '2026-10-13';

function appt(time: string, day = DAY) {
  return buildAppointment({ day, time, pet, profile, service, addOns: [], settings, bookedBy: 'owner' });
}

describe('service menu', () => {
  const menu = defaultServices();
  const byId = (id: string) => menu.find((x) => x.id === id)!;

  it('offers exactly the four services, priced for every dog size', () => {
    expect(menu.map((x) => x.name)).toEqual(['Basic Grooming', 'Full Grooming', 'Cat Grooming', 'Bath / Blow Dry']);
    for (const svc of menu) {
      expect(Object.keys(svc.priceBySize).sort()).toEqual(['husky_chow', 'large', 'medium', 'small']);
      expect(svc.inclusions?.length).toBeGreaterThan(0);
    }
  });

  it('matches the shop price list in pesos', () => {
    const grid = (id: string) => PET_SIZES.map((z) => formatPriceRange(sizePrice(byId(id), z).min, sizePrice(byId(id), z).max));
    expect(grid('basic-grooming')).toEqual(['₱380', '₱480', '₱650', '₱750–₱850']);
    expect(grid('full-grooming')).toEqual(['₱500', '₱600', '₱700', '₱800–₱850']);
    expect(grid('bath-blow-dry')).toEqual(['₱250', '₱350', '₱450–₱550', '₱450–₱550']);
    expect(sizesFor(byId('cat-grooming'))).toEqual(['small']);
    expect(formatMoney(byId('cat-grooming').priceBySize.small)).toBe('₱500');
  });

  it('offers the face design only with Basic Grooming for small and medium dogs, at ₱50 more', () => {
    const face = defaultAddOns().find((a) => a.id === 'face-design')!;
    const basic = byId('basic-grooming');
    expect(addOnApplies(face, 'basic-grooming', 'dog', 'small')).toBe(true);
    expect(addOnApplies(face, 'basic-grooming', 'dog', 'medium')).toBe(true);
    expect(addOnApplies(face, 'basic-grooming', 'dog', 'large')).toBe(false);
    expect(addOnApplies(face, 'full-grooming', 'dog', 'small')).toBe(false);
    expect(servicePrice(basic, [face], 'small')).toBe(430);
    expect(servicePrice(basic, [face], 'medium')).toBe(530);
  });

  it('records a price range on the booking when the price depends on coat volume', () => {
    const husky = { ...pet, size: 'husky_chow' as const };
    const a = buildAppointment({ day: DAY, time: '09:00', pet: husky, profile, service, addOns: [], settings, bookedBy: 'owner' });
    expect([a.estimatedPrice, a.estimatedPriceMax]).toEqual([750, 850]);
    expect(appt('09:00').estimatedPriceMax).toBeUndefined();
  });
});

describe('transactional booking', () => {
  it('creates the appointment, its locks and the day counter together', async () => {
    const fake = new FakeContainer();
    const a = appt('09:00');
    expect(await insertAppointment(fake as unknown as Container, a, settings, true)).toEqual({ ok: true });
    // Basic Grooming, medium dog: 75 min + 15 buffer = 6 blocks
    expect(a.locks).toEqual(['lock-09:00', 'lock-09:15', 'lock-09:30', 'lock-09:45', 'lock-10:00', 'lock-10:15']);
    expect(fake.find(DAY, 'summary')).toMatchObject({ count: 1 });
    expect(fake.find(DAY, 'lock-09:45')).toMatchObject({ appointmentId: a.id });
  });

  it('never double-books, even when two requests race for overlapping times', async () => {
    const fake = new FakeContainer();
    const results = await Promise.all([
      insertAppointment(fake as unknown as Container, appt('09:00'), settings, true),
      insertAppointment(fake as unknown as Container, appt('09:30'), settings, true),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'conflict' });
    expect(fake.find(DAY, 'summary')).toMatchObject({ count: 1 });
  });

  it('enforces the daily cap for owners but not staff', async () => {
    const fake = new FakeContainer();
    const c = fake as unknown as Container;
    await insertAppointment(c, appt('09:00'), settings, true);
    await insertAppointment(c, appt('11:00'), settings, true);
    expect(await insertAppointment(c, appt('14:00'), settings, true)).toEqual({ ok: false, reason: 'full' });
    expect(await insertAppointment(c, appt('14:00'), settings, false)).toEqual({ ok: true });
  });

  it('releases locks and decrements the counter on cancel', async () => {
    const fake = new FakeContainer();
    const c = fake as unknown as Container;
    const a = appt('09:00');
    await insertAppointment(c, a, settings, true);
    const stored = fake.find(DAY, a.id)!;
    await releaseAppointment(c, stored, { ...a, status: 'cancelled', locks: [] }, settings.timeZone);
    expect(fake.find(DAY, 'lock-09:00')).toBeUndefined();
    expect(fake.find(DAY, 'summary')).toMatchObject({ count: 0 });
    expect(fake.find(DAY, a.id)).toMatchObject({ status: 'cancelled' });
    // The time is bookable again
    expect(await insertAppointment(c, appt('09:00'), settings, true)).toEqual({ ok: true });
  });

  it('rejects a stale cancel (someone else changed the appointment first)', async () => {
    const fake = new FakeContainer();
    const c = fake as unknown as Container;
    const a = appt('09:00');
    await insertAppointment(c, a, settings, true);
    const stale = { ...fake.find(DAY, a.id)!, _etag: 'old' };
    await expect(releaseAppointment(c, stale, { ...a, status: 'cancelled', locks: [] }, settings.timeZone)).rejects.toMatchObject({ status: 409 });
  });

  it('moves within a day, keeping overlapping locks and freeing the rest', async () => {
    const fake = new FakeContainer();
    const c = fake as unknown as Container;
    const a = appt('09:00');
    await insertAppointment(c, a, settings, true);
    const moved = { ...a, startTime: '09:30', locks: ['lock-09:30', 'lock-09:45', 'lock-10:00', 'lock-10:15', 'lock-10:30', 'lock-10:45'] };
    expect(await moveAppointment(c, fake.find(DAY, a.id)!, moved, settings, true)).toEqual({ ok: true });
    expect(fake.find(DAY, 'lock-09:00')).toBeUndefined();
    expect(fake.find(DAY, 'lock-10:30')).toBeDefined();
    expect(fake.find(DAY, 'summary')).toMatchObject({ count: 1 });
  });

  it('moves across days: books the new day, then releases the old one', async () => {
    const fake = new FakeContainer();
    const c = fake as unknown as Container;
    const a = appt('09:00');
    await insertAppointment(c, a, settings, true);
    const NEXT = '2026-10-14';
    const moved = { ...appt('09:00', NEXT), id: a.id };
    expect(await moveAppointment(c, fake.find(DAY, a.id)!, moved, settings, true)).toEqual({ ok: true });
    expect(fake.find(DAY, a.id)).toBeUndefined();
    expect(fake.find(NEXT, a.id)).toMatchObject({ day: NEXT });
    expect(fake.find(DAY, 'summary')).toMatchObject({ count: 0 });
    expect(fake.find(NEXT, 'summary')).toMatchObject({ count: 1 });
  });
});

describe('pet validation', () => {
  it('requires one of the four dog sizes and stores cats as one size', async () => {
    const { petInput } = await import('../src/lib/validation');
    const base = { name: 'Koda', species: 'dog', size: 'husky_chow', vaccinations: [] };
    expect(petInput.safeParse(base).success).toBe(true);
    expect(petInput.safeParse({ ...base, size: 'xlarge' }).success).toBe(false);
    expect(petInput.safeParse({ ...base, size: undefined }).success).toBe(false);
    // Cat Grooming is one price, so a cat's size is always stored as small.
    expect(petInput.parse({ ...base, species: 'cat' }).size).toBe('small');
  });
});

describe('client details', () => {
  it('requires a name, contact number, email and address', async () => {
    const { profileInput } = await import('../src/lib/validation');
    const ok = {
      displayName: 'Sam Reyes',
      phone: '0917 123 4567',
      email: 'sam@example.com',
      address: '12 Mabini Street, Barangay Uno, Sample City',
      emailReminders: true,
      emailMarketing: false,
    };
    expect(profileInput.safeParse(ok).success).toBe(true);
    expect(profileInput.safeParse({ ...ok, phone: '+63 917 123 4567' }).success).toBe(true);
    expect(profileInput.safeParse({ ...ok, phone: '' }).success).toBe(false);
    expect(profileInput.safeParse({ ...ok, phone: 'call me' }).success).toBe(false);
    expect(profileInput.safeParse({ ...ok, email: 'not-an-email' }).success).toBe(false);
    expect(profileInput.safeParse({ ...ok, address: '' }).success).toBe(false);
  });
});
