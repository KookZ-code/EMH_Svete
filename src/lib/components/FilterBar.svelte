<script lang="ts">
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
    onFilter,
  }: Props = $props();

  let localStart = $state(startDate);
  let localEnd   = $state(endDate);
  let localAreas = $state<MachineArea[]>([...selectedAreas]);
  let localShift = $state<'all'|'day'|'night'>(shift);

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
      <label class="label">Start</label>
      <input class="input fb-date" type="date" bind:value={localStart} />
    </div>
    <div class="fb-group">
      <label class="label">End</label>
      <input class="input fb-date" type="date" bind:value={localEnd} />
    </div>
  {/if}

  {#if showAreaFilter}
    <div class="fb-group fb-areas">
      <div class="label-row">
        <label class="label">Area</label>
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
      <label class="label">Shift</label>
      <div class="shift-chips">
        {#each (['all','day','night'] as const) as s (s)}
          <button class="chip" class:active={localShift === s} onclick={() => (localShift = s)}>
            {s === 'all' ? 'All' : s === 'day' ? '☀️ Day' : '🌙 Night'}
          </button>
        {/each}
      </div>
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

  .fb-actions { display: flex; align-items: flex-end; }
</style>
