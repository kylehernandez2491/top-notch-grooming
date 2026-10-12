<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Pet, PetSize, Species, Temperament } from '@shared/types';
import { CAT_SIZE, PET_SIZES, TEMPERAMENTS } from '@shared/types';
import { SIZE_EXAMPLES, SIZE_HINTS, SIZE_LABELS, TEMPERAMENT_LABELS } from '@shared/format';
import type { PetInput } from '@/api/client';
import { resizeImage } from '@/utils/device';
import Icon from './Icon.vue';
import PetAvatar from './PetAvatar.vue';

const props = defineProps<{
  initial?: Pet;
  saving?: boolean;
  submitLabel: string;
  errors?: Record<string, string>;
}>();
const emit = defineEmits<{ submit: [input: PetInput]; cancel: [] }>();

const form = reactive({
  name: props.initial?.name ?? '',
  species: (props.initial?.species ?? 'dog') as Species,
  breed: props.initial?.breed ?? '',
  // New dogs start with no size so the owner has to choose one. Cats have one flat price and no size.
  size: (props.initial?.size ?? '') as PetSize | '',
  weightKg: props.initial?.weightKg?.toString() ?? '',
  birthday: props.initial?.birthday ?? '',
  sex: props.initial?.sex ?? 'unknown',
  coat: props.initial?.coat ?? '',
  temperament: (props.initial?.temperament ?? 'friendly') as Temperament,
  behaviorNotes: props.initial?.behaviorNotes ?? '',
  groomingPreferences: props.initial?.groomingPreferences ?? '',
});

const photo = ref<string | undefined>(props.initial?.photo);
const photoChanged = ref(false);
const photoError = ref('');
const triedSubmit = ref(false);

const isDog = computed(() => form.species === 'dog');
const sizeHint = computed(() => (form.size ? SIZE_HINTS[form.size] : "Your dog's size sets the price and how long the groom takes."));

// Switching to cat and back should make the owner choose a dog size again.
watch(
  () => form.species,
  (species) => {
    if (species === 'dog' && props.initial?.species !== 'dog') form.size = '';
  },
);

async function onPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  photoError.value = '';
  try {
    photo.value = await resizeImage(file);
    photoChanged.value = true;
  } catch {
    photoError.value = "That photo couldn't be read. Try a JPEG or PNG.";
  }
}

function removePhoto() {
  photo.value = undefined;
  photoChanged.value = true;
}

function submit() {
  triedSubmit.value = true;
  if (isDog.value && !form.size) {
    document.getElementById('pet-size')?.focus();
    return;
  }
  const weight = Number(form.weightKg);
  emit('submit', {
    name: form.name.trim(),
    species: form.species,
    breed: form.breed.trim(),
    size: isDog.value ? (form.size as PetSize) : CAT_SIZE,
    weightKg: form.weightKg && weight > 0 ? weight : undefined,
    birthday: form.birthday || undefined,
    sex: form.sex as Pet['sex'],
    coat: form.coat || undefined,
    temperament: form.temperament,
    behaviorNotes: form.behaviorNotes || undefined,
    groomingPreferences: form.groomingPreferences || undefined,
    // undefined keeps the current photo; null removes it
    photo: photoChanged.value ? (photo.value ?? null) : undefined,
  });
}

const err = (path: string) =>
  props.errors?.[path] ?? (path === 'size' && isDog.value && triedSubmit.value && !form.size ? "Choose your dog's size" : undefined);
</script>

