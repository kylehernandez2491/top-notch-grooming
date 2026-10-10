/** The contact details every client gives us: shared by the welcome screen and the account screen. */
export interface ContactDetails {
  displayName: string;
  phone: string;
  email: string;
  address: string;
}

/** Mirrors the API's profile rules so mistakes show next to the field before saving. */
export function contactErrors(c: ContactDetails): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!c.displayName.trim()) errors.displayName = 'Enter your name';
  const phone = c.phone.trim();
  const digits = phone.replace(/\D/g, '');
  if (!/^[0-9+()\s.-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = 'Enter a valid contact number, e.g. 0917 123 4567';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) errors.email = 'Enter a valid email address';
  if (c.address.trim().length < 5) errors.address = 'Enter your address';
  return errors;
}

export function trimContact(c: ContactDetails): ContactDetails {
  return { displayName: c.displayName.trim(), phone: c.phone.trim(), email: c.email.trim(), address: c.address.trim() };
}
