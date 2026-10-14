<script setup lang="ts">
/**
 * Quick controls on the staff Today screen: closed today, opening late, closing early, and the message
 * the chat assistant shows customers. Online booking and the chat follow the change straight away.
 * Closing uses time off (a closure); late and early starts save special hours for that date.
 */
import { computed, reactive, ref } from 'vue';
import type { AgendaResponse, DayHours } from '@shared/types';
import { formatTime12, fromMinutes, toMinutes } from '@shared/format';
import { hoursText } from '@shared/chat';
import { dayPlan, weekdayOfDay } from '@shared/hours';
import { api, ApiError } from '@/api/client';
import Icon from './Icon.vue';
import SheetDialog from './SheetDialog.vue';
import { useCatalog } from '@/stores/catalog';
import { useUi } from '@/stores/ui';
import { shortDay } from '@/utils/dates';

const props = defineProps<{ day: string; agenda: AgendaResponse | null }>();
const emit = defineEmits<{ changed: [] }>();
const catalog = useCatalog();
const ui = useUi();
const saving = ref(false);

const isToday = computed(() => props.day === catalog.today);
const dayWord = computed(() => (isToday.value ? 'today' : 'this day'));
const plan = computed(() =>
  catalog.settings ? dayPlan(props.day, catalog.settings.weeklyHours, props.agenda?.closures ?? [], props.agenda?.specialHours ?? []) : null,
);
const booked = computed(() => (props.agenda?.appointments ?? []).filter((a) => a.day === props.day && ['booked', 'checked-in', 'in-progress'].includes(a.status)));
const notice = computed(() => props.agenda?.notice);
const summary = computed(() => {
  const p = plan.value;
  if (!p) return '';
  if (p.closure) return `Closed all day: ${p.closure.reason}`;
  if (!p.hours) return 'Closed, a usual day off';
  return hoursText(p.hours);
});

function showError(err: unknown) {
  const e = err as ApiError;
  const details = e.details?.map((d) => d.message).join('; ');
  ui.toast(details ? `${e.message} ${details}` : e.message, 'error', undefined, 8000);
}

async function act(work: () => Promise<unknown>, message: string) {
  saving.value = true;
  try {
    await work();
    ui.toast(message, 'success');
    emit('changed');
    catalog.load(true).catch(() => undefined);
    return true;
  } catch (err) {
    showError(err);
    return false;
  } finally {
    saving.value = false;
  }
}

// ---------- closed for the day ----------

async function closeDay() {
  const count = booked.value.length;
  const { confirmed, reason } = await ui.confirm({
    title: isToday.value ? 'Close today?' : `Close on ${shortDay(props.day)}?`,
    message: `Online booking stops and the chat tells customers you're closed.${count ? ` ${count} ${count === 1 ? 'pet is' : 'pets are'} booked: those bookings stay, so call the owners to move them.` : ''}`,
    confirmLabel: 'Close for the day',
    reasonLabel: 'Reason customers see (optional)',
    danger: true,
  });
  if (!confirmed) return;
  await act(() => api.admin.createClosure({ date: props.day, reason: reason?.trim() || 'Closed' }), `Closed ${dayWord.value}.`);
}

function reopen() {
  const full = (props.agenda?.closures ?? []).filter((c) => c.date === props.day && !c.start);
  act(() => Promise.all(full.map((c) => api.admin.deleteClosure(c.id))), `Open again ${dayWord.value}.`);
}

// ---------- opening late, closing early, opening on a day off ----------

type Mode = 'late' | 'early' | 'open';
const sheet = ref<Mode | null>(null);
const base = ref<DayHours>({ open: '09:00', close: '17:00', breaks: [] });
const form = reactive({ open: '09:00', close: '17:00', note: '' });
const allTimes = Array.from({ length: (22 - 5) * 4 + 1 }, (_, i) => fromMinutes(5 * 60 + i * 15));
const inside = computed(() => allTimes.filter((t) => t > base.value.open && t < base.value.close));
const openOptions = computed(() => (sheet.value === 'late' ? inside.value : allTimes));
const closeOptions = computed(() => (sheet.value === 'early' ? inside.value : allTimes));
const sheetTitle = computed(() => ({ late: 'Opening late', early: 'Closing early', open: `Open ${dayWord.value}` })[sheet.value ?? 'open']);
/** Bookings that the new hours would leave outside opening time. */
const outside = computed(() => booked.value.filter((a) => a.startTime < form.open || a.endTime > form.close).length);

function openSheet(mode: Mode) {
  const usual = catalog.settings?.weeklyHours[weekdayOfDay(props.day)];
  base.value = plan.value?.hours ?? usual ?? { open: '09:00', close: '17:00', breaks: [] };
  const options = allTimes.filter((t) => t > base.value.open && t < base.value.close);
  // Start an hour later or an hour earlier than now; the groomer picks the real time.
  const later = fromMinutes(toMinutes(base.value.open) + 60);
  const earlier = fromMinutes(toMinutes(base.value.close) - 60);
  form.open = mode === 'late' ? (options.find((t) => t >= later) ?? options[0] ?? base.value.open) : base.value.open;
  form.close = mode === 'early' ? ([...options].reverse().find((t) => t <= earlier) ?? options.at(-1) ?? base.value.close) : base.value.close;
  form.note = plan.value?.special?.note ?? '';
  sheet.value = mode;
}

async function saveHours() {
  // Keep the usual breaks that still fit inside the new hours.
  const breaks = base.value.breaks.filter((b) => b.start >= form.open && b.end <= form.close);
  const ok = await act(
    () => api.admin.saveSpecialHours(props.day, { open: form.open, close: form.close, breaks, note: form.note.trim() || undefined }),
    `Hours changed for ${dayWord.value}. Booking and the chat use them now.`,
  );
  if (ok) sheet.value = null;
}

