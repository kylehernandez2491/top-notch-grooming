<script setup lang="ts">
/** Name, contact number, email and address, with inline errors. */
import type { ContactDetails } from '@/utils/contact';

const model = defineModel<ContactDetails>({ required: true });
defineProps<{ idPrefix: string; errors?: Record<string, string> }>();
</script>

<template>
  <div class="field">
    <label :for="`${idPrefix}-name`">Full name</label>
    <input
      :id="`${idPrefix}-name`"
      v-model="model.displayName"
      class="input"
      autocomplete="name"
      required
      :aria-invalid="!!errors?.displayName"
    />
    <span v-if="errors?.displayName" class="field-error">{{ errors.displayName }}</span>
  </div>

  <div class="grid-2">
    <div class="field">
      <label :for="`${idPrefix}-phone`">Contact number</label>
      <input
        :id="`${idPrefix}-phone`"
        v-model="model.phone"
        class="input"
        type="tel"
        inputmode="tel"
        autocomplete="tel"
        placeholder="0917 123 4567"
        required
        :aria-invalid="!!errors?.phone"
        :aria-describedby="`${idPrefix}-phone-hint`"
      />
      <span :id="`${idPrefix}-phone-hint`" class="field-hint">So the groomer can call or text you when your pet is ready.</span>
      <span v-if="errors?.phone" class="field-error">{{ errors.phone }}</span>
    </div>
    <div class="field">
      <label :for="`${idPrefix}-email`">Email address</label>
      <input
        :id="`${idPrefix}-email`"
        v-model="model.email"
        class="input"
        type="email"
        inputmode="email"
        autocomplete="email"
        required
        :aria-invalid="!!errors?.email"
        :aria-describedby="`${idPrefix}-email-hint`"
      />
      <span :id="`${idPrefix}-email-hint`" class="field-hint">Booking confirmations and reminders go here.</span>
      <span v-if="errors?.email" class="field-error">{{ errors.email }}</span>
    </div>
  </div>

  <div class="field">
    <label :for="`${idPrefix}-address`">Address</label>
    <textarea
      :id="`${idPrefix}-address`"
      v-model="model.address"
      class="textarea address"
      rows="2"
      autocomplete="street-address"
      placeholder="House or unit no., street, barangay, city"
      required
      :aria-invalid="!!errors?.address"
    />
    <span v-if="errors?.address" class="field-error">{{ errors.address }}</span>
  </div>
</template>

<style scoped>
.address {
  min-height: 72px;
}
</style>
