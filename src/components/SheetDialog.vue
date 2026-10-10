<script setup lang="ts">
/**
 * Native <dialog>: focus trapping, Esc to close and inert background for free.
 * Slides up as a bottom sheet on phones, centred card on larger screens.
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const el = ref<HTMLDialogElement | null>(null);

watch(
  () => [props.open, el.value] as const,
  ([open, dialog]) => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  },
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(() => el.value?.open && el.value.close());

function onBackdrop(e: MouseEvent) {
  if (e.target === el.value) emit('close');
}
</script>

<template>
  <dialog ref="el" class="sheet" :aria-label="title" @close="emit('close')" @click="onBackdrop">
    <div class="sheet-body">
      <header class="spread">
        <h2 class="sheet-title">{{ title }}</h2>
        <button type="button" class="icon-btn" aria-label="Close" @click="emit('close')"><Icon name="x" /></button>
      </header>
      <slot />
    </div>
  </dialog>
</template>

<style scoped>
.sheet {
  width: 100%;
  max-width: 100%;
  max-height: 92dvh;
  margin: auto 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--surface);
  color: var(--ink);
}

.sheet[open] {
  animation: rise 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.sheet::backdrop {
  background: rgb(0 0 0 / 0.55);
}

.sheet-body {
  display: grid;
  gap: 16px;
  padding: 18px 18px calc(18px + var(--safe-b));
}

.sheet-title {
  font-size: var(--step-1);
}

@media (min-width: 640px) {
  .sheet {
    max-width: 520px;
    margin: auto;
    border-radius: var(--radius-sheet);
  }
  .sheet-body {
    padding: 24px;
  }
}

@keyframes rise {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
}
</style>
