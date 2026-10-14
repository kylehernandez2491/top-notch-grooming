<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { DateTime } from 'luxon';
import { useRoute } from 'vue-router';
import type { Appointment } from '@shared/types';
import { formatDuration, formatMoney, formatPriceRange, formatTime12 } from '@shared/format';
import { googleCalendarUrl } from '@shared/ics';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';
import PetAvatar from '@/components/PetAvatar.vue';
import StarRating from '@/components/StarRating.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { useUi } from '@/stores/ui';
import { addDays, longDay, relativeDay, shortDay, timestamp } from '@/utils/dates';
import { shareOrCopy, shopDirectionsUrl, telUrl } from '@/utils/device';

const route = useRoute();
const account = useAccount();
const catalog = useCatalog();
const ui = useUi();

const appointment = ref<Appointment | null>(null);
const error = ref('');
const notes = ref('');
const savingNotes = ref(false);
const rating = ref(0);
const comment = ref('');
const sendingReview = ref(false);
/** Set when this page was opened from an email link, possibly on a device that didn't book it. */
const token = typeof route.query.t === 'string' ? route.query.t : undefined;

onMounted(async () => {
  try {
    appointment.value = await api.appointment(route.params.id as string, token);
    notes.value = appointment.value.notes ?? '';
    if (route.hash === '#review') setTimeout(() => document.getElementById('review')?.scrollIntoView({ behavior: 'smooth' }), 300);
  } catch (err) {
    error.value = (err as Error).message;
  }
});

const a = computed(() => appointment.value);
const pet = computed(() => account.petById(a.value?.petId));
const upcoming = computed(() => !!a.value && a.value.status === 'booked' && a.value.startUtc > new Date().toISOString());
const late = computed(() => {
  if (!a.value || !catalog.settings) return false;
  return DateTime.fromISO(a.value.startUtc).diffNow('hours').hours < catalog.settings.cancellationWindowHours;
});
const calendarEvent = computed(() =>
  a.value && catalog.settings
    ? {
        uid: a.value.id,
        startUtc: a.value.startUtc,
        endUtc: a.value.endUtc,
        summary: `${a.value.petName}: ${a.value.serviceName}`,
        location: catalog.settings.address,
        description: `${catalog.settings.shopName} ${catalog.settings.phone}`,
      }
    : null,
);
const nextVisitDay = computed(() => {
  const weeks = a.value?.reportCard?.nextVisitWeeks;
  if (!a.value || !weeks) return undefined;
  const day = addDays(a.value.day, weeks * 7);
  return day > catalog.today ? day : undefined;
});

function update(next: Appointment) {
  appointment.value = next;
  account.upsertAppointment(next);
}

