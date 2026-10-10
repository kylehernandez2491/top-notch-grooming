<script setup lang="ts">
import Icon from './Icon.vue';

const props = withDefaults(defineProps<{ modelValue: number; readonly?: boolean; size?: number }>(), { size: 28 });
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

function onKey(e: KeyboardEvent) {
  if (props.readonly) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') emit('update:modelValue', Math.min(5, props.modelValue + 1));
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') emit('update:modelValue', Math.max(1, props.modelValue - 1));
}
</script>

<template>
  <span v-if="readonly" class="stars" :aria-label="`${modelValue} out of 5 stars`" role="img">
    <Icon v-for="n in 5" :key="n" name="star" :size="size" :class="{ on: n <= Math.round(modelValue) }" />
  </span>
  <span v-else class="stars" role="radiogroup" aria-label="Rating" @keydown="onKey">
    <button
      v-for="n in 5"
      :key="n"
      type="button"
      role="radio"
      class="star-btn"
      :aria-checked="n === modelValue ? 'true' : 'false'"
      :aria-label="`${n} star${n > 1 ? 's' : ''}`"
      :tabindex="n === (modelValue || 1) ? 0 : -1"
      @click="emit('update:modelValue', n)"
    >
      <Icon name="star" :size="size" :class="{ on: n <= modelValue }" />
    </button>
  </span>
</template>

<style scoped>
.stars {
  display: inline-flex;
  gap: 2px;
  color: var(--grout-strong);
}

.star-btn {
  appearance: none;
  border: 0;
  background: none;
  padding: 4px;
  color: inherit;
  cursor: pointer;
  border-radius: 8px;
}

.on {
  color: var(--brand-press);
  fill: var(--brand);
}
</style>
