<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Appointment } from '@shared/types';
import { formatTime12 } from '@shared/format';
import { api, ApiError } from '@/api/client';
import Icon from '@/components/Icon.vue';
import SlotPicker from '@/components/SlotPicker.vue';
import TileCalendar from '@/components/TileCalendar.vue';
import { useAvailability, type AvailabilityParams } from '@/composables/useAvailability';
import { useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { addDays, longDay, monthOf, shortDay } from '@/utils/dates';
import { buzz } from '@/utils/device';

/** Shared by owners (/appointments/:id/reschedule) and staff (?staff=1 from the staff portal). */
const route = useRoute();
const router = useRouter();
const catalog = useCatalog();
const account = useAccount();
const session = useSession();
const ui = useUi();

const staff = computed(() => session.isAdmin && route.query.staff === '1');
const appointment = ref<Appointment | null>(null);
const error = ref('');
const day = ref<string>();
const time = ref<string>();
const month = ref(monthOf(catalog.today));
const saving = ref(false);

onMounted(async () => {
  try {
    const id = route.params.id as string;
    appointment.value = staff.value ? await api.admin.appointment(id) : await api.appointment(id);
    month.value = monthOf(appointment.value.day >= catalog.today ? appointment.value.day : catalog.today);
  } catch (err) {
    error.value = (err as Error).message;
  }
});

const params = computed<AvailabilityParams | null>(() =>
  appointment.value
    ? {
        serviceId: appointment.value.serviceId,
        size: appointment.value.petSize,
        addOns: appointment.value.addOns.map((a) => a.id).sort(),
        exclude: appointment.value.id,
        staff: staff.value,
      }
    : null,
);
const availability = useAvailability(params, month);
const dayInfo = computed(() => (day.value ? availability.days.value.get(day.value) : undefined));
const unchanged = computed(() => day.value === appointment.value?.day && time.value === appointment.value?.startTime);

async function save() {
  if (!appointment.value || !day.value || !time.value) return;
  saving.value = true;
  try {
    const moved = staff.value
      ? await api.admin.reschedule(appointment.value.id, day.value, time.value)
      : await api.reschedule(appointment.value.id, day.value, time.value);
    account.upsertAppointment(moved);
    buzz();
    ui.toast(`Moved to ${shortDay(moved.day)} at ${formatTime12(moved.startTime)}.`, 'success');
    router.replace(staff.value ? `/admin/appointments/${moved.id}` : `/appointments/${moved.id}`);
  } catch (err) {
    ui.toast((err as Error).message, 'error');
    if (err instanceof ApiError && err.status === 409) {
      time.value = undefined;
      availability.refresh();
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <RouterLink :to="staff ? `/admin/appointments/${route.params.id}` : `/appointments/${route.params.id}`" class="back small">
      <Icon name="chevron-left" :size="16" /> Back
    </RouterLink>
    <p v-if="error" class="alert">{{ error }}</p>
    <template v-if="appointment">
      <header class="stack">
        <h1>Change {{ appointment.petName }}'s time</h1>
        <p class="muted">
          Currently {{ longDay(appointment.day) }} at {{ formatTime12(appointment.startTime) }}. Your current time is shown as free so you can
          shift it a little.
        </p>
      </header>
      <div class="layout">
        <div class="panel">
          <TileCalendar
            v-model:month="month"
            :days="availability.days.value"
            :today="catalog.today"
            :selected="day"
            :loading="availability.loading.value"
            :min-month="monthOf(catalog.today)"
            :max-month="monthOf(addDays(catalog.today, staff ? 365 : (catalog.settings?.bookingHorizonDays ?? 60)))"
            @select="(d: string) => ((day = d), (time = undefined))"
          />
        </div>
        <div class="panel">
          <SlotPicker :day="dayInfo" :selected="time" @select="time = $event" />
        </div>
      </div>
      <div class="action-bar">
        <span class="small">
          <strong v-if="day && time">{{ shortDay(day) }}, {{ formatTime12(time) }}</strong>
          <template v-else>Pick a new day and time</template>
        </span>
        <button type="button" class="btn btn-primary" :disabled="!day || !time || unchanged || saving" @click="save">
          {{ saving ? 'Moving…' : 'Move appointment' }}
        </button>
      </div>
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

.layout {
  display: grid;
  gap: 16px;
  align-items: start;
}

@media (min-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  }
}
</style>