function resetHours() {
  act(() => api.admin.deleteSpecialHours(props.day), `Back to the usual hours ${dayWord.value}.`);
}

// ---------- the chat assistant's message ----------

const noticeOpen = ref(false);
const noticeForm = reactive({ message: '', until: '' });

function openNotice() {
  noticeForm.message = notice.value?.message ?? '';
  noticeForm.until = notice.value?.until ?? catalog.today;
  noticeOpen.value = true;
}

async function saveNotice() {
  const ok = await act(() => api.admin.saveNotice({ message: noticeForm.message.trim(), until: noticeForm.until }), 'Message saved. Customers see it in the chat.');
  if (ok) noticeOpen.value = false;
}

async function clearNotice() {
  const ok = await act(() => api.admin.clearNotice(), 'Message removed from the chat.');
  if (ok) noticeOpen.value = false;
}
</script>

<template>
  <section v-if="plan" class="panel stack" aria-labelledby="shop-hours-title">
    <div class="spread">
      <h2 id="shop-hours-title" class="card-title"><Icon name="clock" :size="20" /> {{ isToday ? "Today's hours" : 'Hours this day' }}</h2>
      <span v-if="plan.special && !plan.closure" class="badge special">Special hours</span>
    </div>
    <p class="tabular">
      {{ summary }}<span v-if="plan.special?.note && !plan.closure" class="muted"> · {{ plan.special.note }}</span>
    </p>

    <div v-if="day >= catalog.today" class="row">
      <button v-if="plan.closure" type="button" class="btn btn-sm" :disabled="saving" @click="reopen">Open again {{ dayWord }}</button>
      <template v-else>
        <template v-if="plan.hours">
          <button type="button" class="btn btn-sm" :disabled="saving" @click="openSheet('late')">Opening late</button>
          <button type="button" class="btn btn-sm" :disabled="saving" @click="openSheet('early')">Closing early</button>
          <button type="button" class="btn btn-sm btn-danger" :disabled="saving" @click="closeDay">Closed {{ dayWord }}</button>
        </template>
        <button v-else type="button" class="btn btn-sm" :disabled="saving" @click="openSheet('open')">Open {{ dayWord }}</button>
        <button v-if="plan.special" type="button" class="btn btn-sm btn-ghost" :disabled="saving" @click="resetHours">Back to usual hours</button>
      </template>
    </div>

    <div class="notice-row">
      <p class="small">
        <strong>Chat message:</strong>
        <template v-if="notice"> “{{ notice.message }}” until {{ shortDay(notice.until) }}</template>
        <span v-else class="muted"> none</span>
      </p>
      <button type="button" class="btn btn-sm" :disabled="saving" @click="openNotice"><Icon name="chat" :size="16" /> {{ notice ? 'Edit' : 'Add' }}</button>
    </div>

    <SheetDialog :open="!!sheet" :title="sheetTitle" @close="sheet = null">
      <form v-if="sheet" class="stack" @submit.prevent="saveHours">
        <p class="small muted">
          {{ shortDay(day) }}. Online booking and the chat assistant use these hours straight away. Usually {{ hoursText(base) }}.
        </p>
        <div class="grid-2">
          <div v-if="sheet !== 'early'" class="field">
            <label for="sh-open">Opens at</label>
            <select id="sh-open" v-model="form.open" class="select">
              <option v-for="t in openOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
            </select>
          </div>
          <div v-if="sheet !== 'late'" class="field">
            <label for="sh-close">Closes at</label>
            <select id="sh-close" v-model="form.close" class="select">
              <option v-for="t in closeOptions" :key="t" :value="t">{{ formatTime12(t) }}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="sh-note">Note for customers (optional)</label>
          <input id="sh-note" v-model="form.note" class="input" maxlength="80" placeholder="e.g. Opening late for a vet visit" />
        </div>
        <p v-if="outside" class="alert small">
          {{ outside }} {{ outside === 1 ? 'booking falls' : 'bookings fall' }} outside these hours. They stay booked, so call the owners to move them.
        </p>
        <p v-if="form.open >= form.close" class="field-error">Closing time must be after opening time.</p>
        <div class="row">
          <button type="submit" class="btn btn-primary" :disabled="saving || form.open >= form.close">Save hours</button>
        </div>
      </form>
    </SheetDialog>

    <SheetDialog :open="noticeOpen" title="Message for the chat" @close="noticeOpen = false">
      <form class="stack" @submit.prevent="saveNotice">
        <p class="small muted">Customers see this when they open the chat, e.g. "Closed for Signal No. 2" or "Walk-ins welcome for nail cuts today".</p>
        <div class="field">
          <label for="nt-msg">Message</label>
          <textarea id="nt-msg" v-model="noticeForm.message" class="textarea" maxlength="200" required />
        </div>
        <div class="field">
          <label for="nt-until">Show until the end of</label>
          <input id="nt-until" v-model="noticeForm.until" class="input" type="date" :min="catalog.today" required />
        </div>
        <div class="row">
          <button type="submit" class="btn btn-primary" :disabled="saving || !noticeForm.message.trim() || !noticeForm.until">Save message</button>
          <button v-if="notice" type="button" class="btn btn-danger" :disabled="saving" @click="clearNotice">Remove</button>
        </div>
      </form>
    </SheetDialog>
  </section>
</template>

<style scoped>
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--step-1);
}

.special {
  background: var(--brand-faint);
}

.notice-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--grout);
}

.notice-row p {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
