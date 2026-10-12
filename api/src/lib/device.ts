import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cookie, HttpRequest } from '@azure/functions';

/**
 * Pet owners don't sign in. The first time a phone or browser books, it gets a random device key in an
 * HttpOnly cookie that page scripts can't read. Appointments and waitlist entries store only a hash of
 * that key (ownerId), so the key itself lives nowhere but on the device. Email links carry a separate
 * per-appointment manage token so a booking can still be opened on any other device.
 */
export const DEVICE_COOKIE = 'tn_device';
/** The longest cookie lifetime browsers accept. Every booking renews it. */
const MAX_AGE_SECONDS = 400 * 24 * 3600;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

function readCookie(req: HttpRequest, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function ownerIdFor(deviceKey: string): string {
  return `d-${createHash('sha256').update(deviceKey).digest('base64url')}`;
}

/** The ownerId of the device making this request, or undefined if it has never booked. */
export function deviceOwnerId(req: HttpRequest): string | undefined {
  const key = readCookie(req, DEVICE_COOKIE);
  return key && KEY_RE.test(key) ? ownerIdFor(key) : undefined;
}

export function deviceCookie(key: string, maxAge = MAX_AGE_SECONDS): Cookie {
  return { name: DEVICE_COOKIE, value: key, path: '/api', httpOnly: true, secure: true, sameSite: 'Lax', maxAge };
}

/** This device's ownerId plus the cookie to send back: a fresh key on first use, otherwise a renewal. */
export function ensureDevice(req: HttpRequest): { ownerId: string; cookie: Cookie } {
  const existing = readCookie(req, DEVICE_COOKIE);
  const key = existing && KEY_RE.test(existing) ? existing : randomBytes(32).toString('base64url');
  return { ownerId: ownerIdFor(key), cookie: deviceCookie(key) };
}

export const forgetDeviceCookie = (): Cookie => deviceCookie('', 0);

export const newManageToken = () => randomBytes(24).toString('base64url');

export function tokenMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/** Groups one client's bookings for staff: "+63 917 123 4567" and "0917-123-4567" are the same client. */
export function clientKeyFor(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('63') && digits.length === 12 ? `0${digits.slice(2)}` : digits;
}
