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
  let monthly    = $state<MonthlyRow[]>([]);
  let areaUtil   = $state<AreaRow[]>([]);
  let topDown    = $state<CauseRow[]>([]);
  let topLost    = $state<CauseRow[]>([]);
  let scatterData= $state<ScatterRow[]>([]);
  let machines   = $state<MachRow[]>([]);
  let loading    = $state(true);
  let error      = $state<string|null>(null);

  let filters = $state({
    start: (() => { const d = new Date(); d.setDate(d.getDate()-365); return d.toISOString().slice(0,10); })(),
    end:   new Date().toISOString().slice(0,10),
    areas: [] as MachineArea[],
    shift: 'all' as 'all'|'day'|'night',
  });

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
    const fp = (label: string) => totals.find((r: {label:string;pct:number}) => r.label?.toLowerCase().includes(label))?.pct ?? 0;

    kpi = { utilization_pct: fp('run')||fp('util'), downtime_pct: fp('down'), pm_pct: fp('pm'), lost_time_pct: fp('lost') };
    monthly    = (d.monthly_trend ?? []) as MonthlyRow[];
    areaUtil   = ((raw.area_totals ?? []) as {area:string;utilization_pct:number;target_pct?:number}[])
                 .map(r => ({ area: r.area, utilization_pct: r.utilization_pct??0, target_pct: r.target_pct??80 }));
    topDown    = (d.top_down ?? []) as CauseRow[];
    topLost    = (d.top_lost ?? []) as CauseRow[];
    scatterData= (d.scatter  ?? []) as ScatterRow[];
    machines   = ((d.machine_rows ?? []) as MachRow[]).sort((a,b) => a.utilization_pct - b.utilization_pct);
    loading = false;
  }

  function handleFilter(f: {start:string;end:string;areas:MachineArea[];shift:'all'|'day'|'night'}) {
    filters = f; loadData();
  }

  // ── Attention list: top 10 machines by loss severity ──────────────────────
  const attentionList = $derived(
    [...machines]
      .filter(r => r.down_min > 0 || r.lost_min > 0)
      .sort((a, b) => (b.down_min*2 + b.lost_min) - (a.down_min*2 + a.lost_min))
      .slice(0, 10)
  );

  // ── Chart options ─────────────────────────────────────────────────────────
  function gaugeOpt(value: number, name: string, max: number, color: string) {
    return { series: [{ type:'gauge', radius:'90%', startAngle:210, endAngle:-30, min:0, max,
      splitNumber:5, progress:{show:true,width:12}, pointer:{show:false},
      axisLine:{lineStyle:{width:12,color:[[1,'#e8e8e8']]}},
      axisTick:{show:false}, splitLine:{show:false}, axisLabel:{fontSize:10,distance:-38},
      detail:{valueAnimation:true,formatter:'{value}%',fontSize:22,fontWeight:'bold',color,offsetCenter:[0,'30%']},
      title:{fontSize:11,color:'#838E93',offsetCenter:[0,'60%']},
      data:[{value:Number(value.toFixed(1)),name,itemStyle:{color}}] }] };
  }

  const gaugeUtil  = $derived(gaugeOpt(kpi.utilization_pct, 'Utilization', 100, '#5EBF33'));
  const gaugeDown  = $derived(gaugeOpt(kpi.downtime_pct,    'Downtime',    20,  '#CC0000'));
  const gaugePm    = $derived(gaugeOpt(kpi.pm_pct,          'PM',          10,  '#702076'));
  const gaugeLost  = $derived(gaugeOpt(kpi.lost_time_pct,   'Lost Time',   30,  '#FD7F20'));

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
        { name:'Running',   type:'bar', stack:'s', data:rows.map(r=>+r.run.toFixed(1)),  itemStyle:{color:'#5EBF33'}, emphasis:{focus:'series'} },
        { name:'Downtime',  type:'bar', stack:'s', data:rows.map(r=>+r.down.toFixed(1)), itemStyle:{color:'#CC0000'}, emphasis:{focus:'series'} },
        { name:'PM',        type:'bar', stack:'s', data:rows.map(r=>+r.pm.toFixed(1)),   itemStyle:{color:'#702076'}, emphasis:{focus:'series'} },
        { name:'Lost Time', type:'bar', stack:'s', data:rows.map(r=>+r.lost.toFixed(1)), itemStyle:{color:'#FD7F20'}, emphasis:{focus:'series'} },
      ],
    };
  });

  const areaOpt = $derived({
    tooltip: { trigger:'axis' },
    grid: { top:8, left:58, right:72, bottom:16 },
    xAxis: { type:'value', max:100, axisLabel:{formatter:'{value}%',fontSize:11} },
    yAxis: { type:'category', data:areaUtil.map(r=>r.area).reverse(), axisLabel:{fontSize:11} },
    series: [
      { type:'bar', data:areaUtil.map(r=>r.utilization_pct).reverse(),
        itemStyle:{ color:(p:{value:number;dataIndex:number}) => {
          const t = areaUtil[areaUtil.length-1-p.dataIndex]?.target_pct??80;
          return p.value>=t?'#5EBF33':'#CC0000'; }},
        label:{show:true,position:'right',formatter:(p:{value:number})=>`${Number(p.value).toFixed(1)}%`,fontSize:11} },
      { type:'scatter', data:areaUtil.map(r=>[r.target_pct,r.area]).reverse(),
        symbolSize:14, symbol:'diamond', itemStyle:{color:'#1C355E'}, tooltip:{formatter:'Target: {c[0]}%'} },
    ],
  });

  function causeOpt(data: CauseRow[], color: string) {
    // Use event count (frequency) as bar metric; compute cumulative % from events
    const total = data.reduce((s, r) => s + (r.events ?? 0), 0);
    let running = 0;
    const cumPct = data.map(r => {
      running += r.events ?? 0;
      return total ? +(running / total * 100).toFixed(1) : 0;
    });
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params: Array<{seriesName:string;value:number;color:string;name:string}>) => {
          const bar = params[0]; const line = params[1];
          return `<b>${bar?.name}</b><br>` +
            `<span style="color:${bar?.color}">●</span> Events: <b>${(bar?.value??0).toLocaleString()}</b><br>` +
            `<span style="color:#1C355E">●</span> Cumulative: <b>${line?.value??0}%</b>`;
        }
      },
      grid: { top:8, left:16, right:52, bottom:72, containLabel:true },
      xAxis: { type:'category', data:data.map(r=>r.reason), axisLabel:{rotate:32,fontSize:9,interval:0} },
      yAxis: [
        { type:'value', name:'events', axisLabel:{fontSize:9,formatter:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)} },
        { type:'value', max:100, axisLabel:{formatter:'{value}%',fontSize:9}, splitLine:{show:false} },
      ],
      series: [
        { type:'bar', data:data.map(r=>r.events??0), itemStyle:{color}, barMaxWidth:36 },
        { type:'line', yAxisIndex:1, data:cumPct,
          lineStyle:{color:'#1C355E',width:2}, itemStyle:{color:'#1C355E'}, symbol:'circle', symbolSize:5 },
      ],
    };
  }

  const downOpt  = $derived(causeOpt(topDown,  '#CC0000'));
  const lostOpt  = $derived(causeOpt(topLost,  '#FD7F20'));

  // Scatter: join scatterData with machine_rows to derive avg down duration per event
  const scatterWithDur = $derived(
    scatterData.map(s => {
      const m = machines.find(r => r.code_machine === s.code_machine);
      const downH = m ? m.down_min / 60 : 0;
      return { ...s, avg_duration_h: s.frequency > 0 ? +(downH / s.frequency).toFixed(3) : 0 };
    })
  );

  // Scatter: Frequency vs Duration
  const scatterOpt = $derived.by(() => {
    const freqs = scatterWithDur.map(r=>r.frequency);
    const durs  = scatterWithDur.map(r=>r.avg_duration_h);
    const midFreq = freqs.length ? (Math.min(...freqs)+Math.max(...freqs))/2 : 5;
    const midDur  = durs.length  ? (Math.min(...durs) +Math.max(...durs)) /2 : 2;
    const AREA_COLORS: Record<string,string> = {
      'WB':'#1D9CE4','DA':'#009688','BG':'#702076','SAW':'#FD7F20','MOLD':'#CC0000',
      'PLATE':'#5EBF33','MARK':'#17A2B8','SAW_QFN':'#F68D2E','TF':'#6B3FA0','ISO':'#8A8A8A','FS':'#1C355E',
    };
    return {
      tooltip: { formatter:(p:{value:[number,number,string,string]}) =>
        `<b>${p.value[2]}</b> [${p.value[3]}]<br>Events: ${p.value[0]}<br>Avg Duration: ${p.value[1].toFixed(1)}h` },
      grid: { top:36, left:56, right:120, bottom:56 },
      xAxis: { type:'value', name:'Events (frequency)', nameLocation:'center', nameGap:32, axisLabel:{fontSize:10} },
      yAxis: { type:'value', name:'Avg Duration (h)',   nameLocation:'center', nameGap:42, axisLabel:{fontSize:10} },
      series: [{
        type:'scatter',
        data: scatterWithDur.map(r=>[r.frequency, r.avg_duration_h, r.code_machine, r.area]),
        symbolSize: (d:[number,number]) => Math.min(8 + d[0]*0.3, 28),
        itemStyle: { color:(p:{value:[number,number,string,string]}) => AREA_COLORS[p.value[3]]??'#8A8A8A', opacity:.75 },
      },
      // Quadrant lines
      { type:'line', data:[[midFreq,0],[midFreq,Math.max(...durs,0.1)*1.1]], lineStyle:{type:'dashed',color:'#ccc',width:1}, symbol:'none', silent:true, tooltip:{show:false} },
      { type:'line', data:[[0,midDur],[Math.max(...freqs,1)*1.1,midDur]], lineStyle:{type:'dashed',color:'#ccc',width:1}, symbol:'none', silent:true, tooltip:{show:false} },
      ],
      graphic: [
        { type:'text', left:'56%', top:'10%',  style:{text:'CHRONIC',    fill:'#CC0000', fontSize:9, fontWeight:'700', opacity:.5} },
        { type:'text', left:'16%', top:'10%',  style:{text:'SEVERE',     fill:'#FD7F20', fontSize:9, fontWeight:'700', opacity:.5} },
        { type:'text', left:'56%', bottom:'60px', style:{text:'NUISANCE', fill:'#1D9CE4', fontSize:9, fontWeight:'700', opacity:.5} },
        { type:'text', left:'16%', bottom:'60px', style:{text:'HEALTHY',  fill:'#5EBF33', fontSize:9, fontWeight:'700', opacity:.5} },
      ],
    };
  });

  // ── Machine table ─────────────────────────────────────────────────────────
  const machCols = [
    { key:'code_machine', label:'Machine', width:'100px', sortable:true },
    { key:'area',         label:'Area',    width:'55px',  sortable:true },
    { key:'utilization_pct', label:'Util %', width:'75px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const p=Number(v); const c=p>=80?'#5EBF33':p>=70?'#FD7F20':'#CC0000'; return `<span style="font-weight:700;color:${c}">${p.toFixed(1)}%</span>`; } },
    { key:'down_min', label:'Down (h)', width:'72px', align:'right' as const, sortable:true, format:(v:unknown):string=>(Number(v)/60).toFixed(1) },
    { key:'pm_min',   label:'PM (h)',   width:'62px', align:'right' as const, sortable:true, format:(v:unknown):string=>(Number(v)/60).toFixed(1) },
    { key:'lost_min', label:'Lost (h)', width:'65px', align:'right' as const, sortable:true, format:(v:unknown):string=>(Number(v)/60).toFixed(1) },
  ];

  const attentionCols = [
    { key:'code_machine', label:'Machine', width:'100px', sortable:true,
      renderHtml:(v:unknown,r:MachRow)=>`<span style="font-weight:700;color:var(--color-primary)">${v}</span>${r.utilization_pct<85?' <span style="background:#ffebeb;color:#CC0000;border:1px solid #CC0000;border-radius:3px;font-size:9px;font-weight:700;padding:0 4px">⚠</span>':''}` },
    { key:'area',         label:'Area',    width:'50px',  sortable:true },
    { key:'utilization_pct', label:'Util %', width:'70px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const p=Number(v); const c=p>=80?'#5EBF33':p>=70?'#FD7F20':'#CC0000'; return `<span style="font-weight:700;color:${c}">${p.toFixed(1)}%</span>`; } },
    { key:'down_min', label:'Down (h)', width:'72px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const h=(Number(v)/60).toFixed(1); return Number(v)?`<span style="color:#CC0000;font-weight:700">${h}</span>`:`<span style="color:#aaa">—</span>`; } },
    { key:'lost_min', label:'Lost (h)', width:'68px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown)=>{ const h=(Number(v)/60).toFixed(1); return Number(v)?`<span style="color:#FD7F20;font-weight:700">${h}</span>`:`<span style="color:#aaa">—</span>`; } },
  ];

  // CSV export for machine table
  function exportCsv() {
    const hdrs = ['Machine','Area','Util%','Down(h)','PM(h)','Lost(h)'];
    const esc = (v:unknown)=>{ const s=String(v??''); return s.includes(',')? `"${s.replace(/"/g,'""')}"`:s; };
    const rows = machines.map(r=>[r.code_machine,r.area,r.utilization_pct.toFixed(1),(r.down_min/60).toFixed(1),(r.pm_min/60).toFixed(1),(r.lost_min/60).toFixed(1)].map(esc).join(','));
    const stamp = new Date().toISOString().slice(0,10);
    const blob = new Blob(['﻿'+[hdrs.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`utilization_${stamp}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  onMount(loadData);
</script>

<svelte:head><title>Utilization — EMH Dashboard</title></svelte:head>

<PageHeader title="Utilization Analysis" subtitle="Equipment effectiveness · Downtime · Lost Time breakdown" />

<FilterBar
  startDate={filters.start}
  endDate={filters.end}
  onFilter={handleFilter}
/>

{#if error}
  <div class="banner err">⚠ {error}</div>
{:else if loading}
  <div class="banner load">Loading…</div>
{/if}

<!-- ── Row 1: KPI Gauges ──────────────────────────────────────────────────── -->
<div class="grid-4 mb">
  <div class="chart-card gc"><div class="ct">Utilization</div><EChart option={gaugeUtil} height="155px" /></div>
  <div class="chart-card gc"><div class="ct">Downtime</div><EChart option={gaugeDown} height="155px" /></div>
  <div class="chart-card gc"><div class="ct">PM</div><EChart option={gaugePm} height="155px" /></div>
  <div class="chart-card gc"><div class="ct">Lost Time</div><EChart option={gaugeLost} height="155px" /></div>
</div>

<!-- ── Row 2: Monthly Composition (%) + Utilization by Area ───────────────── -->
<div class="grid-2 mb">
  <div class="chart-card">
    <div class="ct">Monthly Composition (%)</div>
    <EChart option={monthlyOpt} height="240px" />
  </div>
  <div class="chart-card">
    <div class="ct">Utilization by Area (vs Target ◆)</div>
    <EChart option={areaOpt} height="240px" />
  </div>
</div>

<!-- ── Row 3: Top Downtime Causes + Top Lost Time Causes ──────────────────── -->
<div class="grid-2 mb">
  <div class="chart-card">
    <div class="ct">Top Downtime Reasons (M/C DOWN)</div>
    <EChart option={downOpt} height="240px" />
  </div>
  <div class="chart-card">
    <div class="ct">Top Lost Time Causes (Setup / Wait)</div>
    <EChart option={lostOpt} height="240px" />
  </div>
</div>

<!-- ── Row 4: Attention List + Frequency vs Duration Scatter ─────────────── -->
<div class="grid-2 mb">
  <div class="chart-card">
    <div class="ct">Top 10 Machines Needing Attention</div>
    <DataTable columns={attentionCols} rows={attentionList} rowKey={r=>r.code_machine} compact pageSize={10} />
  </div>
  <div class="chart-card">
    <div class="ct">Frequency vs Duration (M/C DOWN) <span class="ct-hint">size = event count</span></div>
    <EChart option={scatterOpt} height="300px" />
  </div>
</div>

<!-- ── Row 5: Full Machine Breakdown Table ────────────────────────────────── -->
<div class="chart-card">
  <div class="ct-row">
    <div class="ct">Machine Breakdown — {machines.length} machines (sorted by utilization ↑)</div>
    <button class="btn-csv" onclick={exportCsv} disabled={machines.length===0}>↓ CSV</button>
  </div>
  <DataTable columns={machCols} rows={machines} rowKey={r=>r.code_machine} compact pageSize={20} />
</div>

<style>
  .mb { margin-bottom: var(--gutter); }
  .banner { padding:10px 16px; border-radius:var(--r-sm); font-size:13px; font-weight:600; margin-bottom:var(--gutter); }
  .banner.err  { background:#FFF0F0; border:1px solid var(--status-down); color:var(--status-down); }
  .banner.load { background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text-muted); }

  .ct {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em; color: var(--color-text-muted); margin-bottom: 8px;
  }
  .ct-hint { font-size:10px; font-weight:400; text-transform:none; letter-spacing:0; color:var(--color-text-disabled); }
  .ct-row  { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; padding-bottom:8px; border-bottom:1px solid var(--color-border); }
  .ct-row .ct { margin-bottom:0; border:none; padding:0; }
  .gc { text-align:center; }

  .btn-csv {
    font-size:11px; font-weight:700; color:var(--color-primary);
    background:transparent; border:1px solid var(--color-primary);
    border-radius:var(--r-sm); padding:3px 10px; cursor:pointer; transition:all .1s;
  }
  .btn-csv:hover  { background:var(--color-primary); color:#fff; }
  .btn-csv:disabled { opacity:.4; cursor:not-allowed; }
</style>
