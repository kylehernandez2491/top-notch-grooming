<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { PetInput } from '@/api/client';
import ContactFields from '@/components/ContactFields.vue';
import PetForm from '@/components/PetForm.vue';
import { useAccount } from '@/stores/account';
import { useUi } from '@/stores/ui';
import { contactErrors, trimContact, type ContactDetails } from '@/utils/contact';

/** First visit on a device: no account to create, just details saved here for next time. */
const account = useAccount();
const ui = useUi();
const route = useRoute();
const router = useRouter();

const step = ref<'you' | 'pet'>('you');
const error = ref('');
const contact = ref<ContactDetails>({
  displayName: account.profile?.displayName ?? '',
  phone: account.profile?.phone ?? '',
  email: account.profile?.email ?? '',
  address: account.profile?.address ?? '',
});
const emailReminders = ref(account.profile?.emailReminders ?? true);
const triedSave = ref(false);
const contactProblems = computed(() => (triedSave.value ? contactErrors(contact.value) : {}));

const redirect = () => (typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/dashboard');

function saveYou() {
  error.value = '';
  triedSave.value = true;
  if (Object.keys(contactErrors(contact.value)).length) return;
  try {
    account.saveProfile({ ...account.profile, ...trimContact(contact.value), emailReminders: emailReminders.value });
    if (account.pets.length) router.replace(redirect());
    else step.value = 'pet';
  } catch (err) {
    error.value = (err as Error).message;
  }
}

function savePet(input: PetInput) {
  try {
    const pet = account.savePet(input);
    ui.toast(`${pet.name} is all set.`, 'success');
    const target = redirect();
    router.replace(target.startsWith('/book') ? target : { path: '/book', query: { petId: pet.id } });
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}
</script>

<template>
  <div class="page page-narrow">
    <template v-if="step === 'you'">
      <header class="stack">
        <h1>Welcome! Let's get you set up.</h1>
        <p class="muted">
          Two quick steps: your contact details, then your pet. No account or password needed. We save them on this device so next
          time you can book in a couple of taps.
        </p>
      </header>
      <form class="panel stack-lg" novalidate @submit.prevent="saveYou">
        <h2 class="form-title">Your details</h2>
        <ContactFields v-model="contact" id-prefix="w" :errors="contactProblems" />
        <label class="check">
          <input v-model="emailReminders" type="checkbox" />
          <span>Email me a reminder the day before each appointment</span>
        </label>
        <p class="small muted">Using a shared or borrowed phone? You can clear your details any time under "Me".</p>
        <p v-if="error" class="alert">{{ error }}</p>
        <button type="submit" class="btn btn-primary">Continue</button>
      </form>
    </template>

    <template v-else>
      <header class="stack">
        <h1>Tell us about your pet</h1>
        <p class="muted">A dog's size sets the price and time. Notes help the groomer prepare.</p>
      </header>
      <PetForm
        submit-label="Save and book"
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
