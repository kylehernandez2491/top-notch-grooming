import type { AddOn, PetSize, Service, Species, Temperament } from './types';
import { CAT_SIZE, PET_SIZES } from './types';

/** "09:30" -> 570 */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 570 -> "09:30" */
export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addMinutes(hhmm: string, minutes: number): string {
  return fromMinutes(toMinutes(hhmm) + minutes);
}

export function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** "13:15" -> "1:15 PM" */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Prices are in Philippine pesos: 380 -> "₱380". */
export const CURRENCY = 'PHP';
export const CURRENCY_SYMBOL = '₱';

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** 750, 850 -> "₱750–₱850"; equal ends -> "₱750". */
export function formatPriceRange(min: number, max?: number): string {
  return max === undefined || max <= min ? formatMoney(min) : `${formatMoney(min)}–${formatMoney(max)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Dog sizes as the shop's price list names them. */
export const SIZE_LABELS: Record<PetSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  husky_chow: 'Husky / Chow Chow',
};

/** Example breeds shown under each size on the price menu. */
export const SIZE_EXAMPLES: Record<PetSize, string> = {
  small: 'e.g. Shih Tzu, Pomeranian, Maltese',
  medium: 'e.g. Beagle, Corgi, Cocker Spaniel',
  large: 'e.g. Golden Retriever, Labrador',
  husky_chow: 'and similar thick double coats',
};

export const SIZE_HINTS: Record<PetSize, string> = {
  small: 'Up to about 10 kg, e.g. Shih Tzu, Pomeranian, Maltese, Chihuahua, Toy Poodle.',
  medium: 'About 10 to 25 kg, e.g. Beagle, Corgi, Cocker Spaniel, Aspin.',
  large: 'Over 25 kg, e.g. Golden Retriever, Labrador, German Shepherd.',
  husky_chow: 'Huskies, Chow Chows, Samoyeds, Malamutes and similar thick double coats.',
};

/** For use mid-sentence: "medium dog", "Husky / Chow Chow", or "cat". */
export function sizePhrase(size: PetSize, species: Species = 'dog'): string {
  if (species === 'cat') return 'cat';
  return size === 'husky_chow' ? SIZE_LABELS[size] : `${SIZE_LABELS[size].toLowerCase()} dog`;
}

/** Sizes a service is priced for: every dog size, or the single cat size for cat-only services. */
export function sizesFor(service: Pick<Service, 'species'>): readonly PetSize[] {
  return service.species.includes('dog') ? PET_SIZES : [CAT_SIZE];
}
export const SPECIES_LABELS: Record<Species, string> = { dog: 'Dog', cat: 'Cat' };

export const TEMPERAMENT_LABELS: Record<Temperament, string> = {
  calm: 'Calm',
  friendly: 'Friendly & wiggly',
  nervous: 'Nervous / anxious',
  reactive: 'Reactive — handle with care',
  senior: 'Senior — needs gentle handling',
};

export function serviceDuration(service: Service, addOns: AddOn[], size: PetSize): number {
  return service.durationBySize[size] + addOns.reduce((sum, a) => sum + a.durationMinutes, 0);
}

/** Price for one size: a single amount, or a range when it depends on coat volume. */
export function sizePrice(service: Service, size: PetSize): { min: number; max: number; note?: string } {
  const min = service.priceBySize[size];
  const max = Math.max(min, service.priceMaxBySize?.[size] ?? min);
  return { min, max, note: service.priceNoteBySize?.[size] || undefined };
}

/** Lower end of the estimate (the whole estimate when there is no range). */
export function servicePrice(service: Service, addOns: AddOn[], size: PetSize): number {
  return sizePrice(service, size).min + addOns.reduce((sum, a) => sum + a.price, 0);
}

/** Upper end of the estimate. */
export function servicePriceMax(service: Service, addOns: AddOn[], size: PetSize): number {
  return sizePrice(service, size).max + addOns.reduce((sum, a) => sum + a.price, 0);
}

/** "₱380" or "₱750–₱850" for one size, including any chosen add-ons. */
export function estimateText(service: Service, addOns: AddOn[], size: PetSize): string {
  return formatPriceRange(servicePrice(service, addOns, size), servicePriceMax(service, addOns, size));
}

/** Whether an add-on can be booked with this service, species and size. */
export function addOnApplies(addOn: AddOn, serviceId: string | undefined, species: Species | undefined, size: PetSize | undefined): boolean {
  if (species && !addOn.species.includes(species)) return false;
  if (serviceId && addOn.serviceIds?.length && !addOn.serviceIds.includes(serviceId)) return false;
  if (size && addOn.sizes?.length && !addOn.sizes.includes(size)) return false;
  return true;
}

/** "from ₱380" across the sizes a service is priced for. */
export function priceRange(service: Service): string {
  const sizes = sizesFor(service);
  const min = Math.min(...sizes.map((s) => sizePrice(service, s).min));
  const max = Math.max(...sizes.map((s) => sizePrice(service, s).max));
  return formatPriceRange(min, max);
}

export function durationRange(service: Service): string {
  const mins = sizesFor(service).map((s) => service.durationBySize[s]);
  const min = Math.min(...mins);
  const max = Math.max(...mins);
  return min === max ? formatDuration(min) : `${formatDuration(min)}–${formatDuration(max)}`;
}

/** Morning ends at noon; used for waitlist windows and slot grouping. */
export function partOfDay(hhmm: string): 'morning' | 'afternoon' | 'evening' {
  const m = toMinutes(hhmm);
  if (m < 12 * 60) return 'morning';
  if (m < 17 * 60) return 'afternoon';
  return 'evening';
}
