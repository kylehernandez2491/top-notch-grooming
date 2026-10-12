import '@fontsource-variable/recursive/casl.css';
import './styles/main.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { router } from './router';
import { useUi } from './stores/ui';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');

// Installable PWA: offer a one-tap update instead of silently swapping code mid-booking.
const updateSW = registerSW({
  onNeedRefresh() {
    useUi().updateReady = () => updateSW(true);
  },
});

// Staff session expired while the portal was open: sign in again, then come back here.
window.addEventListener('api:unauthorized', () => {
  const current = router.currentRoute.value;
  if (current.meta.admin) router.push({ name: 'staff-login', query: { redirect: current.fullPath, expired: '1' } });
});
