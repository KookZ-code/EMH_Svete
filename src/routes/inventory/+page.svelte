<script lang="ts">
  // Inventory — Machine Master List
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EChart from '$lib/components/EChart.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import { inventoryApi } from '$lib/utils/api';
  import type { InventoryMachine, InventoryKpi, MachineArea } from '$types';

  const ALL_AREAS: MachineArea[] = ['BG','SAW','DA','WB','MOLD','PLATE','MARK','SAW_QFN','TF','ISO','FS'];

  let allMachines  = $state<InventoryMachine[]>([]);
  let kpi          = $state<InventoryKpi>({ total_machines:0, key_machines:0, areas:0, avg_age_years:0 });
  let filterArea   = $state<MachineArea[]>([...ALL_AREAS]);
  let filterKey    = $state(false);
  let filterSearch = $state('');
  let loading      = $state(true);
  let error        = $state<string | null>(null);

  async function loadData() {
    loading = true;
    error = null;
    const res = await inventoryApi.all();
    if (res.error) { error = res.error.message; loading = false; return; }
    if (res.data) {
      allMachines = res.data.machines;
      kpi = res.data.kpi;
    }
    loading = false;
  }

  // Client-side filtering
  const displayMachines = $derived.by(() => {
    return allMachines.filter(m => {
      if (!filterArea.includes(m.area)) return false;
      if (filterKey && !m.is_key) return false;
      if (filterSearch.trim()) {
        const q = filterSearch.toLowerCase();
        return m.code_machine.toLowerCase().includes(q) ||
               m.model.toLowerCase().includes(q) ||
               m.manufacturer.toLowerCase().includes(q);
      }
      return true;
    });
  });

  // Unique manufacturers from loaded data
  const manufacturers = $derived([...new Set(allMachines.map(m => m.manufacturer).filter(Boolean))]);

  // ── Charts ────────────────────────────────────────────────────────────────
  const byAreaOption = $derived({
    tooltip: { trigger: 'axis' },
    grid: { top: 10, left: 20, right: 20, bottom: 30, containLabel: true },
    xAxis: { type: 'category', data: ALL_AREAS, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: ALL_AREAS.map(a => allMachines.filter(m => m.area === a).length),
      itemStyle: { color: '#1C355E' },
      label: { show: true, position: 'top', fontSize: 10 },
      barMaxWidth: 40,
    }],
  });

  const mfgPieOption = $derived({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { orient: 'vertical', right: 10, top: 'center', textStyle: { fontSize: 10 } },
    series: [{
      type: 'pie', radius: ['40%','65%'], center: ['38%','50%'],
      label: { show: false },
      data: manufacturers.map((mfr, i) => ({
        name: mfr,
        value: allMachines.filter(m => m.manufacturer === mfr).length,
        itemStyle: { color: ['#1C355E','#157EAC','#41B6E6','#F68D2E','#6CC24A','#DA291C','#702076','#FD7F20'][i%8] },
      })).filter(d => d.value > 0),
    }],
  });

  const ageOption = $derived({
    tooltip: { trigger: 'axis' },
    grid: { top: 10, left: 40, right: 20, bottom: 30 },
    xAxis: { type: 'category', data: Array.from({length:16},(_,i)=>String(2010+i)), axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: Array.from({length:16},(_,i)=>allMachines.filter(m=>m.year_install===2010+i).length),
      itemStyle: { color: '#41B6E6' },
      barMaxWidth: 30,
    }],
  });

  const cols = [
    { key:'code_machine', label:'Machine', width:'100px', sortable:true },
    { key:'area',         label:'Area',    width:'60px',  sortable:true },
    { key:'model',        label:'Model',   sortable:true },
    { key:'manufacturer', label:'Mfr.',    sortable:true },
    { key:'year_install', label:'Year',    width:'65px', align:'center' as const, sortable:true, format:(v:unknown): string=>String(v??'—') },
    { key:'is_key',  label:'KEY',  width:'50px', align:'center' as const, renderHtml:(v:unknown)=>v?'<span style="color:#F68D2E;font-weight:700">KEY</span>':'' },
    { key:'is_auto', label:'Auto', width:'50px', align:'center' as const, renderHtml:(v:unknown)=>v?'✓':'' },
    { key:'serial_no',    label:'Serial', width:'120px', format:(v:unknown): string=>String(v??'—') },
  ];

  function toggleArea(a: MachineArea) {
    if (filterArea.includes(a)) filterArea = filterArea.filter(x=>x!==a);
    else filterArea = [...filterArea, a];
  }

  onMount(loadData);
