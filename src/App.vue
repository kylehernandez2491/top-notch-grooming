<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import AppNav from '@/components/AppNav.vue';
import GlobalUi from '@/components/GlobalUi.vue';
import { useCatalog } from '@/stores/catalog';

const ChatAssistant = defineAsyncComponent(() => import('@/components/ChatAssistant.vue'));

const catalog = useCatalog();
const route = useRoute();
onMounted(() => catalog.load().catch(() => undefined));

/** The chat is for customers: never in the staff portal, and out of the way while booking or filling in forms. */
const NO_CHAT = new Set(['book', 'reschedule', 'welcome', 'pet-new', 'pet-edit', 'staff-login']);
const showChat = computed(() => route.matched.length > 0 && !route.meta.admin && !NO_CHAT.has(String(route.name)));
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <AppNav />
  <main id="main" tabindex="-1" :class="{ 'has-chat': showChat }">
    <RouterView />
  </main>
  <ChatAssistant v-if="showChat" :raised="route.name === 'availability'" />
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

/* Room under the end of the page so the chat button never covers the last thing on it. */
main.has-chat .page {
  padding-bottom: calc(var(--nav-h) + var(--safe-b) + 96px);
}

@media (min-width: 900px) {
  main.has-chat .page {
    padding-bottom: 104px;
  }
}
</style>
