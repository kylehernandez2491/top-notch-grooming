import { computed, ref, watch, type Ref } from 'vue';
import type { AvailabilityResponse, DayAvailability, PetSize } from '@shared/types';
import { api } from '@/api/client';
import { addDays, addMonths, monthRange } from '@/utils/dates';

export interface AvailabilityParams {
  serviceId: string;
  size: PetSize;
  addOns: string[];
  exclude?: string;
  /** Manage token from an email link: proves the owner may treat `exclude` as their own time. */
  token?: string;
  staff?: boolean;
}

/**
 * Loads a month of availability for the tile calendar, caches each month per query, and quietly
 * prefetches the next month so swiping forward feels instant on a phone.
 */
export function useAvailability(params: Ref<AvailabilityParams | null>, month: Ref<string>) {
  const cache = new Map<string, Promise<AvailabilityResponse>>();
  const response = ref<AvailabilityResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let token = 0;

  function load(forMonth: string, force = false): Promise<AvailabilityResponse> | null {
    const q = params.value;
    if (!q) return null;
    const { from, to } = monthRange(forMonth);
    const key = JSON.stringify({ ...q, from, to });
    if (force || !cache.has(key)) {
      const promise = api.availability({ ...q, from, to });
      promise.catch(() => cache.delete(key));
      cache.set(key, promise);
    }
    return cache.get(key)!;
  }

  async function refresh(force = false) {
    const promise = load(month.value, force);
    if (!promise) {
      response.value = null;
      return;
    }
    const mine = ++token;
    loading.value = true;
    error.value = null;
    try {
      const result = await promise;
      if (mine === token) response.value = result;
      load(addMonths(month.value, 1)); // prefetch
    } catch (err) {
      if (mine === token) error.value = (err as Error).message;
    } finally {
      if (mine === token) loading.value = false;
    }
  }

  watch([params, month], () => refresh(), { immediate: true, deep: true });

  const days = computed(() => new Map<string, DayAvailability>((response.value?.days ?? []).map((d) => [d.day, d])));

  /** Earliest open slot from today across the whole booking window. */
  async function findNext(today: string, horizonDays: number) {
    const q = params.value;
    if (!q) return undefined;
    const result = await api.availability({ ...q, from: today, to: addDays(today, Math.min(horizonDays, 92)) });
    return result.nextAvailable;
  }

  function invalidate() {
    cache.clear();
    return refresh(true);
  }

  return { days, response, loading, error, refresh: invalidate, findNext };
}
