<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { Appointment, AppointmentStatus } from '@shared/types';
import { formatDuration, formatMoney, formatPriceRange, formatTime12, sizePhrase } from '@shared/format';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';
import SheetDialog from '@/components/SheetDialog.vue';
import StarRating from '@/components/StarRating.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { nextStep, useStaffActions } from '@/composables/useStaffActions';
import { useUi } from '@/stores/ui';
import { longDay, timestamp } from '@/utils/dates';
import { telUrl } from '@/utils/device';

const route = useRoute();
const ui = useUi();
const { setStatus } = useStaffActions();
const a = ref<Appointment | null>(null);
const error = ref('');
const staffNotes = ref('');
const completeOpen = ref(false);
const finalPrice = ref<number>(0);
const report = reactive({ behavior: '', coat: '', notes: '', recommendations: '', nextVisitWeeks: 6 as number | undefined });
const savingReport = ref(false);

onMounted(async () => {
  try {
    a.value = await api.admin.appointment(route.params.id as string);
    staffNotes.value = a.value.staffNotes ?? '';
    finalPrice.value = a.value.finalPrice ?? a.value.estimatedPrice;
    if (a.value.reportCard) Object.assign(report, a.value.reportCard);
  } catch (err) {
    error.value = (err as Error).message;
  }
});

const step = computed(() => (a.value ? nextStep(a.value.status) : null));
const active = computed(() => !!a.value && ['booked', 'checked-in', 'in-progress'].includes(a.value.status));
const smsUrl = computed(() => (a.value?.ownerPhone ? `sms:${a.value.ownerPhone.replace(/[^\d+]/g, '')}` : ''));

async function change(status: AppointmentStatus, price?: number) {
  if (!a.value) return;
  const updated = await setStatus(a.value, status, price);
  if (updated) {
    a.value = updated;
    ui.toast('Updated.', 'success');
  }
}

async function advance() {
  if (!step.value) return;
  if (step.value.status === 'completed') completeOpen.value = true;
  else await change(step.value.status);
}

async function complete() {
  completeOpen.value = false;
  await change('completed', Number(finalPrice.value));
}

async function saveNotes() {
  if (!a.value) return;
  try {
    a.value = await api.admin.staffNotes(a.value.id, staffNotes.value.trim() || undefined);
    ui.toast('Staff notes saved.', 'success');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  }
}

async function saveReport() {
  if (!a.value) return;
  savingReport.value = true;
  try {
    const first = !a.value.reportCard;
    a.value = await api.admin.reportCard(a.value.id, { ...report, nextVisitWeeks: report.nextVisitWeeks || undefined });
    ui.toast(first ? 'Report card sent to the owner.' : 'Report card updated.', 'success');
  } catch (err) {
    ui.toast((err as Error).message, 'error');
  } finally {
    savingReport.value = false;
  }
}
</script>

