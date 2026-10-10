<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSession } from '@/stores/session';
import { useCatalog } from '@/stores/catalog';

const route = useRoute();
const session = useSession();
const catalog = useCatalog();
const redirect = computed(() => (typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/dashboard'));
const expired = computed(() => route.query.expired === '1');
</script>

<template>
  <div class="page page-narrow">
    <section class="panel stack-lg login">
      <img class="login-logo" src="/brand/logo.png" srcset="/brand/logo@2x.png 2x" width="96" height="96" :alt="catalog.settings?.shopName ?? 'Top Notch Dog Grooming'" />
      <h1>Sign in to book</h1>
      <p v-if="expired" class="note">Your session ended. Sign in again to pick up where you left off.</p>
      <p class="muted">
        Sign in with your email address. New here? The same button creates your account, and it takes about 30 seconds.
      </p>
      <a :href="session.loginUrl(redirect)" class="btn btn-primary btn-block">Continue</a>
      <ul class="perks">
        <li>Save your pets once, book again in two taps</li>
        <li>Move or cancel without calling</li>
        <li>Email confirmations and a reminder the day before</li>
      </ul>
      <p class="small muted">
        Prefer the phone? Call {{ catalog.settings?.shopName ?? 'us' }} at
        <a :href="`tel:${catalog.settings?.phone ?? ''}`">{{ catalog.settings?.phone }}</a>.
      </p>
    </section>
  </div>
</template>

<style scoped>
.login {
  margin-top: 4vh;
  border-top: 6px solid var(--brand);
}

.login-logo {
  width: 96px;
  height: 96px;
  border-radius: 50%;
}

.perks {
  margin: 0;
  padding-left: 1.2em;
  display: grid;
  gap: 6px;
}
</style>
