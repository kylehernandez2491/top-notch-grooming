<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '@/components/Icon.vue';
import { useCatalog } from '@/stores/catalog';
import { useSession } from '@/stores/session';

/** Staff only. Pet owners never sign in; their details stay on their own phone. */
const route = useRoute();
const session = useSession();
const catalog = useCatalog();
const redirect = computed(() => (typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/admin') ? route.query.redirect : '/admin'));
const expired = computed(() => route.query.expired === '1');
</script>

<template>
  <div class="page page-narrow">
    <section class="panel stack-lg login">
      <img class="login-logo" src="/brand/logo.png" srcset="/brand/logo@2x.png 2x" width="96" height="96" :alt="catalog.settings?.shopName ?? 'Top Notch Dog Grooming'" />
      <h1>Staff sign-in</h1>

      <template v-if="session.isSignedIn && !session.isAdmin">
        <p class="note">
          <Icon name="alert" :size="18" />
          <span>
            {{ session.principal?.userDetails || 'This account' }} doesn't have staff access yet. Ask the shop owner to send you an
            invitation, open it, then sign in again.
          </span>
        </p>
        <button type="button" class="btn" @click="session.logout()"><Icon name="logout" :size="18" /> Sign out</button>
      </template>

      <template v-else>
        <p v-if="expired" class="note">Your session ended. Sign in again to pick up where you left off.</p>
        <p class="muted">For the groomer and shop staff. Use the account your staff invitation was sent to.</p>
        <a :href="session.loginUrl('aad', redirect)" class="btn btn-primary btn-block">Sign in with Microsoft</a>
        <a :href="session.loginUrl('github', redirect)" class="btn btn-block">Sign in with GitHub</a>
      </template>

      <p class="small muted">
        Here to book a groom? You don't need an account.
        <RouterLink to="/book">Book now</RouterLink>
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
</style>
