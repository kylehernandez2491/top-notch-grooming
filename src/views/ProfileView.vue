<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import ContactFields from '@/components/ContactFields.vue';
import Icon from '@/components/Icon.vue';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { contactErrors, trimContact, type ContactDetails } from '@/utils/contact';

const session = useSession();
const ui = useUi();
const saving = ref(false);
const contact = ref<ContactDetails>({
  displayName: session.profile?.displayName ?? '',
  phone: session.profile?.phone ?? '',
  email: session.profile?.email ?? '',
  address: session.profile?.address ?? '',
});
const triedSave = ref(false);
const serverErrors = ref<Record<string, string>>({});
const contactProblems = computed(() => ({ ...(triedSave.value ? contactErrors(contact.value) : {}), ...serverErrors.value }));
const form = reactive({
  emergencyContact: session.profile?.emergencyContact ?? '',
  emailReminders: session.profile?.emailReminders ?? true,
  emailMarketing: session.profile?.emailMarketing ?? false,
});

async function save() {
  triedSave.value = true;
  serverErrors.value = {};
  if (Object.keys(contactErrors(contact.value)).length) {
    ui.toast('Please check your contact details.', 'error');
    return;
  }
  saving.value = true;
  try {
    await session.saveProfile({
      ...trimContact(contact.value),
      emergencyContact: form.emergencyContact.trim() || undefined,
      emailReminders: form.emailReminders,
      emailMarketing: form.emailMarketing,
    });
    ui.toast('Profile saved.', 'success');
  } catch (err) {
    if (err instanceof ApiError) serverErrors.value = err.fieldErrors();
    ui.toast((err as Error).message, 'error');
  } finally {
    saving.value = false;
  }
}

async function deleteAccount() {
  const { confirmed } = await ui.confirm({
    title: 'Delete your account?',
    message: 'Upcoming appointments will be cancelled and your pets removed. Past visit records stay with the shop for its books. This cannot be undone.',
    confirmLabel: 'Delete account',
    cancelLabel: 'Keep my account',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api.deleteMe();
    await session.logout();
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}

async function installHelp() {
  ui.toast('On iPhone: tap Share, then "Add to Home Screen". On Android: open the browser menu and choose "Install app".', 'info', undefined, 9000);
}
</script>

<template>
  <div class="page page-narrow">
    <header class="stack">
      <h1>Account</h1>
      <p class="muted">Signed in as {{ session.principal?.userDetails || session.profile?.email }}</p>
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
      <label class="check">
        <input v-model="form.emailMarketing" type="checkbox" />
        <span>Occasional news and seasonal offers</span>
      </label>
      <p class="small muted">Booking confirmations and changes are always emailed.</p>

      <div class="row">
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save changes' }}</button>
      </div>
    </form>

    <section class="panel stack">
      <h2 class="section-title">This device</h2>
      <button type="button" class="btn" @click="installHelp"><Icon name="download" :size="18" /> Add the app to your home screen</button>
    </section>

    <section class="panel stack">
      <h2 class="section-title">Your data</h2>
      <div class="row">
        <a :href="api.exportUrl" class="btn btn-sm" download><Icon name="download" :size="18" /> Download my data</a>
        <button type="button" class="btn btn-sm btn-danger" @click="deleteAccount">Delete account</button>
      </div>
    </section>

    <div class="row">
      <RouterLink v-if="session.isAdmin" to="/admin" class="btn btn-dark">Open staff portal</RouterLink>
      <button type="button" class="btn" @click="session.logout()"><Icon name="logout" :size="18" /> Sign out</button>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  font-size: var(--step-1);
}
</style>
