import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Appointment, BookedPet, OwnerDetails, Pet, WaitlistEntry } from '@shared/types';
import { ACTIVE_STATUSES } from '@shared/types';
import { api, type PetInput } from '@/api/client';

/**
 * Pet owners don't sign in. Their contact details and pets are saved in this browser's localStorage
 * and sent with each booking. Bookings live on the server, tied to this device by an HttpOnly cookie
 * the API sets on the first booking.
 */
const STORAGE_KEY = 'topnotch.owner.v1';
const MAX_PETS = 20;

interface Saved {
  profile: OwnerDetails | null;
  pets: Pet[];
}

function readSaved(): Saved {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Saved>;
    return { profile: data.profile ?? null, pets: Array.isArray(data.pets) ? data.pets : [] };
  } catch {
    return { profile: null, pets: [] };
  }
}

const byName = (list: Pet[]) => list.slice().sort((a, b) => a.name.localeCompare(b.name));

/** What a booking sends about a pet: everything but the photo and the device's own timestamps. */
export function bookedPet({ photo: _photo, createdAt: _c, updatedAt: _u, ...pet }: Pet): BookedPet {
  return pet;
}

/** This device's owner: saved details and pets, plus the bookings and waitlist entries made from here. */
export const useAccount = defineStore('account', () => {
  const saved = readSaved();
  const profile = ref<OwnerDetails | null>(saved.profile);
  const pets = ref<Pet[]>(byName(saved.pets));
  const appointments = ref<Appointment[]>([]);
  const waitlist = ref<WaitlistEntry[]>([]);
  const loaded = ref({ appointments: false, waitlist: false });

  const hasProfile = computed(() => !!profile.value);
  const firstName = computed(() => profile.value?.displayName.split(' ')[0] ?? '');

  /** Writes to storage first, so the screen never shows something that wasn't saved. */
  function persist(next: Saved) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      throw new Error("This browser couldn't save your details. Try a smaller pet photo, or turn off private browsing.");
    }
    profile.value = next.profile;
    pets.value = byName(next.pets);
  }

  function saveProfile(input: OwnerDetails) {
    persist({ profile: input, pets: pets.value });
    return input;
  }

  function savePet(input: PetInput, id?: string): Pet {
    const current = id ? pets.value.find((p) => p.id === id) : undefined;
    if (!current && pets.value.length >= MAX_PETS) throw new Error('That is a lot of pets! Please call us to add more.');
    const { photo, ...details } = input;
    const now = new Date().toISOString();
    const pet: Pet = {
      ...details,
      id: current?.id ?? crypto.randomUUID(),
      photo: photo === undefined ? current?.photo : (photo ?? undefined),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    persist({ profile: profile.value, pets: [...pets.value.filter((p) => p.id !== pet.id), pet] });
    return pet;
  }

  async function removePet(id: string) {
    const pet = pets.value.find((p) => p.id === id);
    if (!pet) return;
    await loadAppointments(true);
    const booked = upcoming.value.filter((a) => a.petId === id).length;
    if (booked) throw new Error(`${pet.name} has ${booked} upcoming appointment${booked === 1 ? '' : 's'}. Cancel them first.`);
    persist({ profile: profile.value, pets: pets.value.filter((p) => p.id !== id) });
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

  function upsertAppointment(appointment: Appointment) {
    const index = appointments.value.findIndex((a) => a.id === appointment.id);
    if (index >= 0) appointments.value.splice(index, 1, appointment);
    else appointments.value.push(appointment);
    appointments.value.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }

  /** "Download my data": everything this device holds, plus the bookings made from it. */
  async function exportData() {
    const visits = await loadAppointments(true).catch(() => appointments.value);
    return { exportedAt: new Date().toISOString(), profile: profile.value, pets: pets.value, appointments: visits };
  }

  /** "Forget me on this device": clears saved details, pets and the device key. Bookings stay with the shop. */
  async function forget() {
    await api.forgetDevice().catch(() => undefined);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage blocked: nothing was saved here anyway.
    }
    if ('caches' in window) await caches.delete('my-api').catch(() => undefined);
    profile.value = null;
    pets.value = [];
    appointments.value = [];
    waitlist.value = [];
    loaded.value = { appointments: false, waitlist: false };
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

  return {
    profile,
    pets,
    appointments,
    waitlist,
    loaded,
    hasProfile,
    firstName,
    saveProfile,
    savePet,
    removePet,
    loadAppointments,
    loadWaitlist,
    upsertAppointment,
    exportData,
    forget,
    upcoming,
    past,
    next,
    petById,
    lastVisitFor,
    rebookSuggestions,
  };
});
