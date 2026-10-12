<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { AddOn, BusinessSettings, Closure, PetSize, Service, Species, Weekday } from '@shared/types';
import { PET_SIZES, WEEKDAYS } from '@shared/types';
import { formatMoney, formatTime12, fromMinutes, priceRange, SIZE_LABELS } from '@shared/format';
import { api, ApiError, type AddOnInput, type ServiceInput, type SettingsInput } from '@/api/client';
import Icon from '@/components/Icon.vue';
import SheetDialog from '@/components/SheetDialog.vue';
import { useCatalog } from '@/stores/catalog';
import { useUi } from '@/stores/ui';
import { shortDay } from '@/utils/dates';

type Tab = 'services' | 'extras' | 'hours' | 'closures';
const tab = ref<Tab>('services');
const ui = useUi();
const catalog = useCatalog();

const services = ref<Service[]>([]);
const addOns = ref<AddOn[]>([]);
const closures = ref<Closure[]>([]);
const settings = ref<SettingsInput | null>(null);
const originalZone = ref('');
const error = ref('');
const saving = ref(false);

onMounted(async () => {
  try {
    const [s, a, c, st] = await Promise.all([api.admin.services(), api.admin.addOns(), api.admin.closures(), api.admin.settings()]);
    services.value = s;
    addOns.value = a;
    closures.value = c;
    const { id: _id, kind: _kind, updatedAt: _u, ...rest } = st as BusinessSettings;
    settings.value = JSON.parse(JSON.stringify(rest));
    originalZone.value = st.timeZone;
  } catch (err) {
    error.value = (err as Error).message;
  }
});

