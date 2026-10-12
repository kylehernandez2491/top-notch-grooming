<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { BookedPet, BookingResult, ClientDetail, WaitlistWindow } from '@shared/types';
import {
  formatDuration,
  formatMoney,
  formatPriceRange,
  formatTime12,
  serviceDuration,
  servicePrice,
  servicePriceMax,
  sizePhrase,
  sizePrice,
  addMinutes,
} from '@shared/format';
import { api, ApiError } from '@/api/client';
import Icon from '@/components/Icon.vue';
import PetAvatar from '@/components/PetAvatar.vue';
import SheetDialog from '@/components/SheetDialog.vue';
import SlotPicker from '@/components/SlotPicker.vue';
import TileCalendar from '@/components/TileCalendar.vue';
import { useAvailability, type AvailabilityParams } from '@/composables/useAvailability';
import { bookedPet, useAccount } from '@/stores/account';
import { useCatalog } from '@/stores/catalog';
import { useUi } from '@/stores/ui';
import { addDays, longDay, monthOf, shortDay } from '@/utils/dates';
import { buzz, shareOrCopy } from '@/utils/device';

/** Owners book with the details saved on their device; staff book at /admin/book?client=<clientKey>. */
const route = useRoute();
const catalog = useCatalog();
const account = useAccount();
const ui = useUi();

type Step = 1 | 2 | 3 | 4;
const steps = ['Pet', 'Service', 'Time', 'Confirm'];
const step = ref<Step>(1);

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : undefined);
const staff = computed(() => route.name === 'admin-book');
const client = ref<ClientDetail | null>(null);

/** Owners' pets come from this device (with photos); a client's come from their booking history. */
const pets = ref<(BookedPet & { photo?: string })[]>([]);
const loading = ref(true);
const loadError = ref('');
const petId = ref(q('petId'));
const serviceId = ref(q('serviceId'));
const addOnIds = ref<string[]>(q('addOns')?.split(',').filter(Boolean) ?? []);
const day = ref(q('day'));
const time = ref(q('time'));
const notes = ref('');
const repeat = ref({ enabled: false, everyWeeks: 6, count: 3 });
const submitting = ref(false);
const submitError = ref('');
const result = ref<BookingResult | null>(null);
const month = ref(monthOf(day.value ?? catalog.today));

