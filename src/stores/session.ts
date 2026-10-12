import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { fetchPrincipal, type ClientPrincipal } from '@/api/client';

/** Static Web Apps' built-in sign-in, used by staff only. Pet owners never sign in. */
export type StaffProvider = 'aad' | 'github';

/** The signed-in staff member, if any. Owners' details live in the account store, on their device. */
export const useSession = defineStore('session', () => {
  const principal = ref<ClientPrincipal | null>(null);
  const ready = ref(false);
  let loading: Promise<void> | null = null;

  const isSignedIn = computed(() => !!principal.value);
  const isAdmin = computed(() => !!principal.value?.userRoles.includes('admin'));

  async function load() {
    principal.value = await fetchPrincipal();
    ready.value = true;
  }

  /** Idempotent: router guards await this before every navigation. */
  function init() {
    loading ??= load();
    return loading;
  }

  function loginUrl(provider: StaffProvider, redirect = '/admin') {
    return `/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(redirect)}`;
  }

  async function logout() {
    // Cached staff API responses must not survive on a shared phone or tablet.
    if ('caches' in window) await caches.delete('my-api').catch(() => undefined);
    window.location.href = '/.auth/logout?post_logout_redirect_uri=/';
  }

  return { principal, ready, isSignedIn, isAdmin, init, loginUrl, logout };
});