const dayNames: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const timeOptions = computed(() => Array.from({ length: (22 - 5) * 4 + 1 }, (_, i) => fromMinutes(5 * 60 + i * 15)));
const zones = ['Asia/Manila', 'Asia/Singapore', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Australia/Sydney'];

function showError(err: unknown) {
  const e = err as ApiError;
  const details = e.details?.map((d) => `${d.path}: ${d.message}`).join('; ');
  ui.toast(details ? `${e.message} ${details}` : e.message, 'error', undefined, 8000);
}

// ---------- hours & rules ----------
function toggleDay(d: Weekday, open: boolean) {
  if (!settings.value) return;
  settings.value.weeklyHours[d] = open ? { open: '09:00', close: '17:00', breaks: [] } : null;
}

async function saveSettings() {
  if (!settings.value) return;
  if (settings.value.timeZone !== originalZone.value) {
    const { confirmed } = await ui.confirm({
      title: 'Change the shop time zone?',
      message: 'Existing appointments keep their wall-clock times. Only change this if the shop really moved or it was set wrong.',
      confirmLabel: 'Change time zone',
    });
    if (!confirmed) return;
  }
  saving.value = true;
  try {
    const saved = await api.admin.saveSettings(settings.value);
    originalZone.value = saved.timeZone;
    await catalog.load(true);
    ui.toast('Hours and rules saved.', 'success');
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}

// ---------- services & extras ----------
type ServiceForm = ServiceInput & { isNew: boolean; inclusionsText: string };
type AddOnForm = AddOnInput & { isNew: boolean };
const editingService = ref<ServiceForm | null>(null);
const editingAddOn = ref<AddOnForm | null>(null);
const sizeMap = (n: number) => Object.fromEntries(PET_SIZES.map((s) => [s, n])) as Record<PetSize, number>;

function newService() {
  editingService.value = {
    isNew: true,
    id: '',
    name: '',
    description: '',
    species: ['dog'],
    inclusions: [],
    inclusionsText: '',
    durationBySize: sizeMap(60),
    priceBySize: sizeMap(500),
    priceMaxBySize: {},
    priceNoteBySize: {},
    active: true,
    popular: false,
    sortOrder: services.value.length + 1,
  };
}

function editService(s: Service) {
  const { kind: _k, updatedAt: _u, ...rest } = s;
  const copy = JSON.parse(JSON.stringify(rest)) as ServiceInput;
  editingService.value = {
    ...copy,
    priceMaxBySize: copy.priceMaxBySize ?? {},
    priceNoteBySize: copy.priceNoteBySize ?? {},
    inclusionsText: (copy.inclusions ?? []).join('\n'),
    isNew: false,
  };
}

/** Cat-only services have one price for every cat, so only one row is edited and copied to every size. */
const serviceCatOnly = computed(() => !!editingService.value && !editingService.value.species.includes('dog'));
const editorSizes = computed<readonly PetSize[]>(() => (serviceCatOnly.value ? ['small'] : PET_SIZES));

/** Turns the editor's form into what the API expects: list from lines, blank or redundant ranges dropped. */
function serviceBody(form: ServiceForm): ServiceInput {
  const { isNew: _n, inclusionsText, ...body } = form;
  const sizes = serviceCatOnly.value ? PET_SIZES.map(() => 'small' as PetSize) : PET_SIZES;
  const priceMaxBySize: Partial<Record<PetSize, number>> = {};
  const priceNoteBySize: Partial<Record<PetSize, string>> = {};
  PET_SIZES.forEach((size, i) => {
    const from = sizes[i];
    body.durationBySize[size] = body.durationBySize[from];
    body.priceBySize[size] = body.priceBySize[from];
    const max = Number(form.priceMaxBySize?.[from]);
    if (max && max > body.priceBySize[size]) priceMaxBySize[size] = max;
    const note = form.priceNoteBySize?.[from]?.trim();
    if (note) priceNoteBySize[size] = note;
  });
  return {
    ...body,
    inclusions: inclusionsText.split('\n').map((line) => line.trim()).filter(Boolean),
    priceMaxBySize,
    priceNoteBySize,
  };
}

function toggleSpecies(list: Species[], species: Species) {
  const i = list.indexOf(species);
  if (i >= 0) list.splice(i, 1);
  else list.push(species);
}

async function saveService() {
  const form = editingService.value;
  if (!form) return;
  const { id, ...body } = serviceBody(form);
  const isNew = form.isNew;
  try {
    const saved = isNew ? await api.admin.createService({ ...body, id: id || undefined } as ServiceInput) : await api.admin.updateService(id, { ...body, id } as ServiceInput);
    services.value = isNew ? [...services.value, saved] : services.value.map((s) => (s.id === saved.id ? saved : s));
    services.value.sort((a, b) => a.sortOrder - b.sortOrder);
    editingService.value = null;
    catalog.load(true);
    ui.toast(`${saved.name} saved.`, 'success');
  } catch (err) {
    showError(err);
  }
}

async function deleteService(s: { id: string; name: string }) {
  const { confirmed } = await ui.confirm({
    title: `Delete ${s.name}?`,
    message: 'Existing bookings keep their details. To hide it temporarily, untick "Offered online" instead.',
    confirmLabel: 'Delete service',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api.admin.deleteService(s.id);
    services.value = services.value.filter((x) => x.id !== s.id);
    editingService.value = null;
    catalog.load(true);
  } catch (err) {
    showError(err);
  }
}

function newAddOn() {
  editingAddOn.value = {
    isNew: true,
    id: '',
    name: '',
    description: '',
    durationMinutes: 10,
    price: 50,
    species: ['dog', 'cat'],
    serviceIds: [],
    sizes: [],
    active: true,
    sortOrder: addOns.value.length + 1,
  };
}

function editAddOn(a: AddOn) {
  const { kind: _k, updatedAt: _u, ...rest } = a;
  const copy = JSON.parse(JSON.stringify(rest)) as AddOnInput;
  editingAddOn.value = { ...copy, serviceIds: copy.serviceIds ?? [], sizes: copy.sizes ?? [], isNew: false };
}

/** The add-on editor offers "every service" or one service; that maps to an empty or one-item list. */
const addOnService = computed({
  get: () => editingAddOn.value?.serviceIds?.[0] ?? '',
  set: (id: string) => {
    if (editingAddOn.value) editingAddOn.value.serviceIds = id ? [id] : [];
  },
});

function toggleSize(list: PetSize[], size: PetSize) {
  const i = list.indexOf(size);
  if (i >= 0) list.splice(i, 1);
  else list.push(size);
}

function addOnScope(a: AddOn) {
  const service = a.serviceIds?.length ? services.value.filter((s) => a.serviceIds!.includes(s.id)).map((s) => s.name).join(', ') : 'Any service';
  const sizes = a.sizes?.length ? a.sizes.map((z) => SIZE_LABELS[z].toLowerCase()).join(', ') : '';
  return sizes ? `${service}, ${sizes} only` : service;
}

async function saveAddOn() {
  const form = editingAddOn.value;
  if (!form) return;
  const { isNew, id, ...body } = form;
  try {
    const saved = isNew ? await api.admin.createAddOn({ ...body, id: id || undefined } as AddOnInput) : await api.admin.updateAddOn(id, { ...body, id } as AddOnInput);
    addOns.value = isNew ? [...addOns.value, saved] : addOns.value.map((a) => (a.id === saved.id ? saved : a));
    editingAddOn.value = null;
    catalog.load(true);
    ui.toast(`${saved.name} saved.`, 'success');
  } catch (err) {
    showError(err);
  }
}

async function deleteAddOn(a: { id: string; name: string }) {
  const { confirmed } = await ui.confirm({ title: `Delete ${a.name}?`, confirmLabel: 'Delete extra', danger: true });
  if (!confirmed) return;
  try {
    await api.admin.deleteAddOn(a.id);
    addOns.value = addOns.value.filter((x) => x.id !== a.id);
    editingAddOn.value = null;
    catalog.load(true);
  } catch (err) {
    showError(err);
  }
}

// ---------- closures ----------
const closure = reactive({ date: '', allDay: true, start: '12:00', end: '15:00', reason: '' });

async function addClosure() {
  if (!closure.date) return;
  try {
    const saved = await api.admin.createClosure({
      date: closure.date,
      start: closure.allDay ? undefined : closure.start,
      end: closure.allDay ? undefined : closure.end,
      reason: closure.reason.trim() || 'Closed',
    });
    closures.value = [...closures.value, saved].sort((a, b) => a.date.localeCompare(b.date));
    closure.date = '';
    closure.reason = '';
    catalog.load(true);
    ui.toast('Time blocked. It no longer shows as bookable.', 'success');
  } catch (err) {
    showError(err);
  }
}

async function removeClosure(c: Closure) {
  try {
    await api.admin.deleteClosure(c.id);
    closures.value = closures.value.filter((x) => x.id !== c.id);
    catalog.load(true);
  } catch (err) {
    showError(err);
  }
}

const upcomingClosures = computed(() => closures.value.filter((c) => c.date >= catalog.today));
</script>

<template>
  <div class="page">
    <h1>Shop settings</h1>
    <div class="tabs" role="tablist" aria-label="Shop settings">
      <button
        v-for="t in [
          { key: 'services', label: 'Services' },
          { key: 'extras', label: 'Extras' },
          { key: 'hours', label: 'Hours & rules' },
          { key: 'closures', label: 'Time off' },
        ] as { key: Tab; label: string }[]"
        :key="t.key"
        type="button"
        role="tab"
        class="tab"
        :aria-selected="tab === t.key ? 'true' : 'false'"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>
    <p v-if="error" class="alert">{{ error }}</p>

    <!-- Services -->
    <section v-if="tab === 'services'" class="stack">
      <div class="spread">
        <p class="muted small">Prices (₱) and times are per dog size; cat services have one price. Owners only see services marked as offered.</p>
        <button type="button" class="btn btn-sm" @click="newService"><Icon name="plus" :size="18" /> Add service</button>
      </div>
      <ul class="divider-list panel list">
        <li v-for="s in services" :key="s.id" class="item">
          <span class="stack item-text">
            <strong>{{ s.name }} <span v-if="!s.active" class="badge">Hidden</span> <span v-if="s.popular" class="badge">Most booked</span></strong>
            <span class="muted small">{{ priceRange(s) }} for {{ s.species.map((x) => `${x}s`).join(' and ') }}</span>
          </span>
          <button type="button" class="btn btn-sm" @click="editService(s)"><Icon name="edit" :size="16" /> Edit</button>
        </li>
      </ul>
    </section>

    <!-- Extras -->
    <section v-else-if="tab === 'extras'" class="stack">
      <div class="spread">
        <p class="muted small">Extras are offered after a service is picked and add to the time and price. Tie one to a service and sizes to show it as a priced option on the menu, like a face design.</p>
        <button type="button" class="btn btn-sm" @click="newAddOn"><Icon name="plus" :size="18" /> Add extra</button>
      </div>
      <ul class="divider-list panel list">
        <li v-for="a in addOns" :key="a.id" class="item">
          <span class="stack item-text">
            <strong>{{ a.name }} <span v-if="!a.active" class="badge">Hidden</span></strong>
            <span class="muted small">+{{ formatMoney(a.price) }}, +{{ a.durationMinutes }} min · {{ addOnScope(a) }}</span>
          </span>
          <button type="button" class="btn btn-sm" @click="editAddOn(a)"><Icon name="edit" :size="16" /> Edit</button>
        </li>
      </ul>
    </section>

    <!-- Hours & rules -->
    <form v-else-if="tab === 'hours' && settings" class="stack-lg" @submit.prevent="saveSettings">
      <section class="panel stack">
        <h2 class="section-title">Weekly hours</h2>
        <div v-for="d in WEEKDAYS" :key="d" class="day-row">
          <label class="check day-toggle">
            <input type="checkbox" :checked="!!settings.weeklyHours[d]" @change="toggleDay(d, ($event.target as HTMLInputElement).checked)" />
            <strong>{{ dayNames[d] }}</strong>
          </label>
          <template v-if="settings.weeklyHours[d]">
            <div class="row times">
              <select v-model="settings.weeklyHours[d]!.open" class="select time" :aria-label="`${dayNames[d]} opens`">
                <option v-for="t in timeOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
              </select>
              <span class="muted">to</span>
              <select v-model="settings.weeklyHours[d]!.close" class="select time" :aria-label="`${dayNames[d]} closes`">
                <option v-for="t in timeOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
              </select>
            </div>
            <div v-for="(b, i) in settings.weeklyHours[d]!.breaks" :key="i" class="row times break">
              <span class="small muted">Break</span>
              <select v-model="b.start" class="select time" :aria-label="`${dayNames[d]} break starts`">
                <option v-for="t in timeOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
              </select>
              <span class="muted">to</span>
              <select v-model="b.end" class="select time" :aria-label="`${dayNames[d]} break ends`">
                <option v-for="t in timeOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
              </select>
              <button type="button" class="icon-btn" aria-label="Remove break" @click="settings.weeklyHours[d]!.breaks.splice(i, 1)">
                <Icon name="x" :size="18" />
              </button>
            </div>
            <button type="button" class="btn btn-sm btn-ghost add-break" @click="settings.weeklyHours[d]!.breaks.push({ start: '12:00', end: '12:30' })">
              <Icon name="plus" :size="16" /> Add break
            </button>
          </template>
          <span v-else class="muted small">Closed</span>
        </div>
      </section>

      <section class="panel stack-lg">
        <h2 class="section-title">Booking rules</h2>
        <div class="grid-2">
          <div class="field">
            <label for="inc">Start times every</label>
            <select id="inc" v-model.number="settings.slotIncrementMinutes" class="select">
              <option :value="15">15 minutes</option>
              <option :value="30">30 minutes</option>
              <option :value="60">60 minutes</option>
            </select>
          </div>
          <div class="field">
            <label for="buf">Clean-up time between pets (min)</label>
            <input id="buf" v-model.number="settings.bufferMinutes" class="input" type="number" min="0" max="120" step="5" />
          </div>
          <div class="field">
            <label for="notice">Minimum notice (hours)</label>
            <input id="notice" v-model.number="settings.minNoticeHours" class="input" type="number" min="0" max="168" />
          </div>
          <div class="field">
            <label for="horizon">Book up to (days ahead)</label>
            <input id="horizon" v-model.number="settings.bookingHorizonDays" class="input" type="number" min="7" max="365" />
          </div>
          <div class="field">
            <label for="cancel">Free cancellation until (hours before)</label>
            <input id="cancel" v-model.number="settings.cancellationWindowHours" class="input" type="number" min="0" max="168" />
          </div>
          <div class="field">
            <label for="max-day">Most pets per day (0 = no limit)</label>
            <input id="max-day" v-model.number="settings.maxAppointmentsPerDay" class="input" type="number" min="0" max="50" />
          </div>
          <div class="field">
            <label for="max-owner">Upcoming visits per client (0 = no limit)</label>
            <input id="max-owner" v-model.number="settings.maxUpcomingPerOwner" class="input" type="number" min="0" max="50" />
          </div>
          <div class="field">
            <label for="noshow">Pause online booking after no-shows (0 = never)</label>
            <input id="noshow" v-model.number="settings.noShowLimit" class="input" type="number" min="0" max="20" />
          </div>
        </div>
      </section>

      <section class="panel stack-lg">
        <h2 class="section-title">Shop details</h2>
        <div class="grid-2">
          <div class="field"><label for="shop">Shop name</label><input id="shop" v-model="settings.shopName" class="input" /></div>
          <div class="field"><label for="tag">Tagline</label><input id="tag" v-model="settings.tagline" class="input" /></div>
          <div class="field"><label for="phone">Phone</label><input id="phone" v-model="settings.phone" class="input" type="tel" /></div>
          <div class="field"><label for="email">Email</label><input id="email" v-model="settings.email" class="input" type="email" /></div>
        </div>
        <div class="field"><label for="addr">Address</label><input id="addr" v-model="settings.address" class="input" /></div>
        <div class="field">
          <label for="tz">Time zone</label>
          <input id="tz" v-model="settings.timeZone" class="input" list="zones" />
          <datalist id="zones"><option v-for="z in zones" :key="z" :value="z" /></datalist>
        </div>
      </section>

      <section class="panel stack-lg">
        <h2 class="section-title">Policies shown to clients</h2>
        <div class="field"><label for="pol-c">Cancellations</label><textarea id="pol-c" v-model="settings.policies.cancellation" class="textarea" /></div>
        <div class="field"><label for="pol-l">Late arrivals</label><textarea id="pol-l" v-model="settings.policies.lateArrival" class="textarea" /></div>
      </section>

      <div class="action-bar">
        <span class="small">Changes apply to new bookings straight away.</span>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>

    <!-- Closures -->
    <section v-else-if="tab === 'closures'" class="stack-lg">
      <form class="panel stack" @submit.prevent="addClosure">
        <h2 class="section-title">Block off time</h2>
        <p class="small muted">Holidays, vacation, a vet run. Existing bookings in that time stay booked, so check the agenda.</p>
        <div class="grid-2">
          <div class="field"><label for="cl-date">Date</label><input id="cl-date" v-model="closure.date" class="input" type="date" :min="catalog.today" required /></div>
          <div class="field"><label for="cl-reason">Reason</label><input id="cl-reason" v-model="closure.reason" class="input" placeholder="Thanksgiving" /></div>
        </div>
        <label class="check"><input v-model="closure.allDay" type="checkbox" /><span>All day</span></label>
        <div v-if="!closure.allDay" class="row times">
          <select v-model="closure.start" class="select time" aria-label="Blocked from">
            <option v-for="t in timeOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
          </select>
          <span class="muted">to</span>
          <select v-model="closure.end" class="select time" aria-label="Blocked until">
            <option v-for="t in timeOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
          </select>
        </div>
        <div class="row"><button type="submit" class="btn btn-dark" :disabled="!closure.date">Block this time</button></div>
      </form>

      <ul v-if="upcomingClosures.length" class="divider-list panel list">
        <li v-for="c in upcomingClosures" :key="c.id" class="item">
          <span class="stack item-text">
            <strong>{{ shortDay(c.date) }}</strong>
            <span class="muted small">{{ c.start ? `${formatTime12(c.start)} to ${formatTime12(c.end!)}` : 'All day' }}, {{ c.reason }}</span>
          </span>
          <button type="button" class="icon-btn" :aria-label="`Remove closure on ${shortDay(c.date)}`" @click="removeClosure(c)"><Icon name="trash" :size="18" /></button>
        </li>
      </ul>
      <p v-else class="panel muted">No time blocked off.</p>
    </section>

    <!-- Service editor -->
    <SheetDialog :open="!!editingService" :title="editingService?.isNew ? 'New service' : 'Edit service'" @close="editingService = null">
      <form v-if="editingService" class="stack" @submit.prevent="saveService">
        <div class="field"><label for="s-name">Name</label><input id="s-name" v-model="editingService.name" class="input" required /></div>
        <div class="field"><label for="s-desc">Description</label><textarea id="s-desc" v-model="editingService.description" class="textarea" /></div>
        <div class="chips" role="group" aria-label="For">
          <button v-for="sp in ['dog', 'cat'] as Species[]" :key="sp" type="button" class="chip" :aria-pressed="editingService.species.includes(sp) ? 'true' : 'false'" @click="toggleSpecies(editingService.species, sp)">
            {{ sp === 'dog' ? 'Dogs' : 'Cats' }}
          </button>
        </div>
        <div class="field">
          <label for="s-incl">What's included</label>
          <textarea id="s-incl" v-model="editingService.inclusionsText" class="textarea" rows="5" placeholder="One per line, e.g. Bath and blow dry" />
          <span class="field-hint">Shown as a checklist on the price menu, one item per line.</span>
        </div>
        <div class="stack size-blocks">
          <fieldset v-for="sz in editorSizes" :key="sz" class="size-block">
            <legend class="size-legend">{{ serviceCatOnly ? 'All cats' : SIZE_LABELS[sz] }}</legend>
            <div class="size-grid">
              <div class="field">
                <label :for="`s-min-${sz}`">Minutes</label>
                <input :id="`s-min-${sz}`" v-model.number="editingService.durationBySize[sz]" class="input" type="number" min="5" max="480" step="5" />
              </div>
              <div class="field">
                <label :for="`s-price-${sz}`">Price (₱)</label>
                <input :id="`s-price-${sz}`" v-model.number="editingService.priceBySize[sz]" class="input" type="number" min="0" step="10" />
              </div>
              <div class="field">
                <label :for="`s-max-${sz}`">Up to (₱)</label>
                <input :id="`s-max-${sz}`" v-model.number="editingService.priceMaxBySize![sz]" class="input" type="number" min="0" step="10" placeholder="Optional" />
              </div>
            </div>
            <div class="field">
              <label :for="`s-note-${sz}`">Note under the price</label>
              <input :id="`s-note-${sz}`" v-model="editingService.priceNoteBySize![sz]" class="input" maxlength="60" placeholder="e.g. Depends on coat volume" />
            </div>
          </fieldset>
        </div>
        <label class="check"><input v-model="editingService.active" type="checkbox" /><span>Offered online</span></label>
        <label class="check"><input v-model="editingService.popular" type="checkbox" /><span>Highlight as most booked</span></label>
        <div class="field"><label for="s-order">Order in menu</label><input id="s-order" v-model.number="editingService.sortOrder" class="input" type="number" min="0" /></div>
        <div class="row">
          <button type="submit" class="btn btn-primary">Save service</button>
          <button v-if="!editingService.isNew" type="button" class="btn btn-danger" @click="deleteService(editingService)">Delete</button>
        </div>
      </form>
    </SheetDialog>

    <!-- Extra editor -->
    <SheetDialog :open="!!editingAddOn" :title="editingAddOn?.isNew ? 'New extra' : 'Edit extra'" @close="editingAddOn = null">
      <form v-if="editingAddOn" class="stack" @submit.prevent="saveAddOn">
        <div class="field"><label for="a-name">Name</label><input id="a-name" v-model="editingAddOn.name" class="input" required /></div>
        <div class="field"><label for="a-desc">Description</label><textarea id="a-desc" v-model="editingAddOn.description" class="textarea" /></div>
        <div class="grid-2">
          <div class="field"><label for="a-min">Extra minutes</label><input id="a-min" v-model.number="editingAddOn.durationMinutes" class="input" type="number" min="0" max="120" step="5" /></div>
          <div class="field"><label for="a-price">Price (₱)</label><input id="a-price" v-model.number="editingAddOn.price" class="input" type="number" min="0" step="10" /></div>
        </div>
        <div class="field">
          <label for="a-service">Offered with</label>
          <select id="a-service" v-model="addOnService" class="select">
            <option value="">Any service</option>
            <option v-for="sv in services" :key="sv.id" :value="sv.id">{{ sv.name }} only</option>
          </select>
        </div>
        <div class="field">
          <span id="a-sizes" class="field-label">Dog sizes</span>
          <div class="chips" role="group" aria-labelledby="a-sizes">
            <button
              v-for="sz in PET_SIZES"
              :key="sz"
              type="button"
              class="chip"
              :aria-pressed="editingAddOn.sizes?.includes(sz) ? 'true' : 'false'"
              @click="toggleSize(editingAddOn.sizes!, sz)"
            >
              {{ SIZE_LABELS[sz] }}
            </button>
          </div>
          <span class="field-hint">Leave all unselected to offer it for every size.</span>
        </div>
        <div class="chips" role="group" aria-label="For">
          <button v-for="sp in ['dog', 'cat'] as Species[]" :key="sp" type="button" class="chip" :aria-pressed="editingAddOn.species.includes(sp) ? 'true' : 'false'" @click="toggleSpecies(editingAddOn.species, sp)">
            {{ sp === 'dog' ? 'Dogs' : 'Cats' }}
          </button>
        </div>
        <label class="check"><input v-model="editingAddOn.active" type="checkbox" /><span>Offered online</span></label>
        <div class="row">
          <button type="submit" class="btn btn-primary">Save extra</button>
          <button v-if="!editingAddOn.isNew" type="button" class="btn btn-danger" @click="deleteAddOn(editingAddOn)">Delete</button>
        </div>
      </form>
    </SheetDialog>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  border-radius: 26px;
  background: var(--surface-sunk);
}

.tab {
  flex: 1 1 40%;
  appearance: none;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-soft);
  font: inherit;
  font-weight: 640;
  white-space: nowrap;
  cursor: pointer;
}

.tab[aria-selected='true'] {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 0 0 1px var(--grout);
}

.section-title {
  font-size: var(--step-1);
}

.list {
  padding-block: 0;
}

.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}

.item-text {
  gap: 2px;
  min-width: 0;
}

.day-row {
  display: grid;
  gap: 8px;
  padding: 12px 0;
  border-top: 1px solid var(--grout);
}

.day-toggle {
  min-height: 32px;
  padding: 0;
}

.times {
  flex-wrap: nowrap;
  gap: 8px;
}

.time {
  width: auto;
  min-width: 0;
  flex: 1;
  max-width: 150px;
}

.break {
  padding-left: 12px;
}

.add-break {
  width: fit-content;
}

.size-blocks {
  gap: 10px;
}

.size-block {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--grout);
  border-radius: var(--radius-tile);
  min-width: 0;
}

.size-legend {
  padding: 0 4px;
  font-size: var(--step--1);
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.size-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
</style>
