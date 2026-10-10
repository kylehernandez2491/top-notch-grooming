<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { WaitlistEntry } from '@shared/types';
import { api } from '@/api/client';
import AppointmentRow from '@/components/AppointmentRow.vue';
import Icon from '@/components/Icon.vue';
import { useAccount } from '@/stores/account';
import { useUi } from '@/stores/ui';
import { longDay } from '@/utils/dates';

type Tab = 'upcoming' | 'past' | 'waitlist';
const route = useRoute();
const router = useRouter();
const account = useAccount();
const ui = useUi();
const tab = ref<Tab>((route.query.tab as Tab) || 'upcoming');
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    await Promise.all([account.loadAppointments(true), account.loadWaitlist(true)]);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
});

function select(t: Tab) {
  tab.value = t;
  router.replace({ query: t === 'upcoming' ? {} : { tab: t } });
}

const tabs = computed(() => [
  { key: 'upcoming' as Tab, label: 'Upcoming', count: account.upcoming.length },
  { key: 'past' as Tab, label: 'Past', count: account.past.length },
  { key: 'waitlist' as Tab, label: 'Waitlist', count: account.waitlist.length },
]);

async function leave(entry: WaitlistEntry) {
  try {
    await api.leaveWaitlist(entry);
    account.waitlist = account.waitlist.filter((w) => w.id !== entry.id);
    ui.toast('Removed from the waitlist.');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}
</script>

<template>
  <div class="page page-narrow">
    <header class="spread">
      <h1>Visits</h1>
      <RouterLink to="/book" class="btn btn-sm"><Icon name="plus" :size="18" /> Book</RouterLink>
    </header>

    <div class="tabs" role="tablist" aria-label="Visits">
      <button
        v-for="t in tabs"
        :id="`tab-${t.key}`"
        :key="t.key"
        type="button"
        role="tab"
        class="tab"
        :aria-selected="tab === t.key ? 'true' : 'false'"
        :aria-controls="`panel-${t.key}`"
        @click="select(t.key)"
      >
        {{ t.label }} <span v-if="t.count" class="tab-count tabular">{{ t.count }}</span>
      </button>
    </div>

    <p v-if="error" class="alert">{{ error }}</p>
    <div v-if="loading" class="skeleton" style="height: 200px" />

    <section v-else-if="tab === 'upcoming'" id="panel-upcoming" role="tabpanel" aria-labelledby="tab-upcoming">
      <ul v-if="account.upcoming.length" class="divider-list panel list">
        <li v-for="a in account.upcoming" :key="a.id"><AppointmentRow :appointment="a" :to="`/appointments/${a.id}`" /></li>
      </ul>
      <div v-else class="panel empty stack">
        <p>No upcoming visits.</p>
        <RouterLink to="/book" class="btn btn-primary">Book a groom</RouterLink>
      </div>
    </section>

    <section v-else-if="tab === 'past'" id="panel-past" role="tabpanel" aria-labelledby="tab-past">
      <ul v-if="account.past.length" class="divider-list panel list">
        <li v-for="a in account.past" :key="a.id"><AppointmentRow :appointment="a" :to="`/appointments/${a.id}`" /></li>
      </ul>
      <p v-else class="panel muted">Past visits, report cards and receipts will show up here.</p>
    </section>

    <section v-else id="panel-waitlist" role="tabpanel" aria-labelledby="tab-waitlist" class="stack">
      <p class="muted small">When someone cancels on a day you're waiting for, we email you straight away. First to book gets the spot.</p>
      <ul v-if="account.waitlist.length" class="divider-list panel list">
        <li v-for="w in account.waitlist" :key="w.id" class="wait-row">
          <span class="stack wait-text">
            <strong>{{ longDay(w.day) }}</strong>
            <span class="muted small">
              {{ w.petName }}, {{ w.serviceName }}, {{ w.window === 'any' ? 'any time' : w.window }}
              <template v-if="w.notifiedAt">. We emailed you about an opening.</template>
            </span>
          </span>
          <span class="row">
            <RouterLink class="btn btn-sm" :to="{ path: '/book', query: { petId: w.petId, serviceId: w.serviceId, day: w.day } }">Check</RouterLink>
            <button type="button" class="icon-btn" :aria-label="`Leave waitlist for ${longDay(w.day)}`" @click="leave(w)">
              <Icon name="x" :size="18" />
            </button>
          </span>
        </li>
      </ul>
      <p v-else class="panel muted">You're not waiting on any days. When a day is full, you can join its waitlist from the booking calendar.</p>
    </section>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--surface-sunk);
}

.tab {
  flex: 1;
  appearance: none;
  min-height: 44px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-soft);
  font: inherit;
  font-weight: 640;
  cursor: pointer;
}

.tab[aria-selected='true'] {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 0 0 1px var(--grout);
}

.tab-count {
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.list {
  padding-block: 0;
}

.empty {
  justify-items: start;
}

.wait-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
}

.wait-text {
  gap: 2px;
  min-width: 0;
}
</style>
