import type { HttpRequest } from '@azure/functions';
import { forbidden, unauthorized } from './http';

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

/**
 * Only staff sign in, with Static Web Apps' built-in Microsoft or GitHub login. The admin role comes
 * from an invitation in the Azure portal (Static Web App → Role management). SWA injects
 * x-ms-client-principal (base64 JSON) on every request to a managed function and strips any copy the
 * browser tries to send, so it can be trusted here.
 */
export function getPrincipal(req: HttpRequest): ClientPrincipal | null {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Partial<ClientPrincipal>;
    if (!decoded.userId) return null;
    return {
      identityProvider: decoded.identityProvider ?? 'unknown',
      userId: decoded.userId,
      userDetails: decoded.userDetails ?? '',
      userRoles: decoded.userRoles ?? [],
    };
  } catch {
    return null;
  }
}

export function isAdmin(principal: ClientPrincipal | null): boolean {
  return !!principal && principal.userRoles.includes('admin');
}

export function requireAdmin(req: HttpRequest): ClientPrincipal {
  const principal = getPrincipal(req);
  if (!principal) throw unauthorized('Staff sign-in required.');
  if (!isAdmin(principal)) throw forbidden('Staff access only.');
  return principal;
}
