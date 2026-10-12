<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import ContactFields from '@/components/ContactFields.vue';
import Icon from '@/components/Icon.vue';
import { useAccount } from '@/stores/account';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { contactErrors, trimContact, type ContactDetails } from '@/utils/contact';

const account = useAccount();
const session = useSession();
const ui = useUi();
const router = useRouter();
const contact = ref<ContactDetails>({
  displayName: account.profile?.displayName ?? '',
  phone: account.profile?.phone ?? '',
  email: account.profile?.email ?? '',
  address: account.profile?.address ?? '',
});
const triedSave = ref(false);
const contactProblems = computed(() => (triedSave.value ? contactErrors(contact.value) : {}));
const form = reactive({
  emergencyContact: account.profile?.emergencyContact ?? '',
  emailReminders: account.profile?.emailReminders ?? true,
});

function save() {
  triedSave.value = true;
  if (Object.keys(contactErrors(contact.value)).length) {
    ui.toast('Please check your contact details.', 'error');
    return;
  }
  try {
    account.saveProfile({
      ...trimContact(contact.value),
      emergencyContact: form.emergencyContact.trim() || undefined,
      emailReminders: form.emailReminders,
    });
    ui.toast('Saved. Your next booking will use these details.', 'success');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}

async function download() {
  const data = await account.exportData();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `my-grooming-data-${data.exportedAt.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function forget() {
  const { confirmed } = await ui.confirm({
    title: 'Forget me on this device?',
    message:
      'Your details, pets and photos are removed from this phone or computer. Your bookings stay with the shop: open them from the links in your confirmation emails, or call us.',
    confirmLabel: 'Forget me',
    cancelLabel: 'Keep my details',
    danger: true,
  });
  if (!confirmed) return;
  await account.forget();
  ui.toast('Done. Nothing about you is saved on this device now.');
  router.replace('/');
}

async function installHelp() {
  ui.toast('On iPhone: tap Share, then "Add to Home Screen". On Android: open the browser menu and choose "Install app".', 'info', undefined, 9000);
}
</script>

<template>
  <div class="page page-narrow">
    <header class="stack">
      <h1>Your details</h1>
      <p class="muted">Saved on this device only and sent with each booking. There's no account or password.</p>
    </header>

    <form class="panel stack-lg" novalidate @submit.prevent="save">
      <h2 class="section-title">Contact details</h2>
      <ContactFields v-model="contact" id-prefix="p" :errors="contactProblems" />
      <div class="field">
        <label for="p-emergency">Emergency contact</label>
        <input id="p-emergency" v-model="form.emergencyContact" class="input" placeholder="Name and phone, in case we can't reach you" />
      </div>

      <h2 class="section-title">Emails</h2>
      <label class="check">
        <input v-model="form.emailReminders" type="checkbox" />
        <span>Reminder the day before each appointment</span>
      </label>
      <p class="small muted">Booking confirmations and changes are always emailed. Keep them: their links open your booking on any device.</p>

      <div class="row">
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>

    <section class="panel stack">
      <h2 class="section-title">This device</h2>
      <p class="small muted">
        Add the app to your home screen so your phone keeps your details. Some browsers clear saved details from websites you
        haven't opened for a while.
      </p>
      <div class="row">
        <button type="button" class="btn btn-sm" @click="installHelp"><Icon name="download" :size="18" /> Add to home screen</button>
        <button type="button" class="btn btn-sm" @click="download"><Icon name="download" :size="18" /> Download my data</button>
        <button type="button" class="btn btn-sm btn-danger" @click="forget">Forget me on this device</button>
      </div>
    </section>

    <div class="row">
      <RouterLink v-if="session.isAdmin" to="/admin" class="btn btn-dark">Open staff portal</RouterLink>
      <RouterLink v-else to="/staff" class="small muted">Staff sign-in</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  font-size: var(--step-1);
}
</style>
