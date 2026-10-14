/** Phone-friendly helpers: photo resizing, native share, haptics, maps and calendar links. */

/** Downscale a camera photo to a small JPEG data URL (keeps Cosmos documents tiny). */
export async function resizeImage(file: File, maxSize = 480, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the photo');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

export async function shareOrCopy(data: { title: string; text: string; url?: string }): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share(data);
      return 'shared';
    }
    await navigator.clipboard.writeText([data.text, data.url].filter(Boolean).join('\n'));
    return 'copied';
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return 'failed';
    return 'failed';
  }
}

export function buzz(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
export const shopDirectionsUrl = () => mapsUrl('Top Notch Dog Grooming - Talavera Branch, Talavera, Nueva Ecija');
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
