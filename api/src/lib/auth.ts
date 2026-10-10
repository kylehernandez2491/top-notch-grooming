import type { HttpRequest } from '@azure/functions';
import { forbidden, unauthorized } from './http';

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

/**
 * SWA injects x-ms-client-principal (base64 JSON) on every request to a managed function and
 * strips any copy the browser tries to send, so it can be trusted here.
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

export function requireUser(req: HttpRequest): ClientPrincipal {
  const principal = getPrincipal(req);
  if (!principal || !principal.userRoles.includes('authenticated')) throw unauthorized();
  return principal;
}

export function isAdmin(principal: ClientPrincipal | null): boolean {
  return !!principal && principal.userRoles.includes('admin');
}

export function requireAdmin(req: HttpRequest): ClientPrincipal {
  const principal = requireUser(req);
  if (!isAdmin(principal)) throw forbidden('Staff access only.');
  return principal;
}

/** Comma-separated ADMIN_EMAILS app setting — the source of truth for who gets the admin role. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Best-effort email from the principal (userDetails is the email claim with the provided config). */
export function principalEmail(principal: ClientPrincipal): string {
  return principal.userDetails.includes('@') ? principal.userDetails.toLowerCase() : '';
}
