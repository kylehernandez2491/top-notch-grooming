import { DateTime } from 'luxon';
import type { MeResponse, OwnerProfile } from '../shared/types';
import { ACTIVE_STATUSES } from '../shared/types';
import { cancelAppointment } from '../lib/actions';
import { getPrincipal, isAdmin, requireUser } from '../lib/auth';
import { clean, getContainers } from '../lib/cosmos';
import { raw, readBody, route } from '../lib/http';
import { ensureProfile, findAppointment, getSettings, listOwnerAppointments, listPets } from '../lib/repo';
import { profileInput } from '../lib/validation';

route('meGet', ['GET'], 'me', async (req): Promise<MeResponse> => {
  const principal = requireUser(req);
  const c = await getContainers();
  const profile = await ensureProfile(c, principal);
  return { profile, roles: principal.userRoles, isAdmin: isAdmin(principal) };
});

route('meUpdate', ['PUT'], 'me', async (req): Promise<MeResponse> => {
  const principal = requireUser(req);
  const input = await readBody(req, profileInput);
  const c = await getContainers();
  const current = await ensureProfile(c, principal);
  const next: OwnerProfile = { ...current, ...input, onboarded: true, updatedAt: new Date().toISOString() };
  const { resource } = await c.owners.items.upsert<OwnerProfile>(next);
  return { profile: clean(resource ?? next), roles: principal.userRoles, isAdmin: isAdmin(principal) };
});

/** "Download my data" — profile, pets and appointment history as JSON. */
route('meExport', ['GET'], 'me/export', async (req) => {
  const principal = requireUser(req);
  const c = await getContainers();
  const [profile, pets, appointments] = await Promise.all([
    ensureProfile(c, principal),
    listPets(c, principal.userId, true),
    listOwnerAppointments(c, principal.userId),
  ]);
  return raw({
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="my-grooming-data-${DateTime.now().toISODate()}.json"`,
    },
    body: JSON.stringify({ exportedAt: new Date().toISOString(), profile, pets, appointments }, null, 2),
  });
});

/** Account deletion: cancels upcoming appointments, then deletes the profile and pets. */
route('meDelete', ['DELETE'], 'me', async (req, ctx) => {
  const principal = requireUser(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const now = new Date().toISOString();
  const upcoming = (await listOwnerAppointments(c, principal.userId)).filter(
    (a) => ACTIVE_STATUSES.includes(a.status) && a.startUtc > now,
  );
  for (const a of upcoming) {
    const fresh = await findAppointment(c, a.id);
    await cancelAppointment(c, ctx, req, fresh, settings, 'owner', 'Account closed');
  }
  const pets = await listPets(c, principal.userId, true);
  for (const pet of pets) await c.owners.item(pet.id, principal.userId).delete();
  await c.owners.item(principal.userId, principal.userId).delete().catch(() => undefined);
  ctx.log(`Deleted account ${getPrincipal(req)?.userId}`);
  return undefined;
});
