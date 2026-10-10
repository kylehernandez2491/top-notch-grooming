<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Pet } from '@shared/types';
import { api, ApiError, type PetInput } from '@/api/client';
import PetForm from '@/components/PetForm.vue';
import { useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { useUi } from '@/stores/ui';

const route = useRoute();
const router = useRouter();
const account = useAccount();
const catalog = useCatalog();
const ui = useUi();

const id = computed(() => route.params.id as string | undefined);
const pet = ref<Pet | undefined>();
const loading = ref(!!id.value);
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const loadError = ref('');

onMounted(async () => {
  if (!id.value) return;
  try {
    pet.value = account.petById(id.value) ?? (await api.pet(id.value));
  } catch (err) {
    loadError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
});

function back(saved?: Pet) {
  const ret = typeof route.query.return === 'string' && route.query.return.startsWith('/') ? route.query.return : undefined;
  if (ret && saved) {
    const target = router.resolve(ret);
    router.replace({ path: target.path, query: { ...target.query, petId: saved.id } });
  } else if (ret) router.replace(ret);
  else router.replace('/pets');
}

async function save(input: PetInput) {
  saving.value = true;
  errors.value = {};
  try {
    const saved = await account.savePet(input, id.value);
    ui.toast(`${saved.name} saved.`, 'success');
    back(saved);
  } catch (err) {
    if (err instanceof ApiError) errors.value = err.fieldErrors();
    ui.toast((err as Error).message, 'error');
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!pet.value) return;
  const { confirmed } = await ui.confirm({
    title: `Remove ${pet.value.name}?`,
    message: 'Their past visits stay on your account. You can add them again any time.',
    confirmLabel: 'Remove pet',
    cancelLabel: 'Keep',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await account.removePet(pet.value.id);
    ui.toast('Pet removed.');
    router.replace('/pets');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}
</script>

<template>
  <div class="page page-narrow">
    <header class="spread">
      <h1>{{ id ? `Edit ${pet?.name ?? 'pet'}` : 'Add a pet' }}</h1>
      <button v-if="pet" type="button" class="btn btn-sm btn-danger" @click="remove">Remove</button>
    </header>
    <p v-if="loadError" class="alert">{{ loadError }}</p>
    <div v-if="loading" class="skeleton" style="height: 320px" />
    <PetForm
      v-else-if="!id || pet"
      :key="pet?.id ?? 'new'"
      :initial="pet"
      :saving="saving"
      :errors="errors"
      :submit-label="id ? 'Save changes' : 'Add pet'"
      :vaccination-policy="catalog.settings?.policies.vaccination"
      @submit="save"
      @cancel="back()"
    />
  </div>
</template>