</script>

<svelte:head><title>Inventory — EMH Dashboard</title></svelte:head>

<PageHeader title="Machine Inventory" subtitle="Equipment master list and asset overview" />

{#if error}
  <div class="state-banner error">⚠ {error}</div>
{:else if loading}
  <div class="state-banner loading">Loading…</div>
{/if}

<div class="inv-kpis" style="margin-bottom: var(--gutter);">
  <div class="inv-kpi"><div class="ik-val">{kpi.total_machines}</div><div class="ik-lbl">Total Machines</div></div>
  <div class="inv-kpi"><div class="ik-val" style="color:var(--color-accent-orange)">{kpi.key_machines}</div><div class="ik-lbl">KEY Machines</div></div>
  <div class="inv-kpi"><div class="ik-val">{kpi.areas}</div><div class="ik-lbl">Areas</div></div>
  <div class="inv-kpi"><div class="ik-val">{kpi.avg_age_years > 0 ? kpi.avg_age_years.toFixed(1) + 'yr' : '—'}</div><div class="ik-lbl">Avg Age</div></div>
</div>

<div class="grid-3" style="margin-bottom: var(--gutter);">
  <div class="chart-card"><div class="card-title">Machines by Area</div><EChart option={byAreaOption} height="200px" /></div>
  <div class="chart-card"><div class="card-title">By Manufacturer</div><EChart option={mfgPieOption} height="200px" /></div>
  <div class="chart-card"><div class="card-title">Age Distribution</div><EChart option={ageOption} height="200px" /></div>
</div>

<div class="chart-card">
  <div class="inv-filters">
    <div class="filter-group">
      <span class="filter-lbl">Area</span>
      {#each ALL_AREAS as a (a)}
        <button class="chip" class:active={filterArea.includes(a)} onclick={()=>toggleArea(a)}>{a}</button>
      {/each}
    </div>
    <div class="filter-group">
      <button class="chip" class:active={filterKey} onclick={()=>(filterKey=!filterKey)}>KEY only</button>
    </div>
    <div class="filter-group">
      <input class="input inv-search" type="search" placeholder="Search machine / model…" bind:value={filterSearch} />
    </div>
    <span class="inv-count">{displayMachines.length} / {allMachines.length}</span>
  </div>
  <DataTable columns={cols} rows={displayMachines} rowKey={r=>r.code_machine} compact pageSize={20} />
</div>

<style>
  .state-banner { padding: 10px 16px; border-radius: var(--r-sm); font-size: 13px; font-weight: 600; margin-bottom: var(--gutter); }
  .state-banner.error   { background: #FFF0F0; border: 1px solid var(--status-down); color: var(--status-down); }
  .state-banner.loading { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); }

  .inv-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  @media (max-width: 700px) { .inv-kpis { grid-template-columns: repeat(2, 1fr); } }
  .inv-kpi { background:var(--color-surface); border:1px solid var(--color-border-strong); border-radius:var(--r-sm); padding:16px; text-align:center; }
  .ik-val { font-size:30px; font-weight:700; color:var(--color-primary); }
  .ik-lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); margin-top:4px; }

  .card-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); margin-bottom:8px; }

  .inv-filters { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding-bottom:12px; border-bottom:1px solid var(--color-border); margin-bottom:4px; }
  .filter-group { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .filter-lbl { font-size:11px; font-weight:700; text-transform:uppercase; color:var(--color-text-muted); }
  .inv-search { width:220px; }
  .inv-count { font-size:12px; color:var(--color-text-muted); white-space:nowrap; margin-left:auto; }
</style>
