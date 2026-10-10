<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DateTime } from 'luxon';
import type { AdminStats } from '@shared/types';
import { formatMoney, formatTime12, fromMinutes } from '@shared/format';
import { api } from '@/api/client';
import BarChart from '@/components/BarChart.vue';
import Icon from '@/components/Icon.vue';
import { useCatalog } from '@/stores/catalog';

const catalog = useCatalog();
type Preset = 'month' | 'last-month' | '90' | 'year';
const preset = ref<Preset>('month');
const from = ref('');
const to = ref('');
const stats = ref<AdminStats | null>(null);
const error = ref('');
const loading = ref(false);

function applyPreset(p: Preset) {
  const today = DateTime.fromISO(catalog.today);
  const ranges: Record<Preset, [DateTime, DateTime]> = {
    month: [today.startOf('month'), today.endOf('month')],
    'last-month': [today.minus({ months: 1 }).startOf('month'), today.minus({ months: 1 }).endOf('month')],
    '90': [today.minus({ days: 89 }), today],
    year: [today.startOf('year'), today],
  };
  from.value = ranges[p][0].toISODate()!;
  to.value = ranges[p][1].toISODate()!;
}

watch(preset, applyPreset, { immediate: true });
watch(
  [from, to],
  async () => {
    if (!from.value || !to.value || to.value < from.value) return;
    loading.value = true;
    error.value = '';
    try {
      stats.value = await api.admin.stats(from.value, to.value);
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

const presets: { key: Preset; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: '90', label: 'Last 90 days' },
  { key: 'year', label: 'This year' },
];

const weekdayLabels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' } as const;
const weekdayItems = computed(() => (stats.value?.byWeekday ?? []).map((d) => ({ label: weekdayLabels[d.weekday], value: d.count, display: `${d.count} visits` })));
const hourItems = computed(() =>
  (stats.value?.byHour ?? []).map((h) => ({ label: formatTime12(fromMinutes(h.hour * 60)).replace(':00', ''), value: h.count, display: `${h.count} visits` })),
);
const serviceItems = computed(() =>
  (stats.value?.topServices ?? []).map((s) => ({ label: s.name, value: s.count, display: `${s.count}`, detail: `${formatMoney(s.revenue)} earned` })),
);
</script>

<template>
  <div class="page">
    <header class="spread">
      <h1>Reports</h1>
      <a class="btn btn-sm" :href="api.admin.exportUrl(from, to)" download><Icon name="download" :size="18" /> Export CSV</a>
    </header>

    <div class="filters">
      <div class="chips" role="radiogroup" aria-label="Period">
        <button
          v-for="p in presets"
          :key="p.key"
          type="button"
          role="radio"
          class="chip"
          :aria-checked="preset === p.key ? 'true' : 'false'"
          @click="preset = p.key"
        >
          {{ p.label }}
        </button>
      </div>
      <div class="row range">
        <input v-model="from" type="date" class="input" aria-label="From" />
        <span class="muted">to</span>
        <input v-model="to" type="date" class="input" aria-label="To" />
      </div>
    </div>

    <p v-if="error" class="alert">{{ error }}</p>

    <section v-if="stats" class="tiles" :aria-busy="loading">
      <div class="tile-stat hero">
        <span class="label">Revenue</span>
        <strong class="value tabular">{{ formatMoney(stats.revenue) }}</strong>
        <span class="sub">{{ stats.completed }} completed visits</span>
      </div>
      <div class="tile-stat">
        <span class="label">Average ticket</span>
        <strong class="value tabular">{{ formatMoney(Math.round(stats.averageTicket)) }}</strong>
      </div>
      <div class="tile-stat">
        <span class="label">Upcoming</span>
        <strong class="value tabular">{{ stats.upcoming }}</strong>
      </div>
      <div class="tile-stat">
        <span class="label">No-show rate</span>
        <strong class="value tabular">{{ Math.round(stats.noShowRate * 100) }}%</strong>
        <span class="sub">{{ stats.noShows }} no-shows</span>
      </div>
      <div class="tile-stat">
        <span class="label">Cancellations</span>
        <strong class="value tabular">{{ stats.cancelled }}</strong>
        <span class="sub">{{ stats.lateCancellations }} late</span>
      </div>
      <div class="tile-stat">
        <span class="label">New clients</span>
        <strong class="value tabular">{{ stats.newClients }}</strong>
      </div>
      <div class="tile-stat">
        <span class="label">Rating</span>
        <strong class="value tabular">{{ stats.rating ? stats.rating.average.toFixed(1) : 'None' }}</strong>
        <span class="sub">{{ stats.rating ? `${stats.rating.count} reviews` : 'No reviews yet' }}</span>
      </div>
    </section>
    <div v-else-if="loading" class="skeleton" style="height: 160px" />

    <div v-if="stats" class="charts">
      <section class="panel"><BarChart title="Visits by weekday" :items="weekdayItems" /></section>
      <section class="panel"><BarChart title="Visits by start hour" :items="hourItems" /></section>
      <section class="panel wide"><BarChart title="Most booked services" :items="serviceItems" orientation="bar" /></section>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  gap: 12px;
}

.range .input {
  width: auto;
  flex: 1;
  max-width: 190px;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
  padding: 3px;
  border-radius: 14px;
  background: var(--grout);
}

.tile-stat {
  display: grid;
  align-content: start;
  gap: 2px;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--surface);
}

.tile-stat.hero {
  grid-column: 1 / -1;
}

.label {
  font-size: var(--step--1);
  font-weight: 600;
  color: var(--ink-soft);
}

.value {
  font-size: var(--step-2);
  font-weight: 800;
  font-variation-settings: 'CASL' 1;
  line-height: 1.1;
}

.hero .value {
  font-size: var(--step-4);
}

.sub {
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.charts {
  display: grid;
  gap: 16px;
}

@media (min-width: 900px) {
  .tiles {
    grid-template-columns: repeat(4, 1fr);
  }
  .tile-stat.hero {
    grid-column: span 2;
  }
  .charts {
    grid-template-columns: 1fr 1fr;
  }
  .wide {
    grid-column: 1 / -1;
  }
}
</style>
