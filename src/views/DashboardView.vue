<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { DateTime } from 'luxon';
import { formatTime12 } from '@shared/format';
import { api } from '@/api/client';
import AppointmentRow from '@/components/AppointmentRow.vue';
import Icon from '@/components/Icon.vue';
import PetAvatar from '@/components/PetAvatar.vue';
import { useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { addDays, longDay, relativeDay, shortDay } from '@/utils/dates';
import { shopDirectionsUrl } from '@/utils/device';

const account = useAccount();
const catalog = useCatalog();
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    await Promise.all([account.loadAppointments(true), account.loadWaitlist(true)]);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
});

const next = computed(() => account.next);
const nextPet = computed(() => account.petById(next.value?.petId));
const later = computed(() => account.upcoming.slice(1, 4));

const countdown = computed(() => {
  if (!next.value) return '';
  const diff = DateTime.fromISO(next.value.startUtc).diffNow(['days', 'hours']);
  if (diff.days >= 1) return `in ${Math.floor(diff.days)} day${Math.floor(diff.days) === 1 ? '' : 's'}`;
  if (diff.hours >= 1) return `in ${Math.round(diff.hours)} hours`;
  return 'very soon';
});

const toReview = computed(() =>
  account.past.filter((a) => a.status === 'completed' && !a.review && a.day >= addDays(catalog.today, -30)).slice(0, 2),
);

function suggestedDay(appointmentDay: string, weeks?: number) {
  if (!weeks) return undefined;
  const day = addDays(appointmentDay, weeks * 7);
  return day > catalog.today ? day : undefined;
}
</script>

