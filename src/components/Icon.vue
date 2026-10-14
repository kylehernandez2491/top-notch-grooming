<script lang="ts">
/** Small stroke icon set (24px grid) so the app ships no icon font. */
const paths = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4',
  paw: 'M8 11a2 2.5 0 1 1 0-.01M16 11a2 2.5 0 1 1 0-.01M5 15a1.8 2.2 0 1 1 0-.01M19 15a1.8 2.2 0 1 1 0-.01M8.5 19.5c0-2.5 1.6-4.5 3.5-4.5s3.5 2 3.5 4.5c0 1-1 1.5-3.5 1.5s-3.5-.5-3.5-1.5z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-3.8 4-6 8-6s7.2 2.2 8 6',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  check: 'M5 12.5 10 17l9-10',
  x: 'M6 6l12 12M18 6 6 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  map: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  phone: 'M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  alert: 'M12 3 2 20h20zM12 10v4M12 17.5h.01',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9 20 19M8.1 16.1 20 5',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.2-1.5M2 9.5a15 15 0 0 1 4.2-2.8M22 9.5A15 15 0 0 0 11 5M12 20h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c.6-3.5 3.3-6 7-6s6.4 2.5 7 6M16 3.5a4 4 0 0 1 0 7.5M18 15c2 .8 3.5 2.8 4 6',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  waitlist: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5h4M3 3l3 3',
  tub: 'M3 12h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM5 12V5a2 2 0 0 1 4 0M7 20l-1 2M17 20l1 2',
  menu: 'M4 6h16M4 12h16M4 18h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  chat: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 10h.01M12 10h.01M16 10h.01',
  send: 'M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z',
} as const;

export type IconName = keyof typeof paths;
</script>

<script setup lang="ts">
const props = withDefaults(defineProps<{ name: IconName; size?: number; label?: string }>(), { size: 22 });
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
    class="icon"
  >
    <path :d="paths[props.name]" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
}
</style>
