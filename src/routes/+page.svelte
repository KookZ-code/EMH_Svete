<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import EChart from '$lib/components/EChart.svelte';
  import { overviewApi } from '$lib/utils/api';
  import type { OverviewKpi, StatusMatrixRow, OpenJob, MachineArea } from '$types';

  const ALL_AREAS: MachineArea[] = ['BG','SAW','DA','WB','MOLD','PLATE','MARK','SAW_QFN','TF','ISO','FS'];

  // ── State ─────────────────────────────────────────────────────────────────
  let kpi          = $state<OverviewKpi>({ key_machines:0, running:0, mc_down:0, waiting_for_tech:0, on_process:0, closed_this_shift:0, last_updated:'' });
  let matrix       = $state<StatusMatrixRow[]>([]);
  let jobs         = $state<OpenJob[]>([]);
  let loading      = $state(true);
  let error        = $state<string | null>(null);
  let filterAreas  = $state<MachineArea[]>([]);  // empty = all areas

  function toggleArea(a: MachineArea) {
    if (filterAreas.includes(a)) filterAreas = filterAreas.filter(x => x !== a);
    else filterAreas = [...filterAreas, a];
    loadData();
  }

  async function loadData() {
    loading = true;
    error = null;
    const areas = filterAreas.length > 0 ? filterAreas : undefined;
    const [overviewRes, jobsRes] = await Promise.all([
      overviewApi.all(areas),
      overviewApi.openJobs(areas),
    ]);
    if (overviewRes.error) { error = overviewRes.error.message; loading = false; return; }
    if (overviewRes.data) {
      kpi    = overviewRes.data.kpi;
      matrix = overviewRes.data.matrix;
    }
    if (jobsRes.data) jobs = jobsRes.data;
    loading = false;
  }

  // ── Donut chart option ────────────────────────────────────────────────────
  const donutOption = $derived({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      orient: 'vertical', right: 10, top: 'center',
      textStyle: { fontSize: 11 },
    },
    series: [{
      type: 'pie',
      radius: ['48%', '70%'],
      center: ['38%', '50%'],
      avoidLabelOverlap: false,
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
      data: [
        { value: kpi.running,           name: 'Running',     itemStyle: { color: '#5EBF33' } },
        { value: kpi.mc_down,           name: 'M/C Down',    itemStyle: { color: '#CC0000' } },
        { value: kpi.waiting_for_tech,  name: 'Waiting',     itemStyle: { color: '#FD7F20' } },
        { value: kpi.on_process,        name: 'On Process',  itemStyle: { color: '#1D9CE4' } },
        { value: Math.max(0, kpi.key_machines - kpi.running - kpi.mc_down - kpi.waiting_for_tech - kpi.on_process),
          name: 'Other', itemStyle: { color: '#8A8A8A' } },
      ].filter(d => d.value > 0),
    }],
  });

  // ── Table columns ─────────────────────────────────────────────────────────
  const jobCols = [
    { key: 'code_machine', label: 'Machine', width: '88px', sortable: true,
      renderHtml: (v: unknown, row: OpenJob) =>
        `<span style="font-weight:700;color:var(--color-primary)">${v}</span>${row.is_key ? ' <span style="font-size:9px;background:var(--color-accent-orange);color:#fff;border-radius:3px;padding:1px 4px;font-weight:700">KEY</span>' : ''}`,
    },
    { key: 'area',     label: 'Area',  width: '48px', sortable: true },
    { key: 'job_type', label: 'Type',  width: '130px',
      renderHtml: (v: unknown) => `<span style="display:inline-block;background:${jobTypeColor(String(v))};color:${String(v)==='CONVERT'?'#333':'#fff'};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap">${v}</span>`,
    },
    { key: 'symptom', label: 'Symptom', width: '240px',
      renderHtml: (v: unknown) => {
        const text = String(v ?? '—');
        const safe = text.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        // max-width on a display:block span caps the td's layout width at 240px
        // so the table never overflows horizontally regardless of text length
        return `<span title="${safe}" style="display:block;max-width:224px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text-dark)">${text}</span>`;
      },
    },
    { key: 'wait_time_min', label: 'Wait', width: '62px', align: 'right' as const, sortable: true,
      renderHtml: (v: unknown) => {
        const m = Number(v);
        const warn = m > 60;
        return `<span style="font-weight:700;color:${warn ? 'var(--status-down)' : 'var(--color-text-dark)'}">${fmtMin(m)}</span>`;
      },
    },
    { key: 'repair_time_min', label: 'Repair', width: '68px', align: 'right' as const, sortable: true,
      renderHtml: (v: unknown) => {
        const m = Number(v);
        return `<span style="font-weight:600;color:var(--color-text-muted)">${fmtMin(m)}</span>`;
      },
    },
    { key: 'tech_name', label: 'Tech', width: '88px', sortable: true,
      format: (v: unknown): string => String(v ?? '—'),
    },
    { key: 'status', label: 'Status', width: '92px',
      renderHtml: (v: unknown) => {
        const s = String(v);
        const cfg: Record<string,string> = { 'Waiting':'#FD7F20', 'On Process':'#1D9CE4' };
        const c = cfg[s] ?? '#8A8A8A';
        return `<span style="background:${c};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap">${s}</span>`;
      },
    },
  ];

  function jobTypeColor(t: string): string {
    const map: Record<string,string> = {
      'M/C DOWN':'#CC0000','ENGINEERING DOWN':'#990000','FACILITY DOWN':'#FD7F20',
      'PM':'#702076','SETUP':'#1D9CE4','SETUP BY OPERATOR':'#17A2B8',
      'CONVERT':'#FFD53A','CLEAN MOLD':'#5EBF33','CHANGE CAP':'#8A8A8A',
    };
    return map[t] ?? '#8A8A8A';
  }

  function fmtMin(min: number): string {
    if (!min || min <= 0) return '—';
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  function exportCsv() {
    const headers = ['Machine','Area','Type','Symptom','Wait (min)','Repair (min)','Tech','Status'];
    const escape  = (v: unknown) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = jobs.map(j => [
      j.code_machine, j.area, j.job_type, j.symptom ?? '',
      j.wait_time_min, j.repair_time_min, j.tech_name ?? '', j.status,
    ].map(escape).join(','));

    const area  = filterAreas.length > 0 ? `_${filterAreas.join('-')}` : '';
    const stamp = new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
    const blob  = new Blob(['﻿' + [headers.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `open_jobs${area}_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Auto-refresh every 5 min
  onMount(() => {
    loadData();
    const timer = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head><title>Factory Pulse — EMH Dashboard</title></svelte:head>

<PageHeader
  title="Factory Pulse"
  subtitle="Real-time equipment status overview"
  badge="Live"
  refreshAt={kpi.last_updated || new Date().toISOString()}
/>

<!-- Area filter -->
<div class="area-filter">
  <span class="af-label">Process</span>
  <button class="chip" class:active={filterAreas.length === 0} onclick={() => { filterAreas = []; loadData(); }}>All</button>
  {#each ALL_AREAS as a (a)}
    <button class="chip" class:active={filterAreas.includes(a)} onclick={() => toggleArea(a)}>{a}</button>
  {/each}
</div>

{#if error}
  <div class="state-banner error">⚠ {error}</div>
{:else if loading && kpi.key_machines === 0}
  <div class="state-banner loading">Loading…</div>
{/if}

<!-- KPI Row -->
<div class="grid-6" style="margin-bottom: var(--gutter);">
  <KpiCard label="KEY Machines"      value={kpi.key_machines}        accent="var(--color-primary)"    icon="🏭" />
  <KpiCard label="Running"           value={kpi.running}             accent="var(--status-running)"   icon="✅" />
  <KpiCard label="M/C Down"          value={kpi.mc_down}             accent="var(--status-down)"      icon="🔴" />
  <KpiCard label="Waiting for Tech"  value={kpi.waiting_for_tech}    accent="var(--status-waiting)"   icon="⏳" />
  <KpiCard label="On Process"        value={kpi.on_process}          accent="var(--status-setup)"     icon="🔧" />
  <KpiCard label="Closed This Shift" value={kpi.closed_this_shift}   accent="var(--status-running)"   icon="✔️" />
</div>

<!-- Status Matrix + Donut -->
<div class="grid-2" style="margin-bottom: var(--gutter);">
  <div class="chart-card">
    <div class="card-title">Job Status Matrix</div>
    <table class="matrix-table">
      <thead>
        <tr>
          <th>Job Type</th>
          <th class="center">Waiting</th>
          <th class="center">On Process</th>
          <th class="center">Closed</th>
        </tr>
      </thead>
      <tbody>
        {#each matrix as row (row.job_type)}
          <tr>
            <td><StatusBadge type={row.job_type} size="sm" /></td>
            <td class="center num {row.waiting > 0 ? 'warn' : ''}">{row.waiting}</td>
            <td class="center num">{row.on_process}</td>
            <td class="center num muted">{row.closed}</td>
          </tr>
        {/each}
        {#if matrix.length > 0}
          <tr class="totals">
            <td>Total</td>
            <td class="center num warn">{matrix.reduce((s,r)=>s+r.waiting,0)}</td>
            <td class="center num">{matrix.reduce((s,r)=>s+r.on_process,0)}</td>
            <td class="center num muted">{matrix.reduce((s,r)=>s+r.closed,0)}</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>

  <div class="chart-card">
    <div class="card-title">Machine Status Distribution</div>
    <EChart option={donutOption} height="220px" />
  </div>
</div>

<!-- Open Jobs Table -->
<div class="chart-card">
  <div class="card-title-row">
    <div class="card-title">Open Jobs</div>
    <span class="open-count">{jobs.length} open</span>
    <button class="btn-export" onclick={exportCsv} disabled={jobs.length === 0} title="Export to CSV">
      ↓ CSV
    </button>
  </div>
  <DataTable
    columns={jobCols}
    rows={jobs}
    rowKey={(r) => String(r.id)}
    pageSize={20}
    compact
  />
</div>

<style>
  .area-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm);
    padding: 10px 14px;
    margin-bottom: var(--gutter);
  }

  .af-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--color-text-muted);
    margin-right: 4px;
    white-space: nowrap;
  }

  .state-banner {
    padding: 10px 16px;
    border-radius: var(--r-sm);
    font-size: 13px;
    font-weight: 600;
    margin-bottom: var(--gutter);
  }
  .state-banner.error   { background: #FFF0F0; border: 1px solid var(--status-down); color: var(--status-down); }
  .state-banner.loading { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); }

  .card-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-dark);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--color-border);
    margin-bottom: 12px;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--color-border);
    margin-bottom: 4px;
  }

  .open-count {
    font-size: 11px;
    font-weight: 700;
    background: var(--status-down);
    color: #fff;
    padding: 2px 8px;
    border-radius: var(--r-sm);
  }

  .card-title-row { margin-left: 0; }

  .btn-export {
    margin-left: auto;
    font-size: 11px;
    font-weight: 700;
    color: var(--color-primary);
    background: transparent;
    border: 1px solid var(--color-primary);
    border-radius: var(--r-sm);
    padding: 3px 10px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    white-space: nowrap;
  }
  .btn-export:hover  { background: var(--color-primary); color: #fff; }
  .btn-export:disabled { opacity: 0.4; cursor: not-allowed; }

  .matrix-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .matrix-table thead tr { background: var(--color-primary); }
  .matrix-table th { color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 10px; }
  .matrix-table th.center { text-align: center; }
  .matrix-table tbody tr:nth-child(odd) { background: var(--color-surface); }
  .matrix-table tbody tr:nth-child(even) { background: var(--color-surface-alt); }
  .matrix-table tbody tr:hover { background: #D1DDE6; }
  .matrix-table td { padding: 8px 10px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
  .matrix-table td.center { text-align: center; }
  .matrix-table td.num { font-weight: 700; font-size: 15px; }
  .matrix-table td.warn { color: var(--status-down); }
  .matrix-table td.muted { color: var(--color-text-muted); }
  .matrix-table tr.totals { background: var(--color-surface-gray) !important; font-weight: 700; }
  .matrix-table tr.totals td { border-top: 2px solid var(--color-border-strong); }
</style>
