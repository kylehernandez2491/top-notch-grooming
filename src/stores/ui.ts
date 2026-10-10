import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Optional free-text reason (e.g. cancellation reason). */
  reasonLabel?: string;
  resolve: (result: { confirmed: boolean; reason?: string }) => void;
}

export const useUi = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  const confirmRequest = ref<ConfirmRequest | null>(null);
  const online = ref(navigator.onLine);
  const updateReady = ref<null | (() => void)>(null);
  let seq = 0;

  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));

  function toast(message: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ms = 4500) {
    const id = ++seq;
    toasts.value.push({ id, message, tone, action });
    window.setTimeout(() => dismiss(id), ms);
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  function confirm(options: Omit<ConfirmRequest, 'resolve'>): Promise<{ confirmed: boolean; reason?: string }> {
    return new Promise((resolve) => {
      confirmRequest.value = { ...options, resolve };
    });
  }

  function settleConfirm(confirmed: boolean, reason?: string) {
    confirmRequest.value?.resolve({ confirmed, reason });
    confirmRequest.value = null;
  }

  return { toasts, confirmRequest, online, updateReady, toast, dismiss, confirm, settleConfirm };
});
