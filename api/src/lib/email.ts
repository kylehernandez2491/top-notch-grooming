import { EmailClient, EmailMessage } from '@azure/communication-email';
import type { InvocationContext } from '@azure/functions';
import type { Appointment, BusinessSettings, WaitlistEntry } from '../shared/types';
import { formatDuration, formatPriceRange, formatTime12 } from '../shared/format';
import { buildIcs } from '../shared/ics';
import { friendlyDate } from './time';

let client: EmailClient | undefined;

function getClient(): EmailClient | undefined {
  const connectionString = process.env.ACS_CONNECTION_STRING;
  if (!connectionString || !process.env.EMAIL_SENDER) return undefined;
  client ??= new EmailClient(connectionString);
  return client;
}

interface OutgoingEmail {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  ics?: string;
  icsName?: string;
}

/**
 * Fire-and-forget send through Azure Communication Services. beginSend() queues the message; we do
 * not poll for delivery so the API stays fast. Email problems never fail a booking.
 */
export async function sendEmail(ctx: InvocationContext, email: OutgoingEmail): Promise<void> {
  if (!email.to) return;
  const acs = getClient();
  if (!acs) {
    ctx.log(`[email disabled] would send "${email.subject}" to ${email.to}`);
    return;
  }
  const message: EmailMessage = {
    senderAddress: process.env.EMAIL_SENDER!,
    content: { subject: email.subject, html: email.html, plainText: email.text },
    recipients: { to: [{ address: email.to, displayName: email.toName }] },
    attachments: email.ics
      ? [{ name: email.icsName ?? 'appointment.ics', contentType: 'text/calendar', contentInBase64: Buffer.from(email.ics).toString('base64') }]
      : undefined,
  };
  try {
    await acs.beginSend(message);
  } catch (err) {
    ctx.warn(`Email "${email.subject}" to ${email.to} failed`, err);
  }
}

// ---------- templates ----------

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function layout(settings: BusinessSettings, appUrl: string, heading: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${cta.url}" style="background:#fad006;color:#0a0a0a;border:2px solid #0a0a0a;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fad006;border-radius:16px 16px 0 0;padding:16px 24px;display:flex;align-items:center">
      <img src="${appUrl}/brand/logo@2x.png" width="56" height="56" alt="${esc(settings.shopName)}" style="border-radius:50%;display:block">
      <span style="font-size:18px;font-weight:800;margin-left:12px">${esc(settings.shopName)}</span>
    </div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px;border:1px solid #e2e2e0;border-top:0">
      <h1 style="font-size:22px;margin:0 0 12px">${esc(heading)}</h1>
      ${body}
      ${button}
    </div>
    <p style="font-size:12px;color:#545454;margin-top:16px">${esc(settings.shopName)} · ${esc(settings.address)} · ${esc(settings.phone)}</p>
  </div></body></html>`;
}

function details(a: Appointment) {
  const rows: [string, string][] = [
    ['When', `${friendlyDate(a.day)}, ${formatTime12(a.startTime)}`],
    ['Pick-up around', formatTime12(a.endTime)],
    ['Pet', `${a.petName} (${a.petBreed || a.petSpecies})`],
    ['Service', a.serviceName + (a.addOns.length ? ` + ${a.addOns.map((x) => x.name).join(', ')}` : '')],
    ['Estimated time', formatDuration(a.durationMinutes)],
    ['Estimated price', `${formatPriceRange(a.estimatedPrice, a.estimatedPriceMax)} (${a.estimatedPriceMax ? 'final price confirmed at pick-up, depends on coat volume' : 'pay at pick-up'})`],
  ];
  return `<table style="width:100%;border-collapse:collapse;font-size:15px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#545454;width:40%">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`,
    )
    .join('')}</table>`;
}

function textDetails(a: Appointment) {
  return `${a.petName} — ${a.serviceName}\n${friendlyDate(a.day)} at ${formatTime12(a.startTime)} (pick-up ~${formatTime12(a.endTime)})\nEstimated ${formatPriceRange(a.estimatedPrice, a.estimatedPriceMax)}, pay at pick-up.`;
}

/** The owner's private link to a booking. It works on any device, so it's only ever sent to the owner. */
export function manageUrl(a: Pick<Appointment, 'id' | 'manageToken'>, appUrl: string): string {
  return `${appUrl}/appointments/${a.id}?t=${encodeURIComponent(a.manageToken)}`;
}

function ics(a: Appointment, settings: BusinessSettings, appUrl: string, method: 'REQUEST' | 'CANCEL' = 'REQUEST') {
  return buildIcs({
    uid: `${a.id}@topnotchgrooming`,
    startUtc: a.startUtc,
    endUtc: a.endUtc,
    summary: `${a.petName}: ${a.serviceName} at ${settings.shopName}`,
    description: `Manage your booking: ${manageUrl(a, appUrl)}`,
    location: settings.address,
    url: manageUrl(a, appUrl),
    method,
    sequence: Math.floor(Date.now() / 1000),
  });
}

