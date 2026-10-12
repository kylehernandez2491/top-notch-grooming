<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Pet } from '@shared/types';
import type { PetInput } from '@/api/client';
import PetForm from '@/components/PetForm.vue';
import { useAccount } from '@/stores/account';
import { useUi } from '@/stores/ui';

const route = useRoute();
const router = useRouter();
const account = useAccount();
const ui = useUi();

const id = computed(() => route.params.id as string | undefined);
/** Pets are saved on this device, so there's nothing to load. */
const pet = computed(() => (id.value ? account.petById(id.value) : undefined));
const loadError = computed(() => (id.value && !pet.value ? "That pet isn't saved on this device." : ''));

function back(saved?: Pet) {
  const ret = typeof route.query.return === 'string' && route.query.return.startsWith('/') ? route.query.return : undefined;
  if (ret && saved) {
    const target = router.resolve(ret);
    router.replace({ path: target.path, query: { ...target.query, petId: saved.id } });
  } else if (ret) router.replace(ret);
  else router.replace('/pets');
}

function save(input: PetInput) {
  try {
    const saved = account.savePet(input, id.value);
    ui.toast(`${saved.name} saved.`, 'success');
    back(saved);
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}

async function remove() {
  if (!pet.value) return;
  const { confirmed } = await ui.confirm({
    title: `Remove ${pet.value.name}?`,
    message: 'Their past visits stay with the shop. You can add them again any time.',
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
    <PetForm
      v-else
      :key="pet?.id ?? 'new'"
      :initial="pet"
      :submit-label="id ? 'Save changes' : 'Add pet'"
      @submit="save"
      @cancel="back()"
    />
  </div>
</template>
