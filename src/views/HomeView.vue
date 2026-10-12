<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AvailabilityResponse } from '@shared/types';
import { WEEKDAYS } from '@shared/types';
import type { Service } from '@shared/types';
import { formatTime12 } from '@shared/format';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';
import ServiceMenu from '@/components/ServiceMenu.vue';
import StarRating from '@/components/StarRating.vue';
import { useCatalog } from '@/stores/catalog';
import { addDays, dayNumber, weekdayShort } from '@/utils/dates';
import { mapsUrl, telUrl } from '@/utils/device';

const catalog = useCatalog();
const week = ref<AvailabilityResponse | null>(null);
const weekError = ref(false);

const featured = computed(() => catalog.services.find((s) => s.popular) ?? catalog.services[0]);
const dayNames: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

watch(
  featured,
  async (service) => {
    if (!service) return;
    try {
      week.value = await api.availability({ from: catalog.today, to: addDays(catalog.today, 6), serviceId: service.id, size: 'medium' });
    } catch {
      weekError.value = true;
    }
  },
  { immediate: true },
);

function fill(d: AvailabilityResponse['days'][number]) {
  if (d.status === 'full') return 1;
  if (!d.capacity || (d.status !== 'open' && d.status !== 'limited')) return 0;
  return 1 - d.slots.length / d.capacity;
}

const serviceBookHref = (s: Service) => `/book?serviceId=${s.id}`;
</script>

