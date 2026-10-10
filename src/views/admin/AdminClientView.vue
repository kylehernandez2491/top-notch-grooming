<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { ClientDetail } from '@shared/types';
import { ACTIVE_STATUSES } from '@shared/types';
import { TEMPERAMENT_LABELS, formatMoney, sizePhrase } from '@shared/format';
import { api } from '@/api/client';
import AppointmentRow from '@/components/AppointmentRow.vue';
import Icon from '@/components/Icon.vue';
import PetAvatar from '@/components/PetAvatar.vue';
import { useCatalog } from '@/stores/catalog';
import { useUi } from '@/stores/ui';
import { ageFrom, shortDay } from '@/utils/dates';
import { telUrl, mapsUrl } from '@/utils/device';

const route = useRoute();
const ui = useUi();
const catalog = useCatalog();
const detail = ref<ClientDetail | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    detail.value = await api.admin.client(route.params.ownerId as string);
  } catch (err) {
    error.value = (err as Error).message;
  }
});

const nowIso = new Date().toISOString();
const upcoming = computed(() => detail.value?.appointments.filter((a) => ACTIVE_STATUSES.includes(a.status) && a.endUtc > nowIso) ?? []);
const history = computed(() => detail.value?.appointments.filter((a) => !upcoming.value.includes(a)).reverse() ?? []);
const spend = computed(() =>
  (detail.value?.appointments ?? []).filter((a) => a.status === 'completed').reduce((s, a) => s + (a.finalPrice ?? a.estimatedPrice), 0),
);

async function resetNoShows() {
  if (!detail.value) return;
  try {
    detail.value.profile = await api.admin.resetNoShows(detail.value.profile.ownerId);
    ui.toast('No-show count reset. Online booking is open for this client again.', 'success');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}
</script>

<template>
  <div class="page page-narrow">
    <RouterLink to="/admin/clients" class="back small"><Icon name="chevron-left" :size="16" /> Clients</RouterLink>
    <p v-if="error" class="alert">{{ error }}</p>
    <div v-if="!detail && !error" class="skeleton" style="height: 240px" />

    <template v-if="detail">
      <header class="spread">
        <div class="stack head">
          <h1>{{ detail.profile.displayName }}</h1>
          <span class="muted small">Client since {{ shortDay(detail.profile.createdAt.slice(0, 10)) }}, {{ formatMoney(spend) }} spent</span>
        </div>
        <RouterLink class="btn btn-primary" :to="{ path: '/book', query: { ownerId: detail.profile.ownerId } }">Book for client</RouterLink>
      </header>

      <section class="panel stack">
        <div class="row">
          <a v-if="detail.profile.phone" class="btn btn-sm" :href="telUrl(detail.profile.phone)"><Icon name="phone" :size="18" /> {{ detail.profile.phone }}</a>
          <a class="btn btn-sm" :href="`mailto:${detail.profile.email}`"><Icon name="mail" :size="18" /> {{ detail.profile.email }}</a>
        </div>
        <p v-if="detail.profile.address" class="row small client-address">
          <Icon name="map" :size="16" />
          <a :href="mapsUrl(detail.profile.address)" target="_blank" rel="noopener">{{ detail.profile.address }}</a>
        </p>
        <p v-if="detail.profile.emergencyContact" class="small">Emergency contact: {{ detail.profile.emergencyContact }}</p>
        <p class="small muted">Reminder emails {{ detail.profile.emailReminders ? 'on' : 'off' }}.</p>
        <div v-if="detail.profile.noShowCount" class="note">
          <Icon name="alert" :size="18" />
          <span>
            {{ detail.profile.noShowCount }} no-show{{ detail.profile.noShowCount === 1 ? '' : 's' }}.
            <template v-if="catalog.settings?.noShowLimit && detail.profile.noShowCount >= catalog.settings.noShowLimit">Online booking is paused.</template>
            <button type="button" class="btn btn-sm btn-ghost" @click="resetNoShows">Reset</button>
          </span>
        </div>
      </section>

      <section class="stack">
        <h2 class="section-title">Pets</h2>
        <article v-for="pet in detail.pets" :key="pet.id" class="panel pet">
          <div class="row">
            <PetAvatar :name="pet.name" :photo="pet.photo" :size="56" />
            <div class="stack pet-head">
              <strong class="pet-name">{{ pet.name }}</strong>
              <span class="muted small">
                {{ pet.breed || pet.species }}, {{ sizePhrase(pet.size, pet.species) }}<template v-if="pet.weightKg">, {{ pet.weightKg }} kg</template
                ><template v-if="ageFrom(pet.birthday)">, {{ ageFrom(pet.birthday) }}</template>
              </span>
            </div>
          </div>
          <dl class="details">
            <dt>Temperament</dt>
            <dd>{{ TEMPERAMENT_LABELS[pet.temperament] }}</dd>
            <template v-if="pet.groomingPreferences"><dt>Preferences</dt><dd>{{ pet.groomingPreferences }}</dd></template>
            <template v-if="pet.behaviorNotes"><dt>Behavior</dt><dd>{{ pet.behaviorNotes }}</dd></template>
            <template v-if="pet.allergies"><dt>Allergies</dt><dd class="warn">{{ pet.allergies }}</dd></template>
            <template v-if="pet.medicalNotes"><dt>Medical</dt><dd class="warn">{{ pet.medicalNotes }}</dd></template>
            <template v-if="pet.coat"><dt>Coat</dt><dd>{{ pet.coat }}</dd></template>
            <dt>Vaccinations</dt>
            <dd>
              <span v-if="!pet.vaccinations.length" class="warn">None on file</span>
              <span v-for="v in pet.vaccinations" :key="v.name" class="vax" :class="{ warn: v.expiresOn < catalog.today }">
                {{ v.name }} until {{ shortDay(v.expiresOn) }}
              </span>
            </dd>
            <template v-if="pet.vetName"><dt>Vet</dt><dd>{{ pet.vetName }} {{ pet.vetPhone }}</dd></template>
          </dl>
        </article>
        <p v-if="!detail.pets.length" class="panel muted">No pets on file yet.</p>
      </section>

      <section v-if="upcoming.length" class="stack">
        <h2 class="section-title">Upcoming</h2>
        <ul class="divider-list panel list">
          <li v-for="a in upcoming" :key="a.id"><AppointmentRow :appointment="a" :to="`/admin/appointments/${a.id}`" /></li>
        </ul>
      </section>

      <section v-if="history.length" class="stack">
        <h2 class="section-title">History</h2>
        <ul class="divider-list panel list">
          <li v-for="a in history" :key="a.id"><AppointmentRow :appointment="a" :to="`/admin/appointments/${a.id}`" /></li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.client-address {
  gap: 6px;
  flex-wrap: nowrap;
  align-items: flex-start;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  color: var(--ink-soft);
  font-weight: 600;
  min-height: 44px;
}

.head {
  gap: 2px;
}

.section-title {
  font-size: var(--step-1);
}

.pet {
  display: grid;
  gap: 14px;
}

.pet-head {
  gap: 0;
}

.pet-name {
  font-size: var(--step-1);
  font-variation-settings: 'CASL' 1;
}

.details {
  display: grid;
  grid-template-columns: minmax(100px, auto) 1fr;
  gap: 8px 16px;
  margin: 0;
}

.details dt {
  color: var(--ink-soft);
  font-size: var(--step--1);
  font-weight: 600;
}

.details dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.warn {
  color: var(--alert);
  font-weight: 600;
}

.list {
  padding-block: 0;
}
</style>
