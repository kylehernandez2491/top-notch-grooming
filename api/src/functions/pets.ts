import { randomUUID } from 'node:crypto';
import type { Pet } from '../shared/types';
import { ACTIVE_STATUSES } from '../shared/types';
import { requireUser } from '../lib/auth';
import { clean, getContainers } from '../lib/cosmos';
import { conflict, created, readBody, route } from '../lib/http';
import { getPet, listOwnerAppointments, listPets } from '../lib/repo';
import { petInput } from '../lib/validation';

route('petsList', ['GET'], 'pets', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  return listPets(c, principal.userId);
});

route('petsCreate', ['POST'], 'pets', async (req) => {
  const principal = requireUser(req);
  const input = await readBody(req, petInput);
  const c = await getContainers();
  const existing = await listPets(c, principal.userId);
  if (existing.length >= 20) throw conflict('That is a lot of pets! Please call us to add more.', 'too_many_pets');
  const now = new Date().toISOString();
  const pet: Pet = {
    ...input,
    photo: input.photo ?? undefined,
    id: randomUUID(),
    type: 'pet',
    ownerId: principal.userId,
    createdAt: now,
    updatedAt: now,
  };
  const { resource } = await c.owners.items.create<Pet>(pet);
  return created(clean(resource ?? pet));
});

route('petsGet', ['GET'], 'pets/{id}', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  return clean(await getPet(c, principal.userId, req.params.id));
});

route('petsUpdate', ['PUT'], 'pets/{id}', async (req) => {
  const principal = requireUser(req);
  const input = await readBody(req, petInput);
  const c = await getContainers();
  const current = await getPet(c, principal.userId, req.params.id);
  const next: Pet = {
    ...clean(current),
    ...input,
    // photo: undefined = keep, null = remove, string = replace
    photo: input.photo === undefined ? current.photo : input.photo ?? undefined,
    updatedAt: new Date().toISOString(),
  };
  const { resource } = await c.owners
    .item(current.id, principal.userId)
    .replace<Pet>(next, { accessCondition: { type: 'IfMatch', condition: current._etag! } });
  return clean(resource ?? next);
});

/** Soft delete: history keeps referring to the pet, but it disappears from the owner's list. */
route('petsDelete', ['DELETE'], 'pets/{id}', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  const pet = await getPet(c, principal.userId, req.params.id);
  const now = new Date().toISOString();
  const upcoming = (await listOwnerAppointments(c, principal.userId)).filter(
    (a) => a.petId === pet.id && ACTIVE_STATUSES.includes(a.status) && a.startUtc > now,
  );
  if (upcoming.length) {
    throw conflict(`${pet.name} has ${upcoming.length} upcoming appointment(s). Cancel them first.`, 'has_upcoming');
  }
  await c.owners.item(pet.id, principal.userId).replace({ ...clean(pet), archived: true, photo: undefined, updatedAt: now });
  return undefined;
});
