<script lang="ts">
  // Live Board — Shop Floor TV Display
  import { onMount } from 'svelte';
  import { liveApi } from '$lib/utils/api';
  import { statusConfig, fmtElapsed } from '$lib/config/machine_status';
  import WbFloorMap from '$lib/components/WbFloorMap.svelte';
  import type { LiveMachine, MachineArea } from '$types';

  const ALL_AREAS: MachineArea[] = ['BG','SAW','DA','WB','MOLD','PLATE','MARK','SAW_QFN','TF','ISO','FS'];

  let machines         = $state<LiveMachine[]>([]);
  let selectedStatuses = $state<string[]>([]);          // [] = show all (no status filter)
  let selectedAreas    = $state<MachineArea[]>([...ALL_AREAS]);
  let clock            = $state('');
  let lastRefresh      = $state('');
  let loading          = $state(true);
  let error            = $state<string | null>(null);
  let highlightCode    = $state<string | null>(null);

  const ALL_STATUSES = Object.keys(statusConfig);

  async function loadData() {
    const res = await liveApi.machines();
    if (res.error) { error = res.error.message; }
    else if (res.data) { machines = res.data; error = null; }
    loading = false;
    lastRefresh = new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
  }

  const statusRank: Record<string, number> = { 'Waiting': 0, 'M/C Down': 1, 'Idle': 2, 'PM': 3, 'Setup': 4, 'Convert': 5, 'Lost Time': 6, 'Other': 7, 'Running': 8 };

  const filtered = $derived.by(() => {
    const list = machines.filter(m => {
      const areaOk   = selectedAreas.includes(m.area);
      const statusOk = selectedStatuses.length === 0 || selectedStatuses.includes(m.status);
      return areaOk && statusOk;
    });
    // Waiting first (elapsed desc), then M/C Down (elapsed desc), then rest
    return list.sort((a, b) => {
      const ra = statusRank[a.status] ?? 6;
      const rb = statusRank[b.status] ?? 6;
      if (ra !== rb) return ra - rb;
      return b.elapsed_min - a.elapsed_min;
    });
  });

  const downCount    = $derived(machines.filter(m => m.status === 'M/C Down').length);
  const waitingCount = $derived(machines.filter(m => m.status === 'Waiting').length);
  const showAlert    = $derived(downCount > 5 || waitingCount > 3);

  function toggleStatus(s: string) {
    if (selectedStatuses.includes(s)) selectedStatuses = selectedStatuses.filter(x => x !== s);
    else selectedStatuses = [...selectedStatuses, s];
  }

  function toggleArea(a: MachineArea) {
    if (selectedAreas.includes(a)) selectedAreas = selectedAreas.filter(x => x !== a);
    else selectedAreas = [...selectedAreas, a];
  }

  function updateClock() {
    clock = new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  onMount(() => {
    updateClock();
    loadData();
    const clockTimer   = setInterval(updateClock, 1000);
    const refreshTimer = setInterval(loadData, 60_000);
    return () => { clearInterval(clockTimer); clearInterval(refreshTimer); };
  });
</script>

<svelte:head><title>Live Board — EMH Dashboard</title></svelte:head>

{#if showAlert}
  <div class="alert-banner">
    ⚠️ ALERT — {downCount} machine{downCount !== 1 ? 's' : ''} DOWN &nbsp;·&nbsp;
    {waitingCount} waiting for tech
  </div>
{/if}

{#if error}
  <div class="state-err">⚠ {error}</div>
{/if}

<div class="live-header">
  <div class="live-title">
    <span class="live-dot"></span>
    Live Board
    <span class="live-clock">{clock}</span>
  </div>

  <div class="live-controls">
    <div class="ctrl-group">
      <span class="ctrl-label">Status</span>
      <button class="chip chip-sm" class:active={selectedStatuses.length === 0}
              onclick={() => { selectedStatuses = []; }}>All</button>
      <button class="chip chip-sm"
              onclick={() => { selectedStatuses = [...ALL_STATUSES]; }}>None</button>
      {#each Object.entries(statusConfig) as [s, cfg] (s)}
        <button
          class="chip"
          class:active={selectedStatuses.includes(s)}
          style:background-color={selectedStatuses.includes(s) ? cfg.bg : ''}
          style:color={selectedStatuses.includes(s) ? cfg.text : ''}
          onclick={() => toggleStatus(s)}
        >{cfg.label}</button>
      {/each}
    </div>
    <div class="ctrl-group">
      <span class="ctrl-label">Area</span>
      <button class="chip chip-sm" class:active={selectedAreas.length === ALL_AREAS.length}
              onclick={() => { selectedAreas = [...ALL_AREAS]; }}>All</button>
      <button class="chip chip-sm" class:active={selectedAreas.length === 0}
              onclick={() => { selectedAreas = []; }}>None</button>
      {#each ALL_AREAS as a (a)}
        <button class="chip" class:active={selectedAreas.includes(a)} onclick={() => toggleArea(a)}>
          {a}
        </button>
      {/each}
    </div>
  </div>

  <div class="live-meta">
    <span>{filtered.length} machines shown</span>
    <span class="muted">{loading ? 'Loading…' : `Refresh: ${lastRefresh}`}</span>
  </div>
</div>

<div class="machine-grid" id="machine-grid">
  {#each filtered as m (m.code_machine)}
    {@const cfg = statusConfig[m.status] ?? statusConfig['Other']}
    <div
      class="machine-tile"
      class:highlight={highlightCode === m.code_machine}
      style:background-color={cfg.bg}
      style:color={cfg.text}
      title="{m.code_machine} — {m.status}{m.symptom ? ': ' + m.symptom : ''}"
    >
      <div class="tile-code">
        {m.code_machine}
        {#if m.is_key}<span class="tile-key">KEY</span>{/if}
      </div>
      <div class="tile-status">{cfg.label}</div>
      {#if m.status !== 'Running'}
        <div class="tile-elapsed">{fmtElapsed(m.elapsed_min)}</div>
        {#if m.tech_name}
          <div class="tile-tech">{m.tech_name}</div>
        {:else}
          <div class="tile-tech no-tech">No Tech</div>
        {/if}
      {/if}
    </div>
  {/each}
</div>

{#if selectedAreas.includes('WB')}
  <WbFloorMap
    machines={machines.filter((m) => m.area === 'WB')}
    onMachineClick={(code) => {
      highlightCode = code;
      document.getElementById('machine-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }}
  />
{/if}

<style>
  .state-err {
    background: #FFF0F0; border: 1px solid #CC0000; color: #CC0000;
    padding: 8px 16px; border-radius: var(--r-sm); margin-bottom: 12px;
    font-size: 13px; font-weight: 600;
  }

  .alert-banner {
    background: var(--status-down); color: #fff; text-align: center;
    font-size: 15px; font-weight: 700; padding: 10px;
    border-radius: var(--r-sm); margin-bottom: 12px;
    animation: pulse 2s infinite;
  }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.8} }

  .live-header {
    display: flex; flex-wrap: wrap; align-items: center; gap: 16px;
    background: var(--color-surface); border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm); padding: 12px 16px; margin-bottom: 16px;
  }

  .live-title {
    font-size: 20px; font-weight: 700; color: var(--color-text-heading);
    display: flex; align-items: center; gap: 10px; white-space: nowrap;
  }

  .live-dot { width:10px; height:10px; background:var(--status-running); border-radius:50%; animation:blink 1.5s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

  .live-clock { font-size: 16px; font-weight: 400; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }

  .live-controls { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .ctrl-group { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .ctrl-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); white-space: nowrap; margin-right: 2px; min-width: 46px; }
  .chip-sm { font-size: 10px; padding: 2px 7px; opacity: 0.75; }
  .chip-sm.active { opacity: 1; }

  .live-meta { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--color-text-muted); text-align: right; white-space: nowrap; }
  .muted { color: var(--color-text-disabled); }

  .machine-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }

  .machine-tile { border-radius: var(--r-sm); padding: 10px; min-height: 90px; display: flex; flex-direction: column; gap: 4px; cursor: default; transition: opacity 0.15s, transform 0.15s; }
  .machine-tile:hover { opacity: 0.9; transform: scale(1.02); }
  .machine-tile.highlight { outline: 3px solid #1A3A5C; outline-offset: 2px; animation: hl-pulse 1s ease-in-out 3; }
  @keyframes hl-pulse { 0%,100%{ outline-color: #1A3A5C; } 50%{ outline-color: #4A90D9; } }

  .tile-code { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 4px; }
  .tile-key { font-size: 9px; font-weight: 700; background: rgba(255,255,255,0.3); border-radius: 3px; padding: 1px 4px; }
  .tile-status { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .tile-elapsed { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: auto; }
  .tile-tech { font-size: 11px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile-tech.no-tech { opacity: 0.6; font-style: italic; }
</style>
