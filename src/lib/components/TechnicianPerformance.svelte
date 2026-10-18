<script lang="ts">
  import type { ComponentProps } from 'svelte';

  interface TechStats {
    name: string;
    closed_jobs: number;
    open_jobs: number;
    total_jobs: number;
    down_avg: number;
    down_min: number;
    down_max: number;
    down_events: number;
    setup_avg: number;
    setup_min: number;
    setup_max: number;
    setup_events: number;
  }

  interface TechSummary {
    tech_count: number;
    down_jobs: number;
    setup_jobs: number;
    closed_jobs: number;
    open_jobs: number;
    closed_pct: number;
    open_pct: number;
    avg_jobs: number;
    down_avg: number;
    down_min: number;
    down_max: number;
    setup_avg: number;
    setup_min: number;
    setup_max: number;
  }

  interface Props {
    summary: TechSummary | null;
    techs: TechStats[];
  }

  let { summary, techs }: Props = $props();

  let sortCol = $state<keyof TechStats>('down_avg');
  let sortDir = $state<1 | -1>(-1);

  function sortBy(col: keyof TechStats) {
    if (sortCol === col) {
      sortDir = sortDir === 1 ? -1 : 1;
    } else {
      sortCol = col;
      sortDir = col === 'name' ? 1 : -1;
    }
  }

  const closedOnly = $derived(techs.filter(t => t.closed_jobs > 0));

  const sorted = $derived.by(() => {
    const col = sortCol;
    const dir = sortDir;
    return [...closedOnly].sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      if (typeof va === 'string') {
        return dir * (va as string).localeCompare(vb as string);
      }
      return dir * ((va as number) - (vb as number));
    });
  });

  const getSortIcon = (col: keyof TechStats) => {
    if (sortCol !== col) return '↕';
    return sortDir === 1 ? '↑' : '↓';
  };
</script>

