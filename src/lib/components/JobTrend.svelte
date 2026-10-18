<script lang="ts">
  import { onMount } from 'svelte';
  import EChart from './EChart.svelte';
  import type { EChartsOption, BarSeriesOption, LineSeriesOption } from 'echarts';

  // Per-shift job counts from /api/v1/wb/report-7day → shift_details.
  // request_* = closed + open of that type; down_jobs / setup_jobs = closed of that type.
  interface ShiftDetail {
    date: string;
    shift: string;
    request_down_jobs: number;
    request_setup_jobs: number;
    down_jobs: number;
    setup_jobs: number;
  }

  interface TrendResponse {
    shift_details: ShiftDetail[];
  }

  // One row per shift, with request/close split by type and the derived backlog and close rate.
  interface JobRow {
    label: string;
    reqDown: number;
    reqSetup: number;
    closeDown: number;
    closeSetup: number;
    req: number;
    close: number;
    backlog: number;
    rate: number | null;
  }

  interface Totals {
    req: number;
    close: number;
    backlog: number;
    rate: number | null;
  }

  type SeriesKey = 'down' | 'setup' | 'backlog' | 'rate';

  // Single source for the series toggles and their colors.
  const SERIES: { key: SeriesKey; label: string; color: string }[] = [
    { key: 'down', label: 'M/C DOWN', color: '#cc0000' },
    { key: 'setup', label: 'SETUP+CONV', color: '#1d9ce4' },
    { key: 'backlog', label: 'BACKLOG', color: '#1c355e' },
    { key: 'rate', label: 'CLOSE RATE %', color: '#2d8e4e' },
  ];
  const colorOf = (key: SeriesKey) => SERIES.find((s) => s.key === key)!.color;

  interface Props {
    date?: string;
    packages?: string;
  }

  let { date = '', packages = '' }: Props = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let shiftDetails = $state<ShiftDetail[]>([]);

  let showSeries = $state<Record<SeriesKey, boolean>>({
    down: true,
    setup: true,
    backlog: true,
    rate: true,
  });

  // KPI scope: -1 = all shifts, otherwise an index into `rows`. Set by the dropdown or a bar click.
  let selected = $state(-1);

  // Rows are derived from the API so the chart, tooltip and KPI all read the same numbers.
  const rows: JobRow[] = $derived(shiftDetails.map(toRow));

  function toRow(d: ShiftDetail): JobRow {
    const req = d.request_down_jobs + d.request_setup_jobs;
    const close = d.down_jobs + d.setup_jobs;
    return {
      label: `${d.date.split('-')[2]} ${d.shift.slice(0, 1)}`,
      reqDown: d.request_down_jobs,
      reqSetup: d.request_setup_jobs,
      closeDown: d.down_jobs,
      closeSetup: d.setup_jobs,
      req,
      close,
      backlog: req - close,
      rate: req > 0 ? Math.round((close / req) * 1000) / 10 : null,
    };
  }

  // Totals over a set of shifts. Close rate is null when there is no request to divide by.
  function summarize(list: JobRow[]): Totals {
    const req = list.reduce((s, r) => s + r.req, 0);
    const close = list.reduce((s, r) => s + r.close, 0);
    return {
      req,
      close,
      backlog: req - close,
      rate: req > 0 ? Math.round((close / req) * 1000) / 10 : null,
    };
  }

  const scopedRows = $derived(selected >= 0 && rows[selected] ? [rows[selected]] : rows);
  const kpi = $derived(summarize(scopedRows));
  const scopeName = $derived(selected >= 0 && rows[selected] ? rows[selected].label : 'All shifts');

  function selectShift(index: number) {
    selected = index === selected ? -1 : index;
  }

  function toggleSeries(key: SeriesKey) {
    showSeries[key] = !showSeries[key];
  }

  async function loadTrendData() {
    loading = true;
    error = null;
    selected = -1;
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (packages) params.set('packages', packages);

      const res = await fetch(`/api/v1/wb/report-7day?${params.toString()}`);
      const json = await res.json();

      if (json.error) {
        error = json.error.message;
        return;
      }
      shiftDetails = (json.data as TrendResponse).shift_details ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error loading job trend data';
    } finally {
      loading = false;
    }
  }

  // Bars: Request and Close are two stacks (DOWN + SETUP each). Close uses a faded fill so the pair reads as one comparison.
  function barSeries(name: string, stack: string, data: number[], color: string, faded: boolean): BarSeriesOption {
    return {
      name,
      type: 'bar',
      stack,
      data,
      barMaxWidth: 22,
      itemStyle: faded
        ? { color, opacity: 0.45, borderColor: color, borderWidth: 1 }
        : { color },
    };
  }

  // Builds the ECharts option from `rows` and the series toggles.
  // Hidden series are left out of `series` entirely (ECharts has no per-series show flag).
  const chartOption = $derived.by((): EChartsOption => {
    const series: (BarSeriesOption | LineSeriesOption)[] = [];

    if (showSeries.down) {
      series.push(barSeries('Request · M/C DOWN', 'request', rows.map((r) => r.reqDown), colorOf('down'), false));
      series.push(barSeries('Close · M/C DOWN', 'close', rows.map((r) => r.closeDown), colorOf('down'), true));
    }
    if (showSeries.setup) {
      series.push(barSeries('Request · SETUP+CONV', 'request', rows.map((r) => r.reqSetup), colorOf('setup'), false));
      series.push(barSeries('Close · SETUP+CONV', 'close', rows.map((r) => r.closeSetup), colorOf('setup'), true));
    }
    if (showSeries.backlog) {
      series.push({
        name: 'Backlog',
        type: 'line',
        yAxisIndex: 0,
        data: rows.map((r) => r.backlog),
        lineStyle: { width: 2, color: colorOf('backlog') },
        itemStyle: { color: colorOf('backlog') },
        symbol: 'circle',
        symbolSize: 6,
        emphasis: { scale: 1.6 },
      });
    }
    if (showSeries.rate) {
      series.push({
        name: 'Close Rate %',
        type: 'line',
        yAxisIndex: 1,
        data: rows.map((r) => r.rate),
        connectNulls: true,
        lineStyle: { width: 2, color: colorOf('rate'), type: 'dashed' },
        itemStyle: { color: colorOf('rate') },
        symbol: 'diamond',
        symbolSize: 7,
        emphasis: { scale: 1.6 },
      });
    }

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(28,53,94,0.06)' } },
        formatter: (params) => {
          const first = Array.isArray(params) ? params[0] : params;
          const r = rows[first?.dataIndex ?? -1];
          if (!r) return '';
          const rate = r.rate == null ? '-' : `${r.rate.toFixed(1)}%`;
          return `<b style="color:#1c355e">${r.label}</b><br/>` +
            `Request: DOWN ${r.reqDown} · SETUP ${r.reqSetup} · <b>${r.req}</b><br/>` +
            `Close: DOWN ${r.closeDown} · SETUP ${r.closeSetup} · <b>${r.close}</b><br/>` +
            `Backlog: <b>${r.backlog}</b> · Close Rate: <b>${rate}</b>`;
        },
      },
      grid: { top: 24, left: 16, right: 16, bottom: 16, containLabel: true },
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.label),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#B6B7B9' } },
        axisLabel: { fontSize: 10, color: '#838E93' },
      },
      yAxis: [
        {
          type: 'value',
          name: 'JOBS',
          min: 0,
          nameTextStyle: { fontSize: 9, color: '#838E93', align: 'left' },
          axisLabel: { fontSize: 10, color: '#838E93' },
          splitLine: { lineStyle: { color: '#EEEEEE' } },
        },
        {
          type: 'value',
          name: 'CLOSE RATE %',
          min: 0,
          max: 100,
          show: showSeries.rate,
          nameTextStyle: { fontSize: 9, color: '#838E93', align: 'right' },
          axisLabel: { fontSize: 10, color: '#838E93', formatter: '{value}%' },
          splitLine: { show: false },
        },
      ],
      series,
    };
  });

  // Clicking a bar (or its shift label) selects that shift for the KPI strip.
  function onChartClick(p: { componentType?: string; dataIndex: number }) {
    if (p.componentType === 'series') selectShift(p.dataIndex);
  }

  onMount(() => {
    if (date) loadTrendData();
  });

  $effect(() => {
    if (date && packages !== undefined) loadTrendData();
  });
