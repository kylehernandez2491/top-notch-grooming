import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useSession } from '@/stores/session';
import { useCatalog } from '@/stores/catalog';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    auth?: boolean;
    admin?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
  { path: '/services', name: 'services', component: () => import('@/views/ServicesView.vue'), meta: { title: 'Services and prices' } },
  { path: '/availability', name: 'availability', component: () => import('@/views/AvailabilityView.vue'), meta: { title: 'Open times' } },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: 'Sign in' } },
  { path: '/welcome', name: 'welcome', component: () => import('@/views/WelcomeView.vue'), meta: { auth: true, title: 'Welcome' } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { auth: true, title: 'Home' } },
  { path: '/book', name: 'book', component: () => import('@/views/BookView.vue'), meta: { auth: true, title: 'Book a groom' } },
  { path: '/appointments', name: 'appointments', component: () => import('@/views/AppointmentsView.vue'), meta: { auth: true, title: 'Visits' } },
  { path: '/appointments/:id', name: 'appointment', component: () => import('@/views/AppointmentView.vue'), meta: { auth: true, title: 'Appointment' } },
  {
    path: '/appointments/:id/reschedule',
    name: 'reschedule',
    component: () => import('@/views/RescheduleView.vue'),
    meta: { auth: true, title: 'Change time' },
  },
  { path: '/pets', name: 'pets', component: () => import('@/views/PetsView.vue'), meta: { auth: true, title: 'Pets' } },
  { path: '/pets/new', name: 'pet-new', component: () => import('@/views/PetEditView.vue'), meta: { auth: true, title: 'Add a pet' } },
  { path: '/pets/:id', name: 'pet-edit', component: () => import('@/views/PetEditView.vue'), meta: { auth: true, title: 'Edit pet' } },
  { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue'), meta: { auth: true, title: 'Account' } },

  { path: '/admin', name: 'admin-today', component: () => import('@/views/admin/AdminTodayView.vue'), meta: { auth: true, admin: true, title: 'Today' } },
  { path: '/admin/week', name: 'admin-week', component: () => import('@/views/admin/AdminWeekView.vue'), meta: { auth: true, admin: true, title: 'Week' } },
  {
    path: '/admin/appointments/:id',
    name: 'admin-appointment',
    component: () => import('@/views/admin/AdminAppointmentView.vue'),
    meta: { auth: true, admin: true, title: 'Appointment' },
  },
  { path: '/admin/clients', name: 'admin-clients', component: () => import('@/views/admin/AdminClientsView.vue'), meta: { auth: true, admin: true, title: 'Clients' } },
  {
    path: '/admin/clients/:ownerId',
    name: 'admin-client',
    component: () => import('@/views/admin/AdminClientView.vue'),
    meta: { auth: true, admin: true, title: 'Client' },
  },
  { path: '/admin/shop', name: 'admin-shop', component: () => import('@/views/admin/AdminShopView.vue'), meta: { auth: true, admin: true, title: 'Shop settings' } },
  { path: '/admin/reports', name: 'admin-reports', component: () => import('@/views/admin/AdminReportsView.vue'), meta: { auth: true, admin: true, title: 'Reports' } },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue'), meta: { title: 'Not found' } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    // Links such as /services#sizes: wait a moment for the lazily loaded page to render its sections.
    if (to.hash) return new Promise((resolve) => setTimeout(() => resolve({ el: to.hash, top: 72 }), 250));
    if (to.path === from.path) return false;
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  const session = useSession();
  await session.init();
  if (to.meta.auth && !session.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.meta.admin && !session.isAdmin) return { name: 'dashboard' };
  if (to.meta.auth && session.needsOnboarding && to.name !== 'welcome') return { name: 'welcome', query: { redirect: to.fullPath } };
  if (to.name === 'home' && session.isLoggedIn) return { name: 'dashboard' };
  return true;
});

router.afterEach((to) => {
  const shop = useCatalog().settings?.shopName ?? 'Top Notch Dog Grooming';
  document.title = to.meta.title ? `${to.meta.title} | ${shop}` : shop;
});
