<script lang="ts">
  import { onMount } from 'svelte';
  import EChart from './EChart.svelte';
  import type { EChartsOption } from 'echarts';

  interface ShiftDetail {
    date: string;
    shift: string;
    total_request_jobs: number;
    total_closed_jobs: number;
    tech_count: number;
    avg_job_per_tech: number;
    down_jobs: number;
    avg_down_time: number;
    setup_jobs: number;
    avg_setup_time: number;
    avg_waiting_time: number;
    max_waiting_time: number;
  }

  type PercentKey = 'avg_util' | 'down_pct' | 'wait_pct' | 'setup_conv_pct' | 'idle_pct';
  type MetricKey = PercentKey | 'tech_count';

  interface TrendData {
    dates: string[];
    shifts: string[];
    shift_details: ShiftDetail[];
    metrics: Record<PercentKey, number[]>;
  }

  interface Props {
    date?: string;
    packages?: string;
  }

  // Single source for the series toggles, KPI tiles and chart lines.
  // axis 0 = left % axis, axis 1 = right count axis (technicians). Only metrics with kpiLabel get a KPI tile.
  const METRICS: { key: MetricKey; label: string; kpiLabel?: string; color: string; axis: 0 | 1 }[] = [
    { key: 'avg_util', label: 'AVG UTIL %', kpiLabel: 'Avg Utilization', color: '#2d8e4e', axis: 0 },
    { key: 'down_pct', label: 'M/C DOWN %', kpiLabel: 'Avg M/C DOWN %', color: '#cc0000', axis: 0 },
    { key: 'wait_pct', label: 'WAIT %', kpiLabel: 'Avg WAIT %', color: '#e67e22', axis: 0 },
    { key: 'setup_conv_pct', label: 'SETUP+CONV %', kpiLabel: 'Avg SETUP+CONV', color: '#1d9ce4', axis: 0 },
    { key: 'idle_pct', label: 'IDLE %', kpiLabel: 'Avg IDLE %', color: '#702076', axis: 0 },
    { key: 'tech_count', label: 'TECHNICIANS', color: '#1c355e', axis: 1 },
  ];

  let { date = '', packages = '' } = $props<Props>();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let trendData = $state<TrendData | null>(null);
  let chartOption = $state<EChartsOption | null>(null);

  let showMetrics = $state<Record<MetricKey, boolean>>({
    avg_util: false,
    down_pct: true,
    wait_pct: true,
    setup_conv_pct: true,
    idle_pct: true,
    tech_count: true,
  });

  let sortColumn = $state<string>('date');
  let sortDir = $state<number>(1); // 1 = asc, -1 = desc

  function avgOf(arr: number[]): number {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  function sortBy(col: string) {
    if (sortColumn === col) {
      sortDir = sortDir === 1 ? -1 : 1;
    } else {
      sortColumn = col;
      sortDir = 1;
    }
  }

  function getSortedData() {
    if (!trendData?.shift_details) return [];
    const sorted = [...trendData.shift_details];
    sorted.sort((a, b) => {
      let aVal = (a as any)[sortColumn];
      let bVal = (b as any)[sortColumn];
      if (typeof aVal === 'string') {
        return sortDir * aVal.localeCompare(bVal);
      }
      return sortDir * ((aVal || 0) - (bVal || 0));
    });
    return sorted;
  }

  function toggleMetric(key: MetricKey) {
    showMetrics[key] = !showMetrics[key];
    buildChart();
  }

  async function loadTrendData() {
    loading = true;
    error = null;
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

      // Ensure down_pct exists (fallback for older API)
      if (json.data && json.data.metrics && !json.data.metrics.down_pct && json.data.metrics.down_events) {
        json.data.metrics.down_pct = json.data.metrics.down_events;
      }
      // Ensure metrics exist (handle API response variations)
      if (json.data?.metrics) {
        const metrics = json.data.metrics;
        // Use down_pct if available, otherwise fallback to down_events
        if (!metrics.down_pct && metrics.down_events) {
          metrics.down_pct = metrics.down_events;
        }
        // Ensure all metric arrays exist
        metrics.avg_util ||= [];
        metrics.down_pct ||= [];
        metrics.wait_pct ||= [];
        metrics.setup_conv_pct ||= [];
        metrics.idle_pct ||= [];
      }
      trendData = json.data;
      buildChart();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error loading trend data';
    } finally {
      loading = false;
    }
  }

  // Series values: % metrics come from `metrics`. Technician count is not in `metrics`,
  // so it is looked up per (date, shift) from `shift_details` to avoid relying on row order.
  function seriesData(key: MetricKey): number[] {
    if (!trendData) return [];
    if (key !== 'tech_count') return trendData.metrics[key];
    const byKey = new Map(trendData.shift_details.map((d) => [`${d.date}|${d.shift}`, d.tech_count]));
    return trendData.dates.map((d, i) => byKey.get(`${d}|${trendData!.shifts[i]}`) ?? 0);
  }

  /*
   * Builds the ECharts option from the fetched trend data and the current toggles.
   * Only enabled metrics become series (ECharts has no per-series `show` flag, so
   * hidden metrics must be left out of `series` entirely). Y-axis max is 100 when
   * AVG UTIL is shown, otherwise scales to the largest visible value (min 20, step 5).
   */
  function buildChart() {
    if (!trendData) return;

    const { dates, shifts, metrics } = trendData;

    // X-axis labels: "Day Shift" (e.g. "15 N")
    const xLabels = dates.map((d, i) => {
      const parts = d.split('-');
      const day = parts[2];
      const shift = shifts[i];
      return `${day} ${shift.slice(0, 1)}`;
    });

    const visible = METRICS.filter((m) => showMetrics[m.key]);
    const pctVisible = visible.filter((m) => m.axis === 0);
    const countVisible = visible.filter((m) => m.axis === 1);

    // Left axis (%) scales to the largest visible % value; AVG UTIL pins it to 100.
    let yMax = 100;
    if (pctVisible.length > 0 && !showMetrics.avg_util) {
      const dataMax = Math.max(...pctVisible.flatMap((m) => seriesData(m.key)));
      yMax = Math.ceil(Math.max(dataMax * 1.2, 20) / 5) * 5;
    }

    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#B6B7B9' } },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return '';
          const idx = params[0]?.dataIndex;
          if (idx == null) return '';
          return `<b>${dates[idx]} ${shifts[idx]}</b><br/>` +
            params.map((p: any) => {
              const isCount = p.seriesName === 'TECHNICIANS';
              const text = isCount ? `${p.value}` : `${p.value.toFixed(1)}%`;
              return `<span style="color:${p.color}">●</span> ${p.seriesName}: ${text}`;
            }).join('<br/>');
        },
      },
      grid: { top: 24, left: 16, right: 16, bottom: 16, containLabel: true },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#B6B7B9' } },
        axisLabel: { fontSize: 10, color: '#838E93' },
      },
      yAxis: [
        {
          type: 'value',
          name: '% OF SHIFT',
          nameTextStyle: { fontSize: 9, color: '#838E93', align: 'left' },
          axisLabel: { fontSize: 10, color: '#838E93' },
          splitLine: { lineStyle: { color: '#EEEEEE' } },
          min: 0,
          max: yMax,
        },
        {
          type: 'value',
          name: 'TECHNICIANS',
          nameTextStyle: { fontSize: 9, color: '#838E93', align: 'right' },
          axisLabel: { fontSize: 10, color: '#838E93' },
          splitLine: { show: false },
          min: 0,
          minInterval: 1,
        },
      ],
      series: visible.map((m) => ({
        name: m.label,
        type: 'line',
        yAxisIndex: m.axis,
        data: seriesData(m.key),
        lineStyle: { width: 2, color: m.color },
        itemStyle: { color: m.color },
        symbol: 'circle',
        symbolSize: 6,
        emphasis: { scale: 1.6 },
      })),
    };

    chartOption = option;
  }

  onMount(() => {
    if (date) loadTrendData();
  });

  $effect(() => {
    if (date && packages !== undefined) loadTrendData();
  });

  $effect(() => {
    showMetrics;
    if (trendData) buildChart();
  });
