<script setup lang="ts">
/** Toasts, the shared confirm sheet, the offline banner and the "new version" prompt. */
import { ref, watch } from 'vue';
import Icon from './Icon.vue';
import SheetDialog from './SheetDialog.vue';
import { useUi } from '@/stores/ui';

const ui = useUi();
const reason = ref('');

watch(
  () => ui.confirmRequest,
  () => (reason.value = ''),
);
</script>

<template>
  <div v-if="!ui.online" class="offline" role="status">
    <Icon name="offline" :size="18" /> You're offline. Saved info is shown; booking needs a connection.
  </div>

  <div v-if="ui.updateReady" class="update" role="status">
    <span>A new version is ready.</span>
    <button type="button" class="btn btn-sm btn-primary" @click="ui.updateReady?.()">Update now</button>
  </div>

  <div class="toasts" aria-live="polite" aria-atomic="false">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="`toast-${t.tone}`" role="status">
      <Icon :name="t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'bell'" :size="18" />
      <span class="toast-msg">{{ t.message }}</span>
      <button v-if="t.action" type="button" class="btn btn-sm btn-ghost toast-action" @click="t.action.run(), ui.dismiss(t.id)">
        {{ t.action.label }}
      </button>
      <button type="button" class="icon-btn" aria-label="Dismiss" @click="ui.dismiss(t.id)"><Icon name="x" :size="16" /></button>
    </div>
  </div>

  <SheetDialog :open="!!ui.confirmRequest" :title="ui.confirmRequest?.title ?? ''" @close="ui.settleConfirm(false)">
    <template v-if="ui.confirmRequest">
      <p v-if="ui.confirmRequest.message">{{ ui.confirmRequest.message }}</p>
      <div v-if="ui.confirmRequest.reasonLabel" class="field">
        <label for="confirm-reason">{{ ui.confirmRequest.reasonLabel }}</label>
        <textarea id="confirm-reason" v-model="reason" class="textarea" maxlength="300" />
      </div>
      <div class="confirm-actions">
        <button type="button" class="btn" @click="ui.settleConfirm(false)">{{ ui.confirmRequest.cancelLabel ?? 'Keep it' }}</button>
        <button
          type="button"
          class="btn"
          :class="ui.confirmRequest.danger ? 'btn-dark danger' : 'btn-primary'"
          @click="ui.settleConfirm(true, reason.trim() || undefined)"
        >
          {{ ui.confirmRequest.confirmLabel }}
        </button>
      </div>
    </template>
  </SheetDialog>
</template>

<style scoped>
.offline,
.update {
  position: sticky;
  top: var(--top-h);
  z-index: 15;
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  font-size: var(--step--1);
  font-weight: 600;
}

.offline {
  background: var(--ink);
  color: var(--paper);
}

.update {
  background: var(--brand-faint);
}

.toasts {
  position: fixed;
  z-index: 50;
  left: 12px;
  right: 12px;
  bottom: calc(var(--nav-h) + var(--safe-b) + 12px);
  display: grid;
  gap: 8px;
  justify-items: center;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 480px);
  padding: 6px 6px 6px 16px;
  border-radius: 14px;
  background: var(--bar-bg);
  color: var(--bar-ink);
  border: 1px solid var(--grout);
  animation: pop 0.2s ease-out;
}

.toast-error {
  background: var(--alert);
  color: #fff;
}

.toast-msg {
  flex: 1;
  font-weight: 560;
}

.toast-action {
  color: var(--brand);
}

.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.danger {
  background: var(--alert);
  border-color: var(--alert);
  color: #fff;
}

@media (min-width: 900px) {
  .toasts {
    bottom: 24px;
  }
}

@keyframes pop {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
}
</style>
