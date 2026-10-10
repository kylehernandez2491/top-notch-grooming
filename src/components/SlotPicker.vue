<script setup lang="ts">
import { computed } from 'vue';
import type { DayAvailability, SlotOption } from '@shared/types';
import { formatTime12, partOfDay } from '@shared/format';
import Icon from './Icon.vue';
import { longDay } from '@/utils/dates';

const props = defineProps<{
  day?: DayAvailability;
  selected?: string;
  loading?: boolean;
  /** Offer "join waitlist" when the day is full. */
  waitlist?: boolean;
}>();

const emit = defineEmits<{ select: [time: string]; waitlist: [] }>();

const groups = computed(() => {
  const order = ['morning', 'afternoon', 'evening'] as const;
  const labels = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
  const by = new Map<string, SlotOption[]>();
  for (const slot of props.day?.slots ?? []) {
    const part = partOfDay(slot.time);
    by.set(part, [...(by.get(part) ?? []), slot]);
  }
  return order.filter((p) => by.has(p)).map((p) => ({ key: p, label: labels[p], slots: by.get(p)! }));
});
</script>

<template>
  <section class="slots" aria-live="polite">
    <template v-if="!day">
      <p class="muted">Pick a day to see open times.</p>
    </template>

    <template v-else-if="loading">
      <div class="slot-grid">
        <div v-for="n in 6" :key="n" class="skeleton" style="height: 48px" />
      </div>
    </template>

    <template v-else-if="day.slots.length">
      <h3 class="slots-title">{{ longDay(day.day) }}</h3>
      <div v-for="group in groups" :key="group.key" class="slot-group">
        <h4 class="slot-group-label">{{ group.label }}</h4>
        <div class="slot-grid" role="radiogroup" :aria-label="`${group.label} times`">
          <button
            v-for="slot in group.slots"
            :key="slot.time"
            type="button"
            role="radio"
            class="slot tabular"
            :aria-checked="slot.time === selected ? 'true' : 'false'"
            :title="`Pick-up around ${formatTime12(slot.endTime)}`"
            @click="emit('select', slot.time)"
          >
            {{ formatTime12(slot.time) }}
          </button>
        </div>
      </div>
    </template>

    <div v-else class="slots-empty">
      <Icon :name="day.status === 'closed' ? 'clock' : 'tub'" :size="28" />
      <div class="stack">
        <h3 class="slots-title">{{ longDay(day.day) }}</h3>
        <p class="muted">{{ day.reason ?? 'No open times.' }}</p>
        <button v-if="waitlist && day.status === 'full'" type="button" class="btn btn-sm" @click="emit('waitlist')">
          <Icon name="waitlist" :size="18" /> Join the waitlist for this day
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.slots {
  display: grid;
  gap: 16px;
  align-content: start;
}

.slots-title {
  font-size: var(--step-1);
}

.slot-group {
  display: grid;
  gap: 8px;
}

.slot-group-label {
  margin: 0;
  font-size: var(--step--1);
  font-weight: 620;
  color: var(--ink-soft);
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.slot {
  appearance: none;
  min-height: 48px;
  border-radius: 10px;
  border: 1.5px solid var(--grout-strong);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-weight: 640;
  cursor: pointer;
}

.slot:hover {
  border-color: var(--accent-ink);
}

.slot[aria-checked='true'] {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}

.slots-empty {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px;
  border-radius: var(--radius-panel);
  background: var(--surface-sunk);
  color: var(--ink-soft);
}

.slots-empty .slots-title {
  color: var(--ink);
}
</style>