</script>

<div class="trend-wrapper">
  <div class="trend-header">
    <h3>📈 7-Day Performance Trend</h3>
    <span class="date-range">{date ? `Last 7 days ending ${date}` : '—'}</span>
  </div>

  {#if loading}
    <div class="chart-placeholder">Loading 7-day trend...</div>
  {:else if error}
    <div class="chart-placeholder error">⚠ {error}</div>
  {:else if chartOption && trendData}
    <!-- KPI strip: average of each metric over the 7 days -->
    <div class="kpi-strip">
      {#each METRICS.filter((m) => m.kpiLabel) as m (m.key)}
        <div class="kpi" style:--c={m.color}>
          <div class="kpi-label">{m.kpiLabel}</div>
          <div class="kpi-value">{avgOf(seriesData(m.key)).toFixed(1)}%</div>
        </div>
      {/each}
    </div>

    <div class="main-grid">
      <!-- Series control (acts as the legend) -->
      <div class="panel">
        <div class="panel-hd"><span>Series Control</span></div>
        <div class="tog-list">
          {#each METRICS as m (m.key)}
            <button
              class="tog"
              class:on={showMetrics[m.key]}
              onclick={() => toggleMetric(m.key)}
              style:--c={m.color}
            >
              <span class="sw"></span>
              <span class="dot"></span>
              <span class="tog-label">{m.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="panel">
        <div class="panel-hd">
          <span>Trend — Utilization / Loss (%) &amp; Technicians</span>
          <span class="hint">HOVER FOR VALUES</span>
        </div>
        <div class="axis-note">
          <b>LEFT AXIS</b> — % of shift time · <b>RIGHT AXIS</b> — technicians · <b>X AXIS</b> — day + shift (N = Night, D = Day)
        </div>
        <div class="chart-container">
          <EChart option={chartOption} height="340px" />
        </div>
      </div>
    </div>

    <!-- Performance Trend Table -->
    {#if trendData.shift_details}
      <div class="table-wrapper">
        <table class="trend-table">
          <thead>
            <tr>
              <th class="sortable" onclick={() => sortBy('date')}>Date {sortColumn === 'date' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('shift')}>Shift {sortColumn === 'shift' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('total_request_jobs')}>Total Request Job {sortColumn === 'total_request_jobs' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('total_closed_jobs')}>Total Close Job {sortColumn === 'total_closed_jobs' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('tech_count')}>Technician {sortColumn === 'tech_count' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('avg_job_per_tech')}>Avg Job per Tech {sortColumn === 'avg_job_per_tech' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('down_jobs')}>M/C Down Job {sortColumn === 'down_jobs' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('avg_down_time')}>Avg M/C Down time {sortColumn === 'avg_down_time' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('setup_jobs')}>Setup Job {sortColumn === 'setup_jobs' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('avg_setup_time')}>Avg Setup time {sortColumn === 'avg_setup_time' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('avg_waiting_time')}>Avg Waiting time {sortColumn === 'avg_waiting_time' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => sortBy('max_waiting_time')}>Max Waiting time {sortColumn === 'max_waiting_time' ? (sortDir === 1 ? '↑' : '↓') : ''}</th>
            </tr>
          </thead>
          <tbody>
            {#each getSortedData() as detail (detail.date + detail.shift)}
              <tr class:shift-night={detail.shift === 'Night'} class:shift-day={detail.shift === 'Day'}>
                <td>{detail.date}</td>
                <td class="shift-label">{detail.shift}</td>
                <td class="num">{detail.total_request_jobs}</td>
                <td class="num">{detail.total_closed_jobs}</td>
                <td class="num">{detail.tech_count}</td>
                <td class="num">{detail.avg_job_per_tech.toFixed(1)}</td>
                <td class="num">{detail.down_jobs}</td>
                <td class="num">{detail.avg_down_time.toFixed(1)}</td>
                <td class="num">{detail.setup_jobs}</td>
                <td class="num">{detail.avg_setup_time.toFixed(1)}</td>
                <td class="num">{detail.avg_waiting_time.toFixed(1)}</td>
                <td class="num">{detail.max_waiting_time.toFixed(1)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
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

  /* KPI strip */
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
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

  /* Series control + chart */
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
    background: none;
    cursor: pointer;
    text-align: left;
  }

  .tog:hover {
    background: #f1f1f1;
  }

  .sw {
    width: 30px;
    height: 16px;
    border-radius: 8px;
    background: #ccc;
    position: relative;
    flex: none;
    transition: background 0.15s;
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

  .chart-container {
    background: white;
    padding: 8px;
  }

  .chart-placeholder {
    background: #f9f9f9;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    padding: 40px;
    text-align: center;
    color: #999;
    font-size: 13px;
  }

  .chart-placeholder.error {
    color: #cc0000;
    background: #fff5f5;
    border-color: #ffccc3;
  }

  .table-wrapper {
    margin-top: 16px;
    border: 1px solid #e3e3e3;
    border-radius: 4px;
    overflow-x: auto;
    background: white;
  }

  .trend-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .trend-table thead {
    background: #f5f5f5;
    border-bottom: 2px solid #ddd;
  }

  .trend-table th {
    padding: 8px 10px;
    text-align: left;
    font-weight: 600;
    color: #1c355e;
    white-space: nowrap;
    border-right: 1px solid #e8e8e8;
  }

  .trend-table th:last-child {
    border-right: none;
  }

  .trend-table th.sortable {
    cursor: pointer;
    user-select: none;
    transition: background-color 0.2s;
  }

  .trend-table th.sortable:hover {
    background-color: #efefef;
  }

  .trend-table td {
    padding: 8px 10px;
    border-right: 1px solid #e8e8e8;
    border-bottom: 1px solid #f0f0f0;
  }

  .trend-table td:last-child {
    border-right: none;
  }

  .trend-table tr.shift-night {
    background: #f9f9fb;
  }

  .trend-table tr.shift-day {
    background: white;
  }

  .trend-table tr:hover {
    background: #f5f7ff;
  }

  .trend-table td.shift-label {
    font-weight: 600;
    color: #666;
  }

  .trend-table tr.shift-day td.shift-label {
    color: #1c9ce4;
  }

  .trend-table td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: #333;
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