<template>
  <form class="stack-lg" novalidate @submit.prevent="submit">
    <fieldset class="panel stack-lg">
      <legend class="legend">About</legend>

      <div class="photo-row">
        <PetAvatar :name="form.name || 'Pet'" :photo="photo" :size="88" />
        <div class="stack">
          <label class="btn btn-sm photo-btn">
            <Icon name="camera" :size="18" /> {{ photo ? 'Change photo' : 'Add a photo' }}
            <input type="file" accept="image/*" capture="environment" class="visually-hidden" @change="onPhoto" />
          </label>
          <button v-if="photo" type="button" class="btn btn-sm btn-ghost" @click="removePhoto">Remove photo</button>
          <span v-if="photoError" class="field-error">{{ photoError }}</span>
        </div>
      </div>

      <div class="field">
        <label for="pet-name">Name</label>
        <input id="pet-name" v-model="form.name" class="input" required autocomplete="off" :aria-invalid="!!err('name')" />
        <span v-if="err('name')" class="field-error">{{ err('name') }}</span>
      </div>

      <div class="field">
        <span class="field-label" id="species-label">Species</span>
        <div class="chips" role="radiogroup" aria-labelledby="species-label">
          <button
            v-for="s in ['dog', 'cat'] as Species[]"
            :key="s"
            type="button"
            role="radio"
            class="chip"
            :aria-checked="form.species === s ? 'true' : 'false'"
            @click="form.species = s"
          >
            {{ s === 'dog' ? 'Dog' : 'Cat' }}
          </button>
        </div>
      </div>

      <div v-if="isDog" class="field">
        <label for="pet-size">Dog size</label>
        <select
          id="pet-size"
          v-model="form.size"
          class="select"
          required
          :aria-invalid="!!err('size')"
          aria-describedby="pet-size-hint"
        >
          <option value="" disabled>Choose your dog's size</option>
          <option v-for="s in PET_SIZES" :key="s" :value="s">{{ SIZE_LABELS[s] }} — {{ SIZE_EXAMPLES[s] }}</option>
        </select>
        <span id="pet-size-hint" class="field-hint">{{ sizeHint }}</span>
        <span v-if="err('size')" class="field-error">{{ err('size') }}</span>
      </div>
      <p v-else class="note small">Cat Grooming is one price for every cat, so there's no size to choose.</p>

      <div class="grid-2">
        <div class="field">
          <label for="pet-breed">Breed</label>
          <input id="pet-breed" v-model="form.breed" class="input" placeholder="e.g. Cockapoo, mixed" autocomplete="off" />
        </div>
        <div class="field">
          <label for="pet-weight">Weight (kg)</label>
          <input id="pet-weight" v-model="form.weightKg" class="input" type="number" inputmode="decimal" min="0" max="150" step="0.1" />
        </div>
      </div>


      <div class="grid-2">
        <div class="field">
          <label for="pet-birthday">Birthday</label>
          <input id="pet-birthday" v-model="form.birthday" class="input" type="date" />
        </div>
        <div class="field">
          <label for="pet-sex">Sex</label>
          <select id="pet-sex" v-model="form.sex" class="select">
            <option value="unknown">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label for="pet-coat">Coat</label>
        <input id="pet-coat" v-model="form.coat" class="input" placeholder="e.g. curly, double coat, matted behind ears" />
      </div>
    </fieldset>

    <fieldset class="panel stack-lg">
      <legend class="legend">Temperament and handling</legend>
      <div class="chips" role="radiogroup" aria-label="Temperament">
        <button
          v-for="t in TEMPERAMENTS"
          :key="t"
          type="button"
          role="radio"
          class="chip"
          :aria-checked="form.temperament === t ? 'true' : 'false'"
          @click="form.temperament = t"
        >
          {{ TEMPERAMENT_LABELS[t] }}
        </button>
      </div>
      <div class="field">
        <label for="pet-behavior">Anything the groomer should know?</label>
        <textarea id="pet-behavior" v-model="form.behaviorNotes" class="textarea" placeholder="Hates the dryer on their face, loves chin scratches…" />
      </div>
      <div class="field">
        <label for="pet-prefs">Grooming preferences</label>
        <textarea id="pet-prefs" v-model="form.groomingPreferences" class="textarea" placeholder="Teddy-bear face, 1/2 inch on body, keep the tail fluffy" />
      </div>
    </fieldset>

    <div class="form-actions">
      <button type="button" class="btn" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="btn btn-primary" :disabled="saving || !form.name.trim()">
        {{ saving ? 'Saving…' : submitLabel }}
      </button>
    </div>
  </form>
</template>

<style scoped>
fieldset {
  margin: 0;
  min-width: 0;
}

.legend {
  float: left;
  width: 100%;
  margin-bottom: 4px;
  font-size: var(--step-1);
  font-weight: 760;
  font-variation-settings: 'CASL' 1;
}

.legend + * {
  clear: both;
}

.photo-row {
  display: flex;
  gap: 16px;
  align-items: center;
}

.photo-btn {
  cursor: pointer;
  width: fit-content;
}

.form-actions {
  position: sticky;
  bottom: calc(var(--nav-h) + var(--safe-b) + 8px);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter: blur(8px);
}

@media (min-width: 900px) {
  .form-actions {
    bottom: 16px;
  }
}
</style>