<div class="tech-perf-wrapper">
  <h3 class="section-title">👥 Technician Performance</h3>

  {#if summary}
    <div class="kpi-cards">
      <div class="kpi-card">
        <div class="kpi-label">Jobs Status</div>
        <div class="kpi-breakdown">
          <div><span class="label">Closed:</span> <span class="value closed">{summary.closed_jobs}</span> <span class="pct">({summary.closed_pct.toFixed(1)}%)</span></div>
          <div><span class="label">Unclosed:</span> <span class="value unclosed">{summary.open_jobs}</span> <span class="pct">({summary.open_pct.toFixed(1)}%)</span></div>
          <div style="border-top:1px solid #e0e0e0; padding-top:3px; margin-top:3px;"><span class="label">Avg/Tech:</span> <span class="value">{summary.avg_jobs.toFixed(1)}</span></div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Overview</div>
        <div class="kpi-breakdown">
          <div><span class="label">Technicians:</span> <span class="value">{summary.tech_count}</span></div>
          <div><span class="label">M/C DOWN Jobs:</span> <span class="value">{summary.down_jobs}</span></div>
          <div><span class="label">SETUP Jobs:</span> <span class="value">{summary.setup_jobs}</span></div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">M/C DOWN</div>
        <div class="kpi-breakdown">
          <div><span class="label">Avg:</span> <span class="value">{summary.down_avg.toFixed(1)}m</span></div>
          <div><span class="label">Min:</span> <span class="value">{summary.down_min.toFixed(1)}m</span></div>
          <div><span class="label">Max:</span> <span class="value">{summary.down_max.toFixed(1)}m</span></div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">SETUP</div>
        <div class="kpi-breakdown">
          <div><span class="label">Avg:</span> <span class="value">{summary.setup_avg.toFixed(1)}m</span></div>
          <div><span class="label">Min:</span> <span class="value">{summary.setup_min.toFixed(1)}m</span></div>
          <div><span class="label">Max:</span> <span class="value">{summary.setup_max.toFixed(1)}m</span></div>
        </div>
      </div>
    </div>
  {/if}

  <div class="table-wrapper">
    <table class="tech-table">
      <thead>
        <tr>
          <th class="sortable" onclick={() => sortBy('name')}>
            Technician {getSortIcon('name')}
          </th>
          <th class="sortable numeric" onclick={() => sortBy('closed_jobs')}>
            Closed {getSortIcon('closed_jobs')}
          </th>
          <th class="sortable numeric" onclick={() => sortBy('down_avg')}>
            M/C DOWN (avg) {getSortIcon('down_avg')}
          </th>
          <th class="numeric">Min</th>
          <th class="numeric">Max</th>
          <th class="numeric">Events</th>
          <th class="sortable numeric" onclick={() => sortBy('setup_avg')}>
            SETUP (avg) {getSortIcon('setup_avg')}
          </th>
          <th class="numeric">Min</th>
          <th class="numeric">Max</th>
          <th class="numeric">Events</th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as tech (tech.name)}
          <tr>
            <td class="name">{tech.name}</td>
            <td class="numeric closed">{tech.closed_jobs}</td>
            <td class="numeric down-avg">{tech.down_avg.toFixed(1)}m</td>
            <td class="numeric">{tech.down_min.toFixed(1)}m</td>
            <td class="numeric">{tech.down_max.toFixed(1)}m</td>
            <td class="numeric">{tech.down_events}</td>
            <td class="numeric setup-avg">{tech.setup_avg.toFixed(1)}m</td>
            <td class="numeric">{tech.setup_min.toFixed(1)}m</td>
            <td class="numeric">{tech.setup_max.toFixed(1)}m</td>
            <td class="numeric">{tech.setup_events}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .tech-perf-wrapper {
    background: white;
    border: 1px solid #e3e3e3;
    border-radius: 6px;
    padding: 16px;
    margin-top: 20px;
  }

  .section-title {
    font-size: 15px;
    font-weight: 600;
    color: #1c355e;
    margin: 0 0 16px 0;
    padding-bottom: 8px;
    border-bottom: 2px solid #f0f0f0;
  }

  .kpi-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .kpi-card {
    background: #f9f9f9;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    padding: 12px;
  }

  .kpi-label {
    font-size: 11px;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .kpi-value {
    font-size: 20px;
    font-weight: 700;
    color: #1c355e;
    margin-bottom: 4px;
  }

  .kpi-sublabel {
    font-size: 10px;
    color: #bbb;
  }

  .kpi-breakdown {
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .kpi-breakdown div {
    display: flex;
    gap: 8px;
  }

  .kpi-breakdown .label {
    color: #999;
    font-weight: 500;
    min-width: 35px;
  }

  .kpi-breakdown .value {
    color: #1c355e;
    font-weight: 600;
  }

  .kpi-breakdown .value.closed {
    color: #2d8e4e;
  }

  .kpi-breakdown .value.unclosed {
    color: #ff6b6b;
  }

  .kpi-breakdown .pct {
    color: #999;
    font-size: 11px;
    font-weight: 500;
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .tech-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .tech-table thead {
    background: #f5f5f5;
    border-bottom: 2px solid #ddd;
  }

  .tech-table th {
    padding: 10px 8px;
    text-align: left;
    font-weight: 600;
    color: #666;
    white-space: nowrap;
  }

  .tech-table th.numeric {
    text-align: right;
  }

  .tech-table th.sortable {
    cursor: pointer;
    user-select: none;
  }

  .tech-table th.sortable:hover {
    background: #ececec;
  }

  .tech-table tbody tr {
    border-bottom: 1px solid #e8e8e8;
  }

  .tech-table tbody tr:hover {
    background: #fafafa;
  }

  .tech-table td {
    padding: 8px;
    color: #333;
  }

  .tech-table td.name {
    font-weight: 500;
    min-width: 120px;
  }

  .tech-table td.numeric {
    text-align: right;
  }

  .tech-table td.down-avg {
    color: #cc0000;
    font-weight: 600;
  }

  .tech-table td.setup-avg {
    color: #1d9ce4;
    font-weight: 600;
  }

  .tech-table td.closed {
    color: #2d8e4e;
    font-weight: 600;
  }

  .tech-table td.unclosed {
    color: #ff6b6b;
    font-weight: 600;
  }
</style>
