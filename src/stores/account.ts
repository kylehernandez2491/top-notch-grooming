import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Appointment, Pet, WaitlistEntry } from '@shared/types';
import { ACTIVE_STATUSES } from '@shared/types';
import { api, type PetInput } from '@/api/client';

/** The signed-in owner's pets, appointments and waitlist entries. */
export const useAccount = defineStore('account', () => {
  const pets = ref<Pet[]>([]);
  const appointments = ref<Appointment[]>([]);
  const waitlist = ref<WaitlistEntry[]>([]);
  const loaded = ref({ pets: false, appointments: false, waitlist: false });

  async function loadPets(force = false) {
    if (loaded.value.pets && !force) return pets.value;
    pets.value = await api.pets();
    loaded.value.pets = true;
    return pets.value;
  }

  async function loadAppointments(force = false) {
    if (loaded.value.appointments && !force) return appointments.value;
    appointments.value = await api.appointments();
    loaded.value.appointments = true;
    return appointments.value;
  }

  async function loadWaitlist(force = false) {
    if (loaded.value.waitlist && !force) return waitlist.value;
    waitlist.value = await api.waitlist();
    loaded.value.waitlist = true;
    return waitlist.value;
  }

  async function savePet(input: PetInput, id?: string) {
    const pet = id ? await api.updatePet(id, input) : await api.createPet(input);
    const index = pets.value.findIndex((p) => p.id === pet.id);
    if (index >= 0) pets.value.splice(index, 1, pet);
    else pets.value.push(pet);
    pets.value.sort((a, b) => a.name.localeCompare(b.name));
    return pet;
  }

  async function removePet(id: string) {
    await api.deletePet(id);
    pets.value = pets.value.filter((p) => p.id !== id);
  }

  function upsertAppointment(appointment: Appointment) {
    const index = appointments.value.findIndex((a) => a.id === appointment.id);
    if (index >= 0) appointments.value.splice(index, 1, appointment);
    else appointments.value.push(appointment);
    appointments.value.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }

  const nowIso = () => new Date().toISOString();
  const upcoming = computed(() => appointments.value.filter((a) => ACTIVE_STATUSES.includes(a.status) && a.endUtc > nowIso()));
  const past = computed(() =>
    appointments.value.filter((a) => !ACTIVE_STATUSES.includes(a.status) || a.endUtc <= nowIso()).slice().reverse(),
  );
  const next = computed(() => upcoming.value[0]);
  const petById = (id?: string) => pets.value.find((p) => p.id === id);
  const lastVisitFor = (petId: string) => past.value.find((a) => a.petId === petId && a.status === 'completed');
  /** Most recent completed visit per pet — powers one-tap "Book again". */
  const rebookSuggestions = computed(() => {
    const seen = new Set<string>();
    return past.value.filter((a) => {
      if (a.status !== 'completed' || seen.has(a.petId) || !petById(a.petId)) return false;
      if (upcoming.value.some((u) => u.petId === a.petId)) return false;
      seen.add(a.petId);
      return true;
    });
  });

  function reset() {
    pets.value = [];
    appointments.value = [];
    waitlist.value = [];
    loaded.value = { pets: false, appointments: false, waitlist: false };
  }

  return {
    pets,
    appointments,
    waitlist,
    loaded,
    loadPets,
    loadAppointments,
    loadWaitlist,
    savePet,
    removePet,
    upsertAppointment,
    upcoming,
    past,
    next,
    petById,
    lastVisitFor,
    rebookSuggestions,
    reset,
  };
});
