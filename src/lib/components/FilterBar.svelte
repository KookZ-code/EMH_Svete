<script lang="ts">
  import { untrack } from 'svelte';
  import type { MachineArea } from '$types';

  const ALL_AREAS: MachineArea[] = ['BG','SAW','DA','WB','MOLD','PLATE','MARK','SAW_QFN','TF','ISO','FS'];

  interface Props {
    startDate?: string;
    endDate?: string;
    selectedAreas?: MachineArea[];
    shift?: 'all' | 'day' | 'night';
    showAreaFilter?: boolean;
    showShiftFilter?: boolean;
    showDateFilter?: boolean;
    shiftVariant?: 'chips' | 'dropdown';
    onFilter?: (f: {
      start: string;
      end: string;
      areas: MachineArea[];
      shift: 'all' | 'day' | 'night';
    }) => void;
  }

  let {
    startDate = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10); })(),
    endDate   = new Date().toISOString().slice(0,10),
    selectedAreas = [...ALL_AREAS],
    shift = 'all',
    showAreaFilter = true,
    showShiftFilter = true,
    showDateFilter = true,
    shiftVariant = 'chips',
    onFilter,
  }: Props = $props();

  // untrack: ต้องการ snapshot ตอน init เท่านั้น ไม่ sync ตาม prop ที่เปลี่ยน
  let localStart = $state(untrack(() => startDate));
  let localEnd   = $state(untrack(() => endDate));
  let localAreas = $state<MachineArea[]>(untrack(() => [...selectedAreas]));
  let localShift = $state<'all'|'day'|'night'>(untrack(() => shift));

  function toggleArea(a: MachineArea) {
    if (localAreas.includes(a)) {
      localAreas = localAreas.filter(x => x !== a);
    } else {
      localAreas = [...localAreas, a];
    }
  }

  function selectAll() { localAreas = [...ALL_AREAS]; }
  function clearAll()  { localAreas = []; }

  function apply() {
    onFilter?.({ start: localStart, end: localEnd, areas: localAreas, shift: localShift });
  }
</script>

<div class="filter-bar">
  {#if showDateFilter}
    <div class="fb-group">
      <label class="label" for="fb-start">Start</label>
      <input id="fb-start" class="input fb-date" type="date" bind:value={localStart} />
    </div>
    <div class="fb-group">
      <label class="label" for="fb-end">End</label>
      <input id="fb-end" class="input fb-date" type="date" bind:value={localEnd} />
    </div>
  {/if}

  {#if showAreaFilter}
    <div class="fb-group fb-areas">
      <div class="label-row">
        <span class="label">Area</span>
        <button class="btn btn-ghost btn-sm" onclick={selectAll}>All</button>
        <button class="btn btn-ghost btn-sm" onclick={clearAll}>None</button>
      </div>
      <div class="area-chips">
        {#each ALL_AREAS as area (area)}
          <button
            class="chip"
            class:active={localAreas.includes(area)}
            onclick={() => toggleArea(area)}
          >
            {area}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if showShiftFilter}
    <div class="fb-group">
      <label class="label" for="fb-shift">Shift</label>
      {#if shiftVariant === 'dropdown'}
        <select id="fb-shift" class="input fb-shift-select" bind:value={localShift}>
          <option value="all">All Shifts</option>
          <option value="day">☀️ Day</option>
          <option value="night">🌙 Night</option>
        </select>
      {:else}
        <div class="shift-chips">
          {#each (['all','day','night'] as const) as s (s)}
            <button class="chip" class:active={localShift === s} onclick={() => (localShift = s)}>
              {#if s === 'all'}
                All
              {:else if s === 'day'}
                <span role="img" aria-label="Day">☀️</span> Day
              {:else}
                <span role="img" aria-label="Night">🌙</span> Night
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="fb-actions">
    <button class="btn btn-solid" onclick={apply}>Apply</button>
  </div>
</div>

<style>
  .filter-bar {
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm);
    padding: 12px 16px;
    margin-bottom: var(--gutter);
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-end;
  }

  .fb-group { display: flex; flex-direction: column; gap: 6px; }

  .fb-date { width: 140px; }

  .label-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .area-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .shift-chips { display: flex; gap: 4px; }
  .fb-shift-select { width: 140px; }

  .fb-actions { display: flex; align-items: flex-end; }
</style>
