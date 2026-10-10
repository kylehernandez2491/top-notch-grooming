<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, type PetInput } from '@/api/client';
import ContactFields from '@/components/ContactFields.vue';
import PetForm from '@/components/PetForm.vue';
import { useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { contactErrors, trimContact, type ContactDetails } from '@/utils/contact';

const session = useSession();
const account = useAccount();
const catalog = useCatalog();
const ui = useUi();
const route = useRoute();
const router = useRouter();

const step = ref<'you' | 'pet'>('you');
const saving = ref(false);
const error = ref('');
const petErrors = ref<Record<string, string>>({});
const contact = ref<ContactDetails>({
  // New profiles start with the email prefix as a placeholder name; ask for the real one.
  displayName: session.profile?.onboarded ? session.profile.displayName : '',
  phone: session.profile?.phone ?? '',
  email: session.profile?.email || session.principal?.userDetails || '',
  address: session.profile?.address ?? '',
});
const emailReminders = ref(true);
const triedSave = ref(false);
const serverErrors = ref<Record<string, string>>({});
const contactProblems = computed(() => ({ ...(triedSave.value ? contactErrors(contact.value) : {}), ...serverErrors.value }));

const redirect = () => (typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard');

async function saveYou() {
  error.value = '';
  serverErrors.value = {};
  triedSave.value = true;
  if (Object.keys(contactErrors(contact.value)).length) return;
  saving.value = true;
  try {
    await session.saveProfile({
      ...trimContact(contact.value),
      emailReminders: emailReminders.value,
      emailMarketing: false,
    });
    const pets = await account.loadPets();
    if (pets.length) router.replace(redirect());
    else step.value = 'pet';
  } catch (err) {
    if (err instanceof ApiError) serverErrors.value = err.fieldErrors();
    error.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

async function savePet(input: PetInput) {
  saving.value = true;
  petErrors.value = {};
  try {
    const pet = await account.savePet(input);
    ui.toast(`${pet.name} is all set.`, 'success');
    const target = redirect();
    router.replace(target.startsWith('/book') ? target : { path: '/book', query: { petId: pet.id } });
  } catch (err) {
    if (err instanceof ApiError) petErrors.value = err.fieldErrors();
    ui.toast((err as Error).message, 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page page-narrow">
    <template v-if="step === 'you'">
      <header class="stack">
        <h1>Welcome! Let's get you set up.</h1>
        <p class="muted">Two quick steps: your contact details, then your pet. You'll only do this once.</p>
      </header>
      <form class="panel stack-lg" novalidate @submit.prevent="saveYou">
        <h2 class="form-title">Your details</h2>
        <ContactFields v-model="contact" id-prefix="w" :errors="contactProblems" />
        <label class="check">
          <input v-model="emailReminders" type="checkbox" />
          <span>Email me a reminder the day before each appointment</span>
        </label>
        <p v-if="error" class="alert">{{ error }}</p>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : 'Continue' }}
        </button>
      </form>
    </template>

    <template v-else>
      <header class="stack">
        <h1>Tell us about your pet</h1>
        <p class="muted">A dog's size sets the price and time. Notes and vaccination dates help the groomer prepare.</p>
      </header>
      <PetForm
        submit-label="Save and book"
        :saving="saving"
        :errors="petErrors"
        :vaccination-policy="catalog.settings?.policies.vaccination"
        @submit="savePet"
        @cancel="router.replace('/dashboard')"
      />
    </template>
  </div>
</template>

<style scoped>
.form-title {
  font-size: var(--step-1);
}
</style>
