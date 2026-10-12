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

  interface TrendData {
    dates: string[];
    shifts: string[];
    shift_details: ShiftDetail[];
    metrics: {
      avg_util: number[];
      down_pct: number[];
      wait_pct: number[];
      setup_conv_pct: number[];
      idle_pct: number[];
    };
  }

  interface Props {
    date?: string;
    packages?: string;
  }

  let { date = '', packages = '' } = $props<Props>();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let trendData = $state<TrendData | null>(null);
  let chartOption = $state<EChartsOption | null>(null);

  let showMetrics = $state({
    avg_util: false,
    down_pct: true,
    wait_pct: true,
    setup_conv_pct: true,
    idle_pct: true,
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

  function buildChart() {
    if (!trendData) return;

    const { dates, shifts, metrics } = trendData;

    // X-axis labels: "Date Shift"
    const xLabels = dates.map((d, i) => {
      const parts = d.split('-');
      const day = parts[2];
      const shift = shifts[i];
      return `${day} ${shift.slice(0, 1)}`;
    });

    // Calculate dynamic Y-axis max based on visible metrics
    let visibleMetrics: number[] = [];
    if (showMetrics.avg_util) visibleMetrics.push(...metrics.avg_util);
    if (showMetrics.down_pct) visibleMetrics.push(...metrics.down_pct);
    if (showMetrics.wait_pct) visibleMetrics.push(...metrics.wait_pct);
    if (showMetrics.setup_conv_pct) visibleMetrics.push(...metrics.setup_conv_pct);
    if (showMetrics.idle_pct) visibleMetrics.push(...metrics.idle_pct);

    let yMax = 100;
    if (visibleMetrics.length > 0) {
      const dataMax = Math.max(...visibleMetrics);
      if (showMetrics.avg_util) {
        yMax = 100;
      } else {
        yMax = Math.max(dataMax * 1.2, 20); // 20% padding, min 20
        yMax = Math.ceil(yMax / 5) * 5; // Round up to nearest 5
      }
    }

    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return '';
          const idx = params[0]?.dataIndex;
          if (idx == null) return '';
          return `<b>${dates[idx]} ${shifts[idx]}</b><br/>` +
            params.map((p: any) => `<span style="color:${p.color}">●</span> ${p.seriesName}: ${p.value.toFixed(1)}${p.seriesName.includes('%') ? '%' : ''}`).join('<br/>');
        },
      },
      legend: {
        data: ['AVG UTIL %', 'M/C DOWN %', 'WAIT %', 'SETUP+CONV %', 'IDLE %'],
        top: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { top: 40, left: 50, right: 50, bottom: 50, containLabel: true },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 10, rotate: 45 },
      },
      yAxis: {
        type: 'value',
        name: '%',
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
        min: 0,
        max: yMax,
      },
      series: [
        {
          name: 'AVG UTIL %',
          type: 'line',
          data: metrics.avg_util,
          stroke: '#2d8e4e',
          lineStyle: { color: '#2d8e4e', width: 2 },
          itemStyle: { color: '#2d8e4e' },
          symbol: 'circle',
          symbolSize: 4,
          show: showMetrics.avg_util,
        },
        {
          name: 'M/C DOWN %',
          type: 'line',
          data: metrics.down_pct,
          lineStyle: { color: '#cc0000', width: 2 },
          itemStyle: { color: '#cc0000' },
          symbol: 'circle',
          symbolSize: 4,
          show: showMetrics.down_pct,
        },
        {
          name: 'WAIT %',
          type: 'line',
          data: metrics.wait_pct,
          lineStyle: { color: '#e67e22', width: 2 },
          itemStyle: { color: '#e67e22' },
          symbol: 'circle',
          symbolSize: 4,
          show: showMetrics.wait_pct,
        },
        {
          name: 'SETUP+CONV %',
          type: 'line',
          data: metrics.setup_conv_pct,
          lineStyle: { color: '#1d9ce4', width: 2 },
          itemStyle: { color: '#1d9ce4' },
          symbol: 'circle',
          symbolSize: 4,
          show: showMetrics.setup_conv_pct,
        },
        {
          name: 'IDLE %',
          type: 'line',
          data: metrics.idle_pct,
          lineStyle: { color: '#702076', width: 2 },
          itemStyle: { color: '#702076' },
          symbol: 'circle',
          symbolSize: 4,
          show: showMetrics.idle_pct,
        },
      ],
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

  <!-- Metric toggles -->
  <div class="metric-toggles">
    {#each [
      { key: 'avg_util', label: 'AVG UTIL %', color: '#2d8e4e' },
      { key: 'down_pct', label: 'M/C DOWN %', color: '#cc0000' },
      { key: 'wait_pct', label: 'WAIT %', color: '#e67e22' },
      { key: 'setup_conv_pct', label: 'SETUP+CONV %', color: '#1d9ce4' },
      { key: 'idle_pct', label: 'IDLE %', color: '#702076' },
    ] as metric (metric.key)}
      <button
        class="toggle-btn"
        class:active={showMetrics[metric.key as keyof typeof showMetrics]}
        onclick={() => {
          showMetrics[metric.key as keyof typeof showMetrics] = !showMetrics[metric.key as keyof typeof showMetrics];
          buildChart();
        }}
        style:--color={metric.color}
      >
        <span class="toggle-dot"></span>
        {metric.label}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="chart-placeholder">Loading 7-day trend...</div>
  {:else if error}
    <div class="chart-placeholder error">⚠ {error}</div>
  {:else if chartOption}
    <!-- Performance Trend Table -->
    {#if trendData && trendData.shift_details}
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

    <div class="chart-container">
      <EChart option={chartOption} height="300px" />
    </div>

    {#if trendData}
      <div class="metrics-summary">
        <div class="metric-stat">
          <div class="stat-label">Avg Utilization</div>
          <div class="stat-value green">
            {avgOf(trendData.metrics.avg_util).toFixed(1)}%
          </div>
        </div>
        <div class="metric-stat">
          <div class="stat-label">Avg M/C DOWN %</div>
          <div class="stat-value red">
            {(trendData.metrics.down_pct.reduce((a, b) => a + b, 0) / trendData.metrics.down_pct.length).toFixed(1)}%
          </div>
        </div>
        <div class="metric-stat">
          <div class="stat-label">Avg WAIT %</div>
          <div class="stat-value orange">
            {(trendData.metrics.wait_pct.reduce((a, b) => a + b, 0) / trendData.metrics.wait_pct.length).toFixed(1)}%
          </div>
        </div>
        <div class="metric-stat">
          <div class="stat-label">Avg SETUP+CONV</div>
          <div class="stat-value blue">
            {(trendData.metrics.setup_conv_pct.reduce((a, b) => a + b, 0) / trendData.metrics.setup_conv_pct.length).toFixed(1)}%
          </div>
        </div>
        <div class="metric-stat">
          <div class="stat-label">Avg IDLE %</div>
          <div class="stat-value purple">
            {(trendData.metrics.idle_pct.reduce((a, b) => a + b, 0) / trendData.metrics.idle_pct.length).toFixed(1)}%
          </div>
        </div>
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

  .metric-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
    padding: 12px;
    background: #f5f5f5;
    border-radius: 4px;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid #ddd;
    background: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: #555;
    transition: all 0.2s ease;
  }

  .toggle-btn:hover {
    border-color: #999;
    background: #fafafa;
  }

  .toggle-btn.active {
    border-color: var(--color);
    background: var(--color);
    color: white;
  }

  .toggle-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.6;
  }

  .toggle-btn.active .toggle-dot {
    opacity: 1;
  }

  .chart-container {
    background: #fafafa;
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 16px;
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

  .metrics-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-top: 12px;
  }

  .metric-stat {
    background: #f9f9f9;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    padding: 10px;
    text-align: center;
  }

  .stat-label {
    font-size: 11px;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .stat-value {
    font-size: 16px;
    font-weight: 700;
  }

  .stat-value.green { color: #2d8e4e; }
  .stat-value.red { color: #cc0000; }
  .stat-value.orange { color: #e67e22; }
  .stat-value.blue { color: #1d9ce4; }
  .stat-value.purple { color: #702076; }

  .table-wrapper {
    margin-bottom: 16px;
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

  .trend-table tr.shift-night td.shift-label {
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
</style>
