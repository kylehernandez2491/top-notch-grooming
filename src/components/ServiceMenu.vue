<script setup lang="ts">
/**
 * The shop's price list: one card per service with what's included and a price for every dog size.
 * Used on the home page and the Services page; each card can link straight into booking.
 */
import { computed } from 'vue';
import type { AddOn, PetSize, Service } from '@shared/types';
import { durationRange, formatMoney, formatPriceRange, SIZE_EXAMPLES, SIZE_LABELS, sizePrice, sizesFor } from '@shared/format';
import Icon from './Icon.vue';

const props = defineProps<{
  services: Service[];
  addOns: AddOn[];
  /** Where a card's Book button goes; omit to hide the buttons. */
  bookHref?: (service: Service) => string;
}>();

/** Add-ons tied to one service, such as a face design, are shown as a priced variant inside the size cell. */
function variants(service: Service, size: PetSize) {
  return props.addOns.filter(
    (a) => a.active && a.serviceIds?.includes(service.id) && (!a.sizes?.length || a.sizes.includes(size)) && a.species.some((sp) => service.species.includes(sp)),
  );
}

/** Extras that go with any service are listed once, under the menu. */
const generalExtras = computed(() => props.addOns.filter((a) => a.active && !a.serviceIds?.length));
const hasRanges = computed(() => props.services.some((s) => sizesFor(s).some((z) => sizePrice(s, z).max > sizePrice(s, z).min)));
const catOnly = (s: Service) => !s.species.includes('dog');
</script>

<template>
  <div class="menu stack-lg">
    <article
      v-for="service in services"
      :key="service.id"
      class="svc"
      :class="{ 'svc-popular': service.popular }"
      :aria-labelledby="`svc-${service.id}`"
    >
      <div class="svc-info">
        <div class="svc-title">
          <h3 :id="`svc-${service.id}`" class="svc-name">{{ service.name }}</h3>
          <span v-if="service.popular" class="badge svc-badge">Most booked</span>
        </div>
        <p class="svc-desc">{{ service.description }}</p>
        <p class="svc-meta small">
          <span class="row svc-meta-item"><Icon name="paw" :size="15" /> {{ catOnly(service) ? 'For cats' : 'For dogs' }}</span>
          <span class="row svc-meta-item"><Icon name="clock" :size="15" /> {{ durationRange(service) }}</span>
        </p>
        <ul v-if="service.inclusions?.length" class="incl" :aria-label="`${service.name} includes`">
          <li v-for="item in service.inclusions" :key="item">
            <span class="incl-tick" aria-hidden="true"><Icon name="check" :size="12" /></span>{{ item }}
          </li>
        </ul>
      </div>

      <div class="svc-prices">
        <dl class="prices" :class="{ 'prices-single': sizesFor(service).length === 1 }">
          <div v-for="size in sizesFor(service)" :key="size" class="price-cell">
            <dt class="size">
              <span class="size-name">{{ catOnly(service) ? 'All cats' : SIZE_LABELS[size] }}</span>
              <span class="size-eg">{{ catOnly(service) ? 'Any breed or size' : SIZE_EXAMPLES[size] }}</span>
            </dt>
            <dd class="price">
              <strong class="amount tabular">{{ formatPriceRange(sizePrice(service, size).min, sizePrice(service, size).max) }}</strong>
              <span v-if="sizePrice(service, size).note" class="price-note">{{ sizePrice(service, size).note }}</span>
              <span v-for="v in variants(service, size)" :key="v.id" class="variant">
                <strong class="tabular">{{ formatMoney(sizePrice(service, size).min + v.price) }}</strong> with {{ v.name.toLowerCase() }}
              </span>
            </dd>
          </div>
        </dl>
        <template v-if="bookHref">
          <a v-if="bookHref(service).startsWith('/.auth')" :href="bookHref(service)" class="btn btn-sm btn-dark svc-book">Book {{ service.name }}</a>
          <RouterLink v-else :to="bookHref(service)" class="btn btn-sm btn-dark svc-book">Book {{ service.name }}</RouterLink>
        </template>
      </div>
    </article>

    <div v-if="generalExtras.length" class="panel extras">
      <h3 class="extras-title">Extras</h3>
      <ul class="divider-list">
        <li v-for="a in generalExtras" :key="a.id" class="spread extra">
          <span>{{ a.name }}<span class="muted small"> · {{ a.description }}</span></span>
          <strong class="tabular">+{{ formatMoney(a.price) }}</strong>
        </li>
      </ul>
    </div>

    <p class="small muted menu-foot">
      Prices are in Philippine pesos and paid at pick-up.
      <template v-if="hasRanges">Where a price shows a range, it depends on coat volume and the groomer will confirm the exact amount.</template>
    </p>
  </div>
</template>

<style scoped>
.svc {
  display: grid;
  gap: 18px;
  padding: 20px 16px;
  border: 1px solid var(--grout);
  border-top: 6px solid var(--brand);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.svc-popular {
  border-color: var(--ink);
  border-top-color: var(--brand);
  box-shadow: 0 0 0 1px var(--ink);
}

.svc-info {
  display: grid;
  gap: 10px;
  align-content: start;
}

.svc-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.svc-name {
  font-size: var(--step-2);
  font-weight: 820;
  font-variation-settings: 'CASL' 0.6;
  letter-spacing: -0.01em;
  line-height: 1.1;
}

.svc-badge {
  background: var(--brand);
  color: var(--on-brand);
  border-color: var(--ink);
}

.svc-desc {
  color: var(--ink-soft);
  max-width: 52ch;
}

.svc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  color: var(--ink-soft);
  font-weight: 600;
}

.svc-meta-item {
  gap: 6px;
}

.incl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--step--1);
}

.incl li {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  line-height: 1.3;
}

.incl-tick {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 17px;
  height: 17px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--on-brand);
}

.incl-tick :deep(svg) {
  stroke-width: 3;
}

.svc-prices {
  display: grid;
  gap: 12px;
  align-content: start;
}

.prices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  margin: 0;
  padding: 2px;
  border-radius: 12px;
  background: var(--grout);
  overflow: hidden;
}

.prices-single {
  grid-template-columns: 1fr;
}

.price-cell {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: var(--surface);
}

.size {
  display: grid;
  gap: 1px;
}

.size-name {
  font-size: 0.72rem;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-wrap: balance;
}

.size-eg {
  font-size: 0.72rem;
  color: var(--ink-soft);
  line-height: 1.25;
}

.price {
  display: grid;
  align-content: start;
  gap: 2px;
  margin: 0;
}

.amount {
  font-size: var(--step-1);
  font-weight: 820;
  letter-spacing: -0.01em;
  line-height: 1.15;
}

.price-note {
  font-size: 0.75rem;
  color: var(--ink-soft);
  line-height: 1.3;
}

.variant {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--grout-strong);
  font-size: 0.75rem;
  line-height: 1.3;
}

.svc-book {
  justify-self: start;
}

.extras {
  display: grid;
  gap: 8px;
}

.extras-title {
  font-size: var(--step-1);
}

.extra {
  padding: 10px 0;
  gap: 12px;
}

.menu-foot {
  max-width: 70ch;
}

@media (min-width: 640px) {
  .svc {
    padding: 24px;
  }
  .prices {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  /* One price (cats): a single cell as wide as two size columns, without the empty grid behind it. */
  .prices-single {
    grid-template-columns: minmax(0, 1fr);
    max-width: 50%;
  }
  .incl {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 900px) {
  .svc {
    grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.4fr);
    gap: 28px;
  }
  .incl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .svc-book {
    justify-self: end;
  }
}
</style>
