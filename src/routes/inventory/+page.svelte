<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EChart     from '$lib/components/EChart.svelte';
  import type { EChartClickParams } from '$lib/components/EChart.svelte';
  import DataTable  from '$lib/components/DataTable.svelte';
  import { inventoryApi } from '$lib/utils/api';
  import type { InventoryMachine, InventoryKpi, HealthStatus, MachineArea } from '$types';

  interface ModelRow {
    model: string; manufacturer: string; count: number;
    areasStr: string; critical: number; warning: number; monitor: number;
    avgAge: number; avgMttr: number;
  }

  const ALL_AREAS: MachineArea[] = ['BG','SAW','DA','WB','MOLD','PLATE','MARK','SAW_QFN','TF','ISO','FS'];
  const CURRENT_YEAR = 2026;

  // ── State ──────────────────────────────────────────────────────────────────
  let allMachines = $state<InventoryMachine[]>([]);
  let kpi         = $state<InventoryKpi>({ total_machines:0, key_machines:0, areas:0, models:0 });
  let loading     = $state(true);
  let error       = $state<string|null>(null);
  let viewMode    = $state<'machines'|'models'>('machines');

  // Filters
  let filterArea   = $state<MachineArea[]>([...ALL_AREAS]);
  let filterModels = $state<string[]>([]);
  let filterMfgs   = $state<string[]>([]);
  let filterKey    = $state(false);
  let filterAuto   = $state(false);
  let filterGold   = $state(false);
  let filterSearch = $state('');
  let filterHealth = $state<HealthStatus|'all'>('all');

  async function loadData() {
    loading = true; error = null;
    const res = await inventoryApi.all();
    if (res.error) { error = res.error.message; loading = false; return; }
    allMachines = res.data?.machines ?? [];
    kpi         = res.data?.kpi     ?? { total_machines:0, key_machines:0, areas:0, models:0 };
    loading = false;
  }

  // ── Derived filter lists ───────────────────────────────────────────────────
  const allModels = $derived([...new Set(allMachines.map(m=>m.model).filter(Boolean))].sort());
  const allMfgs   = $derived([...new Set(allMachines.map(m=>m.manufacturer).filter(Boolean))].sort());

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const displayed = $derived.by(() => {
    const q = filterSearch.trim().toLowerCase();
    return allMachines.filter(m => {
      if (!filterArea.includes(m.area)) return false;
      if (filterModels.length && !filterModels.includes(m.model)) return false;
      if (filterMfgs.length   && !filterMfgs.includes(m.manufacturer)) return false;
      if (filterKey  && !m.is_key)  return false;
      if (filterAuto && !m.is_auto) return false;
      if (filterGold && !m.is_gold) return false;
      if (filterHealth !== 'all' && m.health !== filterHealth) return false;
      if (q) return (
        m.code_machine.toLowerCase().includes(q) ||
        m.des_machine.toLowerCase().includes(q)  ||
        m.model.toLowerCase().includes(q)        ||
        m.manufacturer.toLowerCase().includes(q)
      );
      return true;
    });
  });

  const isFiltered = $derived(
    filterArea.length < ALL_AREAS.length ||
    filterModels.length > 0 || filterMfgs.length > 0 ||
    filterKey || filterAuto || filterGold ||
    filterHealth !== 'all' || filterSearch.trim().length > 0
  );

  // KPI counts for the currently filtered set
  const filtKpi = $derived({
    total:  displayed.length,
    key:    displayed.filter(m => m.is_key).length,
    areas:  new Set(displayed.map(m => m.area)).size,
    models: new Set(displayed.map(m => m.model).filter(Boolean)).size,
  });

  // ── Model summary (grouped from displayed) ─────────────────────────────────
  const modelRows = $derived.by((): ModelRow[] => {
    const map = new Map<string, {
      model: string; manufacturer: string; count: number;
      areas: Set<string>; critical: number; warning: number; monitor: number;
      ageSum: number; ageCount: number; mttrSum: number; mttrCount: number;
    }>();
    for (const m of displayed) {
      if (!m.model) continue;
      if (!map.has(m.model)) {
        map.set(m.model, {
          model: m.model, manufacturer: m.manufacturer ?? '', count: 0,
          areas: new Set(), critical: 0, warning: 0, monitor: 0,
          ageSum: 0, ageCount: 0, mttrSum: 0, mttrCount: 0,
        });
      }
      const r = map.get(m.model)!;
      r.count++;
      r.areas.add(m.area);
      if (m.health === 'critical') r.critical++;
      if (m.health === 'warning')  r.warning++;
      if (m.health === 'monitor')  r.monitor++;
      if (m.year_install) { r.ageSum += CURRENT_YEAR - m.year_install; r.ageCount++; }
      if (m.avg_mttr_min > 0) { r.mttrSum += m.avg_mttr_min; r.mttrCount++; }
    }
    return [...map.values()].map(r => ({
      model: r.model, manufacturer: r.manufacturer, count: r.count,
      areasStr: [...r.areas].sort().join(', '),
      critical: r.critical, warning: r.warning, monitor: r.monitor,
      avgAge:  r.ageCount  ? r.ageSum  / r.ageCount  : 0,
      avgMttr: r.mttrCount ? r.mttrSum / r.mttrCount : 0,
    })).sort((a, b) => b.count - a.count);
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function ageBucket(yr: number|null): 'new'|'prime'|'mature'|'aging'|'unknown' {
    if (!yr) return 'unknown';
    const age = CURRENT_YEAR - yr;
    if (age < 2)  return 'new';
    if (age < 5)  return 'prime';
    if (age < 10) return 'mature';
    return 'aging';
  }
  const AGE_LABELS = { new:'New <2y', prime:'Prime 2–5y', mature:'Mature 5–10y', aging:'Aging >10y' };
  const AGE_COLORS = { new:'#6CC24A', prime:'#41B6E6', mature:'#F68D2E', aging:'#CC0000' };

  function healthLabel(h: HealthStatus) {
    return { critical:'Critical', warning:'Warning', monitor:'Monitor', healthy:'Healthy' }[h];
  }
  const HEALTH_COLOR: Record<HealthStatus,string> = {
    critical:'#CC0000', warning:'#FD7F20', monitor:'#F5C518', healthy:'#5EBF33',
  };

  // ── Filter actions ─────────────────────────────────────────────────────────
  function clearFilters() {
    filterArea = [...ALL_AREAS]; filterModels = []; filterMfgs = [];
    filterKey = false; filterAuto = false; filterGold = false;
    filterHealth = 'all'; filterSearch = '';
  }
  function toggleArea(a: MachineArea) {
    filterArea = filterArea.includes(a) ? filterArea.filter(x=>x!==a) : [...filterArea, a];
  }
  function toggleModel(m: string) {
    filterModels = filterModels.includes(m) ? filterModels.filter(x=>x!==m) : [...filterModels, m];
  }
  function toggleMfg(m: string) {
    filterMfgs = filterMfgs.includes(m) ? filterMfgs.filter(x=>x!==m) : [...filterMfgs, m];
  }
  function drillToModel(model: string) {
    filterModels = [model]; viewMode = 'machines';
  }

  // ── Chart options ──────────────────────────────────────────────────────────
  const byAreaOpt = $derived.by(() => {
    const areasRev = [...ALL_AREAS].reverse();
    const countsRev = areasRev.map(a => displayed.filter(m=>m.area===a).length);
    return {
      tooltip: { trigger:'axis' },
      grid: { top:8, left:10, right:24, bottom:8, containLabel:true },
      xAxis: { type:'value', axisLabel:{fontSize:9} },
      yAxis: { type:'category', data:areasRev, axisLabel:{fontSize:10} },
      series: [{ type:'bar', barMaxWidth:18,
        data: countsRev.map((v, i) => ({
          value: v,
          itemStyle: { color: filterArea.includes(areasRev[i]) ? '#1C355E' : '#8CA4C0' },
        })),
        label: { show:true, position:'right', fontSize:9 },
      }],
    };
  });

  const scatterOpt = $derived.by(() => {
    const groups: Record<HealthStatus, InventoryMachine[]> = { critical:[], warning:[], monitor:[], healthy:[] };
    for (const m of displayed) groups[m.health].push(m);
    return {
      tooltip: {
        formatter: (p: { data: unknown[] }) => {
          const [ev, hrs, id, mttr, desc, area, model] = p.data as [number,number,string,number,string,string,string];
          return `<b>${id}</b><br><span style="color:#888">${desc || ''}</span><br>Area: ${area} · ${model || '—'}<br>7d Down: <b>${hrs}h</b> / <b>${ev}</b> events<br>MTTR: ${mttr > 0 ? Math.round(mttr) + ' min' : '—'}`;
        }
      },
      legend: { data:['Critical','Warning','Monitor','Healthy'], bottom:0, itemWidth:10, itemHeight:10, textStyle:{fontSize:10} },
      grid: { top:8, left:10, right:16, bottom:36, containLabel:true },
      xAxis: { type:'value', name:'Events (7d)', nameTextStyle:{fontSize:9}, axisLabel:{fontSize:9}, minInterval:1 },
      yAxis: { type:'value', name:'Hours (7d)', nameTextStyle:{fontSize:9}, axisLabel:{fontSize:9} },
      series: (['critical','warning','monitor','healthy'] as const).map(h => ({
        name: healthLabel(h),
        type: 'scatter',
        symbolSize: (d: number[]) => Math.max(5, Math.min(22, Math.sqrt(Math.max(0, d[3])) * 1.8 + 5)),
        itemStyle: { color: HEALTH_COLOR[h], opacity: 0.78, borderColor: HEALTH_COLOR[h], borderWidth: 0.5 },
        data: groups[h].map(m => [m.down_events, m.down_hrs, m.code_machine, m.avg_mttr_min, m.des_machine, m.area, m.model]),
        emphasis: { scale: 1.4 },
      })),
    };
  });

  const topModelsOpt = $derived.by(() => {
    const mc = new Map<string,number>();
    displayed.forEach(m => { if(m.model) mc.set(m.model, (mc.get(m.model)??0)+1); });
    const topRev = [...mc.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).reverse();
    return {
      tooltip: { trigger:'axis' },
      grid: { top:8, left:10, right:28, bottom:8, containLabel:true },
      xAxis: { type:'value', axisLabel:{fontSize:9} },
      yAxis: { type:'category', data:topRev.map(x=>x[0]), axisLabel:{fontSize:9, width:100, overflow:'truncate'} },
      series: [{ type:'bar', barMaxWidth:16,
        data: topRev.map(([name,v]) => ({
          value: v,
          itemStyle: { color: filterModels.includes(name) ? '#0D4F7A' : '#157EAC' },
        })),
        label: { show:true, position:'right', fontSize:9 },
      }],
    };
  });

  const byMfgOpt = $derived.by(() => {
    const mc = new Map<string,number>();
    displayed.forEach(m => { if(m.manufacturer) mc.set(m.manufacturer, (mc.get(m.manufacturer)??0)+1); });
    const sorted = [...mc.entries()].sort((a,b)=>b[1]-a[1]);
    const palette = ['#1C355E','#157EAC','#41B6E6','#702076','#F68D2E','#6CC24A','#DA291C','#FD7F20','#5EBF33','#990000'];
    return {
      tooltip: { trigger:'axis' },
      grid: { top:8, left:10, right:28, bottom:8, containLabel:true },
      xAxis: { type:'value', axisLabel:{fontSize:9} },
      yAxis: { type:'category', data:sorted.map(x=>x[0]).reverse(), axisLabel:{fontSize:9} },
      series: [{ type:'bar', barMaxWidth:16,
        data: sorted.map((x,i) => ({ value:x[1], itemStyle:{ color:palette[i%palette.length] } })).reverse(),
        label: { show:true, position:'right', fontSize:9 },
      }],
    };
  });

  const ageOpt = $derived.by(() => {
    const buckets = ['new','prime','mature','aging'] as const;
    return {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'},
        formatter:(ps: Array<{seriesName:string;value:number;color:string}>) =>
          ps.filter(p=>p.value>0).map(p=>`<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${p.value}</b>`).join('<br>') },
      legend: { data: buckets.map(b=>AGE_LABELS[b]), bottom:0, textStyle:{fontSize:10} },
      grid: { top:8, left:10, right:10, bottom:40, containLabel:true },
      xAxis: { type:'category', data:ALL_AREAS, axisLabel:{fontSize:10} },
      yAxis: { type:'value', axisLabel:{fontSize:9} },
      series: buckets.map(b => ({
        name: AGE_LABELS[b], type:'bar', stack:'age', barMaxWidth:32,
        itemStyle: { color: AGE_COLORS[b] },
        data: ALL_AREAS.map(a => displayed.filter(m=>m.area===a && ageBucket(m.year_install)===b).length),
      })),
    };
  });

  // ── Chart click handlers ───────────────────────────────────────────────────
  function onAreaClick(p: EChartClickParams) { toggleArea(p.name as MachineArea); }
  function onModelClick(p: EChartClickParams) { toggleModel(p.name); }
  function onMfgClick(p: EChartClickParams)   { toggleMfg(p.name); }
  function onScatterClick(p: EChartClickParams) {
    const d = p.data as unknown[];
    if (Array.isArray(d) && d[2]) {
      filterSearch = String(d[2]);
      // scroll table into view
      document.querySelector('.dt-wrap')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }
  }
  function onAgeClick(p: EChartClickParams) {
    if ((ALL_AREAS as string[]).includes(p.name)) toggleArea(p.name as MachineArea);
  }

  // ── CSV Export ─────────────────────────────────────────────────────────────
  function exportCsv() {
    const hdrs = ['Machine','Description','Area','Model','Manufacturer','Year','Age','KEY','Auto','Gold','Serial','7d Events','7d Hours','Avg MTTR (min)','Health'];
    const esc  = (v:unknown) => { const s=String(v??''); return s.includes(',')?`"${s.replace(/"/g,'""')}"`:s; };
    const rows = displayed.map(m => [
      m.code_machine, m.des_machine, m.area, m.model, m.manufacturer,
      m.year_install??'', m.year_install ? CURRENT_YEAR - m.year_install : '',
      m.is_key?1:0, m.is_auto?1:0, m.is_gold?1:0, m.serial_no??'',
      m.down_events, m.down_hrs, m.avg_mttr_min, m.health,
    ].map(esc).join(','));
    const blob = new Blob(['﻿'+[hdrs.join(','),...rows].join('\r\n')], {type:'text/csv;charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href=url; a.download='inventory.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Table columns (machines view) ──────────────────────────────────────────
  const cols = [
    { key:'code_machine', label:'Machine', width:'100px', sortable:true,
      renderHtml:(v:unknown)=>`<span style="font-weight:700;color:var(--color-primary)">${v}</span>` },
    { key:'des_machine',  label:'Description', sortable:true,
      renderHtml:(v:unknown)=>{ const t=String(v??'—'); return `<span title="${t.replace(/"/g,'&quot;')}" style="display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t||'—'}</span>`; } },
    { key:'area',   label:'Area',  width:'60px', sortable:true },
    { key:'model',  label:'Model', sortable:true, format:(v:unknown):string=>String(v||'—') },
    { key:'manufacturer', label:'Mfr.', width:'90px', sortable:true, format:(v:unknown):string=>String(v||'—') },
    { key:'year_install', label:'Year', width:'55px', align:'center' as const, sortable:true,
      format:(v:unknown):string=>String(v??'—') },
    { key:'_age', label:'Age', width:'70px', align:'center' as const,
      renderHtml:(_v:unknown, row:unknown)=>{
        const v = (row as InventoryMachine).year_install;
        const b = ageBucket(v as number|null);
        if (b==='unknown') return '<span style="color:var(--color-text-disabled)">—</span>';
        const colors:Record<string,string> = { new:'#6CC24A', prime:'#157EAC', mature:'#F68D2E', aging:'#CC0000' };
        return `<span style="font-size:10px;font-weight:700;color:${colors[b]}">${AGE_LABELS[b as keyof typeof AGE_LABELS]}</span>`;
      } },
    { key:'is_key', label:'Flags', width:'82px', align:'center' as const,
      renderHtml:(_v:unknown, row:unknown)=>{
        const m = row as InventoryMachine;
        const parts: string[] = [];
        if (m.is_key)  parts.push('<span style="background:#F68D2E;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px">KEY</span>');
        if (m.is_auto) parts.push('<span style="background:#157EAC;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px">AUTO</span>');
        if (m.is_gold) parts.push('<span style="background:#D4A017;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px">GOLD</span>');
        return parts.join(' ');
      } },
    { key:'down_hrs', label:'7d Down', width:'72px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const h=Number(v); return h>0?`<span style="color:${h>=8?'var(--status-down)':h>=2?'var(--color-accent-orange)':'inherit'};font-weight:600">${h.toFixed(1)}h</span>`:'<span style="color:var(--color-text-disabled)">—</span>'; } },
    { key:'down_events', label:'Events', width:'60px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const n=Number(v); return n>0?`<b>${n}</b>`:'<span style="color:var(--color-text-disabled)">0</span>'; } },
    { key:'avg_mttr_min', label:'MTTR', width:'62px', align:'right' as const, sortable:true,
      format:(v:unknown):string=>{ const m=Number(v); return m>0?`${Math.round(m)}m`:'—'; } },
    { key:'health', label:'Health', width:'76px', align:'center' as const, sortable:true,
      renderHtml:(v:unknown)=>{
        const h = v as HealthStatus;
        return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${HEALTH_COLOR[h]}22;color:${HEALTH_COLOR[h]};border:1px solid ${HEALTH_COLOR[h]}55">${healthLabel(h)}</span>`;
      } },
    { key:'last_package', label:'Last Package', width:'110px', sortable:true,
      renderHtml:(v:unknown, row:unknown)=>{
        const pkg = v as string|null;
        const date = (row as InventoryMachine).last_run_date;
        if (!pkg || pkg === 'N/A') return '<span style="color:var(--color-text-disabled)">—</span>';
        const title = date ? ` title="${date}"` : '';
        return `<span${title} style="font-size:11px">${pkg}</span>`;
      } },
  ];

  const healthOrder: Record<HealthStatus,number> = { critical:0, warning:1, monitor:2, healthy:3 };
  const sortedRows = $derived([...displayed].sort((a,b) => healthOrder[a.health] - healthOrder[b.health]));

  onMount(loadData);
</script>

<svelte:head><title>Inventory — EMH Dashboard</title></svelte:head>

<PageHeader title="Machine Inventory" subtitle="Equipment master list · 7-day downtime · Health status" />

{#if error}
  <div class="ph err">⚠ {error}</div>
{/if}

<!-- ── Area filter (primary scope selector) ─────────────────────────────── -->
<div class="area-filter-bar">
  <span class="filter-lbl">Area</span>
  <button class="btn btn-ghost btn-xs" onclick={() => (filterArea=[...ALL_AREAS])}>All</button>
  <button class="btn btn-ghost btn-xs" onclick={() => (filterArea=[])}>None</button>
  {#each ALL_AREAS as a (a)}
    <button class="chip" class:active={filterArea.includes(a)} onclick={()=>toggleArea(a)}>{a}</button>
  {/each}
  <div class="afb-divider"></div>
  <button class="chip chip-key"  class:active={filterKey}  onclick={() => (filterKey=!filterKey)}>KEY</button>
  <button class="chip chip-auto" class:active={filterAuto} onclick={() => (filterAuto=!filterAuto)}>Auto</button>
  <button class="chip chip-gold" class:active={filterGold} onclick={() => (filterGold=!filterGold)}>Gold</button>
</div>

<!-- ── Hero search ───────────────────────────────────────────────────────── -->
<div class="search-hero">
  <svg class="sh-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
  </svg>
  <input
    class="sh-input"
    type="search"
    placeholder="Search machine ID, description, model, manufacturer…"
    bind:value={filterSearch}
    autocomplete="off"
  />
  <span class="sh-count">
    {#if isFiltered}
      <b>{filtKpi.total}</b> / {allMachines.length}
    {:else}
      {loading ? '…' : allMachines.length}
    {/if}
    machines
  </span>
</div>

<!-- ── KPI row ──────────────────────────────────────────────────────────── -->
<div class="kpi-row">
  {#each [
    { val: filtKpi.total,  total: kpi.total_machines, lbl:'Total Machines', color:'var(--color-primary)' },
    { val: filtKpi.key,    total: kpi.key_machines,   lbl:'KEY Machines',   color:'var(--color-accent-orange)' },
    { val: filtKpi.areas,  total: kpi.areas,          lbl:'Areas',          color:'var(--color-primary)' },
    { val: filtKpi.models, total: kpi.models,         lbl:'Models',         color:'#702076' },
  ] as {val,total,lbl,color} (lbl)}
    <div class="kpi-card">
      <div class="kv" style="color:{color}">
        {loading ? '…' : val}
        {#if isFiltered && !loading && val !== total}
          <span class="kv-total">/ {total}</span>
        {/if}
      </div>
      <div class="kl">{lbl}</div>
    </div>
  {/each}
</div>

<!-- ── Active filter strip ──────────────────────────────────────────────── -->
{#if isFiltered && !loading}
<div class="filter-strip">
  <span class="fs-label">Filters</span>
  {#if filterArea.length < ALL_AREAS.length}
    <button class="fs-chip" onclick={() => (filterArea=[...ALL_AREAS])}>
      Areas {filterArea.length}/{ALL_AREAS.length} ×
    </button>
  {/if}
  {#each filterModels as m (m)}
    <button class="fs-chip" onclick={() => toggleModel(m)}>Model: {m} ×</button>
  {/each}
  {#each filterMfgs as m (m)}
    <button class="fs-chip" onclick={() => toggleMfg(m)}>Mfr: {m} ×</button>
  {/each}
  {#if filterKey}<button class="fs-chip" onclick={() => (filterKey=false)}>KEY ×</button>{/if}
  {#if filterAuto}<button class="fs-chip" onclick={() => (filterAuto=false)}>Auto ×</button>{/if}
  {#if filterGold}<button class="fs-chip" onclick={() => (filterGold=false)}>Gold ×</button>{/if}
  {#if filterHealth !== 'all'}
    <button class="fs-chip fs-health" style="--fsc:{HEALTH_COLOR[filterHealth]}"
      onclick={() => (filterHealth='all')}>{healthLabel(filterHealth)} ×</button>
  {/if}
  {#if filterSearch.trim()}
    <button class="fs-chip" onclick={() => (filterSearch='')}>"{filterSearch.trim()}" ×</button>
  {/if}
  <button class="btn btn-ghost btn-xs" onclick={clearFilters}>Clear all</button>
</div>
{/if}

<!-- ── Charts row 1: By Area + Health Treemap ──────────────────────────── -->
<div class="grid-2" style="margin-bottom:var(--gutter)">
  <div class="chart-card">
    <div class="chart-title">
      Machines by Area
      {#if filterArea.length < ALL_AREAS.length}
        <button class="chart-badge" onclick={() => (filterArea=[...ALL_AREAS])}>
          {filterArea.length}/{ALL_AREAS.length} ×
        </button>
      {:else}
        <span class="chart-hint">click to filter</span>
      {/if}
    </div>
    <EChart option={byAreaOpt} height="240px" loading={loading} onclick={onAreaClick} />
  </div>
  <div class="chart-card">
    <div class="chart-title">
      Downtime Scatter (Events vs Hours)
      <span class="chart-hint">click point → filter table</span>
    </div>
    <EChart option={scatterOpt} height="240px" loading={loading} onclick={onScatterClick} />
  </div>
</div>

<!-- ── Charts row 2: Top Models + By Manufacturer ──────────────────────── -->
<div class="grid-2" style="margin-bottom:var(--gutter)">
  <div class="chart-card">
    <div class="chart-title">
      Top 15 Models
      {#if filterModels.length > 0}
        <button class="chart-badge" onclick={() => (filterModels=[])}>
          {filterModels.length} selected ×
        </button>
      {:else}
        <span class="chart-hint">click to filter</span>
      {/if}
    </div>
    <EChart option={topModelsOpt} height="260px" loading={loading} onclick={onModelClick} />
  </div>
  <div class="chart-card">
    <div class="chart-title">
      By Manufacturer
      {#if filterMfgs.length > 0}
        <button class="chart-badge" onclick={() => (filterMfgs=[])}>
          {filterMfgs.length} selected ×
        </button>
      {:else}
        <span class="chart-hint">click to filter</span>
      {/if}
    </div>
    <EChart option={byMfgOpt} height="260px" loading={loading} onclick={onMfgClick} />
  </div>
</div>

<!-- ── Chart row 3: Age Lifecycle ──────────────────────────────────────── -->
<div class="chart-card" style="margin-bottom:var(--gutter)">
  <div class="chart-title">
    Machine Age Distribution by Area (Lifecycle)
    <span class="chart-hint">click area to filter</span>
  </div>
  <EChart option={ageOpt} height="200px" loading={loading} onclick={onAgeClick} />
</div>

<!-- ── Filter + Table ──────────────────────────────────────────────────── -->
<div class="chart-card">

  <!-- Health chips -->
  {#if !loading}
  <div class="health-summary">
    {#each (['all','critical','warning','monitor','healthy'] as const) as h (h)}
      {@const count = h==='all' ? displayed.length : displayed.filter(m=>m.health===h).length}
      <button
        class="health-chip"
        class:active={filterHealth===h}
        style="--hc:{h==='all'?'var(--color-primary)':HEALTH_COLOR[h]}"
        onclick={() => (filterHealth=h)}
      >
        {h==='all'?'All':healthLabel(h)} <span class="hc-count">{count}</span>
      </button>
    {/each}
  </div>
  {/if}

  <!-- Model / Mfg / Flags / Export -->
  <div class="filter-row" style="flex-wrap:wrap;gap:8px;padding-top:6px">
    <div class="multi-select">
      <span class="filter-lbl">Model</span>
      <div class="ms-chips">
        {#if filterModels.length === 0}
          <span class="ms-placeholder">All models</span>
        {:else}
          {#each filterModels as m (m)}
            <button class="chip active ms-chip" onclick={() => toggleModel(m)}>{m} ×</button>
          {/each}
        {/if}
      </div>
      <select class="input ms-sel" onchange={(e) => { const v=(e.target as HTMLSelectElement).value; if(v) toggleModel(v); (e.target as HTMLSelectElement).value=''; }}>
        <option value="">+ Add model…</option>
        {#each allModels as m (m)}
          {#if !filterModels.includes(m)}<option value={m}>{m}</option>{/if}
        {/each}
      </select>
    </div>

    <div class="multi-select">
      <span class="filter-lbl">Mfr.</span>
      <div class="ms-chips">
        {#if filterMfgs.length === 0}
          <span class="ms-placeholder">All manufacturers</span>
        {:else}
          {#each filterMfgs as m (m)}
            <button class="chip active ms-chip" onclick={() => toggleMfg(m)}>{m} ×</button>
          {/each}
        {/if}
      </div>
      <select class="input ms-sel" onchange={(e) => { const v=(e.target as HTMLSelectElement).value; if(v) toggleMfg(v); (e.target as HTMLSelectElement).value=''; }}>
        <option value="">+ Add mfr…</option>
        {#each allMfgs as m (m)}
          {#if !filterMfgs.includes(m)}<option value={m}>{m}</option>{/if}
        {/each}
      </select>
    </div>

    <div style="margin-left:auto">
      <button class="btn btn-outline btn-sm" onclick={exportCsv} disabled={displayed.length===0}>↓ CSV</button>
    </div>
  </div>

  <!-- View toggle -->
  <div class="view-row">
    <div class="view-toggle">
      <button class="vt-btn" class:active={viewMode==='machines'} onclick={() => (viewMode='machines')}>
        Machines ({displayed.length})
      </button>
      <button class="vt-btn" class:active={viewMode==='models'} onclick={() => (viewMode='models')}>
        Models ({modelRows.length})
      </button>
    </div>
    {#if viewMode === 'models'}
      <span class="view-hint">Click a row to drill into all machines for that model</span>
    {/if}
  </div>

  <!-- Machines table -->
  {#if viewMode === 'machines'}
    <div style="margin-top:8px">
      <DataTable columns={cols} rows={sortedRows} rowKey={r=>r.code_machine} compact pageSize={25} />
    </div>
  {/if}

  <!-- Models table -->
  {#if viewMode === 'models'}
    <div style="margin-top:8px; overflow-x:auto">
      {#if modelRows.length === 0}
        <div class="empty-state">No models match current filters.</div>
      {:else}
        <table class="model-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Manufacturer</th>
              <th class="tc">Count</th>
              <th>Areas</th>
              <th class="tc">Critical</th>
              <th class="tc">Warning</th>
              <th class="tc">Avg Age</th>
              <th class="tc">Avg MTTR</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each modelRows as r (r.model)}
              <tr class="model-row" onclick={() => drillToModel(r.model)}
                  title="View all {r.count} machines for {r.model}">
                <td class="td-model">{r.model || '—'}</td>
                <td>{r.manufacturer || '—'}</td>
                <td class="tc td-count">{r.count}</td>
                <td class="td-areas">{r.areasStr}</td>
                <td class="tc">
                  {#if r.critical > 0}<span class="badge-crit">{r.critical}</span>{:else}—{/if}
                </td>
                <td class="tc">
                  {#if r.warning > 0}<span class="badge-warn">{r.warning}</span>{:else}—{/if}
                </td>
                <td class="tc">{r.avgAge  > 0 ? `${r.avgAge.toFixed(1)}y`  : '—'}</td>
                <td class="tc">{r.avgMttr > 0 ? `${Math.round(r.avgMttr)}m` : '—'}</td>
                <td class="tc td-drill">→</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}

</div>

<style>
  /* KPI */
  .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:var(--gutter); }
  .kpi-card { background:var(--color-surface); border:1px solid var(--color-border-strong); border-radius:var(--r-sm); padding:16px; text-align:center; }
  .kv { font-size:30px; font-weight:700; line-height:1.1; }
  .kv-total { font-size:16px; font-weight:400; color:var(--color-text-muted); margin-left:4px; }
  .kl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); margin-top:4px; }

  /* Area filter bar */
  .area-filter-bar {
    display:flex; align-items:center; gap:6px; flex-wrap:wrap;
    background:var(--color-surface); border:1px solid var(--color-border-strong);
    border-radius:var(--r-sm); padding:10px 16px; margin-bottom:var(--gutter);
  }

  .afb-divider { width:1px; height:20px; background:var(--color-border-strong); margin:0 4px; flex-shrink:0; }
  .chip-key.active  { background:#F68D2E; border-color:#F68D2E; color:#fff; }
  .chip-auto.active { background:#157EAC; border-color:#157EAC; color:#fff; }
  .chip-gold.active { background:#D4A017; border-color:#D4A017; color:#fff; }

  /* Search hero */
  .search-hero {
    display:flex; align-items:center; gap:10px;
    background:var(--color-surface); border:1.5px solid var(--color-border-strong);
    border-radius:var(--r-sm); padding:10px 16px; margin-bottom:var(--gutter);
  }
  .sh-icon { width:16px; height:16px; flex-shrink:0; color:var(--color-text-muted); }
  .sh-input {
    flex:1; border:none; background:transparent;
    font-size:14px; font-family:inherit; color:var(--color-text); outline:none;
  }
  .sh-input::placeholder { color:var(--color-text-disabled); }
  .sh-count { font-size:12px; color:var(--color-text-muted); white-space:nowrap; }
  .sh-count b { color:var(--color-text); font-weight:700; }

  /* Filter strip */
  .filter-strip {
    display:flex; align-items:center; gap:6px; flex-wrap:wrap;
    background:#EEF2FC; border:1px solid #C8D4EE;
    border-radius:var(--r-sm); padding:7px 12px; margin-bottom:var(--gutter);
  }
  .fs-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); white-space:nowrap; }
  .fs-chip {
    display:inline-flex; align-items:center;
    font-size:11px; font-weight:600; padding:2px 9px; border-radius:20px;
    background:var(--color-primary); color:#fff; border:none; cursor:pointer; transition:opacity 0.1s;
  }
  .fs-chip:hover { opacity:0.8; }
  .fs-health { background:var(--fsc, var(--color-primary)); }

  /* Chart title */
  .chart-title {
    display:flex; align-items:center; gap:8px;
    font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
    color:var(--color-text-muted); padding-bottom:8px;
    border-bottom:1px solid var(--color-border); margin-bottom:10px;
  }
  .chart-badge {
    margin-left:auto; font-size:10px; font-weight:600;
    padding:2px 8px; border-radius:10px;
    background:var(--color-primary); color:#fff; border:none; cursor:pointer; transition:opacity 0.1s;
  }
  .chart-badge:hover { opacity:0.8; }
  .chart-hint { margin-left:auto; font-size:10px; font-weight:400; color:var(--color-text-disabled); font-style:italic; text-transform:none; letter-spacing:0; }

  /* Health summary */
  .health-summary { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .health-chip {
    display:inline-flex; align-items:center; gap:5px;
    font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em;
    padding:4px 12px; border-radius:20px;
    border:1.5px solid var(--hc); color:var(--hc);
    background:transparent; cursor:pointer; transition:all 0.12s;
  }
  .health-chip:hover, .health-chip.active { background:var(--hc); color:#fff; }
  .hc-count { font-size:12px; font-weight:700; }

  /* Filters */
  .filter-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding-bottom:8px; border-bottom:1px solid var(--color-border); }
  .filter-lbl { font-size:11px; font-weight:700; text-transform:uppercase; color:var(--color-text-muted); white-space:nowrap; }
  .flag-group { display:flex; align-items:center; gap:6px; }
  .multi-select { display:flex; align-items:center; gap:6px; }
  .ms-chips { display:flex; flex-wrap:wrap; gap:4px; }
  .ms-placeholder { font-size:11px; color:var(--color-text-disabled); }
  .ms-chip { font-size:10px; padding:2px 7px; }
  .ms-sel { width:130px; font-size:11px; padding:3px 6px; }
  .btn-xs { font-size:10px; padding:2px 7px; }

  /* View toggle */
  .view-row {
    display:flex; align-items:center; gap:12px;
    padding:10px 0; border-top:1px solid var(--color-border); margin-top:8px;
  }
  .view-toggle { display:flex; background:var(--color-bg); border:1px solid var(--color-border-strong); border-radius:6px; overflow:hidden; }
  .vt-btn {
    font-size:12px; font-weight:700; padding:5px 16px;
    border:none; background:transparent; color:var(--color-text-muted);
    cursor:pointer; transition:all 0.12s;
  }
  .vt-btn.active { background:var(--color-primary); color:#fff; }
  .view-hint { font-size:11px; color:var(--color-text-muted); font-style:italic; }

  /* Models table */
  .model-table { width:100%; border-collapse:collapse; font-size:12px; }
  .model-table th {
    padding:6px 10px; text-align:left; font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted);
    border-bottom:2px solid var(--color-border-strong); background:var(--color-surface); white-space:nowrap;
  }
  .model-table th.tc { text-align:center; }
  .model-table td { padding:7px 10px; border-bottom:1px solid var(--color-border); vertical-align:middle; }
  .model-table td.tc { text-align:center; }
  .model-row { cursor:pointer; transition:background 0.08s; }
  .model-row:hover { background:var(--color-bg); }
  .td-model { font-weight:700; color:var(--color-primary); }
  .td-count { font-size:15px; font-weight:700; }
  .td-areas { font-size:11px; color:var(--color-text-muted); max-width:160px; }
  .td-drill { color:var(--color-text-disabled); font-size:14px; }
  .model-row:hover .td-drill { color:var(--color-primary); }
  .badge-crit { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; font-weight:700; background:#CC000020; color:#CC0000; }
  .badge-warn { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; font-weight:700; background:#FD7F2020; color:#FD7F20; }
  .empty-state { padding:24px; text-align:center; color:var(--color-text-muted); font-size:13px; }

  /* Error */
  .ph.err { background:#FFF0F0; border:1px solid var(--status-down); color:var(--status-down); padding:10px 16px; border-radius:var(--r-sm); font-size:13px; font-weight:600; margin-bottom:var(--gutter); }
</style>