</script>

<div class="trend-wrapper">
  <div class="trend-header">
    <h3>📊 Job Request / Close by Type</h3>
    <span class="date-range">{date ? `Last 7 days ending ${date}` : '—'}</span>
  </div>

  {#if loading}
    <div class="chart-placeholder">Loading job trend...</div>
  {:else if error}
    <div class="chart-placeholder error">⚠ {error}</div>
  {:else if rows.length > 0}
    <div class="scope-bar">
      <label for="job-scope">KPI scope:</label>
      <select id="job-scope" value={String(selected)} onchange={(e) => (selected = Number(e.currentTarget.value))}>
        <option value="-1">All shifts</option>
        {#each rows as r, i (i)}
          <option value={String(i)}>{r.label}</option>
        {/each}
      </select>
      <span class="hint">or click a bar; click again to reset</span>
    </div>

    <div class="kpi-strip">
      <div class="kpi" style:--c="#1c355e">
        <div class="kpi-label">Total Request</div>
        <div class="kpi-value">{kpi.req.toLocaleString()}</div>
        <div class="kpi-sub">{scopeName}</div>
      </div>
      <div class="kpi" style:--c="#1d9ce4">
        <div class="kpi-label">Total Close</div>
        <div class="kpi-value">{kpi.close.toLocaleString()}</div>
        <div class="kpi-sub">{scopeName}</div>
      </div>
      <div class="kpi" style:--c="#2d8e4e">
        <div class="kpi-label">Close Rate</div>
        <div class="kpi-value">{kpi.rate == null ? '-' : `${kpi.rate.toFixed(1)}%`}</div>
        <div class="kpi-sub">close ÷ request</div>
      </div>
      <div class="kpi" style:--c="#702076">
        <div class="kpi-label">Backlog</div>
        <div class="kpi-value">{kpi.backlog.toLocaleString()}</div>
        <div class="kpi-sub">request − close</div>
      </div>
    </div>

    <div class="main-grid">
      <div class="panel">
        <div class="panel-hd"><span>Series Control</span></div>
        <div class="tog-list">
          {#each SERIES as s (s.key)}
            <button
              class="tog"
              class:on={showSeries[s.key]}
              onclick={() => toggleSeries(s.key)}
              style:--c={s.color}
            >
              <span class="sw"></span>
              <span class="dot"></span>
              <span class="tog-label">{s.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="panel">
        <div class="panel-hd">
          <span>Job Request / Close</span>
          <span class="hint">HOVER FOR VALUES</span>
        </div>
        <div class="axis-note">
          <b>LEFT AXIS</b> — jobs (stacked) · <b>RIGHT AXIS</b> — close rate % · <b>X AXIS</b> — day + shift (N = Night, D = Day)<br />
          Left bar = <b>Request</b> (solid) · right bar = <b>Close</b> (faded)
        </div>
        <div class="chart-container">
          <EChart option={chartOption} height="380px" onclick={onChartClick} />
        </div>
      </div>
    </div>
  {:else}
    <div class="chart-placeholder">No data available</div>
  {/if}
</div>

<style>
  .trend-wrapper {
    background: white;
    border: 1px solid #e3e3e3;
    border-radius: 6px;
    padding: 16px;
    margin-top: var(--gutter);
  }

  .trend-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #eee;
  }

  .trend-header h3 {
    font-size: 16px;
    font-weight: 600;
    color: #1c355e;
    margin: 0;
  }

  .date-range {
    font-size: 12px;
    color: #999;
  }

  .scope-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
    color: #999;
  }

  .scope-bar select {
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    background: white;
    color: #333;
  }

  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }

  .kpi {
    background: #f9f9f9;
    border: 1px solid #e8e8e8;
    border-top: 3px solid var(--c);
    border-radius: 4px;
    padding: 10px 12px;
  }

  .kpi-label {
    font-size: 11px;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
  }

  .kpi-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--c);
    margin-top: 2px;
  }

  .kpi-sub {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
  }

  .main-grid {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }

  .panel {
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    background: #fafafa;
    min-width: 0;
  }

  .panel-hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid #e8e8e8;
    background: white;
    border-radius: 4px 4px 0 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #1c355e;
  }

  .hint {
    font-size: 10px;
    font-weight: 400;
    color: #999;
    letter-spacing: 0.5px;
  }

  .axis-note {
    padding: 6px 12px;
    font-size: 11px;
    color: #999;
    border-bottom: 1px solid #e8e8e8;
    line-height: 1.5;
  }

  .axis-note b {
    color: #333;
  }

  .tog-list {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tog {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    user-select: none;
    text-align: left;
  }

  .tog:hover {
    background: #f1f2f2;
  }

  .sw {
    width: 30px;
    height: 16px;
    border-radius: 8px;
    background: #b6b7b9;
    position: relative;
    flex: none;
  }

  .sw::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    transition: left 0.15s;
  }

  .tog.on .sw {
    background: var(--c);
  }

  .tog.on .sw::after {
    left: 16px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
    flex: none;
  }

  .tog-label {
    font-size: 12px;
    font-weight: 600;
    color: #999;
  }

  .tog.on .tog-label {
    color: #333;
  }

  .chart-placeholder {
    padding: 40px;
    text-align: center;
    color: #999;
    font-size: 13px;
  }

  .chart-placeholder.error {
    color: #cc0000;
  }

  @media (max-width: 900px) {
    .main-grid {
      grid-template-columns: 1fr;
    }
    .kpi-strip {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