<template>
  <div class="page">
    <header class="stack">
      <h1>Hi {{ account.firstName || 'there' }}</h1>
    </header>

    <p v-if="error" class="alert"><Icon name="alert" :size="18" /> {{ error }}</p>

    <section v-if="loading" class="panel"><div class="skeleton" style="height: 140px" /></section>

    <section v-else-if="next" class="next panel" aria-labelledby="next-title">
      <div class="next-head">
        <PetAvatar :name="next.petName" :photo="nextPet?.photo" :size="64" />
        <div class="stack next-when">
          <h2 id="next-title" class="next-title">{{ relativeDay(next.day, catalog.today) }} at {{ formatTime12(next.startTime) }}</h2>
          <p class="muted">
            {{ next.petName }}'s {{ next.serviceName }}, {{ longDay(next.day) }}. Pick-up around {{ formatTime12(next.endTime) }} ({{ countdown }}).
          </p>
        </div>
      </div>
      <div class="next-actions">
        <a class="btn btn-sm" :href="api.icsUrl(next.id)"><Icon name="calendar" :size="18" /> Add to calendar</a>
        <a v-if="catalog.settings" class="btn btn-sm" :href="shopDirectionsUrl()" target="_blank" rel="noopener">
          <Icon name="map" :size="18" /> Directions
        </a>
        <RouterLink class="btn btn-sm" :to="`/appointments/${next.id}/reschedule`"><Icon name="clock" :size="18" /> Change time</RouterLink>
        <RouterLink class="btn btn-sm btn-ghost" :to="`/appointments/${next.id}`">Details</RouterLink>
      </div>
    </section>

    <section v-else class="panel empty">
      <Icon name="tub" :size="36" />
      <div class="stack">
        <h2 class="empty-title">Nothing booked yet</h2>
        <p class="muted">Open times are shown as a calendar. It takes about a minute.</p>
        <RouterLink to="/book" class="btn btn-primary">Book a groom</RouterLink>
      </div>
    </section>

    <div class="dash-grid">
      <section v-if="account.rebookSuggestions.length" class="stack" aria-labelledby="again-title">
        <h2 id="again-title" class="section-title">Book again</h2>
        <RouterLink
          v-for="a in account.rebookSuggestions"
          :key="a.id"
          class="option again"
          :to="{
            path: '/book',
            query: {
              petId: a.petId,
              serviceId: a.serviceId,
              addOns: a.addOns.map((x) => x.id).join(','),
              day: suggestedDay(a.day, a.reportCard?.nextVisitWeeks),
            },
          }"
        >
          <span class="row">
            <PetAvatar :name="a.petName" :photo="account.petById(a.petId)?.photo" :size="40" />
            <span class="stack again-text">
              <strong>{{ a.petName }}: {{ a.serviceName }}</strong>
              <span class="muted small">
                Last visit {{ shortDay(a.day) }}<template v-if="suggestedDay(a.day, a.reportCard?.nextVisitWeeks)">
                  . Groomer suggests around {{ shortDay(suggestedDay(a.day, a.reportCard?.nextVisitWeeks)!) }}</template
                >
              </span>
            </span>
            <Icon name="repeat" class="again-icon" />
          </span>
        </RouterLink>
      </section>

      <section v-if="later.length" class="stack" aria-labelledby="later-title">
        <div class="spread">
          <h2 id="later-title" class="section-title">Also coming up</h2>
          <RouterLink to="/appointments" class="small">All visits</RouterLink>
        </div>
        <ul class="divider-list panel list-panel">
          <li v-for="a in later" :key="a.id"><AppointmentRow :appointment="a" :to="`/appointments/${a.id}`" /></li>
        </ul>
      </section>

      <section v-if="toReview.length" class="stack" aria-labelledby="review-title">
        <h2 id="review-title" class="section-title">How did it go?</h2>
        <RouterLink v-for="a in toReview" :key="a.id" :to="`/appointments/${a.id}#review`" class="option">
          <strong>Rate {{ a.petName }}'s {{ a.serviceName }}</strong>
          <span class="muted small">{{ shortDay(a.day) }}. Your feedback goes straight to the groomer.</span>
        </RouterLink>
      </section>

      <section class="stack" aria-labelledby="pets-title">
        <div class="spread">
          <h2 id="pets-title" class="section-title">Your pets</h2>
          <RouterLink to="/pets/new" class="small">Add a pet</RouterLink>
        </div>
        <div class="pets-strip">
          <RouterLink v-for="pet in account.pets" :key="pet.id" :to="`/pets/${pet.id}`" class="pet-chip">
            <PetAvatar :name="pet.name" :photo="pet.photo" :size="56" />
            <span>{{ pet.name }}</span>
          </RouterLink>
          <RouterLink to="/pets/new" class="pet-chip add">
            <span class="add-tile"><Icon name="plus" /></span>
            <span>Add</span>
          </RouterLink>
        </div>
        <p v-if="account.waitlist.length" class="small muted">
          You're on the waitlist for {{ account.waitlist.length }} day{{ account.waitlist.length === 1 ? '' : 's' }}.
          <RouterLink to="/appointments?tab=waitlist">See waitlist</RouterLink>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.next {
  display: grid;
  gap: 16px;
  border-color: var(--fill-line);
  background: linear-gradient(to top, var(--brand-faint) 0 38%, var(--surface) 38%);
}

.next-head {
  display: flex;
  gap: 16px;
  align-items: center;
}

.next-title {
  font-size: var(--step-2);
}

.next-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.empty {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.empty-title {
  font-size: var(--step-1);
}

.dash-grid {
  display: grid;
  gap: 28px;
}

.section-title {
  font-size: var(--step-1);
}

.list-panel {
  padding-block: 0;
}

.again {
  text-decoration: none;
}

.again-text {
  gap: 0;
  flex: 1;
  min-width: 0;
}

.again-icon {
  color: var(--accent-ink);
}

.pets-strip {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding-bottom: 4px;
  scroll-snap-type: x mandatory;
}

.pet-chip {
  display: grid;
  justify-items: center;
  gap: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: var(--step--1);
  scroll-snap-align: start;
  min-width: 64px;
}

.add-tile {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 30%;
  border: 2px dashed var(--grout-strong);
  color: var(--ink-soft);
}

@media (min-width: 900px) {
  .dash-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
