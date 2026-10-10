<script setup lang="ts">
import { onMounted } from 'vue';
import AppNav from '@/components/AppNav.vue';
import GlobalUi from '@/components/GlobalUi.vue';
import { useCatalog } from '@/stores/catalog';

const catalog = useCatalog();
onMounted(() => catalog.load().catch(() => undefined));
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <AppNav />
  <main id="main" tabindex="-1">
    <RouterView />
  </main>
  <GlobalUi />
</template>

<style>
.skip-link {
  position: absolute;
  left: 12px;
  top: -60px;
  z-index: 100;
  padding: 10px 16px;
  border-radius: var(--radius-pill);
  background: var(--brand);
  color: var(--on-brand);
  font-weight: 700;
}

.skip-link:focus {
  top: 12px;
}

main:focus {
  outline: none;
}
</style>
