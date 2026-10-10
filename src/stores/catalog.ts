import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { PetSize, PublicCatalog, Species } from '@shared/types';
import { addOnApplies } from '@shared/format';
import { api } from '@/api/client';

export const useCatalog = defineStore('catalog', () => {
  const data = ref<PublicCatalog | null>(null);
  const error = ref<string | null>(null);
  let pending: Promise<PublicCatalog> | null = null;

  async function load(force = false) {
    if (data.value && !force) return data.value;
    pending ??= api
      .catalog()
      .then((catalog) => {
        data.value = catalog;
        error.value = null;
        return catalog;
      })
      .catch((err: Error) => {
        error.value = err.message;
        throw err;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  const settings = computed(() => data.value?.settings);
  const services = computed(() => data.value?.services ?? []);
  const addOns = computed(() => data.value?.addOns ?? []);
  const today = computed(() => data.value?.today ?? new Date().toISOString().slice(0, 10));

  const serviceById = (id?: string) => services.value.find((s) => s.id === id);
  const addOnById = (id: string) => addOns.value.find((a) => a.id === id);
  const servicesFor = (species?: Species) => (species ? services.value.filter((s) => s.species.includes(species)) : services.value);
  /** Add-ons that can be booked with this service for this pet (all three are optional filters). */
  const addOnsFor = (species?: Species, serviceId?: string, size?: PetSize) =>
    addOns.value.filter((a) => addOnApplies(a, serviceId, species, size));

  return { data, error, load, settings, services, addOns, today, serviceById, addOnById, servicesFor, addOnsFor };
});