<template>
  <div class="page">
    <section class="hero">
      <div class="hero-copy stack-lg">
        <img
          class="hero-logo"
          src="/brand/logo.png"
          srcset="/brand/logo@2x.png 2x"
          width="132"
          height="132"
          :alt="catalog.settings?.shopName ?? 'Top Notch Dog Grooming'"
        />
        <h1 class="hero-title">Book a groom in under a minute.</h1>
        <p class="hero-lede">
          {{ catalog.settings?.tagline ?? 'Top-notch grooming since 2013' }}. Pick an open time and we'll email you a reminder the day
          before.
        </p>
        <div class="row">
          <RouterLink to="/book" class="btn hero-btn">Book now</RouterLink>
          <RouterLink to="/availability" class="btn hero-btn-alt">See all open times</RouterLink>
        </div>
        <p v-if="catalog.data?.rating" class="row small hero-rating">
          <StarRating :model-value="catalog.data.rating.average" readonly :size="18" />
          {{ catalog.data.rating.average }} from {{ catalog.data.rating.count }} reviews
        </p>
      </div>

      <div class="hero-week panel" aria-labelledby="week-title">
        <div class="spread">
          <h2 id="week-title" class="week-title">The next seven days</h2>
          <span v-if="featured" class="muted small">{{ featured.name }}, medium dog</span>
        </div>
        <div v-if="week" class="week-tiles">
          <RouterLink
            v-for="d in week.days"
            :key="d.day"
            :to="{ path: '/availability', query: { day: d.day, serviceId: featured?.id } }"
            class="week-tile"
            :class="`s-${d.status}`"
            :style="{ '--level': fill(d) }"
            :aria-label="`${weekdayShort(d.day)} ${dayNumber(d.day)}: ${d.slots.length ? `${d.slots.length} times open` : d.reason}`"
          >
            <span class="wt-wd">{{ weekdayShort(d.day) }}</span>
            <span class="wt-num tabular">{{ dayNumber(d.day) }}</span>
            <span class="wt-count">{{ d.slots.length ? `${d.slots.length} open` : ({ closed: 'Closed', full: 'Full' } as Record<string, string>)[d.status] ?? 'No times' }}</span>
          </RouterLink>
        </div>
        <div v-else-if="weekError" class="muted">Open times aren't loading right now. Call us to book.</div>
        <div v-else class="week-tiles">
          <div v-for="n in 7" :key="n" class="skeleton week-skel" />
        </div>
        <p v-if="week?.nextAvailable" class="small">
          Next opening: <strong>{{ weekdayShort(week.nextAvailable.day) }} {{ dayNumber(week.nextAvailable.day) }} at {{ formatTime12(week.nextAvailable.time) }}</strong>
        </p>
      </div>
    </section>

    <section id="services" class="stack-lg" aria-labelledby="menu-title">
      <div class="spread menu-head">
        <div class="stack">
          <h2 id="menu-title">Services and prices</h2>
          <p class="muted">Choose what your pet needs. Dog prices depend on size; cats are one price.</p>
        </div>
        <RouterLink to="/services#sizes" class="btn btn-sm">Size guide</RouterLink>
      </div>
      <ServiceMenu v-if="catalog.services.length" :services="catalog.services" :add-ons="catalog.addOns" :book-href="serviceBookHref" />
      <div v-else class="skeleton" style="height: 220px" />
    </section>

    <section v-if="catalog.settings" class="info-grid">
      <div class="panel stack">
        <h2 class="info-title">Hours</h2>
        <dl class="hours">
          <template v-for="d in WEEKDAYS" :key="d">
            <dt>{{ dayNames[d] }}</dt>
            <dd class="tabular">
              <template v-if="catalog.settings.weeklyHours[d]">
                {{ formatTime12(catalog.settings.weeklyHours[d]!.open) }} to {{ formatTime12(catalog.settings.weeklyHours[d]!.close) }}
              </template>
              <span v-else class="muted">Closed</span>
            </dd>
          </template>
        </dl>
      </div>
      <div class="panel stack">
        <h2 class="info-title">Find us</h2>
        <p>{{ catalog.settings.address }}</p>
        <div class="row">
          <a class="btn btn-sm" :href="mapsUrl(catalog.settings.address)" target="_blank" rel="noopener"><Icon name="map" :size="18" /> Directions</a>
          <a class="btn btn-sm" :href="telUrl(catalog.settings.phone)"><Icon name="phone" :size="18" /> {{ catalog.settings.phone }}</a>
        </div>
      </div>
      <div class="panel stack">
        <h2 class="info-title">Before you book</h2>
        <p class="small">{{ catalog.settings.policies.vaccination }}</p>
        <p class="small muted">{{ catalog.settings.policies.cancellation }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* The brand moment: a logo-yellow band with black type, in light and dark mode alike. */
.hero {
  display: grid;
  gap: 24px;
  align-items: center;
  margin: -20px -16px 0;
  padding: 28px 16px;
  background: var(--brand);
  color: #0a0a0a;
}

.hero-logo {
  width: 132px;
  height: 132px;
  border-radius: 50%;
  box-shadow: 0 0 0 4px #0a0a0a;
}

.hero-title {
  font-size: clamp(2.2rem, 7vw, 3.6rem);
  font-weight: 860;
  line-height: 1.02;
  letter-spacing: -0.03em;
  max-width: 14ch;
}

.hero-lede {
  font-size: var(--step-1);
  color: #2b2b2b;
  max-width: 40ch;
}

.hero-btn {
  background: #0a0a0a;
  border-color: #0a0a0a;
  color: #ffffff;
}

.hero-btn:hover {
  background: #262626;
}

.hero-btn-alt {
  background: #ffffff;
  border-color: #0a0a0a;
  color: #0a0a0a;
}

.hero-btn-alt:hover {
  background: #fff6cc;
}

.hero-rating {
  color: #0a0a0a;
}

.hero-rating :deep(.stars),
.hero-rating :deep(.on) {
  color: #0a0a0a;
  fill: #0a0a0a;
}

.hero .hero-week {
  color: var(--ink);
  border-color: #0a0a0a;
  border-width: 2px;
}

.hero-week {
  display: grid;
  gap: 14px;
}

.week-title {
  font-size: var(--step-1);
}

.week-tiles {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
  padding: 3px;
  border-radius: 12px;
  background: var(--grout);
}

.week-tile {
  --level: 0;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 10px 2px 8px;
  border-radius: 6px;
  background: var(--surface);
  text-decoration: none;
  min-height: 96px;
  align-content: start;
}

.week-tile::before {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: calc(var(--level) * 100%);
  background: var(--fill-color);
  box-shadow: inset 0 2px 0 var(--fill-line);
  z-index: -1;
  animation: fill-up 0.9s cubic-bezier(0.3, 0.7, 0.3, 1) both;
}

.week-tile.s-closed {
  background: repeating-linear-gradient(135deg, var(--surface-sunk) 0 6px, var(--surface) 6px 12px);
}

.week-tile.s-past,
.week-tile.s-beyond {
  background: var(--surface-sunk);
  color: var(--ink-soft);
}

.week-tile.s-full::before {
  background: var(--fill-full);
  box-shadow: none;
}

.wt-wd {
  font-size: var(--step--1);
  color: var(--ink-soft);
  font-weight: 600;
}

.wt-num {
  font-size: var(--step-2);
  font-weight: 800;
  font-variation-settings: 'CASL' 1;
  line-height: 1.1;
}

.wt-count {
  font-size: 0.7rem;
  font-weight: 640;
  text-align: center;
}

.week-skel {
  min-height: 96px;
  border-radius: 6px;
}

@keyframes fill-up {
  from {
    height: 0;
  }
}

.menu-head {
  align-items: flex-end;
}

.info-grid {
  display: grid;
  gap: 16px;
}

.info-title {
  font-size: var(--step-1);
}

.hours {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 0;
}

.hours dt {
  font-weight: 600;
}

.hours dd {
  margin: 0;
}

@media (min-width: 900px) {
  .hero {
    grid-template-columns: 1fr 1.1fr;
    gap: 48px;
    margin: 0;
    padding: 40px;
    border-radius: var(--radius-sheet);
  }
  .info-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
