<script setup lang="ts">
import { computed } from 'vue';
import type { Appointment } from '@shared/types';
import { formatTime12, sizePhrase } from '@shared/format';
import Icon from './Icon.vue';
import StatusBadge from './StatusBadge.vue';
import { nextStep, useStaffActions } from '@/composables/useStaffActions';
import { telUrl } from '@/utils/device';

const props = defineProps<{ appointment: Appointment; compact?: boolean }>();
const emit = defineEmits<{ updated: [appointment: Appointment] }>();
const { setStatus } = useStaffActions();

const step = computed(() => nextStep(props.appointment.status));
const started = computed(() => props.appointment.startUtc <= new Date().toISOString());
const inactive = computed(() => ['cancelled', 'no-show'].includes(props.appointment.status));

async function advance(status = step.value?.status) {
  if (!status) return;
  const updated = await setStatus(props.appointment, status);
  if (updated) emit('updated', updated);
}
</script>

<template>
  <article class="agenda" :class="[`st-${appointment.status}`, { inactive, compact }]">
    <div class="agenda-time tabular">
      <strong>{{ formatTime12(appointment.startTime) }}</strong>
      <span class="muted small">{{ formatTime12(appointment.endTime) }}</span>
    </div>
    <div class="agenda-body stack">
      <div class="spread">
        <RouterLink :to="`/admin/appointments/${appointment.id}`" class="agenda-pet">{{ appointment.petName }}</RouterLink>
        <StatusBadge :status="appointment.status" />
      </div>
      <p class="muted small">{{ appointment.petBreed || appointment.petSpecies }}, {{ sizePhrase(appointment.petSize, appointment.petSpecies) }}</p>
      <p class="small">
        {{ appointment.serviceName }}<template v-if="appointment.addOns.length"> + {{ appointment.addOns.map((a) => a.name).join(', ') }}</template>
      </p>
      <p v-if="!compact" class="small muted">
        {{ appointment.ownerName }}
        <a v-if="appointment.ownerPhone" :href="telUrl(appointment.ownerPhone)" class="phone">{{ appointment.ownerPhone }}</a>
      </p>
      <ul v-if="appointment.petAlerts.length" class="alerts">
        <li v-for="alert in appointment.petAlerts" :key="alert"><Icon name="alert" :size="14" /> {{ alert }}</li>
      </ul>
      <p v-if="appointment.notes && !compact" class="owner-note small">“{{ appointment.notes }}”</p>
      <div v-if="!compact && !inactive && appointment.status !== 'completed'" class="row">
        <button v-if="step" type="button" class="btn btn-sm btn-dark" @click="advance()">{{ step.label }}</button>
        <button v-if="started && ['booked', 'checked-in'].includes(appointment.status)" type="button" class="btn btn-sm" @click="advance('no-show')">
          No-show
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.agenda {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 14px;
  padding: 14px;
  border-radius: var(--radius-panel);
  background: var(--surface);
  border: 1px solid var(--grout);
  border-left: 5px solid var(--fill-color);
}

.agenda.st-checked-in,
.agenda.st-in-progress {
  border-left-color: var(--brand);
}

.agenda.st-completed {
  border-left-color: var(--ok);
}

.agenda.inactive {
  opacity: 0.55;
  border-left-color: var(--alert);
}

.agenda.compact {
  grid-template-columns: 1fr;
  gap: 4px;
  padding: 8px 10px;
}

.agenda.compact .agenda-time {
  display: flex;
  gap: 6px;
}

.agenda-time {
  display: grid;
  align-content: start;
}

.agenda-body {
  gap: 6px;
  min-width: 0;
}

.agenda-pet {
  font-weight: 760;
  font-variation-settings: 'CASL' 1;
  text-decoration: none;
  font-size: var(--step-0);
}

.agenda-pet:hover {
  text-decoration: underline;
}

.phone {
  margin-left: 6px;
  font-weight: 600;
}

.alerts {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 2px;
  color: var(--alert);
  font-size: var(--step--1);
  font-weight: 600;
}

.alerts li {
  display: flex;
  gap: 4px;
  align-items: baseline;
}

.owner-note {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--surface-sunk);
}
</style>