<template>
  <div class="page page-narrow">
    <RouterLink :to="{ path: '/admin', query: a ? { day: a.day } : {} }" class="back small"><Icon name="chevron-left" :size="16" /> Agenda</RouterLink>
    <p v-if="error" class="alert">{{ error }}</p>
    <div v-if="!a && !error" class="skeleton" style="height: 260px" />

    <template v-if="a">
      <header class="spread">
        <div class="stack head">
          <h1>{{ a.petName }}</h1>
          <span class="muted">{{ a.petBreed || a.petSpecies }}, {{ sizePhrase(a.petSize, a.petSpecies) }}</span>
        </div>
        <StatusBadge :status="a.status" />
      </header>

      <section v-if="a.petAlerts.length" class="alert">
        <Icon name="alert" :size="18" />
        <ul class="alert-list">
          <li v-for="x in a.petAlerts" :key="x">{{ x }}</li>
        </ul>
      </section>

      <section class="panel stack">
        <p class="when">{{ longDay(a.day) }}, {{ formatTime12(a.startTime) }} to {{ formatTime12(a.endTime) }}</p>
        <dl class="details">
          <dt>Service</dt>
          <dd>{{ a.serviceName }}<template v-if="a.addOns.length"> + {{ a.addOns.map((x) => x.name).join(', ') }}</template></dd>
          <dt>Length</dt>
          <dd>{{ formatDuration(a.durationMinutes) }}</dd>
          <dt>Price</dt>
          <dd class="tabular">
            {{ formatPriceRange(a.estimatedPrice, a.estimatedPriceMax) }} estimate<template v-if="a.finalPrice !== undefined">, {{ formatMoney(a.finalPrice) }} charged</template>
          </dd>
          <dt>Booked by</dt>
          <dd>{{ a.bookedBy === 'staff' ? 'Shop' : 'Owner online' }}{{ a.seriesId ? ', part of a repeat series' : '' }}</dd>
        </dl>
        <p v-if="a.notes" class="owner-note">Owner: “{{ a.notes }}”</p>
        <p v-if="a.lateCancellation" class="small warn">Late cancellation</p>
      </section>

      <section class="panel stack">
        <h2 class="section-title">Owner</h2>
        <RouterLink :to="`/admin/clients/${encodeURIComponent(a.clientKey)}`" class="owner-link"><strong>{{ a.ownerName }}</strong></RouterLink>
        <div class="row">
          <a v-if="a.ownerPhone" class="btn btn-sm" :href="telUrl(a.ownerPhone)"><Icon name="phone" :size="18" /> Call</a>
          <a v-if="smsUrl" class="btn btn-sm" :href="`${smsUrl}?body=${encodeURIComponent(`Hi! ${a.petName} is ready for pick-up.`)}`">
            Text "ready for pick-up"
          </a>
          <a v-if="a.ownerEmail" class="btn btn-sm" :href="`mailto:${a.ownerEmail}`"><Icon name="mail" :size="18" /> Email</a>
        </div>
      </section>

      <section v-if="active" class="panel stack">
        <h2 class="section-title">Workflow</h2>
        <div class="row">
          <button v-if="step" type="button" class="btn btn-primary" @click="advance">{{ step.label }}</button>
          <RouterLink v-if="a.status === 'booked'" class="btn" :to="{ path: `/appointments/${a.id}/reschedule`, query: { staff: '1' } }">
            <Icon name="clock" :size="18" /> Move
          </RouterLink>
          <button type="button" class="btn" @click="change('no-show')">No-show</button>
          <button type="button" class="btn btn-danger" @click="change('cancelled')">Cancel</button>
        </div>
      </section>
      <section v-else-if="a.status === 'completed' || a.status === 'no-show'" class="row">
        <button v-if="a.status === 'completed'" type="button" class="btn btn-sm" @click="completeOpen = true">Edit amount charged</button>
        <button v-if="a.status === 'no-show'" type="button" class="btn btn-sm" @click="change('completed')">Undo no-show</button>
      </section>

      <section class="panel stack">
        <label for="staff-notes" class="section-title">Staff notes</label>
        <p class="small muted">Only the shop sees these.</p>
        <textarea id="staff-notes" v-model="staffNotes" class="textarea" maxlength="1000" placeholder="Used #7 blade, nervous with nail grinder…" />
        <button type="button" class="btn btn-sm" :disabled="staffNotes === (a.staffNotes ?? '')" @click="saveNotes">Save notes</button>
      </section>

      <form v-if="a.status === 'completed' || a.status === 'in-progress'" class="panel stack-lg" @submit.prevent="saveReport">
        <div class="stack">
          <h2 class="section-title">Report card</h2>
          <p class="small muted">{{ a.reportCard ? 'Shown on the owner’s visit page.' : 'The owner gets an email when you send this.' }}</p>
        </div>
        <div class="field">
          <label for="rc-behavior">Behavior</label>
          <input id="rc-behavior" v-model="report.behavior" class="input" placeholder="Calm on the table, wiggly for feet" required />
        </div>
        <div class="field">
          <label for="rc-coat">Coat and skin</label>
          <input id="rc-coat" v-model="report.coat" class="input" placeholder="Light matting behind ears, skin healthy" required />
        </div>
        <div class="field">
          <label for="rc-notes">What we did</label>
          <textarea id="rc-notes" v-model="report.notes" class="textarea" required />
        </div>
        <div class="field">
          <label for="rc-rec">Recommendations</label>
          <textarea id="rc-rec" v-model="report.recommendations" class="textarea" placeholder="Brush behind ears twice a week" required />
        </div>
        <div class="field">
          <label for="rc-next">Suggest next visit in</label>
          <select id="rc-next" v-model.number="report.nextVisitWeeks" class="select">
            <option :value="undefined">No suggestion</option>
            <option v-for="w in [2, 3, 4, 5, 6, 8, 10, 12]" :key="w" :value="w">{{ w }} weeks</option>
          </select>
        </div>
        <button type="submit" class="btn btn-dark" :disabled="savingReport">{{ a.reportCard ? 'Update report card' : 'Send report card' }}</button>
      </form>

      <section v-if="a.review" class="panel stack">
        <h2 class="section-title">Owner review</h2>
        <StarRating :model-value="a.review.rating" readonly :size="22" />
        <p v-if="a.review.comment">{{ a.review.comment }}</p>
      </section>

      <details class="panel">
        <summary>History</summary>
        <ol class="timeline">
          <li v-for="(h, i) in a.history" :key="i">
            <strong>{{ h.event }}</strong>
            <span class="muted small">{{ timestamp(h.at) }} by {{ h.by }}{{ h.note ? `. ${h.note}` : '' }}</span>
          </li>
        </ol>
      </details>
    </template>

    <SheetDialog :open="completeOpen" title="Amount charged" @close="completeOpen = false">
      <div class="field">
        <label for="final-price">Total charged (₱)</label>
        <input id="final-price" v-model.number="finalPrice" class="input" type="number" inputmode="decimal" min="0" step="1" />
        <span class="field-hint">Estimate was {{ a ? formatPriceRange(a.estimatedPrice, a.estimatedPriceMax) : '' }}. Used for revenue reports.</span>
      </div>
      <button type="button" class="btn btn-primary" @click="complete">Save and mark done</button>
    </SheetDialog>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  color: var(--ink-soft);
  font-weight: 600;
  min-height: 44px;
}

.head {
  gap: 2px;
}

.alert-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}

.when {
  font-size: var(--step-1);
  font-weight: 700;
  font-variation-settings: 'CASL' 1;
}

.details {
  display: grid;
  grid-template-columns: minmax(96px, auto) 1fr;
  gap: 8px 16px;
  margin: 0;
}

.details dt {
  color: var(--ink-soft);
  font-size: var(--step--1);
  font-weight: 600;
}

.details dd {
  margin: 0;
}

.owner-note {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-sunk);
}

.warn {
  color: var(--alert);
  font-weight: 600;
}

.section-title {
  font-size: var(--step-1);
  font-weight: 760;
  font-variation-settings: 'CASL' 1;
}

.owner-link {
  width: fit-content;
}

summary {
  cursor: pointer;
  font-weight: 640;
}

.timeline {
  margin: 12px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
}

.timeline li {
  display: grid;
}
</style>
