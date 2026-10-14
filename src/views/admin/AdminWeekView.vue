<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AgendaResponse } from '@shared/types';
import { formatTime12, toMinutes } from '@shared/format';
import { hoursOn } from '@shared/hours';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';
import { useCatalog } from '@/stores/catalog';
import { addDays, dayNumber, shortDay, startOfWeek, weekdayShort } from '@/utils/dates';

const catalog = useCatalog();
const route = useRoute();
const router = useRouter();
const start = ref(startOfWeek((route.query.week as string) || catalog.today));
const agenda = ref<AgendaResponse | null>(null);
const error = ref('');
const PX_PER_MIN = 1.1;

const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(start.value, i)));

const scroller = ref<HTMLElement | null>(null);

async function load() {
  error.value = '';
  try {
    agenda.value = await api.admin.agenda(start.value, addDays(start.value, 6));
    // On a phone only one or two days fit, so start the board at today's column.
    await nextTick();
    const todayCol = scroller.value?.querySelector<HTMLElement>('.col.today');
    if (scroller.value) scroller.value.scrollLeft = todayCol ? todayCol.offsetLeft - 56 : 0;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

watch(
  start,
  (s) => {
    router.replace({ query: s === startOfWeek(catalog.today) ? {} : { week: s } });
    load();
  },
  { immediate: true },
);

/** Grid spans the earliest opening to the latest closing across the week, special hours included. */
const bounds = computed(() => {
  const hours = [
    ...(Object.values(catalog.settings?.weeklyHours ?? {}).filter(Boolean) as { open: string; close: string }[]),
    ...(agenda.value?.specialHours ?? []),
  ];
  if (!hours.length) return { from: 8 * 60, to: 18 * 60 };
  return {
    from: Math.floor(Math.min(...hours.map((h) => toMinutes(h.open))) / 60) * 60,
    to: Math.ceil(Math.max(...hours.map((h) => toMinutes(h.close))) / 60) * 60,
  };
});

const hourMarks = computed(() => {
  const marks: number[] = [];
  for (let m = bounds.value.from; m <= bounds.value.to; m += 60) marks.push(m);
  return marks;
});

const top = (hhmm: string) => (toMinutes(hhmm) - bounds.value.from) * PX_PER_MIN;
const height = (from: string, to: string) => Math.max(22, (toMinutes(to) - toMinutes(from)) * PX_PER_MIN);

const byDay = computed(() => {
  const map = new Map<string, AgendaResponse['appointments']>();
  for (const a of agenda.value?.appointments ?? []) {
    if (a.status === 'cancelled') continue;
    map.set(a.day, [...(map.get(a.day) ?? []), a]);
  }
  return map;
});

function blocked(day: string) {
  const hours = catalog.settings ? hoursOn(day, catalog.settings.weeklyHours, agenda.value?.specialHours) : undefined;
  const closures = (agenda.value?.closures ?? []).filter((c) => c.date === day);
  if (!hours || closures.some((c) => !c.start)) return [{ start: formatHHMM(bounds.value.from), end: formatHHMM(bounds.value.to), label: closures.find((c) => !c.start)?.reason ?? 'Closed' }];
  return [
    ...(toMinutes(hours.open) > bounds.value.from ? [{ start: formatHHMM(bounds.value.from), end: hours.open, label: '' }] : []),
    ...(toMinutes(hours.close) < bounds.value.to ? [{ start: hours.close, end: formatHHMM(bounds.value.to), label: '' }] : []),
    ...hours.breaks.map((b) => ({ start: b.start, end: b.end, label: 'Break' })),
    ...closures.map((c) => ({ start: c.start!, end: c.end!, label: c.reason })),
  ];
}

function formatHHMM(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const total = computed(() => [...byDay.value.values()].reduce((s, list) => s + list.length, 0));
</script>

<template>
  <div class="page">
    <header class="spread">
      <div class="row">
        <button type="button" class="icon-btn" aria-label="Previous week" @click="start = addDays(start, -7)"><Icon name="chevron-left" /></button>
        <h1 class="week-title">{{ shortDay(days[0]) }} to {{ shortDay(days[6]) }}</h1>
        <button type="button" class="icon-btn" aria-label="Next week" @click="start = addDays(start, 7)"><Icon name="chevron-right" /></button>
      </div>
      <span class="muted">{{ total }} appointments</span>
    </header>
    <p v-if="error" class="alert">{{ error }}</p>

    <div ref="scroller" class="board-scroll">
      <div class="board" :style="{ '--rows': `${(bounds.to - bounds.from) * PX_PER_MIN}px` }">
        <div class="axis">
          <div class="col-head" />
          <div class="col-body">
            <span v-for="m in hourMarks" :key="m" class="hour tabular" :style="{ top: `${(m - bounds.from) * PX_PER_MIN}px` }">
              {{ formatTime12(formatHHMM(m)).replace(':00', '') }}
            </span>
          </div>
        </div>
        <div v-for="d in days" :key="d" class="col" :class="{ today: d === catalog.today }">
          <RouterLink class="col-head" :to="{ path: '/admin', query: { day: d } }">
            <span class="small muted">{{ weekdayShort(d) }}</span>
            <strong class="tabular">{{ dayNumber(d) }}</strong>
            <span class="badge count">{{ byDay.get(d)?.length ?? 0 }}</span>
          </RouterLink>
          <div class="col-body">
            <span v-for="m in hourMarks" :key="m" class="line" :style="{ top: `${(m - bounds.from) * PX_PER_MIN}px` }" />
            <div
              v-for="b in blocked(d)"
              :key="b.start + b.label"
              class="blocked"
              :style="{ top: `${top(b.start)}px`, height: `${height(b.start, b.end)}px` }"
            >
              <span v-if="b.label" class="small">{{ b.label }}</span>
            </div>
            <RouterLink
              v-for="a in byDay.get(d) ?? []"
              :key="a.id"
              :to="`/admin/appointments/${a.id}`"
              class="block"
              :class="`st-${a.status}`"
              :style="{ top: `${top(a.startTime)}px`, height: `${height(a.startTime, a.endTime)}px` }"
            >
              <strong>{{ a.petName }}</strong>
              <span class="small">{{ formatTime12(a.startTime) }}, {{ a.serviceName }}</span>
              <span v-if="a.petAlerts.length" class="block-alert" aria-label="Has handling alerts"><Icon name="alert" :size="12" /></span>
            </RouterLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.week-title {
  font-size: var(--step-1);
}

.board-scroll {
  overflow-x: auto;
  border: 1px solid var(--grout);
  border-radius: var(--radius-panel);
  background: var(--surface);
  scroll-snap-type: x proximity;
  /* the sticky time axis covers 56px, so snap columns just past it */
  scroll-padding-left: 56px;
}

.board {
  display: grid;
  grid-template-columns: 56px repeat(7, minmax(128px, 1fr));
  min-width: 100%;
}

.axis {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--surface);
  border-right: 1px solid var(--grout);
}

.col {
  border-right: 1px solid var(--grout);
  scroll-snap-align: start;
}

.col.today .col-head {
  background: color-mix(in srgb, var(--brand) 25%, var(--surface));
}

.col-head {
  height: 64px;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 0;
  border-bottom: 1px solid var(--grout);
  text-decoration: none;
  position: relative;
}

.count {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 0.7rem;
  padding: 0 6px;
}

.col-body {
  position: relative;
  height: var(--rows);
}

.hour {
  position: absolute;
  right: 6px;
  transform: translateY(-50%);
  font-size: 0.7rem;
  color: var(--ink-soft);
}

.line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed var(--grout);
}

.blocked {
  position: absolute;
  left: 0;
  right: 0;
  padding: 4px 6px;
  background: repeating-linear-gradient(135deg, var(--surface-sunk) 0 6px, transparent 6px 12px);
  color: var(--ink-soft);
}

.block {
  position: absolute;
  left: 4px;
  right: 4px;
  z-index: 1;
  display: grid;
  align-content: start;
  gap: 0;
  overflow: hidden;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--fill-color);
  color: #0a0a0a;
  text-decoration: none;
  font-size: var(--step--1);
  line-height: 1.25;
  border-left: 4px solid var(--fill-line);
}

.block.st-checked-in,
.block.st-in-progress {
  background: color-mix(in srgb, var(--brand) 60%, white);
  border-left-color: var(--brand-press);
}

.block.st-completed {
  background: var(--ok-bg);
  color: var(--ok);
  border-left-color: var(--ok);
}

.block.st-no-show {
  background: var(--alert-bg);
  color: var(--alert);
  border-left-color: var(--alert);
}

.block-alert {
  position: absolute;
  top: 4px;
  right: 4px;
  color: var(--alert);
}
</style>
