<script setup lang="ts">
/**
 * The availability calendar, drawn as a grid of day tiles. Each tile fills with yellow as the day
 * fills up, so owners can read "how busy" before tapping. Fully keyboard-navigable ARIA grid;
 * swipe left/right on phones to change month.
 */
import { computed, nextTick, ref } from 'vue';
import type { DayAvailability } from '@shared/types';
import Icon from './Icon.vue';
import { useSwipe } from '@/composables/useSwipe';
import { addDays, addMonths, dayNumber, longDay, monthGrid, monthLabel, monthOf } from '@/utils/dates';

const props = defineProps<{
  month: string;
  days: Map<string, DayAvailability>;
  today: string;
  selected?: string;
  loading?: boolean;
  minMonth?: string;
  maxMonth?: string;
  caption?: string;
}>();

const emit = defineEmits<{ 'update:month': [month: string]; select: [day: string] }>();

const weeks = computed(() => monthGrid(props.month));
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const canPrev = computed(() => !props.minMonth || props.month > props.minMonth);
const canNext = computed(() => !props.maxMonth || props.month < props.maxMonth);
const focusDay = ref<string | null>(null);
const gridEl = ref<HTMLElement | null>(null);

function go(delta: number) {
  if ((delta < 0 && !canPrev.value) || (delta > 0 && !canNext.value)) return;
  emit('update:month', addMonths(props.month, delta));
}

useSwipe(gridEl, { left: () => go(1), right: () => go(-1) });

function info(day: string) {
  return props.days.get(day);
}

function isSelectable(day: string) {
  return (info(day)?.slots.length ?? 0) > 0;
}

/** 0 = empty day, 1 = completely booked. */
function fill(day: string): number {
  const d = info(day);
  if (!d) return 0;
  if (d.status === 'full') return 1;
  if (!d.capacity || (d.status !== 'open' && d.status !== 'limited')) return 0;
  return Math.min(1, Math.max(0, 1 - d.slots.length / d.capacity));
}

function tone(day: string): string {
  const d = info(day);
  if (!d) return 'unknown';
  if (d.status === 'open' || d.status === 'limited') return fill(day) >= 0.6 || d.status === 'limited' ? 'filling' : 'open';
  return d.status;
}

function label(day: string): string {
  const d = info(day);
  const base = longDay(day);
  if (!d) return base;
  if (d.slots.length) return `${base}: ${d.slots.length} ${d.slots.length === 1 ? 'time' : 'times'} open`;
  return `${base}: ${d.reason ?? 'unavailable'}`;
}

const tabbableDay = computed(() => {
  const inMonth = (d?: string) => d && monthOf(d) === props.month;
  if (inMonth(focusDay.value ?? undefined)) return focusDay.value!;
  if (inMonth(props.selected)) return props.selected!;
  if (inMonth(props.today)) return props.today;
  return `${props.month}-01`;
});

function choose(day: string) {
  focusDay.value = day;
  if (monthOf(day) !== props.month) emit('update:month', monthOf(day));
  if (isSelectable(day)) emit('select', day);
}

async function onKey(event: KeyboardEvent, day: string) {
  const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  let target: string | undefined;
  if (event.key in moves) target = addDays(day, moves[event.key]);
  else if (event.key === 'PageUp') target = addDays(day, -28);
  else if (event.key === 'PageDown') target = addDays(day, 28);
  else if (event.key === 'Home') target = addDays(day, -((new Date(`${day}T12:00`).getDay() + 6) % 7));
  else if (event.key === 'End') target = addDays(day, 6 - ((new Date(`${day}T12:00`).getDay() + 6) % 7));
  if (!target) return;
  event.preventDefault();
  const targetMonth = monthOf(target);
  if ((props.minMonth && targetMonth < props.minMonth) || (props.maxMonth && targetMonth > props.maxMonth)) return;
  focusDay.value = target;
  if (targetMonth !== props.month) emit('update:month', targetMonth);
  await nextTick();
  gridEl.value?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus();
}
</script>

