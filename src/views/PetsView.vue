<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { sizePhrase } from '@shared/format';
import Icon from '@/components/Icon.vue';
import PetAvatar from '@/components/PetAvatar.vue';
import { useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { ageFrom, shortDay } from '@/utils/dates';

const account = useAccount();
const catalog = useCatalog();
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    await account.loadAppointments(); // for "Last groom"; the pets themselves are saved on this device
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
});

const expiredCount = (petId: string) =>
  account.petById(petId)?.vaccinations.filter((v) => v.expiresOn < catalog.today).length ?? 0;
</script>

<template>
  <div class="page page-narrow">
    <header class="spread">
      <h1>Pets</h1>
      <RouterLink to="/pets/new" class="btn btn-sm"><Icon name="plus" :size="18" /> Add a pet</RouterLink>
    </header>
    <p v-if="error" class="alert">{{ error }}</p>
    <div v-if="loading" class="skeleton" style="height: 160px" />

    <ul v-else-if="account.pets.length" class="pets">
      <li v-for="pet in account.pets" :key="pet.id" class="panel pet">
        <RouterLink :to="`/pets/${pet.id}`" class="pet-link">
          <PetAvatar :name="pet.name" :photo="pet.photo" :size="72" />
          <span class="stack pet-text">
            <strong class="pet-name">{{ pet.name }}</strong>
            <span class="muted small">
              {{ pet.breed || (pet.species === 'dog' ? 'Dog' : 'Cat') }}, {{ sizePhrase(pet.size, pet.species) }}<template v-if="ageFrom(pet.birthday)">, {{ ageFrom(pet.birthday) }}</template>
            </span>
            <span v-if="account.lastVisitFor(pet.id)" class="small">Last groom {{ shortDay(account.lastVisitFor(pet.id)!.day) }}</span>
            <span v-if="expiredCount(pet.id)" class="small warn"><Icon name="alert" :size="14" /> Vaccination date needs updating</span>
          </span>
        </RouterLink>
        <RouterLink :to="{ path: '/book', query: { petId: pet.id } }" class="btn btn-sm">Book</RouterLink>
      </li>
    </ul>

    <div v-else class="panel stack empty">
      <Icon name="paw" :size="32" />
      <p>Add your pet once and you'll be able to book in a couple of taps.</p>
      <RouterLink to="/pets/new" class="btn btn-primary">Add a pet</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.pets {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pet {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pet-link {
  flex: 1;
  display: flex;
  gap: 16px;
  align-items: center;
  text-decoration: none;
  min-width: 0;
}

.pet-text {
  gap: 2px;
  min-width: 0;
}

.pet-name {
  font-size: var(--step-1);
  font-variation-settings: 'CASL' 1;
}

.warn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--alert);
  font-weight: 600;
}

.empty {
  justify-items: start;
}
</style>
