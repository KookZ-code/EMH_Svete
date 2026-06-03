<script lang="ts">
  // Machine Detail — Per-machine drill-down
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import EChart from '$lib/components/EChart.svelte';
  import { machineDetailApi } from '$lib/utils/api';
  import type { MachineProfile, MachineMetrics, StatusTimelineEvent } from '$types';

  interface MachineListItem { machine_id: string; area: string; flag_key: number; }

  let machineList  = $state<MachineListItem[]>([]);
  let selectedId   = $state('');
  let profile      = $state<MachineProfile | null>(null);
  let metrics      = $state<MachineMetrics | null>(null);
  let timeline     = $state<StatusTimelineEvent[]>([]);
  let loading      = $state(true);
  let loadingDetail = $state(false);
  let error        = $state<string | null>(null);

  async function loadList() {
    loading = true;
    const res = await machineDetailApi.list();
    if (res.error) { error = res.error.message; loading = false; return; }
    machineList = (res.data ?? []).map(m => ({
      machine_id: m.machine_id,
      area:       m.area,
      flag_key:   m.flag_key,
    }));
    loading = false;
    if (machineList.length > 0 && !selectedId) {
      await selectMachine(machineList[0].machine_id);
    }
  }

  async function selectMachine(id: string) {
    selectedId = id;
    loadingDetail = true;
    const res = await machineDetailApi.detail(id);
    if (res.error) { error = res.error.message; loadingDetail = false; return; }
    if (res.data) {
      profile  = res.data.profile;
      metrics  = res.data.metrics;
      timeline = res.data.timeline;
      error = null;
    }
    loadingDetail = false;
  }

  // ── Timeline chart ────────────────────────────────────────────────────────
  const statusColorMap: Record<string, string> = {
    'M/C Down':'#CC0000', 'PM':'#702076', 'Setup':'#1D9CE4', 'Convert':'#FFD53A',
    'Running':'#5EBF33', 'Waiting':'#FD7F20',
  };

  const timelineOption = $derived({
    tooltip: { trigger: 'axis' },
    grid: { top: 10, left: 20, right: 20, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: timeline.slice(0, 20).map(e => e.ts.slice(0, 10)).reverse(),
      axisLabel: { fontSize: 10, rotate: 30 },
    },
    yAxis: { type: 'value', name: 'Minutes', axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: timeline.slice(0, 20).map(e => e.duration_min).reverse(),
      itemStyle: {
        color: (p: { dataIndex: number }) => {
          const ev = timeline.slice(0, 20).reverse()[p.dataIndex];
          return statusColorMap[ev?.status ?? ''] ?? '#8A8A8A';
        },
      },
      barMaxWidth: 30,
    }],
  });

  const eventCols = [
    { key: 'ts',           label: 'Time',    width:'120px', sortable: true, format: (v: unknown) => String(v).replace('T',' ').slice(0,16) },
    { key: 'status',       label: 'Status',  width:'100px',
      renderHtml: (v: unknown) => {
        const c = statusColorMap[String(v)] ?? '#8A8A8A';
        const tc = String(v) === 'Convert' ? '#333' : '#fff';
        return `<span style="background:${c};color:${tc};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">${v}</span>`;
      },
    },
    { key: 'job_type',     label: 'Job Type', width:'130px', format: (v: unknown): string => String(v ?? '—') },
    { key: 'duration_min', label: 'Min',      width:'70px',  align:'right' as const, sortable: true },
  ];

  onMount(loadList);
</script>

<svelte:head><title>Machine Detail — EMH Dashboard</title></svelte:head>

<PageHeader title="Machine Detail" subtitle="Per-machine performance drill-down" />

