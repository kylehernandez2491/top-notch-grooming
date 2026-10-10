<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { ClientSummary } from '@shared/types';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';

const q = ref('');
const clients = ref<ClientSummary[]>([]);
const loading = ref(true);
const error = ref('');
let timer: number | undefined;

async function load() {
  loading.value = true;
  try {
    clients.value = await api.admin.clients(q.value.trim());
    error.value = '';
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(q, () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 250);
});
</script>

<template>
  <div class="page page-narrow">
    <h1>Clients</h1>
    <div class="field">
      <label for="client-search" class="visually-hidden">Search clients</label>
      <input id="client-search" v-model="q" class="input" type="search" placeholder="Search by name, email, phone or pet" autocomplete="off" />
    </div>
    <p v-if="error" class="alert">{{ error }}</p>
    <div v-if="loading && !clients.length" class="skeleton" style="height: 200px" />
    <ul v-else-if="clients.length" class="divider-list panel list">
      <li v-for="c in clients" :key="c.profile.ownerId">
        <RouterLink :to="`/admin/clients/${c.profile.ownerId}`" class="client">
          <span class="stack client-text">
            <strong>{{ c.profile.displayName || c.profile.email }}</strong>
            <span class="muted small">{{ c.profile.phone || c.profile.email }}</span>
          </span>
          <span class="row client-meta">
            <span class="badge">{{ c.petCount }} {{ c.petCount === 1 ? 'pet' : 'pets' }}</span>
            <span v-if="c.profile.noShowCount" class="badge no-show">{{ c.profile.noShowCount }} no-show</span>
            <Icon name="chevron-right" :size="18" />
          </span>
        </RouterLink>
      </li>
    </ul>
    <p v-else class="panel muted">{{ q ? 'No clients match that search.' : 'Clients appear here after they sign up.' }}</p>
  </div>
</template>

<style scoped>
.list {
  padding-block: 0;
}

.client {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  min-height: 64px;
  text-decoration: none;
}

.client-text {
  gap: 0;
  min-width: 0;
}

.client-meta {
  flex-wrap: nowrap;
  gap: 6px;
}

.no-show {
  background: var(--alert-bg);
  color: var(--alert);
}
</style>
