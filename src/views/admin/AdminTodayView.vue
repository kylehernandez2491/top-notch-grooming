<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AgendaResponse, Appointment } from '@shared/types';
import { formatMoney, formatTime12, fromMinutes, toMinutes } from '@shared/format';
import { api } from '@/api/client';
import AgendaCard from '@/components/AgendaCard.vue';
import Icon from '@/components/Icon.vue';
import { useSwipe } from '@/composables/useSwipe';
import { useCatalog } from '@/stores/catalog';
import { addDays, longDay, relativeDay } from '@/utils/dates';

const catalog = useCatalog();
const route = useRoute();
const router = useRouter();
const day = ref((route.query.day as string) || catalog.today);
const agenda = ref<AgendaResponse | null>(null);
const loading = ref(false);
const error = ref('');
const root = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    agenda.value = await api.admin.agenda(day.value, day.value);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

watch(day, (d) => {
  router.replace({ query: d === catalog.today ? {} : { day: d } });
  load();
});

// Keep the front desk view fresh without anyone touching it.
let timer: number | undefined;
const onFocus = () => document.visibilityState === 'visible' && load();
onMounted(() => {
  load();
  timer = window.setInterval(load, 60_000);
  document.addEventListener('visibilitychange', onFocus);
});
onBeforeUnmount(() => {
  window.clearInterval(timer);
  document.removeEventListener('visibilitychange', onFocus);
});

useSwipe(root, { left: () => (day.value = addDays(day.value, 1)), right: () => (day.value = addDays(day.value, -1)) });

const active = computed(() => (agenda.value?.appointments ?? []).filter((a) => a.status !== 'cancelled'));
const cancelled = computed(() => (agenda.value?.appointments ?? []).filter((a) => a.status === 'cancelled'));
const expected = computed(() => active.value.filter((a) => a.status !== 'no-show').reduce((s, a) => s + (a.finalPrice ?? a.estimatedPrice), 0));
const done = computed(() => active.value.filter((a) => a.status === 'completed').length);

/** Free stretches of 30+ minutes inside opening hours — handy for phone and walk-in bookings. */
const gaps = computed(() => {
  const settings = catalog.settings;
  if (!settings) return [];
  const weekday = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(`${day.value}T12:00`).getDay()];
  const hours = settings.weeklyHours[weekday];
  if (!hours) return [];
  const busy = [
    ...active.value.map((a) => [toMinutes(a.startTime), toMinutes(a.endTime) + settings.bufferMinutes]),
    ...hours.breaks.map((b) => [toMinutes(b.start), toMinutes(b.end)]),
    ...(agenda.value?.closures ?? []).filter((c) => c.start && c.end).map((c) => [toMinutes(c.start!), toMinutes(c.end!)]),
  ].sort((x, y) => x[0] - y[0]);
  const result: { start: string; end: string }[] = [];
  let cursor = toMinutes(hours.open);
  for (const [s, e] of busy) {
    if (s - cursor >= 30) result.push({ start: fromMinutes(cursor), end: fromMinutes(s) });
    cursor = Math.max(cursor, e);
  }
  if (toMinutes(hours.close) - cursor >= 30) result.push({ start: fromMinutes(cursor), end: hours.close });
  return result;
});

function replace(updated: Appointment) {
  if (!agenda.value) return;
  agenda.value.appointments = agenda.value.appointments.map((a) => (a.id === updated.id ? updated : a));
}
</script>

<template>
  <div ref="root" class="page">
    <header class="day-nav">
      <button type="button" class="icon-btn" aria-label="Previous day" @click="day = addDays(day, -1)"><Icon name="chevron-left" /></button>
      <div class="day-title">
        <h1>{{ relativeDay(day, catalog.today) }}</h1>
        <span class="row date-row">
          <span class="muted small">{{ longDay(day) }}</span>
          <input v-model="day" type="date" class="date-input" aria-label="Jump to a date" />
        </span>
      </div>
      <button type="button" class="icon-btn" aria-label="Next day" @click="day = addDays(day, 1)"><Icon name="chevron-right" /></button>
      <button v-if="day !== catalog.today" type="button" class="btn btn-sm" @click="day = catalog.today">Today</button>
      <button type="button" class="icon-btn refresh" aria-label="Refresh" :disabled="loading" @click="load"><Icon name="refresh" /></button>
    </header>

    <p v-if="error" class="alert">{{ error }}</p>

    <section class="stats">
      <div class="stat"><strong class="tabular">{{ active.length }}</strong><span>pets booked</span></div>
      <div class="stat"><strong class="tabular">{{ done }}</strong><span>done</span></div>
      <div class="stat"><strong class="tabular">{{ formatMoney(expected) }}</strong><span>expected</span></div>
      <div class="stat"><strong class="tabular">{{ agenda?.waitlist.length ?? 0 }}</strong><span>on waitlist</span></div>
    </section>

    <section v-for="c in agenda?.closures ?? []" :key="c.id" class="note">
      <Icon name="clock" :size="18" />
      <span>{{ c.start ? `${formatTime12(c.start)} to ${formatTime12(c.end!)}` : 'All day' }}: {{ c.reason }}</span>
    </section>

    <div v-if="loading && !agenda" class="skeleton" style="height: 200px" />

    <section class="stack" aria-label="Appointments">
      <AgendaCard v-for="a in active" :key="a.id" :appointment="a" @updated="replace" />
      <div v-if="agenda && !active.length" class="panel muted">Nothing booked for this day.</div>
    </section>

    <section v-if="gaps.length" class="stack">
      <h2 class="section-title">Free time</h2>
      <div class="chips">
        <span v-for="g in gaps" :key="g.start" class="badge gap tabular">{{ formatTime12(g.start) }} to {{ formatTime12(g.end) }}</span>
      </div>
      <p class="small muted">To book a phone or walk-in client, open them from Clients and choose Book for client.</p>
    </section>

    <details v-if="cancelled.length" class="panel">
      <summary>{{ cancelled.length }} cancelled</summary>
      <div class="stack cancelled">
        <AgendaCard v-for="a in cancelled" :key="a.id" :appointment="a" compact />
      </div>
    </details>
  </div>
</template>

<style scoped>
.day-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.day-title {
  display: grid;
  flex: 1;
  min-width: 0;
}

.date-row {
  gap: 8px;
}

.date-input {
  min-height: 32px;
  padding: 2px 6px;
  border: 1px solid var(--grout-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--step--1);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  padding: 3px;
  border-radius: 12px;
  background: var(--grout);
}

.stat {
  display: grid;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface);
}

.stat strong {
  font-size: var(--step-1);
  font-variation-settings: 'CASL' 1;
}

.stat span {
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.section-title {
  font-size: var(--step-1);
}

.gap {
  background: var(--brand-faint);
  padding: 6px 12px;
}

.cancelled {
  margin-top: 10px;
}

summary {
  cursor: pointer;
  font-weight: 640;
}

@media (max-width: 520px) {
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
