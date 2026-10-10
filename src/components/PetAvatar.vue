<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; photo?: string; size?: number; species?: 'dog' | 'cat' }>(), { size: 48 });

// Stable brand-coloured tile per pet name when there's no photo (logo yellow, black, greys).
const tints = [
  { bg: '#fad006', fg: '#0a0a0a' },
  { bg: '#0a0a0a', fg: '#fad006' },
  { bg: '#fde27a', fg: '#0a0a0a' },
  { bg: '#e2e2e0', fg: '#0a0a0a' },
];
const tint = computed(() => tints[[...props.name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % tints.length]);
const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?');
</script>

<template>
  <span class="avatar" :style="{ width: `${size}px`, height: `${size}px`, background: tint.bg, color: tint.fg, fontSize: `${size * 0.42}px` }">
    <img v-if="photo" :src="photo" :alt="`Photo of ${name}`" loading="lazy" />
    <span v-else aria-hidden="true">{{ initial }}</span>
  </span>
</template>

<style scoped>
.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  overflow: hidden;
  border-radius: 30%;
  font-weight: 760;
  font-variation-settings: 'CASL' 1;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
