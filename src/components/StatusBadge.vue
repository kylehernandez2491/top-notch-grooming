<script setup lang="ts">
import type { AppointmentStatus } from '@shared/types';

defineProps<{ status: AppointmentStatus }>();

const labels: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  'checked-in': 'Checked in',
  'in-progress': 'Being groomed',
  completed: 'Done',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
};
</script>

<template>
  <span class="badge" :class="`status-${status}`">{{ labels[status] }}</span>
</template>

<style scoped>
.status-booked {
  background: var(--brand-faint);
  color: var(--accent-ink);
}
.status-checked-in,
.status-in-progress {
  background: color-mix(in srgb, var(--brand) 35%, var(--surface));
  color: var(--ink);
}
.status-completed {
  background: var(--ok-bg);
  color: var(--ok);
}
.status-cancelled,
.status-no-show {
  background: var(--alert-bg);
  color: var(--alert);
}
</style>
