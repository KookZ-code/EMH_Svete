<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import EChart from '$lib/components/EChart.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import { downtimeApi } from '$lib/utils/api';
  import type { MachineArea, JobType } from '$types';

  interface ReasonRow { reason: string; hours: number; count: number; avg_repair_min: number; cumulative_pct: number; }
  interface MachRow   { code_machine: string; area: string; total_hours: number; [k: string]: unknown; }
  interface ShiftRow  { day: string; shift_name: string; events: number; repair_hrs: number; wait_hrs: number; }
  interface KpiData   { total_hours: number; total_events: number; avg_repair_min: number; avg_wait_min: number; }

  interface SectionData {
    reasons: ReasonRow[]; machines: MachRow[]; shift: ShiftRow[];
    kpi: KpiData; loading: boolean; error: string | null;
  }

  const empty = (): SectionData => ({
    reasons: [], machines: [], shift: [],
    kpi: { total_hours:0, total_events:0, avg_repair_min:0, avg_wait_min:0 },
    loading: true, error: null,
  });

  // Setup type options
  const SETUP_OPTIONS = [
    { value:'all',      label:'All Setup',          types:['SETUP','SETUP BY OPERATOR','CONVERT','CLEAN MOLD','CHANGE CAP'] as JobType[] },
    { value:'tech',     label:'Setup (Technician)', types:['SETUP','CONVERT','CHANGE CAP'] as JobType[] },
    { value:'operator', label:'Setup by Operator',  types:['SETUP BY OPERATOR'] as JobType[] },
  ];
  let setupType = $state('all');
  const activeSetup = $derived(SETUP_OPTIONS.find(o=>o.value===setupType) ?? SETUP_OPTIONS[0]);

  // Section display config
  const DOWN_COLOR  = '#CC0000';
  const SETUP_COLOR = '#1D9CE4';
  const DOWN_TYPES: JobType[] = ['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN'];

  let down  = $state<SectionData>(empty());
  let setup = $state<SectionData>(empty());

  let filters = $state({
    start: (() => { const d = new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10); })(),
    end:   new Date().toISOString().slice(0,10),
    areas: [] as MachineArea[],
    shift: 'all' as 'all'|'day'|'night',
  });

  async function fetchSection(types: JobType[]): Promise<SectionData> {
    const activeShift = drilldown?.shift ?? (filters.shift !== 'all' ? filters.shift : undefined);
    const res = await downtimeApi.detail({
      job_types: types,
      start: filters.start, end: filters.end,
      shift: activeShift,
      areas: filters.areas.length > 0 ? filters.areas : undefined,
      drill_day: drilldown?.day,
    });
    if (res.error) return { ...empty(), loading:false, error:res.error.message };
    const d = res.data as { reason?:ReasonRow[]; machines_by_reason?:MachRow[]; daily_shift?:ShiftRow[]; kpi?:KpiData };
    return { reasons:d.reason??[], machines:d.machines_by_reason??[], shift:d.daily_shift??[], kpi:d.kpi??empty().kpi, loading:false, error:null };
  }

  async function loadAll() {
    down = empty(); setup = empty();
    const [d, s] = await Promise.all([
      fetchSection(DOWN_TYPES),
      fetchSection(activeSetup.types),
    ]);
    down = d; setup = s;
  }

  async function reloadSetup() {
    setup = empty();
    setup = await fetchSection(activeSetup.types);
  }

  function handleFilter(f: {start:string;end:string;areas:MachineArea[];shift:'all'|'day'|'night'}) {
    filters = f; loadAll();
  }

  function changeSetupType(v: string) {
    setupType = v;
    reloadSetup();
  }

  // ── Chart builders ────────────────────────────────────────────────────────
  function shiftChart(sec: SectionData, color: string, activeShift: 'all'|'day'|'night') {
    const df = sec.shift;
    const days = [...new Set(df.map(r=>r.day))].sort();
    const dayOpa   = activeShift === 'night' ? 0.22 : 1;
    const nightOpa = activeShift === 'day'   ? 0.22 : 1;
    return {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'} },
      legend: { data:['Day','Night'], top:0, textStyle:{fontSize:10} },
      grid:  { top:30, left:46, right:10, bottom:55 },
      xAxis: { type:'category', data:days, axisLabel:{rotate:35,fontSize:9,formatter:(v:string)=>v.slice(5)} },
      yAxis: { type:'value', name:'h', nameTextStyle:{fontSize:9}, axisLabel:{fontSize:9} },
      series: [
        { name:'Day',   type:'bar', barMaxWidth:20, cursor:'pointer',
          itemStyle:{color, opacity:dayOpa},
          emphasis:{itemStyle:{opacity:1}},
          data: days.map(d=>{ const r=df.find(x=>x.day===d&&x.shift_name==='Day');   return r?+(r.repair_hrs+r.wait_hrs).toFixed(1):0; }) },
        { name:'Night', type:'bar', barMaxWidth:20, cursor:'pointer',
          itemStyle:{color:'#702076', opacity:nightOpa},
          emphasis:{itemStyle:{opacity:1}},
          data: days.map(d=>{ const r=df.find(x=>x.day===d&&x.shift_name==='Night'); return r?+(r.repair_hrs+r.wait_hrs).toFixed(1):0; }) },
      ],
    };
  }

  // Drill-down: click a specific day+shift bar → filter ALL page data to that day+shift.
  // Uses drill_day param (computed chart-day, handles cross-midnight Night shift correctly).
  // Does NOT modify filters.start/end — the date range stays intact.
  interface Drilldown { day: string; shift: 'day'|'night'; }
  let drilldown = $state<Drilldown | null>(null);

  function handleShiftClick(params: { seriesName: string; name: string }) {
    const day   = params.name; // echarts category value = full date "2026-06-05"
    const shift = (params.seriesName === 'Day' ? 'day' : 'night') as 'day'|'night';
    drilldown = (drilldown?.day === day && drilldown?.shift === shift) ? null : { day, shift };
    loadAll();
  }

  function clearDrilldown() { drilldown = null; loadAll(); }

  function paretoChart(sec: SectionData, color: string) {
    const r = sec.reasons;
    // cumulative_pct now comes from backend computed from count
    return {
      tooltip: {
        trigger:'axis', axisPointer:{type:'shadow'},
        formatter: (ps: Array<{name:string;value:number;seriesName:string;color:string}>) => {
          const bar = ps.find(x=>x.seriesName==='Hours');
          if (!bar) return '';
          const row = r.find(x=>x.reason===bar.name || x.reason.slice(0,16)+'…'===bar.name);
          const cum  = ps.find(x=>x.seriesName==='Cum%');
          const mttr = row ? (row.avg_repair_min || (row.count > 0 ? Math.round(row.hours / row.count * 60) : 0)) : 0;
          return `<b>${bar.name}</b><br>` +
            `<span style="color:${bar.color}">●</span> Hours: <b>${(bar.value||0).toFixed(1)}h</b>` +
            ` <span style="color:var(--color-text-muted);font-size:11px">(${row?.count??0} events)</span><br>` +
            `<span style="color:#1C355E">●</span> Cumulative: <b>${cum?.value??0}%</b><br>` +
            `MTTR: <b>${mttr}m</b>`;
        },
      },
      grid: { top:8, left:20, right:55, bottom:90, containLabel:true },
      xAxis: {
        type:'category',
        data: r.map(x=>x.reason.length>16?x.reason.slice(0,16)+'…':x.reason),
        axisLabel:{rotate:38,fontSize:9,interval:0},
      },
      yAxis: [
        { type:'value', name:'h', nameTextStyle:{fontSize:10}, axisLabel:{fontSize:9,formatter:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)} },
        { type:'value', max:100, axisLabel:{formatter:'{value}%',fontSize:9}, splitLine:{show:false} },
      ],
      series: [
        { name:'Hours', type:'bar', data:r.map(x=>x.hours), itemStyle:{color}, barMaxWidth:32 },
        { name:'Cum%',  type:'line', yAxisIndex:1, data:r.map(x=>x.cumulative_pct),
          lineStyle:{color:'#1C355E',width:2}, itemStyle:{color:'#1C355E'}, symbol:'circle', symbolSize:5 },
      ],
    };
  }

  function machineChart(sec: SectionData, color: string) {
    const rows = sec.machines.slice(0, 15);
    return {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'},
        formatter:(ps:Array<{name:string;value:number}>) =>
          `${ps[0]?.name}: <b>${(ps[0]?.value||0).toLocaleString()} events</b>` },
      grid: { top:8, left:82, right:52, bottom:8 },
      xAxis: { type:'value', name:'events', nameTextStyle:{fontSize:9},
        axisLabel:{fontSize:9, formatter:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)} },
      yAxis: { type:'category', data:rows.map(r=>r.code_machine).reverse(), axisLabel:{fontSize:9} },
      series: [{ name:'Events', type:'bar', barMaxWidth:20,
        data: rows.map(r=>Number((r as {total_hours?:number}).total_hours??0)).reverse(),
        itemStyle:{color},
        label:{show:true, position:'right', fontSize:9,
          formatter:(p:{value:number})=>p.value?p.value.toLocaleString():'' } }],
    };
  }

  function fmtH(h:number){ if(h===null||h===undefined)return '—'; if(h<0.1)return h===0?'0h':'<6m'; return h<1?`${Math.round(h*60)}m`:`${h.toFixed(1)}h`; }
  function fmtMin(m:number){ if(!m||m===0)return '—'; return m<60?`${Math.round(m)}m`:`${(m/60).toFixed(1)}h`; }

  // ── Event Detail ─────────────────────────────────────────────────────────
  const ALL_JOB_TYPES: JobType[] = ['M/C DOWN','SETUP','SETUP BY OPERATOR','PM','CONVERT','CHANGE CAP','FACILITY DOWN','ENGINEERING DOWN'];
  const JT_COLORS: Record<string,string> = {
    'M/C DOWN':'#CC0000','SETUP':'#1D9CE4','SETUP BY OPERATOR':'#17A2B8',
    'PM':'#702076','CONVERT':'#FFA500','CHANGE CAP':'#8A8A8A',
    'FACILITY DOWN':'#FD7F20','ENGINEERING DOWN':'#990000',
  };

  interface EventRow { event_time:string; machine_id:string; area:string; job_type:string; symptom:string; cause:string; tech:string; wait_min:number; repair_min:number; die_mask:string; lot_no:string; package_type:string; }

  let evtTypes    = $state<string[]>(['M/C DOWN','SETUP','CONVERT','CHANGE CAP']);
  let evtMachine  = $state('');
  let evtSymptom  = $state('');
  let evtCause    = $state('');
  let evtTech     = $state('');
  let evtRows     = $state<EventRow[]>([]);
  let evtLoading  = $state(false);
  let evtError    = $state<string|null>(null);

  function toggleEvtType(jt: string) {
    if (evtTypes.includes(jt)) evtTypes = evtTypes.filter(x => x !== jt);
    else evtTypes = [...evtTypes, jt];
  }

  async function searchEvents() {
    evtLoading = true; evtError = null;
    try {
      const p = new URLSearchParams();
      if (evtTypes.length)  p.set('job_types', evtTypes.join(','));
      if (filters.start)    p.set('start', filters.start);
      if (filters.end)      p.set('end', filters.end);
      if (filters.areas.length) p.set('areas', filters.areas.join(','));
      if (filters.shift !== 'all') p.set('shift', filters.shift);
      if (evtMachine.trim()) p.set('machine', evtMachine.trim());
      if (evtSymptom.trim()) p.set('symptom', evtSymptom.trim());
      if (evtCause.trim())   p.set('cause', evtCause.trim());
      if (evtTech.trim())    p.set('tech', evtTech.trim());
      const base = (await import('$app/paths')).base;
      const res = await fetch(`${base}/api/downtime/events?${p.toString()}`);
      const json = await res.json();
      if (json.error) { evtError = json.error.message; evtRows = []; }
      else evtRows = json.data?.events ?? [];
    } catch (e) {
      evtError = e instanceof Error ? e.message : 'Error';
    }
    evtLoading = false;
  }

  function exportEvtCsv() {
    const hdrs = ['Date/Time','Machine','Area','Job Type','Symptom','Cause','Tech','Wait (min)','Repair (min)'];
    const esc = (v:unknown) => { const s=String(v??''); return s.includes(',')? `"${s.replace(/"/g,'""')}"`:s; };
    const rows = evtRows.map(r=>[r.event_time.replace('T',' ').slice(0,16),r.machine_id,r.area,r.job_type,r.symptom,r.cause,r.tech,r.wait_min,r.repair_min].map(esc).join(','));
    const stamp = new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
    const blob = new Blob(['﻿'+[hdrs.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`events_${stamp}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const evtCols = [
    { key:'event_time', label:'Date/Time', width:'118px', format:(v:unknown)=>String(v).replace('T',' ').slice(0,16) },
    { key:'machine_id', label:'Machine',   width:'90px',  sortable:true, renderHtml:(v:unknown)=>`<span style="font-weight:700;color:var(--color-primary)">${v}</span>` },
    { key:'area',       label:'Area',      width:'50px',  sortable:true },
    { key:'job_type',   label:'Type',      width:'115px',
      renderHtml:(v:unknown)=>{ const c=JT_COLORS[String(v)]??'#8A8A8A'; const tc=String(v)==='CONVERT'?'#333':'#fff'; return `<span style="background:${c};color:${tc};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap">${v}</span>`; } },
    { key:'symptom',    label:'Symptom',   width:'200px',
      renderHtml:(v:unknown)=>{ const t=String(v??'—'); const s=t.replace(/"/g,'&quot;'); return `<span title="${s}" style="display:block;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t}</span>`; } },
    { key:'cause',      label:'Cause',     width:'160px',
      renderHtml:(v:unknown)=>{ const t=String(v??'—'); const s=t.replace(/"/g,'&quot;'); return `<span title="${s}" style="display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6B3FA0">${t}</span>`; } },
    { key:'tech',       label:'Tech',      width:'80px',  sortable:true },
    { key:'wait_min',   label:'Wait',      width:'62px',  align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const m=Number(v); return `<span style="color:${m>60?'var(--color-accent-orange)':'inherit'}">${m}</span>`; } },
    { key:'repair_min',   label:'Repair',   width:'68px',  align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const m=Number(v); return `<span style="color:${m>120?'var(--status-down)':'inherit'};font-weight:600">${m}</span>`; } },
    { key:'package_type', label:'Package',  width:'90px',  sortable:true,
      format:(v:unknown):string=>String(v??'—')||'—' },
    { key:'lot_no',       label:'Lot No.',  width:'140px', sortable:true,
      renderHtml:(v:unknown)=>{ const t=String(v??'—'); return `<span style="font-family:monospace;font-size:11px">${t||'—'}</span>`; } },
    { key:'die_mask',     label:'Die Mask', width:'70px',  sortable:true,
      format:(v:unknown):string=>String(v??'—')||'—' },
  ];

  // ── $derived chart options ────────────────────────────────────────────────
  const downShiftOpt   = $derived.by(() => shiftChart(down,  DOWN_COLOR,  filters.shift));
  const setupShiftOpt  = $derived.by(() => shiftChart(setup, SETUP_COLOR, filters.shift));
  const downParetoOpt  = $derived.by(() => paretoChart(down,  DOWN_COLOR));
  const setupParetoOpt = $derived.by(() => paretoChart(setup, SETUP_COLOR));
  const downMachOpt    = $derived.by(() => machineChart(down,  DOWN_COLOR));
  const setupMachOpt   = $derived.by(() => machineChart(setup, SETUP_COLOR));

  onMount(loadAll);
</script>

<svelte:head><title>Downtime & Setup — EMH Dashboard</title></svelte:head>

<PageHeader title="Downtime & Setup Analysis" subtitle="Root cause breakdown · Day vs Night shift · Machine impact" />

<FilterBar
  startDate={filters.start}
  endDate={filters.end}
  onFilter={handleFilter}
/>

<!-- Setup Type selector -->
<div class="setup-type-bar">
  <span class="filter-lbl">SETUP TYPE</span>
  <div class="setup-opts">
    {#each SETUP_OPTIONS as opt (opt.value)}
      <button
        class="stype-btn"
        class:active={setupType === opt.value}
        onclick={() => changeSetupType(opt.value)}
      >{opt.label}</button>
    {/each}
  </div>
</div>

<!-- ── Row 1: KPI cards — M/C DOWN | SETUP ───────────────────────────────── -->
<div class="grid-2" style="margin-bottom:var(--gutter)">
  {#each [
    { sec:down,  label:'M/C DOWN',          color:DOWN_COLOR },
    { sec:setup, label:activeSetup.label,   color:SETUP_COLOR },
  ] as {sec,label,color} (label)}
    <div>
      <!-- Section header strip -->
      <div class="sec-strip" style="--c:{color}">
        <span class="sec-badge">{label}</span>
        {#if sec.loading}
          <span class="sec-status muted">Loading…</span>
        {:else if sec.error}
          <span class="sec-status err">⚠ {sec.error}</span>
        {:else}
          <span class="sec-status">{sec.kpi.total_events.toLocaleString()} events · {fmtH(sec.kpi.total_hours)}</span>
        {/if}
      </div>
      <!-- KPI: Total Hours | MTTR | MTTW -->
      <div class="kpi-row">
        <div class="kpi-card" style="--acc:{color}">
          <div class="kv" style="color:{color}">{fmtH(sec.kpi.total_hours)}</div>
          <div class="kl">Total Loss</div>
          <div class="ksub">{sec.kpi.total_events.toLocaleString()} events</div>
        </div>
        <div class="kpi-card" style="--acc:{color}">
          <div class="kv">{fmtMin(sec.kpi.avg_repair_min)}</div>
          <div class="kl">MTTR</div>
          <div class="ksub">mean repair time</div>
        </div>
        <div class="kpi-card" style="--acc:{color}">
          <div class="kv">{fmtMin(sec.kpi.avg_wait_min)}</div>
          <div class="kl">MTTW</div>
          <div class="ksub">mean wait time</div>
        </div>
      </div>
    </div>
  {/each}
</div>

<!-- ── Row 2: Shift trend ────────────────────────────────────────────────── -->
<div class="grid-2" style="margin-bottom:var(--gutter)">
  <div class="chart-card">
    <div class="chart-title">
      <span class="sec-dot" style="background:{DOWN_COLOR}"></span>
      M/C DOWN — Daily Trend · Day vs Night
      {#if drilldown}
        <button class="shift-active-pill" style="--pill-bg:{drilldown.shift==='day'?'#E07B00':'#702076'}" onclick={clearDrilldown}>
          {drilldown.day.slice(5)} · {drilldown.shift === 'day' ? '☀ Day' : '🌙 Night'} &times;
        </button>
      {:else}
        <span class="shift-hint">click bar to drill down</span>
      {/if}
    </div>
    {#if down.error}<div class="ph err">⚠ {down.error}</div>{/if}
    <EChart option={downShiftOpt}  height="240px" loading={down.loading} onclick={handleShiftClick} />
  </div>
  <div class="chart-card">
    <div class="chart-title">
      <span class="sec-dot" style="background:{SETUP_COLOR}"></span>
      {activeSetup.label} — Daily Trend · Day vs Night
      {#if drilldown}
        <button class="shift-active-pill" style="--pill-bg:{drilldown.shift==='day'?'#E07B00':'#702076'}" onclick={clearDrilldown}>
          {drilldown.day.slice(5)} · {drilldown.shift === 'day' ? '☀ Day' : '🌙 Night'} &times;
        </button>
      {/if}
    </div>
    {#if setup.error}<div class="ph err">⚠ {setup.error}</div>{/if}
    <EChart option={setupShiftOpt} height="240px" loading={setup.loading} onclick={handleShiftClick} />
  </div>
</div>

<!-- ── Row 3: Pareto ─────────────────────────────────────────────────────── -->
<div class="grid-2" style="margin-bottom:var(--gutter)">
  <div class="chart-card">
    <div class="chart-title"><span class="sec-dot" style="background:{DOWN_COLOR}"></span>M/C DOWN — Top {down.reasons.length} Reasons (Pareto)</div>
    {#if down.error}<div class="ph err">⚠ {down.error}</div>{/if}
    <EChart option={downParetoOpt}  height="290px" loading={down.loading} />
  </div>
  <div class="chart-card">
    <div class="chart-title"><span class="sec-dot" style="background:{SETUP_COLOR}"></span>{activeSetup.label} — Top {setup.reasons.length} Reasons (Pareto)</div>
    {#if setup.error}<div class="ph err">⚠ {setup.error}</div>{/if}
    <EChart option={setupParetoOpt} height="290px" loading={setup.loading} />
  </div>
</div>

<!-- ── Row 4: Machine charts ─────────────────────────────────────────────── -->
<div class="grid-2">
  <div class="chart-card">
    <div class="chart-title"><span class="sec-dot" style="background:{DOWN_COLOR}"></span>M/C DOWN — Top Machines by Events</div>
    {#if down.error}<div class="ph err">⚠ {down.error}</div>{/if}
    <EChart option={downMachOpt}  height="340px" loading={down.loading} />
  </div>
  <div class="chart-card">
    <div class="chart-title"><span class="sec-dot" style="background:{SETUP_COLOR}"></span>{activeSetup.label} — Top Machines by Events</div>
    {#if setup.error}<div class="ph err">⚠ {setup.error}</div>{/if}
    <EChart option={setupMachOpt} height="340px" loading={setup.loading} />
  </div>
</div>

<!-- ── Event Detail table ──────────────────────────────────────────────────── -->
<div class="chart-card" style="margin-top:var(--gutter)">
  <!-- Header -->
  <div class="evt-header">
    <div>
      <span class="evt-title">Event Detail</span>
      <span class="evt-sub">— All Events</span>
    </div>
    <div class="evt-header-right">
      <span class="evt-badge">M/C DOWN + SETUP</span>
      <button class="btn-export" onclick={exportEvtCsv} disabled={evtRows.length===0}>↓ Export CSV</button>
    </div>
  </div>

  <!-- Job Type chips -->
  <div class="evt-filter-group">
    <span class="filter-lbl">JOB TYPE</span>
    <div class="jt-chips">
      {#each ALL_JOB_TYPES as jt (jt)}
        <button
          class="jt-chip"
          class:active={evtTypes.includes(jt)}
          style:--jt-color={JT_COLORS[jt] ?? '#8A8A8A'}
          onclick={() => toggleEvtType(jt)}
        >{jt}</button>
      {/each}
    </div>
  </div>

  <!-- Sub-filters row -->
  <div class="evt-subfilters">
    <div class="sf-group">
      <label class="filter-lbl" for="sf-machine">MACHINE</label>
      <input id="sf-machine" class="input sf-input" type="text" placeholder="e.g. W/B #275R" bind:value={evtMachine} onkeydown={(e)=>e.key==='Enter'&&searchEvents()} />
    </div>
    <div class="sf-group">
      <label class="filter-lbl" for="sf-symptom">SYMPTOM</label>
      <input id="sf-symptom" class="input sf-input" type="text" placeholder="All Symptoms" bind:value={evtSymptom} onkeydown={(e)=>e.key==='Enter'&&searchEvents()} />
    </div>
    <div class="sf-group">
      <label class="filter-lbl" for="sf-cause">CAUSE</label>
      <input id="sf-cause" class="input sf-input" type="text" placeholder="All Causes" bind:value={evtCause} onkeydown={(e)=>e.key==='Enter'&&searchEvents()} />
    </div>
    <div class="sf-group">
      <label class="filter-lbl" for="sf-tech">TECH</label>
      <input id="sf-tech" class="input sf-input" type="text" placeholder="All Techs" bind:value={evtTech} onkeydown={(e)=>e.key==='Enter'&&searchEvents()} />
    </div>
    <button class="btn btn-solid sf-search" onclick={searchEvents} disabled={evtLoading}>
      {evtLoading ? 'Loading…' : 'Search'}
    </button>
  </div>

  <!-- Results -->
  {#if evtError}
    <div class="ph err">⚠ {evtError}</div>
  {:else if evtLoading}
    <div class="ph">Loading events…</div>
  {:else if evtRows.length === 0}
    <div class="ph">No events data. Press Search to load.</div>
  {:else}
    <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:4px">{evtRows.length} events</div>
    <DataTable columns={evtCols} rows={evtRows} rowKey={(_r,i)=>String(i)} compact pageSize={20} />
  {/if}
</div>

<style>
  /* Event Detail */
  .evt-header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 10px; border-bottom: 1px solid var(--color-border); margin-bottom: 12px;
  }
  .evt-title { font-size: 14px; font-weight: 700; color: var(--color-text-dark); }
  .evt-sub   { font-size: 12px; color: var(--color-text-muted); }
  .evt-header-right { display: flex; align-items: center; gap: 10px; }
  .evt-badge {
    font-size: 10px; font-weight: 700; color: var(--color-primary);
    background: rgba(28,53,94,.08); padding: 2px 9px; border-radius: 10px;
    text-transform: uppercase; letter-spacing: 0.04em;
  }

  .evt-filter-group { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .jt-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .jt-chip {
    font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
    border: 1.5px solid var(--color-border-strong);
    background: transparent; cursor: pointer; color: var(--color-text-muted);
    transition: all 0.1s; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .jt-chip:hover  { border-color: var(--jt-color); color: var(--jt-color); }
  .jt-chip.active { background: var(--jt-color); color: #fff; border-color: var(--jt-color); }

  .evt-subfilters { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 10px; }
  .sf-group { display: flex; flex-direction: column; gap: 4px; }
  .sf-input { width: 160px; }
  .sf-search { min-width: 90px; }

  /* Setup type selector */
  .setup-type-bar {
    display: flex; align-items: center; gap: 12px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm); padding: 10px 14px;
    margin-bottom: var(--gutter);
  }
  .filter-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); white-space: nowrap; }
  .setup-opts { display: flex; gap: 6px; }
  .stype-btn {
    font-size: 12px; font-weight: 600;
    padding: 4px 14px; border-radius: var(--r-sm);
    border: 1.5px solid var(--color-border-strong);
    background: transparent; cursor: pointer; color: var(--color-text-muted);
    transition: all 0.12s;
  }
  .stype-btn:hover  { border-color: #1D9CE4; color: #1D9CE4; }
  .stype-btn.active { background: #1D9CE4; color: #fff; border-color: #1D9CE4; }

  /* Section header strip */
  .sec-strip {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--c);
  }
  .sec-badge {
    display: inline-block; font-size: 11px; font-weight: 700;
    color: #fff; background: var(--c);
    padding: 3px 11px; border-radius: 4px;
    text-transform: uppercase; letter-spacing: 0.05em;
    flex-shrink: 0;
  }
  .sec-status       { font-size: 12px; color: var(--color-text-muted); }
  .sec-status.muted { color: var(--color-text-disabled); font-style: italic; }
  .sec-status.err   { color: var(--status-down); font-weight: 600; }

  /* KPI row — single horizontal row */
  .kpi-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    margin-bottom: 0;
  }
  .kpi-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-top: 3px solid var(--acc, var(--color-border-strong));
    border-radius: var(--r-sm);
    padding: 12px 16px;
    text-align: center;
  }
  .kv   { font-size: 26px; font-weight: 700; color: var(--color-primary); line-height: 1.1; }
  .kl   { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); margin-top: 4px; }
  .ksub { font-size: 11px; color: var(--color-text-disabled); margin-top: 2px; }

  /* Chart card title */
  .chart-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--color-text-muted);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 10px;
  }
  .sec-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  /* Active shift pill — dismissible filter indicator */
  .shift-active-pill {
    margin-left: auto;
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; font-weight: 700;
    padding: 2px 9px; border-radius: 10px;
    background: var(--pill-bg, var(--color-primary)); color: #fff;
    border: none; cursor: pointer;
    letter-spacing: 0.02em;
    opacity: 0.92;
    transition: opacity 0.12s;
  }
  .shift-active-pill:hover { opacity: 1; }
  .shift-hint {
    margin-left: auto;
    font-size: 10px; font-weight: 400; font-style: italic;
    color: var(--color-text-disabled); text-transform: none; letter-spacing: 0;
  }

  /* Placeholders */
  .ph { padding: 32px; color: var(--color-text-muted); font-size: 13px; text-align: center; }
  .ph.err { background:#FFF0F0; border-radius:var(--r-sm); color:var(--status-down); font-weight:600; padding:12px 16px; }
</style>
