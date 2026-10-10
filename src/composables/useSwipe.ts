import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/** Horizontal swipe detection for touch screens (pointer events, no dependencies). */
export function useSwipe(target: Ref<HTMLElement | null>, handlers: { left?: () => void; right?: () => void }, threshold = 48) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  };
  const up = (e: PointerEvent) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) handlers.left?.();
    else handlers.right?.();
  };
  const cancel = () => (tracking = false);

  onMounted(() => {
    const el = target.value;
    if (!el) return;
    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointerup', up, { passive: true });
    el.addEventListener('pointercancel', cancel, { passive: true });
  });
  onBeforeUnmount(() => {
    const el = target.value;
    if (!el) return;
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  });
}
