import { adminEmails } from '../lib/auth';
import { route } from '../lib/http';

interface RolesSourceRequest {
  identityProvider?: string;
  userId?: string;
  userDetails?: string;
  claims?: { typ: string; val: string }[];
}

/**
 * SWA "rolesSource" function (Standard plan + custom auth). SWA calls this once at sign-in and
 * attaches the returned roles to the session. Everyone listed in ADMIN_EMAILS becomes "admin";
 * everyone else is a regular pet owner ("authenticated" is always added by SWA).
 * Role changes take effect on the user's next sign-in.
 */
route('roles', ['POST'], 'roles', async (req, ctx) => {
  let body: RolesSourceRequest = {};
  try {
    body = (await req.json()) as RolesSourceRequest;
  } catch {
    return { roles: [] };
  }
  const emails = new Set<string>();
  if (body.userDetails?.includes('@')) emails.add(body.userDetails.toLowerCase());
  for (const claim of body.claims ?? []) {
    if (/(^|\/)(email|emails|emailaddress|preferred_username)$/i.test(claim.typ) && claim.val.includes('@')) {
      emails.add(claim.val.toLowerCase());
    }
  }
  const admins = adminEmails();
  const roles = [...emails].some((e) => admins.includes(e)) ? ['admin'] : [];
  ctx.log(`rolesSource: ${body.userId ?? 'unknown'} -> [${roles.join(',')}]`);
  return { roles };
});