<template>
  <section class="cal" :aria-busy="loading ? 'true' : 'false'">
    <header class="cal-head">
      <button class="icon-btn" type="button" :disabled="!canPrev" aria-label="Previous month" @click="go(-1)">
        <Icon name="chevron-left" />
      </button>
      <h3 class="cal-title" aria-live="polite">{{ monthLabel(month) }}</h3>
      <button class="icon-btn" type="button" :disabled="!canNext" aria-label="Next month" @click="go(1)">
        <Icon name="chevron-right" />
      </button>
    </header>

    <div ref="gridEl" class="cal-wall" role="grid" :aria-label="caption ?? `Availability for ${monthLabel(month)}`">
      <div class="cal-row" role="row">
        <span v-for="name in weekdayNames" :key="name" class="cal-weekday" role="columnheader">
          <abbr :title="name">{{ name }}</abbr>
        </span>
      </div>
      <div v-for="week in weeks" :key="week[0]" class="cal-row" role="row">
        <span v-for="day in week" :key="day" role="gridcell" :aria-selected="day === selected ? 'true' : 'false'">
          <button
            type="button"
            class="tile"
            :class="[
              `tone-${tone(day)}`,
              {
                outside: monthOf(day) !== month,
                selected: day === selected,
                today: day === today,
                loading: loading && !info(day),
              },
            ]"
            :style="{ '--level': fill(day) }"
            :data-day="day"
            :tabindex="day === tabbableDay ? 0 : -1"
            :aria-label="label(day)"
            :aria-disabled="!isSelectable(day) ? 'true' : undefined"
            :aria-current="day === today ? 'date' : undefined"
            @click="choose(day)"
            @keydown="onKey($event, day)"
          >
            <span class="tile-top">
              <span class="tile-num tabular">{{ dayNumber(day) }}</span>
              <span v-if="info(day)?.slots.length" class="tile-count tabular" aria-hidden="true">{{ info(day)!.slots.length }}</span>
            </span>
          </button>
        </span>
      </div>
    </div>

    <ul class="legend" aria-label="Legend">
      <li><span class="swatch tone-open" style="--level: 0.15" />Plenty open</li>
      <li><span class="swatch tone-filling" style="--level: 0.7" />Filling up</li>
      <li><span class="swatch tone-full" style="--level: 1" />Full</li>
      <li><span class="swatch tone-closed" />Closed</li>
    </ul>
  </section>
</template>

<style scoped>
.cal {
  display: grid;
  gap: 10px;
}

.cal-head {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  text-align: center;
}

.cal-title {
  font-size: var(--step-1);
}

.icon-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* The grout: tiles sit on a grout-coloured backing with small gaps. */
.cal-wall {
  display: grid;
  gap: 3px;
  padding: 3px;
  border-radius: 12px;
  background: var(--grout);
  touch-action: pan-y;
  user-select: none;
}

.cal-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}

.cal-row > span {
  display: block;
  min-width: 0;
}

.cal-weekday {
  padding: 6px 0;
  text-align: center;
  font-size: var(--step--1);
  font-weight: 620;
  color: var(--ink-soft);
  background: var(--surface-sunk);
  border-radius: 6px;
}

.cal-weekday abbr {
  text-decoration: none;
}

.tile {
  --level: 0;
  appearance: none;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  width: 100%;
  aspect-ratio: 1 / 1;
  min-height: 44px;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  border: 0;
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

/* The fill line: rises as the day books up */
.tile::before {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: calc(var(--level) * 100%);
  background: var(--fill-color);
  /* inset shadow (not a border) so an empty tile shows no line at all */
  box-shadow: inset 0 2px 0 var(--fill-line);
  z-index: -1;
  transition: height 0.45s cubic-bezier(0.3, 0.7, 0.3, 1);
}

.tile-num {
  font-weight: 700;
  font-size: var(--step-0);
  font-variation-settings: 'CASL' 1;
  line-height: 1;
}

.tile-top {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: baseline;
  gap: 2px;
}

/* Count sits top-right, above the fill line. On narrow phones the fill alone tells the story
   (the count is still in each tile's accessible label), so it only appears with room to breathe. */
.tile-count {
  display: none;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--ink-soft);
  line-height: 1;
}

.tile.tone-full {
  color: var(--ink-soft);
}

.tile.tone-full::before {
  background: var(--fill-full);
  box-shadow: none;
}

.tile.tone-closed {
  background: repeating-linear-gradient(135deg, var(--surface-sunk) 0 6px, var(--surface) 6px 12px);
  color: var(--ink-soft);
  cursor: default;
}

.tile.tone-past,
.tile.tone-beyond,
.tile.tone-unknown {
  background: var(--surface-sunk);
  color: color-mix(in srgb, var(--ink-soft) 70%, transparent);
  cursor: default;
}

.tile.outside {
  opacity: 0.45;
}

.tile.today {
  box-shadow: inset 0 0 0 2px var(--ink);
}

.tile.selected {
  background: var(--ink);
  color: var(--paper);
  outline: 3px solid var(--ink);
  outline-offset: -1px;
}

.tile.selected::before {
  background: var(--fill-selected);
  box-shadow: inset 0 2px 0 var(--brand);
}

.tile.selected .tile-count {
  color: var(--paper);
  opacity: 0.85;
}

.tile.loading {
  animation: pulse 1.2s ease-in-out infinite;
}

.tile:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: -3px;
  border-radius: 6px;
}

@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  --level: 0;
  position: relative;
  overflow: hidden;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--grout-strong);
}

.swatch::before {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: calc(var(--level) * 100%);
  background: var(--fill-color);
  box-shadow: inset 0 1px 0 var(--fill-line);
}

.swatch.tone-full::before {
  background: var(--fill-full);
  box-shadow: none;
}

.swatch.tone-closed {
  background: repeating-linear-gradient(135deg, var(--surface-sunk) 0 3px, var(--surface) 3px 6px);
}

@media (min-width: 480px) {
  .tile-count {
    display: inline;
  }
}

@media (min-width: 640px) {
  .tile {
    aspect-ratio: 5 / 4;
    padding: 8px 10px;
  }
  .tile-count {
    font-size: var(--step--1);
  }
}
</style>
