<script lang="ts">
  // Tech Performance — Technician Scoring & Leaderboard
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import EChart from '$lib/components/EChart.svelte';
  import DataTable from '$lib/components/DataTable.svelte';
  import { timelineApi } from '$lib/utils/api';
  import type { TechScore, MachineArea } from '$types';

  const gradeColors: Record<string,string> = { A:'#5EBF33', B:'#1D9CE4', C:'#FD7F20', D:'#CC0000' };

  let techs        = $state<TechScore[]>([]);
  let selectedTech = $state<TechScore | null>(null);
  let loading      = $state(true);
  let error        = $state<string | null>(null);

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
    const res = await timelineApi.scores(p);
    if (res.error) { error = res.error.message; loading = false; return; }
    techs = res.data ?? [];
    if (techs.length > 0) selectedTech = techs[0];
    loading = false;
  }

  function handleFilter(f: { start: string; end: string; areas: MachineArea[]; shift: 'all'|'day'|'night' }) {
    filters = f;
    loadData();
  }

  function selectTech(t: TechScore) { selectedTech = t; }

  const radarOption = $derived({
    radar: {
      indicator: [
        { name: 'MTTR',        max: 100 },
        { name: 'Response',    max: 100 },
        { name: 'FTFR',        max: 100 },
        { name: 'Volume',      max: 100 },
        { name: 'Versatility', max: 100 },
      ],
      radius: '70%',
      axisName: { fontSize: 11, color: '#586674' },
    },
    tooltip: {},
    series: [{
      type: 'radar',
      data: selectedTech ? [{
        value: [
          selectedTech.mttr_score,
          selectedTech.response_score,
          selectedTech.ftfr_score,
          selectedTech.volume_score,
          selectedTech.versatility_score,
        ],
        name: selectedTech.tech_name,
        areaStyle: { color: gradeColors[selectedTech.grade] + '33' },
        lineStyle: { color: gradeColors[selectedTech.grade], width: 2 },
        itemStyle: { color: gradeColors[selectedTech.grade] },
        symbol: 'circle', symbolSize: 6,
      }] : [],
    }],
  });

  const scoreBarOption = $derived({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { top: 10, left: 20, right: 60, bottom: 20, containLabel: true },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}', fontSize: 10 } },
    yAxis: { type: 'category', data: [...techs].reverse().map(t => t.tech_name), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: [...techs].reverse().map(t => ({ value: t.score, itemStyle: { color: gradeColors[t.grade] } })),
      label: { show: true, position: 'right', formatter: (p: {value: number}) => p.value.toFixed(1), fontSize: 10 },
      barMaxWidth: 24,
    }],
  });

  const cols = [
    { key: 'tech_name',  label: 'Technician', sortable: true },
    { key: 'supervisor', label: 'Supervisor',  sortable: true, format: (v:unknown): string => String(v ?? '—') },
    { key: 'grade',      label: 'Grade', width:'60px', align:'center' as const,
      renderHtml: (v: unknown) => {
        const g = String(v);
        return `<span style="background:${gradeColors[g]};color:#fff;font-weight:700;font-size:12px;padding:2px 8px;border-radius:4px">${g}</span>`;
      },
    },
    { key: 'score',           label: 'Score',    width:'70px', align:'right' as const, sortable: true, format: (v: unknown): string => Number(v).toFixed(1) },
    { key: 'mttr_score',      label: 'MTTR',     width:'60px', align:'right' as const, sortable: true },
    { key: 'response_score',  label: 'Response', width:'70px', align:'right' as const, sortable: true },
    { key: 'ftfr_score',      label: 'FTFR',     width:'60px', align:'right' as const, sortable: true },
    { key: 'total_jobs',      label: 'Jobs',     width:'60px', align:'right' as const, sortable: true },
    { key: 'areas_covered',   label: 'Areas',    width:'60px', align:'right' as const, sortable: true },
  ];

  onMount(loadData);
</script>

<svelte:head><title>Tech Performance — EMH Dashboard</title></svelte:head>

<PageHeader title="Tech Performance" subtitle="Composite scoring: MTTR · Response · FTFR · Volume · Versatility" />

<FilterBar onFilter={handleFilter} showAreaFilter={false} />

{#if error}
  <div class="state-banner error">⚠ {error}</div>
{:else if loading}
  <div class="state-banner loading">Loading…</div>
{/if}

<div class="grid-2" style="margin-bottom: var(--gutter);">
  <div class="chart-card">
    <div class="card-title">Technician Scores</div>
    <div class="grade-legend">
      {#each Object.entries(gradeColors) as [g, c] (g)}
        <span class="grade-chip" style:background-color={c}>{g} {g==='A'?'≥85':g==='B'?'70–84':g==='C'?'55–69':'<55'}</span>
      {/each}
    </div>
    <EChart option={scoreBarOption} height="260px" />
  </div>
  <div class="chart-card">
    <div class="card-title">
      Radar — {selectedTech?.tech_name ?? '—'}
      {#if selectedTech}
        <span class="grade-pill" style:background-color={gradeColors[selectedTech.grade]}>{selectedTech.grade}</span>
      {/if}
    </div>
    <EChart option={radarOption} height="280px" />
    <p class="radar-hint">Click a row in the table to switch technician</p>
  </div>
</div>

<div class="chart-card">
  <div class="card-title">Leaderboard</div>
  <div class="dt-clickable">
    <DataTable
      columns={cols}
      rows={techs}
      rowKey={r => r.tech_name}
      pageSize={20}
      compact
      onRowClick={selectTech}
    />
  </div>
</div>

<style>
  .state-banner { padding: 10px 16px; border-radius: var(--r-sm); font-size: 13px; font-weight: 600; margin-bottom: var(--gutter); }
  .state-banner.error   { background: #FFF0F0; border: 1px solid var(--status-down); color: var(--status-down); }
  .state-banner.loading { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); }

  .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .grade-legend { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .grade-chip { color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: var(--r-sm); }
  .grade-pill { color: #fff; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: var(--r-sm); }
  .radar-hint { font-size: 11px; color: var(--color-text-muted); margin-top: 6px; text-align: center; }
  .dt-clickable :global(tbody tr) { cursor: pointer; }
</style>
