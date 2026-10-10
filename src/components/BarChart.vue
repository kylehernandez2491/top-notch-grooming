<script setup lang="ts">
/**
 * Single-series column or bar chart in plain HTML/CSS. Thin marks (<=24px) with 4px rounded data
 * ends, values labelled selectively (the peak), a hover/focus tooltip on every mark, and a table view.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    items: { label: string; value: number; display?: string; detail?: string }[];
    orientation?: 'column' | 'bar';
    unit?: string;
  }>(),
  { orientation: 'column', unit: '' },
);

const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
const peak = computed(() => props.items.reduce((best, i) => (i.value > best.value ? i : best), props.items[0] ?? { label: '', value: 0 }));
const pct = (v: number) => `${(v / max.value) * 100}%`;
const show = (i: { value: number; display?: string }) => i.display ?? `${i.value}${props.unit}`;
const empty = computed(() => props.items.every((i) => i.value === 0));
</script>

<template>
  <figure class="chart">
    <figcaption class="chart-title">{{ title }}</figcaption>
    <p v-if="empty" class="muted small">No data for this period yet.</p>

    <div v-else-if="orientation === 'column'" class="cols" role="list">
      <div v-for="item in items" :key="item.label" class="col" role="listitem">
        <div class="col-track">
          <div
            class="col-bar"
            :style="{ height: pct(item.value) }"
            tabindex="0"
            :aria-label="`${item.label}: ${show(item)}`"
          >
            <span v-if="item === peak" class="cap-label tabular" aria-hidden="true">{{ show(item) }}</span>
            <span class="tip" role="tooltip">
              <strong>{{ item.label }}</strong> {{ show(item) }}<template v-if="item.detail"><br />{{ item.detail }}</template>
            </span>
          </div>
        </div>
        <span class="col-label">{{ item.label }}</span>
      </div>
    </div>

    <div v-else class="bars" role="list">
      <div v-for="item in items" :key="item.label" class="bar-row" role="listitem">
        <span class="bar-label">{{ item.label }}</span>
        <div class="bar-track">
          <div class="bar" :style="{ width: `calc((100% - 72px) * ${item.value / max})` }" tabindex="0" :aria-label="`${item.label}: ${show(item)}`">
            <span class="tip" role="tooltip">
              <strong>{{ item.label }}</strong> {{ show(item) }}<template v-if="item.detail"><br />{{ item.detail }}</template>
            </span>
          </div>
          <span class="tip-label tabular">{{ show(item) }}</span>
        </div>
      </div>
    </div>

    <details v-if="!empty" class="table-view">
      <summary class="small">Show as table</summary>
      <table>
        <thead>
          <tr><th scope="col">Item</th><th scope="col">Value</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.label">
            <th scope="row">{{ item.label }}</th>
            <td class="tabular">{{ show(item) }}{{ item.detail ? `, ${item.detail}` : '' }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
  display: grid;
  gap: 14px;
}

.chart-title {
  font-weight: 700;
  font-variation-settings: 'CASL' 1;
}

.cols {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 200px;
  /* room for the peak's cap label, which sits above the tallest bar */
  padding-top: 24px;
  border-bottom: 1px solid var(--grout);
}

.col {
  flex: 1;
  display: grid;
  grid-template-rows: 1fr auto;
  min-width: 0;
}

.col-track {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}

.col-bar {
  position: relative;
  width: min(24px, 70%);
  min-height: 2px;
  border-radius: 4px 4px 0 0;
  background: var(--chart);
  outline-offset: 2px;
}

.cap-label {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--step--1);
  font-weight: 640;
  white-space: nowrap;
  color: var(--ink);
}

.col-label {
  padding-top: 6px;
  text-align: center;
  font-size: 0.72rem;
  color: var(--ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bars {
  display: grid;
  gap: 10px;
}

.bar-row {
  display: grid;
  grid-template-columns: minmax(90px, 34%) 1fr;
  gap: 12px;
  align-items: center;
}

.bar-label {
  font-size: var(--step--1);
  font-weight: 560;
}

.bar-track {
  display: flex;
  align-items: center;
  gap: 8px;
  border-left: 1px solid var(--grout);
  min-width: 0;
}

.bar {
  position: relative;
  height: 20px;
  min-width: 2px;
  border-radius: 0 4px 4px 0;
  background: var(--chart);
  flex: none;
}

.tip-label {
  font-size: var(--step--1);
  font-weight: 600;
  white-space: nowrap;
}

/* Hover/focus tooltip on every mark */
.tip {
  position: absolute;
  z-index: 4;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--ink);
  color: var(--paper);
  font-size: var(--step--1);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s;
}

.col-bar:hover .tip,
.col-bar:focus-visible .tip,
.bar:hover .tip,
.bar:focus-visible .tip {
  opacity: 1;
}

.table-view summary {
  cursor: pointer;
  color: var(--ink-soft);
}

.table-view table {
  margin-top: 8px;
  width: 100%;
  border-collapse: collapse;
  font-size: var(--step--1);
}

.table-view th,
.table-view td {
  text-align: left;
  padding: 6px 4px;
  border-bottom: 1px solid var(--grout);
}
</style>