onMounted(async () => {
  try {
    await catalog.load();
    if (staff.value) {
      const clientKey = q('client');
      if (!clientKey) throw new Error('Open a client from the Clients screen, then choose "Book for client".');
      client.value = await api.admin.client(clientKey);
      pets.value = client.value.pets;
    } else {
      pets.value = account.pets;
    }
    if (!petId.value && pets.value.length === 1) petId.value = pets.value[0].id;
    // Jump ahead as far as the prefilled details allow (rebook links, availability page, waitlist emails).
    if (pet.value && service.value) step.value = 3;
    else if (pet.value) step.value = 2;
  } catch (err) {
    loadError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
});

const pet = computed(() => pets.value.find((p) => p.id === petId.value));
const services = computed(() => catalog.servicesFor(pet.value?.species));
const service = computed(() => services.value.find((s) => s.id === serviceId.value));
const addOns = computed(() => catalog.addOnsFor(pet.value?.species, service.value?.id, pet.value?.size));
const chosenAddOns = computed(() => addOns.value.filter((a) => addOnIds.value.includes(a.id)));
const duration = computed(() => (service.value && pet.value ? serviceDuration(service.value, chosenAddOns.value, pet.value.size) : 0));
const price = computed(() => (service.value && pet.value ? servicePrice(service.value, chosenAddOns.value, pet.value.size) : 0));
const priceMax = computed(() => (service.value && pet.value ? servicePriceMax(service.value, chosenAddOns.value, pet.value.size) : 0));
const priceText = computed(() => formatPriceRange(price.value, priceMax.value));
const priceVaries = computed(() => priceMax.value > price.value);

watch(pet, (p) => {
  if (p && service.value && !service.value.species.includes(p.species)) serviceId.value = undefined;
});
// Add-ons depend on the service and the pet's size (e.g. a face design is only for small and medium Basic Grooming).
watch(addOns, (list) => {
  addOnIds.value = addOnIds.value.filter((id) => list.some((a) => a.id === id));
});

const params = computed<AvailabilityParams | null>(() =>
  service.value && pet.value
    ? { serviceId: service.value.id, size: pet.value.size, addOns: [...addOnIds.value].sort(), staff: staff.value }
    : null,
);
const availability = useAvailability(params, month);
const dayInfo = computed(() => (day.value ? availability.days.value.get(day.value) : undefined));
const maxMonth = computed(() => monthOf(addDays(catalog.today, staff.value ? 365 : (catalog.settings?.bookingHorizonDays ?? 60))));

// A previously chosen time can vanish when the service or add-ons change the length.
watch(
  () => availability.days.value,
  () => {
    if (time.value && dayInfo.value && !dayInfo.value.slots.some((s) => s.time === time.value)) time.value = undefined;
  },
);

const repeatDates = computed(() =>
  repeat.value.enabled && day.value
    ? Array.from({ length: repeat.value.count }, (_, i) => addDays(day.value!, i * repeat.value.everyWeeks * 7))
    : [],
);

const canContinue = computed(() => {
  if (step.value === 1) return !!pet.value;
  if (step.value === 2) return !!service.value;
  if (step.value === 3) return !!day.value && !!time.value;
  return true;
});

function toggleAddOn(id: string) {
  addOnIds.value = addOnIds.value.includes(id) ? addOnIds.value.filter((x) => x !== id) : [...addOnIds.value, id];
}

function pickDay(d: string) {
  day.value = d;
  time.value = undefined;
}

async function jumpToNext() {
  const next = await availability.findNext(catalog.today, catalog.settings?.bookingHorizonDays ?? 60);
  if (!next) {
    ui.toast('No openings in the booking window. Try the waitlist on a full day.');
    return;
  }
  month.value = monthOf(next.day);
  day.value = next.day;
  time.value = next.time;
}

function go(to: Step) {
  if (to > step.value && !canContinue.value) return;
  step.value = to;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submit() {
  const owner = staff.value ? client.value?.owner : account.profile;
  if (!owner || !pet.value || !service.value || !day.value || !time.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const { photo: _photo, ...details } = pet.value;
    const request = {
      owner,
      pet: staff.value ? details : bookedPet(account.petById(pet.value.id)!),
      serviceId: service.value.id,
      addOnIds: addOnIds.value,
      day: day.value,
      time: time.value,
      notes: notes.value.trim() || undefined,
      repeat: repeat.value.enabled ? { everyWeeks: repeat.value.everyWeeks, count: repeat.value.count } : undefined,
    };
    if (staff.value) {
      result.value = await api.admin.book({ ...request, ownerId: client.value?.ownerId });
    } else {
      result.value = await api.book(request);
      result.value.appointments.forEach((a) => account.upsertAppointment(a));
    }
    buzz([10, 40, 10]);
  } catch (err) {
    submitError.value = (err as Error).message;
    if (err instanceof ApiError && ['slot_taken', 'slot_unavailable'].includes(err.code ?? '')) {
      time.value = undefined;
      step.value = 3;
      await availability.refresh();
      ui.toast(err.message, 'error');
    }
  } finally {
    submitting.value = false;
  }
}

// ----- waitlist -----
const waitlistOpen = ref(false);
const waitlistWindow = ref<WaitlistWindow>('any');
async function joinWaitlist() {
  const owner = account.profile;
  if (!owner || !pet.value || !service.value || !day.value) return;
  try {
    await api.joinWaitlist({
      day: day.value,
      serviceId: service.value.id,
      window: waitlistWindow.value,
      owner: { displayName: owner.displayName, email: owner.email, phone: owner.phone },
      pet: { id: pet.value.id, name: pet.value.name },
    });
    waitlistOpen.value = false;
    ui.toast(`You're on the waitlist for ${shortDay(day.value)}. We'll email you if a spot opens.`, 'success');
    account.loadWaitlist(true);
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}

const alsoBooked = computed(() =>
  (result.value?.appointments ?? [])
    .slice(1)
    .map((a) => shortDay(a.day))
    .join(', '),
);

async function share() {
  const a = result.value?.appointments[0];
  if (!a) return;
  const outcome = await shareOrCopy({
    title: `${a.petName}'s grooming`,
    text: `${a.petName} is booked for ${a.serviceName} on ${longDay(a.day)} at ${formatTime12(a.startTime)}.`,
  });
  if (outcome === 'copied') ui.toast('Copied to clipboard.');
}

function bookAnother() {
  result.value = null;
  day.value = undefined;
  time.value = undefined;
  notes.value = '';
  repeat.value.enabled = false;
  availability.refresh();
  step.value = 1;
}
</script>

<template>
  <div class="page page-book">
    <!-- Success -->
    <section v-if="result" class="done stack-lg" aria-live="polite">
      <div class="done-mark" aria-hidden="true"><Icon name="check" :size="40" /></div>
      <h1>{{ staff ? 'Booked.' : "You're booked!" }}</h1>
      <div class="panel stack">
        <p class="done-when">
          <strong>{{ longDay(result.appointments[0].day) }} at {{ formatTime12(result.appointments[0].startTime) }}</strong>
        </p>
        <p class="muted">
          {{ result.appointments[0].petName }}'s {{ result.appointments[0].serviceName }}. Pick-up around
          {{ formatTime12(result.appointments[0].endTime) }}. Estimated
          {{ formatPriceRange(result.appointments[0].estimatedPrice, result.appointments[0].estimatedPriceMax) }}, paid at pick-up.
        </p>
        <p v-if="result.appointments.length > 1" class="small">
          Also booked: {{ alsoBooked }}.
        </p>
        <p v-for="s in result.skipped" :key="s.day" class="alert small">{{ shortDay(s.day) }} wasn't booked: {{ s.reason }}</p>
        <p class="small muted">A confirmation email is on its way{{ staff ? ' to the client' : '' }}.</p>
      </div>
      <div class="row">
        <a class="btn" :href="api.icsUrl(result.appointments[0].id)"><Icon name="calendar" :size="18" /> Add to calendar</a>
        <button type="button" class="btn" @click="share"><Icon name="share" :size="18" /> Share</button>
        <RouterLink
          class="btn btn-dark"
          :to="staff ? `/admin/appointments/${result.appointments[0].id}` : `/appointments/${result.appointments[0].id}`"
        >
          View booking
        </RouterLink>
      </div>
      <button type="button" class="btn btn-ghost" @click="bookAnother">Book another pet</button>
    </section>

    <template v-else>
      <header class="stack">
        <h1>{{ staff ? `Book for ${client?.owner.displayName ?? 'client'}` : 'Book a groom' }}</h1>
        <ol class="stepper" aria-label="Booking steps">
          <li v-for="(label, i) in steps" :key="label" :aria-current="step === i + 1 ? 'step' : undefined" :class="{ done: step > i + 1 }">
            <button type="button" :disabled="i + 1 > step" @click="go((i + 1) as Step)">
              <span class="step-num">{{ i + 1 }}</span><span class="step-label">{{ label }}</span>
            </button>
          </li>
        </ol>
      </header>

      <p v-if="loadError" class="alert">{{ loadError }}</p>
      <div v-if="loading" class="skeleton" style="height: 240px" />

      <!-- 1. Pet -->
      <section v-else-if="step === 1" class="stack" aria-labelledby="s1">
        <h2 id="s1" class="step-title">Who's coming in?</h2>
        <div v-if="!pets.length" class="note">
          <span>Add your pet first. It takes a minute and you'll only do it once.</span>
        </div>
        <div class="option-grid" role="radiogroup" aria-labelledby="s1">
          <button
            v-for="p in pets"
            :key="p.id"
            type="button"
            role="radio"
            class="option pet-option"
            :aria-checked="p.id === petId ? 'true' : 'false'"
            @click="(petId = p.id), go(2)"
          >
            <PetAvatar :name="p.name" :photo="p.photo" :size="52" />
            <span class="stack pet-option-text">
              <strong>{{ p.name }}</strong>
              <span class="muted small">{{ p.breed || (p.species === 'dog' ? 'Dog' : 'Cat') }}, {{ sizePhrase(p.size, p.species) }}</span>
            </span>
          </button>
        </div>
        <RouterLink v-if="!staff" :to="{ path: '/pets/new', query: { return: route.fullPath } }" class="btn">
          <Icon name="plus" :size="18" /> Add a pet
        </RouterLink>
      </section>

      <!-- 2. Service -->
      <section v-else-if="step === 2 && pet" class="stack-lg" aria-labelledby="s2">
        <h2 id="s2" class="step-title">What does {{ pet.name }} need?</h2>
        <p class="muted small">
          Prices for {{ pet.name }}, a {{ sizePhrase(pet.size, pet.species) }}, paid at pick-up.
          <RouterLink to="/services">See the full price list</RouterLink>
        </p>
        <div class="option-grid" role="radiogroup" aria-labelledby="s2">
          <button
            v-for="s in services"
            :key="s.id"
            type="button"
            role="radio"
            class="option svc-option"
            :aria-checked="s.id === serviceId ? 'true' : 'false'"
            @click="serviceId = s.id"
          >
            <span class="spread svc-option-head">
              <strong class="svc-option-name">{{ s.name }}<span v-if="s.popular" class="badge svc-popular">Most booked</span></strong>
              <strong class="tabular svc-option-price">{{ formatPriceRange(sizePrice(s, pet.size).min, sizePrice(s, pet.size).max) }}</strong>
            </span>
            <span v-if="sizePrice(s, pet.size).note" class="small svc-option-note">{{ sizePrice(s, pet.size).note }}</span>
            <span class="muted small">{{ s.description }}</span>
            <span v-if="s.inclusions?.length" class="svc-incl small">
              <span v-for="item in s.inclusions" :key="item" class="svc-incl-item"><Icon name="check" :size="13" />{{ item }}</span>
            </span>
            <span class="small row svc-option-time"><Icon name="clock" :size="14" /> About {{ formatDuration(s.durationBySize[pet.size]) }}</span>
          </button>
        </div>

        <div v-if="service && addOns.length" class="stack">
          <h3 class="sub-title">Options for {{ service.name }}</h3>
          <div class="addon-list">
            <button
              v-for="a in addOns"
              :key="a.id"
              type="button"
              role="checkbox"
              class="option addon"
              :aria-checked="addOnIds.includes(a.id) ? 'true' : 'false'"
              @click="toggleAddOn(a.id)"
            >
              <span class="spread">
                <span class="row addon-name">
                  <span class="tick" aria-hidden="true"><Icon v-if="addOnIds.includes(a.id)" name="check" :size="14" /></span>
                  <strong>{{ a.name }}</strong>
                </span>
                <span class="tabular small">+{{ formatMoney(a.price) }}</span>
              </span>
              <span class="muted small">{{ a.description }}<template v-if="a.durationMinutes"> Adds {{ a.durationMinutes }} min.</template></span>
              <span class="small">
                {{ service.name }} with {{ a.name.toLowerCase() }}:
                <strong class="tabular">{{ formatPriceRange(sizePrice(service, pet.size).min + a.price, sizePrice(service, pet.size).max + a.price) }}</strong>
              </span>
            </button>
          </div>
        </div>
      </section>

      <!-- 3. Time -->
      <section v-else-if="step === 3 && pet && service" class="stack-lg" aria-labelledby="s3">
        <div class="spread">
          <h2 id="s3" class="step-title">Pick a time</h2>
          <button type="button" class="btn btn-sm" @click="jumpToNext"><Icon name="sparkle" :size="16" /> Next opening</button>
        </div>
        <p class="muted small">{{ service.name }} for {{ pet.name }} takes about {{ formatDuration(duration) }}.</p>
        <p v-if="availability.error.value" class="alert">{{ availability.error.value }}</p>
        <div class="time-layout">
          <div class="panel">
            <TileCalendar
              v-model:month="month"
              :days="availability.days.value"
              :today="catalog.today"
              :selected="day"
              :loading="availability.loading.value"
              :min-month="monthOf(catalog.today)"
              :max-month="maxMonth"
              @select="pickDay"
            />
          </div>
          <div class="panel">
            <SlotPicker
              :day="dayInfo"
              :selected="time"
              :loading="availability.loading.value && !dayInfo"
              :waitlist="!staff"
              @select="time = $event"
              @waitlist="waitlistOpen = true"
            />
          </div>
        </div>
      </section>

      <!-- 4. Confirm -->
      <section v-else-if="step === 4 && pet && service && day && time" class="stack-lg" aria-labelledby="s4">
        <h2 id="s4" class="step-title">Check and confirm</h2>
        <div class="panel summary">
          <PetAvatar :name="pet.name" :photo="pet.photo" :size="56" />
          <dl class="summary-list">
            <dt>When</dt>
            <dd>
              <strong>{{ longDay(day) }}, {{ formatTime12(time) }}</strong>
              <span class="muted small">Pick-up around {{ formatTime12(addMinutes(time, duration)) }}</span>
            </dd>
            <dt>Pet</dt>
            <dd>{{ pet.name }}, {{ sizePhrase(pet.size, pet.species) }}</dd>
            <dt>Service</dt>
            <dd>
              {{ service.name }}<template v-if="chosenAddOns.length"> with {{ chosenAddOns.map((a) => a.name.toLowerCase()).join(', ') }}</template>
            </dd>
            <dt>Estimate</dt>
            <dd>
              <strong class="tabular">{{ priceText }}</strong>
              <span class="muted small">
                {{ priceVaries ? 'Depends on coat volume; the groomer will confirm the exact price. Pay at pick-up.' : 'Pay at pick-up.' }}
              </span>
            </dd>
          </dl>
        </div>

        <div class="field">
          <label for="notes">Notes for the groomer</label>
          <textarea id="notes" v-model="notes" class="textarea" maxlength="500" :placeholder="`Anything new since ${pet.name}'s last visit?`" />
        </div>

        <div class="panel stack">
          <label class="check">
            <input v-model="repeat.enabled" type="checkbox" />
            <span>
              <strong>Make it a regular visit</strong><br />
              <span class="muted small">Book the same time again so you never miss a groom.</span>
            </span>
          </label>
          <div v-if="repeat.enabled" class="grid-2">
            <div class="field">
              <label for="every">Every</label>
              <select id="every" v-model.number="repeat.everyWeeks" class="select">
                <option v-for="w in [2, 3, 4, 5, 6, 8, 10, 12]" :key="w" :value="w">{{ w }} weeks</option>
              </select>
            </div>
            <div class="field">
              <label for="count">Number of visits</label>
              <select id="count" v-model.number="repeat.count" class="select">
                <option v-for="n in [2, 3, 4, 5, 6]" :key="n" :value="n">{{ n }} visits</option>
              </select>
            </div>
          </div>
          <p v-if="repeat.enabled" class="small muted">
            {{ repeatDates.map(shortDay).join(', ') }}. If a later date is taken, we'll book the rest and tell you which.
          </p>
        </div>

        <p class="small muted">{{ catalog.settings?.policies.cancellation }}</p>
        <p v-if="submitError" class="alert" role="alert">{{ submitError }}</p>
      </section>

      <div v-if="!loading" class="action-bar">
        <span class="bar-summary small">
          <template v-if="step === 4">{{ priceText }} est.</template>
          <template v-else-if="day && time">{{ shortDay(day) }}, {{ formatTime12(time) }}</template>
          <template v-else-if="service && pet">{{ service.name }}, {{ priceText }}</template>
          <template v-else-if="pet">{{ pet.name }}</template>
          <template v-else>Step {{ step }} of 4</template>
        </span>
        <span class="row bar-actions">
          <button v-if="step > 1" type="button" class="btn btn-sm bar-back" @click="go((step - 1) as Step)">Back</button>
          <button v-if="step < 4" type="button" class="btn btn-primary" :disabled="!canContinue" @click="go((step + 1) as Step)">Continue</button>
          <button v-else type="button" class="btn btn-primary" :disabled="submitting" @click="submit">
            {{ submitting ? 'Booking…' : repeat.enabled ? `Book ${repeat.count} visits` : 'Confirm booking' }}
          </button>
        </span>
      </div>
    </template>

    <SheetDialog :open="waitlistOpen" title="Join the waitlist" @close="waitlistOpen = false">
      <p v-if="day">We'll email you if a spot opens on {{ longDay(day) }}. First to book gets it.</p>
      <div class="chips" role="radiogroup" aria-label="Preferred time">
        <button
          v-for="w in ['any', 'morning', 'afternoon'] as WaitlistWindow[]"
          :key="w"
          type="button"
          role="radio"
          class="chip"
          :aria-checked="waitlistWindow === w ? 'true' : 'false'"
          @click="waitlistWindow = w"
        >
          {{ w === 'any' ? 'Any time' : w === 'morning' ? 'Morning' : 'Afternoon' }}
        </button>
      </div>
      <button type="button" class="btn btn-primary" @click="joinWaitlist">Join the waitlist</button>
    </SheetDialog>
  </div>
</template>

<style scoped>
.stepper {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.stepper button {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 0;
  border: 0;
  border-top: 4px solid var(--grout);
  background: none;
  color: var(--ink-soft);
  font: inherit;
  font-size: var(--step--1);
  font-weight: 620;
  cursor: pointer;
  text-align: left;
}

.stepper button:disabled {
  cursor: default;
}

.stepper li.done button {
  border-top-color: var(--accent-ink);
  color: var(--ink);
}

.stepper li[aria-current='step'] button {
  border-top-color: var(--ink);
  color: var(--ink);
}

.step-num {
  display: none;
}

.step-title {
  font-size: var(--step-2);
}

.sub-title {
  font-size: var(--step-1);
}

.option-grid {
  display: grid;
  gap: 10px;
}

.svc-option {
  display: grid;
  gap: 6px;
  align-content: start;
}

.svc-option-head {
  align-items: baseline;
  gap: 12px;
}

.svc-option-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  font-size: var(--step-1);
}

.svc-popular {
  background: var(--brand);
  color: var(--on-brand);
  border-color: var(--ink);
  font-size: 0.7rem;
}

.svc-option-price {
  font-size: var(--step-1);
  white-space: nowrap;
}

.svc-option-note {
  font-weight: 640;
}

.svc-incl {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--ink);
}

.svc-incl-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.svc-option-time {
  gap: 6px;
  color: var(--ink-soft);
}

.pet-option {
  display: flex;
  align-items: center;
  gap: 14px;
}

.pet-option-text {
  gap: 0;
}

.addon-list {
  display: grid;
  gap: 8px;
}

.addon-name {
  gap: 10px;
  flex-wrap: nowrap;
}

.tick {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1.5px solid var(--grout-strong);
  background: var(--surface);
  flex: none;
}

.addon[aria-checked='true'] .tick {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}

.time-layout {
  display: grid;
  gap: 16px;
  align-items: start;
}

.summary {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.summary-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 16px;
  margin: 0;
  flex: 1;
}

.summary-list dt {
  color: var(--ink-soft);
  font-size: var(--step--1);
  font-weight: 600;
  padding-top: 2px;
}

.summary-list dd {
  margin: 0;
  display: grid;
}

.bar-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.bar-actions {
  flex-wrap: nowrap;
  gap: 6px;
}

.bar-back {
  background: transparent;
  color: var(--bar-ink);
  border-color: color-mix(in srgb, var(--bar-ink) 40%, transparent);
}

.bar-back:hover {
  background: color-mix(in srgb, var(--bar-ink) 12%, transparent);
}

.done {
  justify-items: start;
}

.done-mark {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--ink);
  background: var(--brand);
  color: var(--on-brand);
  animation: pop-in 0.4s cubic-bezier(0.2, 1.4, 0.4, 1);
}

.done-when {
  font-size: var(--step-1);
}

@keyframes pop-in {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
}

@media (min-width: 640px) {
  .step-num {
    display: inline-grid;
  }
  .option-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 900px) {
  .time-layout {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  }
}
</style>