{#if error}
  <div class="state-err">⚠ {error}</div>
{/if}

<div class="detail-layout">
  <!-- Machine list -->
  <div class="machine-list">
    <div class="ml-title">Machines</div>
    {#if loading}
      <div class="ml-loading">Loading…</div>
    {:else}
      {#each machineList as m (m.machine_id)}
        <button
          class="ml-item"
          class:active={selectedId === m.machine_id}
          onclick={() => selectMachine(m.machine_id)}
        >
          <span class="ml-code">{m.machine_id}</span>
          <span class="ml-area">{m.area}</span>
          {#if m.flag_key === 1}<span class="ml-key">KEY</span>{/if}
        </button>
      {/each}
    {/if}
  </div>

  <!-- Detail panel -->
  <div class="detail-body">
    {#if loadingDetail}
      <div class="state-loading">Loading machine data…</div>
    {:else if profile}
      <!-- Profile card -->
      <div class="chart-card profile-card" style="margin-bottom: var(--gutter);">
        <div class="profile-header">
          <div>
            <h3 class="profile-code">{profile.code_machine}</h3>
            <p class="profile-model">{profile.model} · {profile.manufacturer}</p>
          </div>
          {#if profile.is_key}
            <span class="key-badge">KEY MACHINE</span>
          {/if}
        </div>
        <div class="profile-fields">
          <div class="pf-row"><span>Area</span><strong>{profile.area}</strong></div>
          <div class="pf-row"><span>Install Year</span><strong>{profile.year_install ?? '—'}</strong></div>
          <div class="pf-row"><span>Serial No.</span><strong>{profile.serial_no ?? '—'}</strong></div>
          {#if profile.notes}
            <div class="pf-row"><span>Notes</span><em>{profile.notes}</em></div>
          {/if}
        </div>
      </div>

      <!-- Metrics -->
      {#if metrics}
        <div class="metrics-row" style="margin-bottom: var(--gutter);">
          <div class="metric-card"><div class="metric-val">{metrics.utilization_30d.toFixed(1)}%</div><div class="metric-lbl">Utilization (30d)</div></div>
          <div class="metric-card"><div class="metric-val">{metrics.mttr_h.toFixed(1)}h</div><div class="metric-lbl">Avg MTTR</div></div>
          <div class="metric-card"><div class="metric-val">{metrics.downtime_events_30d}</div><div class="metric-lbl">Down Events (30d)</div></div>
          <div class="metric-card"><div class="metric-val">{metrics.pm_events_30d}</div><div class="metric-lbl">PM Events (30d)</div></div>
        </div>
      {/if}

      <!-- Timeline chart -->
      <div class="chart-card" style="margin-bottom: var(--gutter);">
        <div class="card-title">Event Duration Timeline (last 20)</div>
        <EChart option={timelineOption} height="180px" />
      </div>

      <!-- Events table -->
      <div class="chart-card">
        <div class="card-title">Recent Events</div>
        <DataTable columns={eventCols} rows={timeline} rowKey={(_r, i) => String(i)} compact pageSize={15} />
      </div>
    {:else if !loading}
      <div class="state-loading">Select a machine to view details.</div>
    {/if}
  </div>
</div>

<style>
  .state-err { background:#FFF0F0; border:1px solid #CC0000; color:#CC0000; padding:8px 16px; border-radius:var(--r-sm); margin-bottom:12px; font-size:13px; font-weight:600; }
  .state-loading { padding:24px; color:var(--color-text-muted); font-size:13px; }

  .detail-layout { display: grid; grid-template-columns: 200px 1fr; gap: var(--gutter); align-items: start; }
  @media (max-width: 800px) { .detail-layout { grid-template-columns: 1fr; } }

  .machine-list { background:var(--color-surface); border:1px solid var(--color-border-strong); border-radius:var(--r-sm); overflow:hidden; position:sticky; top:70px; }
  .ml-title { background:var(--color-primary); color:#fff; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; padding:8px 12px; }
  .ml-loading { padding:12px; color:var(--color-text-muted); font-size:12px; }

  .ml-item { display:flex; align-items:center; gap:6px; width:100%; padding:8px 12px; background:none; border:none; border-bottom:1px solid var(--color-border); cursor:pointer; text-align:left; transition:background 0.1s; font-size:12px; }
  .ml-item:hover { background:var(--color-surface-alt); }
  .ml-item.active { background:#D1DDE6; font-weight:700; }
  .ml-code { flex:1; font-weight:600; color:var(--color-text-dark); }
  .ml-area { font-size:10px; color:var(--color-text-muted); }
  .ml-key { font-size:9px; font-weight:700; background:var(--color-accent-orange); color:#fff; border-radius:3px; padding:1px 4px; }

  .profile-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:12px; gap:12px; }
  .profile-code { font-size:20px; font-weight:700; color:var(--color-primary); }
  .profile-model { font-size:13px; color:var(--color-text-muted); margin-top:2px; }
  .key-badge { background:var(--color-accent-orange); color:#fff; font-size:10px; font-weight:700; padding:4px 10px; border-radius:var(--r-sm); white-space:nowrap; flex-shrink:0; }
  .profile-fields { display:flex; flex-direction:column; gap:6px; }
  .pf-row { display:flex; gap:16px; font-size:13px; }
  .pf-row span { color:var(--color-text-muted); min-width:100px; }
  .pf-row strong { color:var(--color-text-dark); font-weight:600; }

  .metrics-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  @media (max-width: 900px) { .metrics-row { grid-template-columns:repeat(2,1fr); } }
  .metric-card { background:var(--color-surface); border:1px solid var(--color-border-strong); border-radius:var(--r-sm); padding:12px; text-align:center; }
  .metric-val { font-size:28px; font-weight:700; color:var(--color-primary); }
  .metric-lbl { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); margin-top:4px; }

  .card-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); margin-bottom:8px; }
</style>
