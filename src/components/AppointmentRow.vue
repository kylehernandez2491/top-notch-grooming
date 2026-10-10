<script setup lang="ts">
import { DateTime } from 'luxon';
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { Appointment } from '@shared/types';
import { formatTime12 } from '@shared/format';
import Icon from './Icon.vue';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ appointment: Appointment; to: RouteLocationRaw; showOwner?: boolean }>();
const date = computed(() => DateTime.fromISO(props.appointment.day));
</script>

<template>
  <RouterLink :to="to" class="appt" :class="{ dim: ['cancelled', 'no-show'].includes(appointment.status) }">
    <span class="appt-when" aria-hidden="true">
      <span class="appt-wd">{{ date.toFormat('ccc') }}</span>
      <span class="appt-d tabular">{{ date.day }}</span>
      <span class="appt-m">{{ date.toFormat('LLL') }}</span>
    </span>
    <span class="appt-main">
      <span class="spread">
        <strong class="appt-pet">{{ appointment.petName }}</strong>
        <StatusBadge :status="appointment.status" />
      </span>
      <span class="muted small">
        <span class="visually-hidden">{{ date.toFormat('cccc, LLLL d') }}, </span>
        {{ formatTime12(appointment.startTime) }} to {{ formatTime12(appointment.endTime) }}, {{ appointment.serviceName }}
      </span>
      <span v-if="showOwner" class="small">{{ appointment.ownerName }}</span>
    </span>
    <Icon name="chevron-right" class="appt-go" />
  </RouterLink>
</template>

<style scoped>
.appt {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 12px 4px;
  text-decoration: none;
  color: inherit;
  min-height: 72px;
}

.appt:hover .appt-pet {
  text-decoration: underline;
}

.appt.dim {
  opacity: 0.6;
}

.appt-when {
  display: grid;
  justify-items: center;
  padding: 6px 0;
  border-radius: 10px;
  background: var(--brand-faint);
  line-height: 1.1;
}

.appt-wd,
.appt-m {
  font-size: 0.72rem;
  font-weight: 620;
  color: var(--ink-soft);
}

.appt-d {
  font-size: var(--step-1);
  font-weight: 760;
  font-variation-settings: 'CASL' 1;
}

.appt-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.appt-go {
  color: var(--ink-soft);
}
</style>
