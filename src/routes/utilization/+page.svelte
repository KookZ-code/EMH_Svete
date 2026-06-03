<script lang="ts">
  // Utilization — KPI Gauges, Trend Analysis
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import EChart from '$lib/components/EChart.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import { utilizationApi } from '$lib/utils/api';
  import type { MachineArea } from '$types';

  interface KpiState { utilization_pct: number; downtime_pct: number; pm_pct: number; lost_time_pct: number; }
  interface MonthlyRow { month: string; running_min: number; down_min: number; pm_min: number; lost_min: number; }
  interface AreaRow  { area: string; utilization_pct: number; target_pct: number; }
  interface ParetoRow { reason: string; hours: number; cumulative_pct: number; }
  interface MachRow  { code_machine: string; area: string; utilization_pct: number; down_min: number; pm_min: number; lost_min: number; }

  let kpi       = $state<KpiState>({ utilization_pct: 0, downtime_pct: 0, pm_pct: 0, lost_time_pct: 0 });
  let monthly   = $state<MonthlyRow[]>([]);
  let areaUtil  = $state<AreaRow[]>([]);
  let downPareto = $state<ParetoRow[]>([]);
  let machines  = $state<MachRow[]>([]);
  let loading   = $state(true);
  let error     = $state<string | null>(null);

  // Current filter params (initialized to defaults matching FilterBar defaults)
  let filters = $state({
    start: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10); })(),
    end:   new Date().toISOString().slice(0,10),
    areas: [] as MachineArea[],
    shift: 'all' as 'all' | 'day' | 'night',
  });

  async function loadData() {
    loading = true;
    error = null;
    const p = {
      start: filters.start,
      end:   filters.end,
      shift: filters.shift !== 'all' ? filters.shift : undefined,
      areas: filters.areas.length > 0 ? filters.areas : undefined,
    };
    const res = await utilizationApi.detail(p);
    if (res.error) { error = res.error.message; loading = false; return; }
    if (!res.data) { loading = false; return; }

    const d = res.data;
    const raw = d.raw ?? {};

    // Derive KPI from kpi_totals array
    const totals = raw.kpi_totals ?? [];
    function findPct(label: string) {
      const row = totals.find((r: { label: string; pct: number }) => r.label?.toLowerCase().includes(label));
      return row?.pct ?? 0;
    }
    kpi = {
      utilization_pct: findPct('run') || findPct('util'),
      downtime_pct:    findPct('down'),
      pm_pct:          findPct('pm'),
      lost_time_pct:   findPct('lost'),
    };

    // Monthly trend
    monthly = (d.monthly_trend ?? []) as MonthlyRow[];

    // Area utilization
    areaUtil = ((raw.area_totals ?? []) as { area: string; utilization_pct: number; target_pct?: number }[])
      .map(r => ({ area: r.area, utilization_pct: r.utilization_pct ?? 0, target_pct: r.target_pct ?? 80 }));

    // Downtime pareto
    downPareto = (d.top_down ?? []) as ParetoRow[];

    // Bottom machines by utilization
    machines = ((d.machine_rows ?? []) as MachRow[])
      .sort((a, b) => a.utilization_pct - b.utilization_pct)
      .slice(0, 10);

    loading = false;
  }

  function handleFilter(f: { start: string; end: string; areas: MachineArea[]; shift: 'all'|'day'|'night' }) {
    filters = f;
    loadData();
  }

  // ── Chart options ─────────────────────────────────────────────────────────

  function gaugeOption(value: number, name: string, max: number, color: string): object {
    return {
      series: [{
        type: 'gauge', radius: '90%', startAngle: 210, endAngle: -30, min: 0, max,
        splitNumber: 5,
        progress: { show: true, width: 12 },
        pointer: { show: false },
        axisLine: { lineStyle: { width: 12, color: [[1, '#e8e8e8']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { fontSize: 10, distance: -38 },
        detail: { valueAnimation: true, formatter: '{value}%', fontSize: 22, fontWeight: 'bold', color, offsetCenter: [0, '30%'] },
        title: { fontSize: 11, color: '#838E93', offsetCenter: [0, '60%'] },
        data: [{ value: Number(value.toFixed(1)), name, itemStyle: { color } }],
      }],
    };
  }

  const gaugeUtil  = $derived(gaugeOption(kpi.utilization_pct, 'Utilization', 100, '#5EBF33'));
  const gaugeDown  = $derived(gaugeOption(kpi.downtime_pct,    'Downtime',    20,  '#CC0000'));
  const gaugePm    = $derived(gaugeOption(kpi.pm_pct,          'PM',          10,  '#702076'));
  const gaugeLost  = $derived(gaugeOption(kpi.lost_time_pct,   'Lost Time',   30,  '#FD7F20'));

  const monthlyOption = $derived({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, data: ['Running','Downtime','PM','Lost Time'], textStyle: { fontSize: 11 } },
    grid: { top: 40, left: 50, right: 20, bottom: 30 },
    xAxis: { type: 'category', data: monthly.map(r => r.month.slice(5)), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', name: 'Hours', axisLabel: { formatter: (v: number) => `${Math.round(v/60)}h`, fontSize: 11 } },
    series: [
      { name:'Running',   type:'bar', stack:'total', data: monthly.map(r => r.running_min), itemStyle: { color:'#5EBF33' } },
      { name:'Downtime',  type:'bar', stack:'total', data: monthly.map(r => r.down_min),    itemStyle: { color:'#CC0000' } },
      { name:'PM',        type:'bar', stack:'total', data: monthly.map(r => r.pm_min),      itemStyle: { color:'#702076' } },
      { name:'Lost Time', type:'bar', stack:'total', data: monthly.map(r => r.lost_min),    itemStyle: { color:'#FD7F20' } },
    ],
  });

  const areaOption = $derived({
    tooltip: { trigger: 'axis' },
    grid: { top: 10, left: 60, right: 80, bottom: 20 },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', fontSize: 11 } },
    yAxis: { type: 'category', data: areaUtil.map(r => r.area).reverse(), axisLabel: { fontSize: 11 } },
    series: [
      {
        type: 'bar',
        data: areaUtil.map(r => r.utilization_pct).reverse(),
        itemStyle: {
          color: (p: { value: number; dataIndex: number }) => {
            const t = areaUtil[areaUtil.length - 1 - p.dataIndex]?.target_pct ?? 80;
            return p.value >= t ? '#5EBF33' : '#CC0000';
          },
        },
        label: { show: true, position: 'right', formatter: (p: { value: number }) => `${Number(p.value).toFixed(1)}%`, fontSize: 11 },
      },
      {
        type: 'scatter',
        data: areaUtil.map(r => [r.target_pct, r.area]).reverse(),
        symbolSize: 14, symbol: 'diamond',
        itemStyle: { color: '#1C355E' },
        tooltip: { formatter: 'Target: {c[0]}%' },
      },
    ],
  });

  const paretoOption = $derived({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    grid: { top: 10, left: 20, right: 60, bottom: 80, containLabel: true },
    xAxis: { type: 'category', data: downPareto.map(r => r.reason), axisLabel: { rotate: 30, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: 'Hours', axisLabel: { fontSize: 10 } },
      { type: 'value', name: '%', max: 100, axisLabel: { formatter: '{value}%', fontSize: 10 } },
    ],
    series: [
      { type: 'bar', data: downPareto.map(r => r.hours), itemStyle: { color: '#CC0000' }, barMaxWidth: 40 },
      {
        type: 'line', yAxisIndex: 1, data: downPareto.map(r => r.cumulative_pct),
        smooth: false, symbol: 'circle', symbolSize: 6,
        lineStyle: { color: '#1C355E', width: 2 }, itemStyle: { color: '#1C355E' },
      },
    ],
  });

  const machCols = [
    { key: 'code_machine',    label: 'Machine',  width: '100px', sortable: true },
    { key: 'area',            label: 'Area',     width: '60px',  sortable: true },
    { key: 'utilization_pct', label: 'Util %',   width: '80px',  align: 'right' as const, sortable: true,
      renderHtml: (v: unknown) => {
        const pct = Number(v);
        const c = pct >= 80 ? '#5EBF33' : pct >= 70 ? '#FD7F20' : '#CC0000';
        return `<span style="font-weight:700;color:${c}">${pct.toFixed(1)}%</span>`;
      },
    },
    { key: 'down_min', label: 'Down (h)', width: '80px', align: 'right' as const, sortable: true, format: (v: unknown): string => (Number(v)/60).toFixed(1) },
    { key: 'pm_min',   label: 'PM (h)',   width: '70px', align: 'right' as const, sortable: true, format: (v: unknown): string => (Number(v)/60).toFixed(1) },
    { key: 'lost_min', label: 'Lost (h)', width: '70px', align: 'right' as const, sortable: true, format: (v: unknown): string => (Number(v)/60).toFixed(1) },
  ];

  onMount(loadData);
</script>

<svelte:head><title>Utilization — EMH Dashboard</title></svelte:head>

<PageHeader title="Utilization Analysis" subtitle="Equipment effectiveness and downtime breakdown" />

<FilterBar onFilter={handleFilter} />

{#if error}
  <div class="state-banner error">⚠ {error}</div>
{:else if loading}
  <div class="state-banner loading">Loading…</div>
{/if}

<div class="grid-4" style="margin-bottom: var(--gutter);">
  <div class="chart-card gauge-card"><div class="card-title">Utilization</div><EChart option={gaugeUtil} height="160px" /></div>
  <div class="chart-card gauge-card"><div class="card-title">Downtime</div><EChart option={gaugeDown} height="160px" /></div>
  <div class="chart-card gauge-card"><div class="card-title">PM</div><EChart option={gaugePm} height="160px" /></div>
  <div class="chart-card gauge-card"><div class="card-title">Lost Time</div><EChart option={gaugeLost} height="160px" /></div>
</div>

<div class="grid-2" style="margin-bottom: var(--gutter);">
  <div class="chart-card"><div class="card-title">Monthly Composition</div><EChart option={monthlyOption} height="260px" /></div>
  <div class="chart-card"><div class="card-title">Utilization by Area (vs Target ◆)</div><EChart option={areaOption} height="260px" /></div>
</div>

<div class="grid-2" style="margin-bottom: var(--gutter);">
  <div class="chart-card"><div class="card-title">Top Downtime Reasons (Pareto)</div><EChart option={paretoOption} height="260px" /></div>
  <div class="chart-card"><div class="card-title">Bottom 10 Machines by Utilization</div><DataTable columns={machCols} rows={machines} rowKey={r => r.code_machine} compact pageSize={10} /></div>
</div>

<style>
  .state-banner { padding: 10px 16px; border-radius: var(--r-sm); font-size: 13px; font-weight: 600; margin-bottom: var(--gutter); }
  .state-banner.error   { background: #FFF0F0; border: 1px solid var(--status-down); color: var(--status-down); }
  .state-banner.loading { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); }
  .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); margin-bottom: 8px; }
  .gauge-card { text-align: center; }
</style>