export const templates = {
  confirmed(a: Appointment, s: BusinessSettings, appUrl: string): OutgoingEmail {
    return {
      to: a.ownerEmail,
      toName: a.ownerName,
      subject: `You're booked: ${a.petName} on ${friendlyDate(a.day)} at ${formatTime12(a.startTime)}`,
      html: layout(s, appUrl,
        `See you soon, ${a.petName}! 🐾`,
        `${details(a)}<p style="font-size:14px;color:#545454;margin-top:18px">${esc(s.policies.cancellation)}</p><p style="font-size:14px;color:#545454">Keep this email: the button below opens your booking on any phone or computer.</p>`,
        { label: 'View or change booking', url: manageUrl(a, appUrl) },
      ),
      text: `You're booked!\n\n${textDetails(a)}\n\nManage (keep this link private): ${manageUrl(a, appUrl)}`,
      ics: ics(a, s, appUrl),
    };
  },

  rescheduled(a: Appointment, s: BusinessSettings, appUrl: string): OutgoingEmail {
    return {
      to: a.ownerEmail,
      toName: a.ownerName,
      subject: `New time for ${a.petName}: ${friendlyDate(a.day)} at ${formatTime12(a.startTime)}`,
      html: layout(s, appUrl, 'Your appointment has moved', details(a), { label: 'View booking', url: manageUrl(a, appUrl) }),
      text: `Your appointment has moved.\n\n${textDetails(a)}`,
      ics: ics(a, s, appUrl),
    };
  },

  cancelled(a: Appointment, s: BusinessSettings, appUrl: string, byStaff: boolean): OutgoingEmail {
    const intro = byStaff
      ? `<p>We're sorry — we had to cancel ${esc(a.petName)}'s appointment.${a.cancelReason ? ` Reason: ${esc(a.cancelReason)}` : ''} Please pick a new time that suits you.</p>`
      : `<p>${esc(a.petName)}'s appointment has been cancelled. We hope to see you again soon.</p>`;
    return {
      to: a.ownerEmail,
      toName: a.ownerName,
      subject: `Cancelled: ${a.petName} on ${friendlyDate(a.day)}`,
      html: layout(s, appUrl, 'Appointment cancelled', intro + details(a), { label: 'Book a new time', url: `${appUrl}/book` }),
      text: `Cancelled: ${textDetails(a)}\n\nBook again: ${appUrl}/book`,
      ics: ics(a, s, appUrl, 'CANCEL'),
      icsName: 'cancelled.ics',
    };
  },

  reminder(a: Appointment, s: BusinessSettings, appUrl: string): OutgoingEmail {
    return {
      to: a.ownerEmail,
      toName: a.ownerName,
      subject: `Reminder: ${a.petName} is booked tomorrow at ${formatTime12(a.startTime)}`,
      html: layout(s, appUrl,
        `Pamper day for ${a.petName} 🛁`,
        `${details(a)}<p style="font-size:14px;color:#545454;margin-top:18px">Tip: a short walk before drop-off helps nervous pets settle. ${esc(s.policies.lateArrival)}</p>`,
        { label: 'Need to change it?', url: manageUrl(a, appUrl) },
      ),
      text: `Reminder: ${textDetails(a)}\n\nChange or cancel: ${manageUrl(a, appUrl)}`,
    };
  },

  waitlistOpening(w: WaitlistEntry, s: BusinessSettings, appUrl: string): OutgoingEmail {
    const url = `${appUrl}/book?petId=${encodeURIComponent(w.petId)}&serviceId=${encodeURIComponent(w.serviceId)}&day=${w.day}`;
    return {
      to: w.ownerEmail,
      toName: w.ownerName,
      subject: `A spot opened up on ${friendlyDate(w.day)}`,
      html: layout(s, appUrl,
        'Good news — a spot opened up!',
        `<p>You're on the waitlist for <strong>${esc(friendlyDate(w.day))}</strong> (${esc(w.petName)}, ${esc(w.serviceName)}). Spots go fast, so grab it while you can.</p>`,
        { label: 'Book the open spot', url },
      ),
      text: `A spot opened up on ${friendlyDate(w.day)}. Book it: ${url}`,
    };
  },

  reportCard(a: Appointment, s: BusinessSettings, appUrl: string): OutgoingEmail {
    return {
      to: a.ownerEmail,
      toName: a.ownerName,
      subject: `${a.petName}'s grooming report card is ready`,
      html: layout(s, appUrl,
        `${a.petName} was a star ⭐`,
        `<p>The groomer left notes about today's visit, plus a recommendation for the next one.</p>`,
        { label: 'Read the report card', url: manageUrl(a, appUrl) },
      ),
      text: `${a.petName}'s report card is ready: ${manageUrl(a, appUrl)}`,
    };
  },

  staffNotice(kind: 'booked' | 'cancelled' | 'rescheduled', a: Appointment, s: BusinessSettings, appUrl: string): OutgoingEmail {
    return {
      to: process.env.STAFF_NOTIFY_EMAIL ?? '',
      subject: `[${kind}] ${a.petName} — ${friendlyDate(a.day)} ${formatTime12(a.startTime)}`,
      html: layout(s, appUrl,
        `Appointment ${kind}`,
        `${details(a)}${a.petAlerts.length ? `<p style="color:#c62828"><strong>Alerts:</strong> ${esc(a.petAlerts.join(' · '))}</p>` : ''}<p>Owner: ${esc(a.ownerName)} · ${esc(a.ownerPhone ?? a.ownerEmail)}</p>`,
        { label: 'Open in staff portal', url: `${appUrl}/admin/appointments/${a.id}` },
      ),
      text: `${kind}: ${textDetails(a)}\nOwner: ${a.ownerName} ${a.ownerPhone ?? a.ownerEmail}`,
    };
  },
};
