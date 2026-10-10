import { timingSafeEqual } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import type { Appointment } from '../shared/types';
import { saveAppointment } from '../lib/booking';
import { clean, getContainers } from '../lib/cosmos';
import { sendEmail, templates } from '../lib/email';
import { baseUrl, HttpError, route } from '../lib/http';
import { getProfile, getSettings, queryAll } from '../lib/repo';

function assertJobKey(req: HttpRequest) {
  const expected = process.env.JOBS_KEY ?? '';
  const provided = req.headers.get('x-jobs-key') ?? '';
  const ok =
    expected.length >= 24 &&
    expected.length === provided.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!ok) throw new HttpError(401, 'Invalid job key.', 'unauthorized');
}

/**
 * Sends "see you tomorrow" emails. Managed functions only support HTTP triggers, so a scheduled
 * GitHub Actions workflow (.github/workflows/reminders.yml) calls this hourly with x-jobs-key.
 * Idempotent: each appointment is stamped with reminderSentAt.
 */
route('jobsReminders', ['POST'], 'jobs/reminders', async (req, ctx) => {
  assertJobKey(req);
  const c = await getContainers();
  const settings = await getSettings(c);
  const leadHours = Number(process.env.REMINDER_LEAD_HOURS ?? 24);
  const now = new Date();
  const until = new Date(now.getTime() + leadHours * 3_600_000);

  const due = await queryAll<Appointment & { _etag?: string }>(
    c.bookings,
    `SELECT * FROM c WHERE c.type = "appointment" AND c.status = "booked"
       AND c.startUtc > @now AND c.startUtc <= @until AND NOT IS_DEFINED(c.reminderSentAt)`,
    [
      { name: '@now', value: now.toISOString() },
      { name: '@until', value: until.toISOString() },
    ],
  );

  const appUrl = baseUrl(req);
  let sent = 0;
  let skipped = 0;
  for (const appointment of due) {
    const profile = await getProfile(c, appointment.ownerId);
    const wantsEmail = profile?.emailReminders !== false;
    if (wantsEmail) {
      await sendEmail(ctx, templates.reminder(appointment, settings, appUrl));
      sent++;
    } else {
      skipped++;
    }
    try {
      await saveAppointment(c.bookings, appointment, { ...clean(appointment), reminderSentAt: new Date().toISOString() });
    } catch (err) {
      ctx.warn(`Could not stamp reminder on ${appointment.id}`, err);
    }
  }
  ctx.log(`Reminders: ${sent} sent, ${skipped} opted out, ${due.length} due`);
  return { due: due.length, sent, skipped };
});
