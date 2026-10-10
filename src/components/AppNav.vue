<script setup lang="ts">
/** Top bar on every screen; bottom tab bar on phones (thumb reach), inline links on desktop. */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icon, { type IconName } from './Icon.vue';
import { useCatalog } from '@/stores/catalog';
import { useSession } from '@/stores/session';

const session = useSession();
const catalog = useCatalog();
const route = useRoute();

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  exact?: boolean;
}

const staffArea = computed(() => route.path.startsWith('/admin'));

const items = computed<NavItem[]>(() => {
  if (!session.isLoggedIn) {
    return [
      { to: '/', label: 'Home', icon: 'home', exact: true },
      { to: '/services', label: 'Services', icon: 'scissors' },
      { to: '/availability', label: 'Open times', icon: 'calendar' },
      { to: '/login', label: 'Sign in', icon: 'user' },
    ];
  }
  if (staffArea.value && session.isAdmin) {
    return [
      { to: '/admin', label: 'Today', icon: 'list', exact: true },
      { to: '/admin/week', label: 'Week', icon: 'calendar' },
      { to: '/admin/clients', label: 'Clients', icon: 'users' },
      { to: '/admin/shop', label: 'Shop', icon: 'settings' },
      { to: '/admin/reports', label: 'Reports', icon: 'chart' },
    ];
  }
  return [
    { to: '/dashboard', label: 'Home', icon: 'home' },
    { to: '/book', label: 'Book', icon: 'plus' },
    { to: '/appointments', label: 'Visits', icon: 'calendar' },
    { to: '/pets', label: 'Pets', icon: 'paw' },
    { to: '/profile', label: 'Me', icon: 'user' },
  ];
});

function active(item: NavItem) {
  return item.exact ? route.path === item.to : route.path === item.to || route.path.startsWith(`${item.to}/`);
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-inner">
      <RouterLink :to="session.isLoggedIn ? '/dashboard' : '/'" class="brand">
        <img class="brand-logo" src="/brand/logo.png" srcset="/brand/logo@2x.png 2x" width="40" height="40" alt="" />
        <span class="brand-name">{{ catalog.settings?.shopName ?? 'Top Notch Dog Grooming' }}</span>
      </RouterLink>

      <nav class="desk-nav" aria-label="Main">
        <RouterLink
          v-for="item in items.filter((i) => i.to !== '/login')"
          :key="item.to"
          :to="item.to"
          class="desk-link"
          :aria-current="active(item) ? 'page' : undefined"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="topbar-end">
        <template v-if="session.isAdmin">
          <RouterLink v-if="!staffArea" to="/admin" class="btn btn-sm">Staff</RouterLink>
          <RouterLink v-else to="/dashboard" class="btn btn-sm">Owner view</RouterLink>
        </template>
        <a v-if="!session.isLoggedIn" :href="session.loginUrl('/dashboard')" class="btn btn-sm btn-dark top-signin">Sign in</a>
      </div>
    </div>
  </header>

  <nav class="tabbar" aria-label="Main">
    <RouterLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="tab"
      :class="{ 'tab-book': item.to === '/book' }"
      :aria-current="active(item) ? 'page' : undefined"
    >
      <Icon :name="item.icon" :size="item.to === '/book' ? 24 : 22" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: color-mix(in srgb, var(--paper) 90%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--grout);
  padding-top: env(safe-area-inset-top, 0px);
}

.topbar-inner {
  max-width: var(--page-max);
  margin: 0 auto;
  height: var(--top-h);
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  text-decoration: none;
  font-weight: 800;
  font-size: var(--step-0);
  font-variation-settings: 'CASL' 1;
  letter-spacing: -0.01em;
}

@media (min-width: 900px) {
  .brand {
    font-size: var(--step-1);
  }
}

.brand-logo {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex: none;
}

.brand-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.desk-nav {
  display: none;
  gap: 4px;
}

.desk-link {
  padding: 8px 14px;
  border-radius: var(--radius-pill);
  text-decoration: none;
  font-weight: 600;
  color: var(--ink-soft);
}

.desk-link[aria-current='page'] {
  color: var(--ink);
  background: var(--brand-faint);
}

.topbar-end {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.tabbar {
  position: fixed;
  z-index: 20;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-around;
  height: calc(var(--nav-h) + var(--safe-b));
  padding-bottom: var(--safe-b);
  background: var(--surface);
  border-top: 1px solid var(--grout);
}

.tab {
  flex: 1;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 2px;
  text-decoration: none;
  color: var(--ink-soft);
  font-size: 0.72rem;
  font-weight: 620;
  min-width: 0;
}

.tab[aria-current='page'] {
  color: var(--ink);
}

.tab :deep(svg) {
  height: 30px;
  padding-block: 4px;
}

.tab[aria-current='page'] :deep(svg) {
  stroke-width: 2.4;
}

/* The Book tab is the app's main action, so it gets the logo yellow. */
.tab-book :deep(svg) {
  width: 40px;
  height: 30px;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--brand);
  color: var(--on-brand);
}

@media (max-width: 899px) {
  .top-signin {
    display: none;
  }
}

@media (min-width: 900px) {
  .desk-nav {
    display: flex;
  }
  .tabbar {
    display: none;
  }
}
</style>
