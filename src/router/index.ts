import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { useSession } from '@/stores/session';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    /** Needs the owner's details saved on this device (there's no sign-in for owners). */
    profile?: boolean;
    admin?: boolean;
  }
}

const BookView = () => import('@/views/BookView.vue');

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
  { path: '/services', name: 'services', component: () => import('@/views/ServicesView.vue'), meta: { title: 'Services and prices' } },
  { path: '/availability', name: 'availability', component: () => import('@/views/AvailabilityView.vue'), meta: { title: 'Open times' } },
  { path: '/staff', name: 'staff-login', component: () => import('@/views/StaffLoginView.vue'), meta: { title: 'Staff sign-in' } },
  { path: '/welcome', name: 'welcome', component: () => import('@/views/WelcomeView.vue'), meta: { title: 'Your details' } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { profile: true, title: 'Home' } },
  { path: '/book', name: 'book', component: BookView, meta: { profile: true, title: 'Book a groom' } },
  { path: '/appointments', name: 'appointments', component: () => import('@/views/AppointmentsView.vue'), meta: { title: 'Visits' } },
  // No profile needed: these open from the link in a confirmation email, on any device.
  { path: '/appointments/:id', name: 'appointment', component: () => import('@/views/AppointmentView.vue'), meta: { title: 'Appointment' } },
  {
    path: '/appointments/:id/reschedule',
    name: 'reschedule',
    component: () => import('@/views/RescheduleView.vue'),
    meta: { title: 'Change time' },
  },
  { path: '/pets', name: 'pets', component: () => import('@/views/PetsView.vue'), meta: { profile: true, title: 'Pets' } },
  { path: '/pets/new', name: 'pet-new', component: () => import('@/views/PetEditView.vue'), meta: { profile: true, title: 'Add a pet' } },
  { path: '/pets/:id', name: 'pet-edit', component: () => import('@/views/PetEditView.vue'), meta: { profile: true, title: 'Edit pet' } },
  { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue'), meta: { profile: true, title: 'Your details' } },

  { path: '/admin', name: 'admin-today', component: () => import('@/views/admin/AdminTodayView.vue'), meta: { admin: true, title: 'Today' } },
  { path: '/admin/week', name: 'admin-week', component: () => import('@/views/admin/AdminWeekView.vue'), meta: { admin: true, title: 'Week' } },
  {
    path: '/admin/appointments/:id',
    name: 'admin-appointment',
    component: () => import('@/views/admin/AdminAppointmentView.vue'),
    meta: { admin: true, title: 'Appointment' },
  },
  { path: '/admin/book', name: 'admin-book', component: BookView, meta: { admin: true, title: 'Book for client' } },
  { path: '/admin/clients', name: 'admin-clients', component: () => import('@/views/admin/AdminClientsView.vue'), meta: { admin: true, title: 'Clients' } },
  {
    path: '/admin/clients/:clientKey',
    name: 'admin-client',
    component: () => import('@/views/admin/AdminClientView.vue'),
    meta: { admin: true, title: 'Client' },
  },
  { path: '/admin/shop', name: 'admin-shop', component: () => import('@/views/admin/AdminShopView.vue'), meta: { admin: true, title: 'Shop settings' } },
  { path: '/admin/reports', name: 'admin-reports', component: () => import('@/views/admin/AdminReportsView.vue'), meta: { admin: true, title: 'Reports' } },

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
  const account = useAccount();
  await session.init();
  if (to.meta.admin && !session.isAdmin) return { name: 'staff-login', query: { redirect: to.fullPath } };
  if (to.meta.profile && !account.hasProfile) return { name: 'welcome', query: { redirect: to.fullPath } };
  if (to.name === 'home' && account.hasProfile) return { name: 'dashboard' };
  return true;
});

router.afterEach((to) => {
  const shop = useCatalog().settings?.shopName ?? 'Top Notch Dog Grooming';
  document.title = to.meta.title ? `${to.meta.title} | ${shop}` : shop;
});
