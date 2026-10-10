<script setup lang="ts">
import type { Service } from '@shared/types';
import { PET_SIZES } from '@shared/types';
import { SIZE_HINTS, SIZE_LABELS } from '@shared/format';
import ServiceMenu from '@/components/ServiceMenu.vue';
import { useCatalog } from '@/stores/catalog';
import { useSession } from '@/stores/session';

const catalog = useCatalog();
const session = useSession();
const bookHref = (s: Service) => (session.isLoggedIn ? `/book?serviceId=${s.id}` : session.loginUrl(`/book?serviceId=${s.id}`));
</script>

<template>
  <div class="page">
    <header class="stack intro">
      <h1>Services and prices</h1>
      <p class="muted lede">Pick the service that suits your pet. Dog prices go by size, and cats are one price.</p>
    </header>

    <ServiceMenu v-if="catalog.services.length" :services="catalog.services" :add-ons="catalog.addOns" :book-href="bookHref" />
    <div v-else class="skeleton" style="height: 320px" />

    <section id="sizes" class="panel stack" aria-labelledby="sizes-title">
      <h2 id="sizes-title" class="guide-title">Which size is my dog?</h2>
      <p class="small muted">If your dog is between sizes, choose the closer one or call us to ask.</p>
      <dl class="guide">
        <template v-for="s in PET_SIZES" :key="s">
          <dt>{{ SIZE_LABELS[s] }}</dt>
          <dd>{{ SIZE_HINTS[s] }}</dd>
        </template>
      </dl>
    </section>

    <div class="row">
      <a v-if="!session.isLoggedIn" :href="session.loginUrl('/book')" class="btn btn-primary">Sign in to book</a>
      <RouterLink v-else to="/book" class="btn btn-primary">Book a groom</RouterLink>
      <RouterLink to="/availability" class="btn">See open times</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.intro {
  max-width: 62ch;
}

.lede {
  font-size: var(--step-0);
}

.guide-title {
  font-size: var(--step-1);
}

.guide {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  gap: 10px 18px;
  margin: 0;
}

.guide dt {
  font-weight: 720;
}

.guide dd {
  margin: 0;
  color: var(--ink-soft);
}
</style>
