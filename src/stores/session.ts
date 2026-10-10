import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { OwnerProfile } from '@shared/types';
import { api, fetchPrincipal, type ClientPrincipal, type ProfileInput } from '@/api/client';

const PROVIDER = import.meta.env.VITE_AUTH_PROVIDER || 'entraExternalId';

export const useSession = defineStore('session', () => {
  const principal = ref<ClientPrincipal | null>(null);
  const profile = ref<OwnerProfile | null>(null);
  const roles = ref<string[]>([]);
  const ready = ref(false);
  let loading: Promise<void> | null = null;

  const isLoggedIn = computed(() => !!principal.value);
  const isAdmin = computed(() => roles.value.includes('admin'));
  const needsOnboarding = computed(() => isLoggedIn.value && !!profile.value && !profile.value.onboarded);
  const firstName = computed(() => profile.value?.displayName.split(' ')[0] ?? '');

  async function load() {
    principal.value = await fetchPrincipal();
    if (principal.value) {
      try {
        const me = await api.me();
        profile.value = me.profile;
        roles.value = me.roles;
      } catch {
        // API down: still let the visitor browse; protected pages will show their own errors.
        roles.value = principal.value.userRoles;
      }
    }
    ready.value = true;
  }

  /** Idempotent: router guards await this before every navigation. */
  function init() {
    loading ??= load();
    return loading;
  }

  async function saveProfile(input: ProfileInput) {
    const me = await api.updateMe(input);
    profile.value = me.profile;
    return me.profile;
  }

  function loginUrl(redirect = '/') {
    return `/.auth/login/${PROVIDER}?post_login_redirect_uri=${encodeURIComponent(redirect)}`;
  }

  async function logout() {
    // Cached personal API responses must not survive on a shared phone or tablet.
    if ('caches' in window) await caches.delete('my-api').catch(() => undefined);
    window.location.href = '/.auth/logout?post_logout_redirect_uri=/';
  }

  return { principal, profile, roles, ready, isLoggedIn, isAdmin, needsOnboarding, firstName, init, saveProfile, loginUrl, logout };
});