async function cancel() {
  if (!a.value) return;
  const { confirmed, reason } = await ui.confirm({
    title: `Cancel ${a.value.petName}'s appointment?`,
    message: late.value
      ? `This is within ${catalog.settings?.cancellationWindowHours} hours of the appointment, so it will be noted as a late cancellation.`
      : 'The time will be released to the next person on the waitlist.',
    confirmLabel: 'Cancel appointment',
    cancelLabel: 'Keep it',
    danger: true,
    reasonLabel: 'Reason (optional)',
  });
  if (!confirmed) return;
  try {
    update(await api.cancel(a.value.id, reason, token));
    ui.toast('Appointment cancelled.', 'success');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}

async function saveNotes() {
  if (!a.value) return;
  savingNotes.value = true;
  try {
    update(await api.updateNotes(a.value.id, notes.value.trim() || undefined, token));
    ui.toast('Notes saved.', 'success');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  } finally {
    savingNotes.value = false;
  }
}

async function sendReview() {
  if (!a.value || !rating.value) return;
  sendingReview.value = true;
  try {
    update(await api.review(a.value.id, rating.value, comment.value.trim() || undefined, token));
    ui.toast('Thanks for the feedback!', 'success');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  } finally {
    sendingReview.value = false;
  }
}

async function share() {
  if (!a.value) return;
  const result = await shareOrCopy({
    title: `${a.value.petName}'s grooming`,
    text: `${a.value.petName} has ${a.value.serviceName} on ${longDay(a.value.day)} at ${formatTime12(a.value.startTime)}, ${catalog.settings?.shopName ?? ''}.`,
  });
  if (result === 'copied') ui.toast('Copied to clipboard.');
}

const eventLabels: Record<string, string> = {
  created: 'Booked',
  rescheduled: 'Moved',
  notes: 'Notes updated',
  booked: 'Booked',
  'checked-in': 'Checked in',
  'in-progress': 'Grooming started',
  completed: 'Finished',
  cancelled: 'Cancelled',
  'no-show': 'Marked as no-show',
};
</script>

<template>
  <div class="page page-narrow">
    <RouterLink to="/appointments" class="back small"><Icon name="chevron-left" :size="16" /> Visits</RouterLink>
    <p v-if="error" class="alert">{{ error }}</p>
    <div v-if="!a && !error" class="skeleton" style="height: 260px" />

    <template v-if="a">
      <header class="head">
        <PetAvatar :name="a.petName" :photo="pet?.photo" :size="64" />
        <div class="stack head-text">
          <h1 class="head-title">{{ a.petName }}'s {{ a.serviceName }}</h1>
          <StatusBadge :status="a.status" />
        </div>
      </header>

      <section class="panel when">
        <p class="when-rel muted">{{ relativeDay(a.day, catalog.today) }}</p>
        <p class="when-main">{{ longDay(a.day) }}</p>
        <p class="when-time tabular">{{ formatTime12(a.startTime) }} drop-off, pick-up around {{ formatTime12(a.endTime) }}</p>
        <div v-if="upcoming" class="row actions">
          <a class="btn btn-sm" :href="api.icsUrl(a.id, token)"><Icon name="calendar" :size="18" /> Add to calendar</a>
          <a v-if="calendarEvent" class="btn btn-sm" :href="googleCalendarUrl(calendarEvent)" target="_blank" rel="noopener">Google Calendar</a>
          <button type="button" class="btn btn-sm" @click="share"><Icon name="share" :size="18" /> Share</button>
          <a v-if="catalog.settings" class="btn btn-sm" :href="shopDirectionsUrl()" target="_blank" rel="noopener">
            <Icon name="map" :size="18" /> Directions
          </a>
        </div>
      </section>

      <section v-if="a.status === 'cancelled'" class="note">
        <Icon name="alert" :size="18" />
        <span>
          Cancelled{{ a.cancelReason ? `: ${a.cancelReason}` : '' }}.
          <RouterLink :to="{ path: '/book', query: { petId: a.petId, serviceId: a.serviceId } }">Book a new time</RouterLink>
        </span>
      </section>

      <section class="panel">
        <dl class="details">
          <dt>Service</dt>
          <dd>{{ a.serviceName }}</dd>
          <template v-if="a.addOns.length">
            <dt>Extras</dt>
            <dd>{{ a.addOns.map((x) => x.name).join(', ') }}</dd>
          </template>
          <dt>Time needed</dt>
          <dd>{{ formatDuration(a.durationMinutes) }}</dd>
          <dt>{{ a.finalPrice !== undefined ? 'Paid' : 'Estimate' }}</dt>
          <dd class="tabular">{{ a.finalPrice !== undefined ? formatMoney(a.finalPrice) : formatPriceRange(a.estimatedPrice, a.estimatedPriceMax) }}</dd>
        </dl>
      </section>

      <section v-if="upcoming" class="panel stack">
        <label for="appt-notes" class="field-label">Notes for the groomer</label>
        <textarea id="appt-notes" v-model="notes" class="textarea" maxlength="500" placeholder="New lump on her back leg, please check" />
        <div class="row">
          <button type="button" class="btn btn-sm" :disabled="savingNotes || notes === (a.notes ?? '')" @click="saveNotes">Save notes</button>
        </div>
      </section>

      <section v-if="a.reportCard" class="panel stack report" aria-labelledby="rc">
        <h2 id="rc" class="section-title">Report card</h2>
        <dl class="details">
          <dt>Behavior</dt>
          <dd>{{ a.reportCard.behavior }}</dd>
          <dt>Coat and skin</dt>
          <dd>{{ a.reportCard.coat }}</dd>
          <dt>Groomer's notes</dt>
          <dd>{{ a.reportCard.notes }}</dd>
          <dt>Recommendations</dt>
          <dd>{{ a.reportCard.recommendations }}</dd>
        </dl>
        <RouterLink
          v-if="a.reportCard.nextVisitWeeks"
          class="btn btn-primary"
          :to="{ path: '/book', query: { petId: a.petId, serviceId: a.serviceId, addOns: a.addOns.map((x) => x.id).join(','), day: nextVisitDay } }"
        >
          Book the next visit (in {{ a.reportCard.nextVisitWeeks }} weeks{{ nextVisitDay ? `, ${shortDay(nextVisitDay)}` : '' }})
        </RouterLink>
      </section>

      <section v-if="a.status === 'completed'" id="review" class="panel stack" aria-labelledby="rv">
        <h2 id="rv" class="section-title">{{ a.review ? 'Your review' : `How did ${a.petName}'s groom go?` }}</h2>
        <template v-if="a.review">
          <StarRating :model-value="a.review.rating" readonly />
          <p v-if="a.review.comment">{{ a.review.comment }}</p>
        </template>
        <template v-else>
          <StarRating v-model="rating" />
          <div class="field">
            <label for="review-comment">Comments (optional)</label>
            <textarea id="review-comment" v-model="comment" class="textarea" maxlength="1000" />
          </div>
          <button type="button" class="btn btn-primary" :disabled="!rating || sendingReview" @click="sendReview">Send review</button>
        </template>
      </section>

      <div v-if="upcoming" class="stack">
        <p v-if="late" class="small muted">{{ catalog.settings?.policies.cancellation }}</p>
        <div class="row">
          <RouterLink :to="{ path: `/appointments/${a.id}/reschedule`, query: token ? { t: token } : {} }" class="btn btn-dark">
            <Icon name="clock" :size="18" /> Change time
          </RouterLink>
          <button type="button" class="btn btn-danger" @click="cancel">Cancel appointment</button>
        </div>
      </div>

      <details class="panel history">
        <summary>History</summary>
        <ol class="timeline">
          <li v-for="(h, i) in a.history" :key="i">
            <strong>{{ eventLabels[h.event] ?? h.event }}</strong>
            <span class="muted small">{{ timestamp(h.at) }}{{ h.by === 'staff' ? ' by the shop' : '' }}{{ h.note ? `. ${h.note}` : '' }}</span>
          </li>
        </ol>
      </details>

      <p v-if="catalog.settings" class="small muted">
        Questions? Call <a :href="telUrl(catalog.settings.phone)">{{ catalog.settings.phone }}</a>.
      </p>
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  color: var(--ink-soft);
  font-weight: 600;
  min-height: 44px;
}

.head {
  display: flex;
  gap: 16px;
  align-items: center;
}

.head-text {
  gap: 6px;
  justify-items: start;
}

.head-title {
  font-size: var(--step-2);
}

.when {
  display: grid;
  gap: 4px;
}

.when-rel {
  font-weight: 640;
}

.when-main {
  font-size: var(--step-2);
  font-weight: 780;
  font-variation-settings: 'CASL' 1;
  line-height: 1.2;
}

.actions {
  margin-top: 12px;
}

.details {
  display: grid;
  grid-template-columns: minmax(110px, auto) 1fr;
  gap: 10px 16px;
  margin: 0;
}

.details dt {
  color: var(--ink-soft);
  font-size: var(--step--1);
  font-weight: 600;
  padding-top: 2px;
}

.details dd {
  margin: 0;
}

.section-title {
  font-size: var(--step-1);
}

.report {
  border-color: var(--fill-line);
}

.history summary {
  cursor: pointer;
  font-weight: 640;
  min-height: 32px;
}

.timeline {
  margin: 12px 0 0;
  padding: 0 0 0 18px;
  display: grid;
  gap: 10px;
}

.timeline li {
  display: grid;
}
</style>
