<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { PetSize } from '@shared/types';
import { CAT_SIZE, PET_SIZES } from '@shared/types';
import { formatDuration, formatPriceRange, formatTime12, SIZE_LABELS, sizePhrase, sizePrice } from '@shared/format';
import SlotPicker from '@/components/SlotPicker.vue';
import TileCalendar from '@/components/TileCalendar.vue';
import { useAvailability, type AvailabilityParams } from '@/composables/useAvailability';
import { useCatalog } from '@/stores/catalog';
import { useSession } from '@/stores/session';
import { addDays, monthOf, shortDay } from '@/utils/dates';

const catalog = useCatalog();
const session = useSession();
const route = useRoute();
const router = useRouter();

const serviceId = ref((route.query.serviceId as string) || '');
const size = ref<PetSize>((route.query.size as PetSize) || 'medium');
const selectedDay = ref<string | undefined>(route.query.day as string | undefined);
const selectedTime = ref<string>();
const month = ref(monthOf(selectedDay.value ?? catalog.today));

watch(
  () => catalog.services,
  (services) => {
    if (!serviceId.value && services.length) serviceId.value = (services.find((s) => s.popular) ?? services[0]).id;
  },
  { immediate: true },
);

const service = computed(() => catalog.serviceById(serviceId.value));
// Cat-only services have one price, so there is no size to choose.
const forDogs = computed(() => !service.value || service.value.species.includes('dog'));
const effectiveSize = computed<PetSize>(() => (forDogs.value ? size.value : CAT_SIZE));
const params = computed<AvailabilityParams | null>(() => (serviceId.value ? { serviceId: serviceId.value, size: effectiveSize.value, addOns: [] } : null));
const { days, loading, error, findNext } = useAvailability(params, month);
const day = computed(() => (selectedDay.value ? days.value.get(selectedDay.value) : undefined));
const maxMonth = computed(() => monthOf(addDays(catalog.today, catalog.settings?.bookingHorizonDays ?? 60)));

watch([serviceId, size], () => (selectedTime.value = undefined));

function selectDay(d: string) {
  selectedDay.value = d;
  selectedTime.value = undefined;
  router.replace({ query: { ...route.query, day: d, serviceId: serviceId.value } });
}

async function jumpToNext() {
  const next = await findNext(catalog.today, catalog.settings?.bookingHorizonDays ?? 60);
  if (!next) return;
  month.value = monthOf(next.day);
  selectDay(next.day);
  selectedTime.value = next.time;
}

function book() {
  const target = router.resolve({
    path: '/book',
    query: { serviceId: serviceId.value, day: selectedDay.value, time: selectedTime.value },
  }).fullPath;
  if (session.isLoggedIn) router.push(target);
  else window.location.href = session.loginUrl(target);
}
</script>

<template>
  <div class="page">
    <header class="stack">
      <h1>Open times</h1>
      <p class="muted">Pick a service and your dog's size. The yellow fill shows how booked each day is.</p>
    </header>

    <div class="layout">
      <div class="stack-lg">
        <div class="panel stack">
          <div class="field">
            <label for="svc">Service</label>
            <select id="svc" v-model="serviceId" class="select">
              <option v-for="s in catalog.services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div v-if="forDogs" class="field">
            <label for="size">Dog size</label>
            <select id="size" v-model="size" class="select">
              <option v-for="s in PET_SIZES" :key="s" :value="s">{{ SIZE_LABELS[s] }}</option>
            </select>
          </div>
          <p v-if="service" class="small muted">
            About {{ formatDuration(service.durationBySize[effectiveSize]) }} and
            {{ formatPriceRange(sizePrice(service, effectiveSize).min, sizePrice(service, effectiveSize).max) }}
            for {{ forDogs ? (size === 'husky_chow' ? 'a Husky or Chow Chow' : `a ${sizePhrase(size)}`) : 'any cat' }}.
          </p>
        </div>

        <div class="panel stack">
          <div class="spread">
            <button type="button" class="btn btn-sm" :disabled="!params" @click="jumpToNext">Jump to next opening</button>
          </div>
          <p v-if="error" class="alert">{{ error }}</p>
          <TileCalendar
            v-model:month="month"
            :days="days"
            :today="catalog.today"
            :selected="selectedDay"
            :loading="loading"
            :min-month="monthOf(catalog.today)"
            :max-month="maxMonth"
            @select="selectDay"
          />
        </div>
      </div>

      <div class="panel slots-panel">
        <SlotPicker :day="day" :selected="selectedTime" :loading="loading && !day" @select="selectedTime = $event" />
      </div>
    </div>

    <div v-if="selectedDay && selectedTime" class="action-bar">
      <span class="small">
        <strong>{{ shortDay(selectedDay) }}, {{ formatTime12(selectedTime) }}</strong>
      </span>
      <button type="button" class="btn btn-primary" @click="book">{{ session.isLoggedIn ? 'Book this time' : 'Sign in to book' }}</button>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  gap: 20px;
  align-items: start;
}

@media (min-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  }
  .slots-panel {
    position: sticky;
    top: calc(var(--top-h) + 20px);
  }
}
</style>
