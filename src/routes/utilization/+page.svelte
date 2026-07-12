<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import EChart from '$lib/components/EChart.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import { utilizationApi } from '$lib/utils/api';
  import type { MachineArea } from '$types';

  // ── Types ─────────────────────────────────────────────────────────────────
  interface KpiState { utilization_pct: number; downtime_pct: number; pm_pct: number; lost_time_pct: number; }
  interface MonthlyRow { month: string; running_min: number; down_min: number; pm_min: number; lost_min: number; }
  interface AreaRow  { area: string; utilization_pct: number; target_pct: number; }
  interface CauseRow { reason: string; hours: number; cumulative_pct: number; events?: number; }
  interface ScatterRow { code_machine: string; area: string; frequency: number; avg_duration_h: number; }
  interface MachRow  { code_machine: string; area: string; utilization_pct: number; down_min: number; pm_min: number; lost_min: number; }

  // ── State ─────────────────────────────────────────────────────────────────
  let kpi        = $state<KpiState>({ utilization_pct:0, downtime_pct:0, pm_pct:0, lost_time_pct:0 });
  let kpiPrev    = $state<KpiState|null>(null);
  let monthly    = $state<MonthlyRow[]>([]);
  let areaUtil   = $state<AreaRow[]>([]);
  let topDown    = $state<CauseRow[]>([]);
  let topLost    = $state<CauseRow[]>([]);
  let scatterData= $state<ScatterRow[]>([]);
  let machines   = $state<MachRow[]>([]);
  let loading    = $state(true);
  let error      = $state<string|null>(null);
  let lastUpdated= $state<string|undefined>(undefined);

  let filters = $state({
    start: (() => { const d = new Date(); d.setDate(d.getDate()-365); return d.toISOString().slice(0,10); })(),
    end:   new Date().toISOString().slice(0,10),
    areas: [] as MachineArea[],
    shift: 'all' as 'all'|'day'|'night',
  });

  function utilColor(pct: number): string {
    return pct >= 80 ? 'var(--status-running)' : pct >= 70 ? 'var(--status-waiting)' : 'var(--status-down)';
  }

  // higherIsBetter=true (Utilization): rising = good/green. Otherwise rising = bad/red.
  function trendInfo(current: number, prev: number, higherIsBetter: boolean) {
    const delta = +(current - prev).toFixed(1);
    const good = higherIsBetter ? delta >= 0 : delta <= 0;
    return { delta, arrow: delta > 0 ? '▲' : delta < 0 ? '▼' : '—', color: delta === 0 ? 'var(--color-text-muted)' : (good ? 'var(--status-running)' : 'var(--status-down)') };
  }

  async function loadData() {
    loading = true; error = null;
    const p = { start: filters.start, end: filters.end,
      shift: filters.shift !== 'all' ? filters.shift : undefined,
      areas: filters.areas.length > 0 ? filters.areas : undefined };
    const res = await utilizationApi.detail(p);
    if (res.error) { error = res.error.message; loading = false; return; }
    if (!res.data)  { loading = false; return; }

    const d = res.data;
    const raw = d.raw ?? {};
    const totals = raw.kpi_totals ?? [];
    const fp = (rows: {label:string;pct:number}[], label: string) => rows.find(r => r.label?.toLowerCase().includes(label))?.pct ?? 0;

    kpi = { utilization_pct: fp(totals,'run')||fp(totals,'util'), downtime_pct: fp(totals,'down'), pm_pct: fp(totals,'pm'), lost_time_pct: fp(totals,'lost') };

    const prevTotals = raw.prev_kpi_totals ?? [];
    kpiPrev = prevTotals.length
      ? { utilization_pct: fp(prevTotals,'run')||fp(prevTotals,'util'), downtime_pct: fp(prevTotals,'down'), pm_pct: fp(prevTotals,'pm'), lost_time_pct: fp(prevTotals,'lost') }
      : null;

    monthly    = (d.monthly_trend ?? []) as MonthlyRow[];
    // DA runs a lower target than other areas (80% vs 85%) — the API currently
    // returns 85% for every area, so override it here rather than trust that field for DA.
    areaUtil   = ((raw.area_totals ?? []) as {area:string;utilization_pct:number;target_pct?:number}[])
                 .map(r => ({ area: r.area, utilization_pct: r.utilization_pct??0, target_pct: r.area === 'DA' ? 80 : (r.target_pct??85) }))
                 .sort((a,b) => a.utilization_pct - b.utilization_pct);
    topDown    = (d.top_down ?? []) as CauseRow[];
    topLost    = (d.top_lost ?? []) as CauseRow[];
    scatterData= (d.scatter  ?? []) as ScatterRow[];
    machines   = ((d.machine_rows ?? []) as MachRow[]).sort((a,b) => a.utilization_pct - b.utilization_pct);
    lastUpdated = new Date().toISOString();
    loading = false;
  }

  function handleFilter(f: {start:string;end:string;areas:MachineArea[];shift:'all'|'day'|'night'}) {
    filters = f; loadData();
  }

  const noData = $derived(!loading && !error && machines.length === 0 && monthly.length === 0);

  // Scatter: join scatterData with machine_rows to derive avg down duration (minutes) per event
  const scatterWithDur = $derived(
    scatterData.map(s => {
      const m = machines.find(r => r.code_machine === s.code_machine);
      const downMin = m ? m.down_min : 0;
      return { ...s, avg_duration_min: s.frequency > 0 ? +(downMin / s.frequency).toFixed(1) : 0 };
    })
  );

  // ── Attention list: top 10 machines by loss severity ──────────────────────
  const attentionList = $derived(
    [...machines]
      .filter(r => r.down_min > 0 || r.lost_min > 0)
      .map(r => {
        const s = scatterWithDur.find(x => x.code_machine === r.code_machine);
        return { ...r, events: s?.frequency ?? 0, avg_mttr_min: s ? Math.round(s.avg_duration_min) : 0,
          score: +(r.down_min*2 + r.lost_min).toFixed(1) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((r, i) => ({ ...r, rank: i + 1 }))
  );

  // ── Chart options ─────────────────────────────────────────────────────────
  // ECharts renders to <canvas>, which cannot resolve CSS custom properties —
  // these mirror the --status-* tokens in app.css so canvas colors stay in sync with the design system.
  const STATUS = {
    running: '#5EBF33', down: '#CC0000', pm: '#702076', waiting: '#FD7F20',
    setup: '#1D9CE4', other: '#8A8A8A', primary: '#1C355E',
  };

  // Monthly — 100% stacked %
  const monthlyOpt = $derived.by(() => {
    const rows = monthly.map(r => {
      const total = r.running_min + r.down_min + r.pm_min + r.lost_min || 1;
      return { month: r.month.slice(5), run: r.running_min/total*100, down: r.down_min/total*100, pm: r.pm_min/total*100, lost: r.lost_min/total*100 };
    });
    return {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, formatter:(p:unknown[]) => {
        const ps = p as Array<{name:string;seriesName:string;value:number;color:string}>;
        return `<b>${ps[0]?.name}</b><br>${ps.map(s=>`<span style="color:${s.color}">●</span> ${s.seriesName}: <b>${s.value.toFixed(1)}%</b>`).join('<br>')}`;
      }},
      legend: { top:0, data:['Running','Downtime','PM','Lost Time'], textStyle:{fontSize:11} },
      grid: { top:36, left:46, right:14, bottom:28 },
      xAxis: { type:'category', data:rows.map(r=>r.month), axisLabel:{fontSize:11} },
      yAxis: { type:'value', max:100, axisLabel:{formatter:'{value}%',fontSize:11} },
      series: [
        { name:'Running',   type:'bar', stack:'s', data:rows.map(r=>+r.run.toFixed(1)),  itemStyle:{color:STATUS.running}, emphasis:{focus:'series'} },
        { name:'Downtime',  type:'bar', stack:'s', data:rows.map(r=>+r.down.toFixed(1)), itemStyle:{color:STATUS.down}, emphasis:{focus:'series'} },
        { name:'PM',        type:'bar', stack:'s', data:rows.map(r=>+r.pm.toFixed(1)),   itemStyle:{color:STATUS.pm}, emphasis:{focus:'series'} },
        { name:'Lost Time', type:'bar', stack:'s', data:rows.map(r=>+r.lost.toFixed(1)), itemStyle:{color:STATUS.waiting}, emphasis:{focus:'series'} },
      ],
    };
  });

  const areaOpt = $derived({
    tooltip: { trigger:'axis' },
    grid: { top:8, left:58, right:72, bottom:16 },
    xAxis: { type:'value', max:100, axisLabel:{formatter:'{value}%',fontSize:11} },
    yAxis: { type:'category', data:areaUtil.map(r=>r.area), axisLabel:{fontSize:11} },
    series: [
      { type:'bar', data:areaUtil.map(r=>r.utilization_pct),
        itemStyle:{ color:(p:{value:number;dataIndex:number}) => {
          const t = areaUtil[p.dataIndex]?.target_pct??80;
          return p.value>=t?STATUS.running:STATUS.down; }},
        label:{show:true,position:'right',formatter:(p:{value:number})=>`${Number(p.value).toFixed(1)}%`,fontSize:11} },
      { type:'scatter', data:areaUtil.map(r=>[r.target_pct,r.area]),
        symbolSize:14, symbol:'diamond', itemStyle:{color:STATUS.primary}, tooltip:{formatter:'Target: {c[0]}%'} },
    ],
  });

  // Top 5, individual % of total (M/C DOWN events for downtime, hours for lost time), horizontal bar
  function causeOpt(data: CauseRow[], color: string) {
    const total = data.reduce((s, r) => s + (r.events ?? r.hours ?? 0), 0);
    const top5 = [...data]
      .sort((a,b) => (b.events ?? b.hours ?? 0) - (a.events ?? a.hours ?? 0))
      .slice(0, 5)
      .map(r => ({ reason: r.reason, pct: total ? +((r.events ?? r.hours ?? 0) / total * 100).toFixed(2) : 0 }))
      .reverse(); // ascending so the largest renders at the top of the horizontal bar
    return {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, formatter:(p: Array<{name:string;value:number}>) => `<b>${p[0]?.name}</b>: ${p[0]?.value}%` },
      grid: { top:8, left:8, right:48, bottom:8, containLabel:true },
      xAxis: { type:'value', max:'dataMax', axisLabel:{formatter:'{value}%',fontSize:10} },
      yAxis: { type:'category', data:top5.map(r=>r.reason), axisLabel:{fontSize:11} },
      series: [
        { type:'bar', data:top5.map(r=>r.pct), itemStyle:{color}, barMaxWidth:22,
          label:{show:true,position:'right',formatter:'{c}%',fontSize:11} },
      ],
    };
  }

  const downOpt  = $derived(causeOpt(topDown,  STATUS.waiting));
  const lostOpt  = $derived(causeOpt(topLost,  STATUS.pm));

  // Scatter: Frequency vs Duration. Only machines with at least one M/C DOWN event —
  // zero-frequency rows can't sit on a log axis and add nothing to a "which machines are the worst" view.
  const scatterPoints = $derived(scatterWithDur.filter(r => r.frequency > 0));

  function median(nums: number[]): number {
    if (!nums.length) return 0;
    const s = [...nums].sort((a,b)=>a-b);
    const mid = Math.floor(s.length/2);
    return s.length % 2 ? s[mid] : (s[mid-1]+s[mid])/2;
  }

  // Scatter: Frequency vs Duration
  const scatterOpt = $derived.by(() => {
    const freqs = scatterPoints.map(r=>r.frequency);
    const durs  = scatterPoints.map(r=>r.avg_duration_min);
    const medFreq = median(freqs) || 1;
    const medDur  = median(durs)  || 1;
    const maxFreq = Math.max(...freqs, medFreq*2);
    const maxDur  = Math.max(...durs, medDur*2);
    const AREA_COLORS: Record<string,string> = {
      'WB':STATUS.setup,'DA':'#009688','BG':STATUS.pm,'SAW':STATUS.waiting,'MOLD':STATUS.down,
      'PLATE':STATUS.running,'MARK':'#17A2B8','SAW_QFN':'#F68D2E','TF':'#6B3FA0','ISO':STATUS.other,'FS':STATUS.primary,
    };
    return {
      tooltip: { formatter:(p:{value:[number,number,string,string]}) =>
        `<b>${p.value[2]}</b> [${p.value[3]}]<br>Events: ${p.value[0]}<br>Avg Duration: ${p.value[1].toFixed(1)} min` },
      grid: { top:36, left:56, right:120, bottom:56 },
      // Log scale: machine event counts are heavily skewed (many low-frequency, a few very high),
      // a linear axis bunches nearly everything against the left edge.
      xAxis: { type:'log', name:'Events (frequency)', nameLocation:'center', nameGap:32, axisLabel:{fontSize:10}, min:1 },
      yAxis: { type:'value', name:'Avg Duration (min)', nameLocation:'center', nameGap:42, axisLabel:{fontSize:10} },
      series: [{
        type:'scatter',
        data: scatterPoints.map(r=>[r.frequency, r.avg_duration_min, r.code_machine, r.area]),
        symbolSize: (d:[number,number]) => Math.min(6 + Math.sqrt(d[0])*1.5, 28),
        itemStyle: { color:(p:{value:[number,number,string,string]}) => AREA_COLORS[p.value[3]]??'#8A8A8A', opacity:.75 },
      },
      // Quadrant lines at the median (robust to outliers, unlike a min/max midpoint)
      { type:'line', data:[[medFreq,0],[medFreq,maxDur*1.1]], lineStyle:{type:'dashed',color:'#ccc',width:1}, symbol:'none', silent:true, tooltip:{show:false} },
      { type:'line', data:[[1,medDur],[maxFreq*1.1,medDur]], lineStyle:{type:'dashed',color:'#ccc',width:1}, symbol:'none', silent:true, tooltip:{show:false} },
      ],
      graphic: [
        { type:'text', left:'56%', top:'10%',  style:{text:'CHRONIC',    fill:STATUS.down, fontSize:9, fontWeight:'700', opacity:.5} },
        { type:'text', left:'16%', top:'10%',  style:{text:'SEVERE',     fill:STATUS.waiting, fontSize:9, fontWeight:'700', opacity:.5} },
        { type:'text', left:'56%', bottom:'60px', style:{text:'NUISANCE', fill:STATUS.setup, fontSize:9, fontWeight:'700', opacity:.5} },
        { type:'text', left:'16%', bottom:'60px', style:{text:'HEALTHY',  fill:STATUS.running, fontSize:9, fontWeight:'700', opacity:.5} },
      ],
    };
  });

  // ── Machine table ─────────────────────────────────────────────────────────
  // Per-machine total minutes aren't returned by the API, but are derivable from what is:
  // utilization_pct = running/(down+pm+lost+running) => total = (down+pm+lost)/(1 - utilization_pct/100)
  function machinePct(r: MachRow, min: number): number {
    const total = (r.down_min + r.pm_min + r.lost_min) / (1 - Math.min(r.utilization_pct, 99.9)/100);
    return total > 0 ? +(min / total * 100).toFixed(2) : 0;
  }

  const machCols = [
    { key:'code_machine', label:'Machine', width:'100px', sortable:true },
    { key:'area',         label:'Area',    width:'55px',  sortable:true },
    { key:'utilization_pct', label:'Util %', width:'75px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const p=Number(v); return `<span style="font-weight:700;color:${utilColor(p)}">${p.toFixed(1)}%</span>`; } },
    { key:'down_min', label:'Downtime %', width:'78px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown,r:MachRow)=>`${machinePct(r, Number(v)).toFixed(1)}%` },
    { key:'pm_min',   label:'PM %',   width:'62px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown,r:MachRow)=>`${machinePct(r, Number(v)).toFixed(1)}%` },
    { key:'lost_min', label:'Lost Time %', width:'78px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown,r:MachRow)=>`${machinePct(r, Number(v)).toFixed(1)}%` },
  ];

  const attentionCols = [
    { key:'rank', label:'Rank', width:'44px', align:'center' as const,
      renderHtml:(v:unknown)=>{ const n=Number(v); const bg = n<=3?'var(--status-down)':'var(--status-waiting)';
        return `<span style="display:inline-block;min-width:22px;padding:1px 5px;border-radius:var(--r-sm);background:${bg};color:#fff;font-weight:700;font-size:11px">#${n}</span>`; } },
    { key:'code_machine', label:'Machine', width:'96px', sortable:true,
      renderHtml:(v:unknown)=>`<span style="font-weight:700;color:var(--color-primary)">${v}</span>` },
    { key:'area',         label:'Area',    width:'50px',  sortable:true },
    { key:'down_min', label:'Down Hrs', width:'68px', align:'right' as const, sortable:true, format:(v:unknown):string=>(Number(v)/60).toFixed(1) },
    { key:'events',   label:'Events',   width:'56px', align:'right' as const, sortable:true },
    { key:'avg_mttr_min', label:'Avg MTTR', width:'70px', align:'right' as const, sortable:true, format:(v:unknown):string=>`${v} m` },
    { key:'score',    label:'Score',    width:'60px', align:'right' as const, sortable:true },
  ];

  // CSV export for machine table
  function exportCsv() {
    const hdrs = ['Machine','Area','Utilization%','Downtime%','PM%','LostTime%'];
    const esc = (v:unknown)=>{ const s=String(v??''); return s.includes(',')? `"${s.replace(/"/g,'""')}"`:s; };
    const rows = machines.map(r=>[r.code_machine,r.area,r.utilization_pct.toFixed(1),machinePct(r,r.down_min).toFixed(1),machinePct(r,r.pm_min).toFixed(1),machinePct(r,r.lost_min).toFixed(1)].map(esc).join(','));
    const stamp = new Date().toISOString().slice(0,10);
    const blob = new Blob(['﻿'+[hdrs.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`utilization_${stamp}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  onMount(loadData);
</script>

<svelte:head><title>Utilization — EMH Dashboard</title></svelte:head>

<PageHeader title="Utilization Analysis" subtitle="Equipment effectiveness · Downtime · Lost Time breakdown" refreshAt={lastUpdated} />

<FilterBar
  startDate={filters.start}
  endDate={filters.end}
  selectedAreas={filters.areas.length > 0 ? filters.areas : undefined}
  shift={filters.shift}
  shiftVariant="dropdown"
  onFilter={handleFilter}
/>

{#if error}
  <div class="banner err"><span role="img" aria-label="Error">⚠</span> {error}</div>
{:else if loading}
  <div class="banner load">Loading…</div>
{:else if noData}
  <div class="banner empty">No data for the selected period/filters.</div>
{/if}

<!-- ── Row 1: KPI Tiles ───────────────────────────────────────────────────── -->
<div class="kpi-row mb">
  <div class="kpi-card" style="--acc:{STATUS.running}">
    <div class="kh"><span class="ki" style="background:{STATUS.running}22">⚙</span><span class="kl">Percent Utilization</span></div>
    <div class="kv" style="color:{STATUS.running}">{kpi.utilization_pct.toFixed(1)}%</div>
    <div class="ksub">100% − Down − PM − Lost</div>
    {#if kpiPrev}
      {@const t = trendInfo(kpi.utilization_pct, kpiPrev.utilization_pct, true)}
      <div class="ktrend" style="color:{t.color}">{t.arrow} {t.delta > 0 ? '+' : ''}{t.delta}% vs prev period</div>
    {/if}
  </div>
  <div class="kpi-card" style="--acc:{STATUS.down}">
    <div class="kh"><span class="ki" style="background:{STATUS.down}22">⛔</span><span class="kl">Percent Downtime</span></div>
    <div class="kv" style="color:{STATUS.down}">{kpi.downtime_pct.toFixed(1)}%</div>
    <div class="ksub">M/C DOWN only</div>
    {#if kpiPrev}
      {@const t = trendInfo(kpi.downtime_pct, kpiPrev.downtime_pct, false)}
      <div class="ktrend" style="color:{t.color}">{t.arrow} {t.delta > 0 ? '+' : ''}{t.delta}% vs prev period</div>
    {/if}
  </div>
  <div class="kpi-card" style="--acc:{STATUS.pm}">
    <div class="kh"><span class="ki" style="background:{STATUS.pm}22">🔧</span><span class="kl">Percent Downtime PM</span></div>
    <div class="kv" style="color:{STATUS.pm}">{kpi.pm_pct.toFixed(1)}%</div>
    <div class="ksub">Planned maintenance</div>
    {#if kpiPrev}
      {@const t = trendInfo(kpi.pm_pct, kpiPrev.pm_pct, false)}
      <div class="ktrend" style="color:{t.color}">{t.arrow} {t.delta > 0 ? '+' : ''}{t.delta}% vs prev period</div>
    {/if}
  </div>
  <div class="kpi-card" style="--acc:{STATUS.waiting}">
    <div class="kh"><span class="ki" style="background:{STATUS.waiting}22">⏱</span><span class="kl">Percent Lost Time</span></div>
    <div class="kv" style="color:{STATUS.waiting}">{kpi.lost_time_pct.toFixed(1)}%</div>
    <div class="ksub">Setup · Wait · Convert</div>
    {#if kpiPrev}
      {@const t = trendInfo(kpi.lost_time_pct, kpiPrev.lost_time_pct, false)}
      <div class="ktrend" style="color:{t.color}">{t.arrow} {t.delta > 0 ? '+' : ''}{t.delta}% vs prev period</div>
    {/if}
  </div>
</div>

<!-- ── Row 2: Monthly Composition (%) + Utilization by Area ───────────────── -->
<div class="grid-2 mb">
  <div class="chart-card">
    <div class="ct">Time Composition by Month<span class="ct-sub">Click bar to filter</span></div>
    <EChart option={monthlyOpt} height="240px" />
  </div>
  <div class="chart-card">
    <div class="ct">Utilization by Area<span class="ct-sub">Current Period</span></div>
    <EChart option={areaOpt} height="240px" />
  </div>
</div>

<!-- ── Row 3: Top Downtime + Top Lost Time ────────────────────────────────── -->
<div class="grid-2 mb">
  <div class="chart-card">
    <div class="ct">Top 5 Downtime<span class="ct-sub">M/C DOWN</span></div>
    <EChart option={downOpt} height="200px" />
  </div>
  <div class="chart-card">
    <div class="ct">Top 5 Lost Time<span class="ct-sub">Setup · Wait</span></div>
    <EChart option={lostOpt} height="200px" />
  </div>
</div>

<!-- ── Row 4: Attention List + Frequency vs Duration Scatter ─────────────── -->
<div class="grid-2 mb">
  <div class="chart-card">
    <div class="ct">Top 10 Machines Needing Attention<span class="ct-sub">Action List</span></div>
    <DataTable columns={attentionCols} rows={attentionList} rowKey={r=>r.code_machine} compact pageSize={10} />
  </div>
  <div class="chart-card">
    <div class="ct">Downtime: Frequency vs Duration<span class="ct-sub">Per Machine</span></div>
    <EChart option={scatterOpt} height="300px" />
  </div>
</div>

<!-- ── Row 5: Full Machine Breakdown Table ────────────────────────────────── -->
<div class="chart-card">
  <div class="ct-row">
    <div class="ct">Machine Breakdown — Sorted by Utilization (Lowest First)</div>
    <div class="ct-row-actions">
      <span class="pill">{machines.length <= 100 ? `Top ${machines.length}` : 'Top 100'}</span>
      <button class="btn btn-outline btn-sm" onclick={exportCsv} disabled={machines.length===0}>↓ CSV</button>
    </div>
  </div>
  <DataTable columns={machCols} rows={machines} rowKey={r=>r.code_machine} compact pageSize={20} />
</div>

<style>
  .mb { margin-bottom: var(--gutter); }
  .banner { padding:10px 16px; border-radius:var(--r-sm); font-size:13px; font-weight:600; margin-bottom:var(--gutter); }
  .banner.err   { background:#FFF0F0; border:1px solid var(--status-down); color:var(--status-down); }
  .banner.load  { background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text-muted); }
  .banner.empty { background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text-muted); font-style:italic; }

  .ct {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em; color: var(--color-text-muted); margin-bottom: 8px;
  }
  .ct-sub { display:block; font-size:10px; font-weight:400; text-transform:none; letter-spacing:0; color:var(--color-text-disabled); margin-top:2px; }
  .ct-row  { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; padding-bottom:8px; border-bottom:1px solid var(--color-border); }
  .ct-row .ct { margin-bottom:0; border:none; padding:0; }
  .ct-row-actions { display:flex; align-items:center; gap:8px; }
  .pill {
    font-size:10px; font-weight:700; color:var(--color-text-muted);
    background:var(--color-surface-gray); border:1px solid var(--color-border);
    border-radius:var(--r-sm); padding:2px 8px; text-transform:uppercase; letter-spacing:0.03em;
  }

  .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:var(--gutter); }
  .kpi-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-top: 3px solid var(--acc, var(--color-border-strong));
    border-radius: var(--r-sm);
    padding: 14px 16px;
  }
  .kh { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .ki { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:var(--r-sm); font-size:12px; flex-shrink:0; }
  .kv { font-size: 28px; font-weight: 700; line-height: 1.1; }
  .kl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }
  .ksub { font-size: 11px; color: var(--color-text-disabled); margin-top: 2px; }
  .ktrend { font-size: 11px; font-weight: 600; margin-top: 6px; }
</style>
