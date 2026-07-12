<script lang="ts" generics="T extends object">
  interface Column<R extends object> {
    key: string;
    label: string;
    width?: string;
    align?: 'left' | 'center' | 'right';
    format?: (val: unknown, row: R) => string;
    renderHtml?: (val: unknown, row: R) => string;
    sortable?: boolean;
  }

  interface Props<R extends object> {
    columns: Column<R>[];
    rows: R[];
    rowKey?: (row: R, index: number) => string;
    emptyText?: string;
    pageSize?: number;
    compact?: boolean;
    onRowClick?: (row: R) => void;
  }

  let {
    columns,
    rows,
    rowKey = (_r, i) => String(i),
    emptyText = 'No data',
    pageSize = 50,
    compact = false,
    onRowClick,
  }: Props<T> = $props();

  let sortKey = $state('');
  let sortAsc = $state(true);
  let currentPage = $state(1);
  let search = $state('');

  const filtered = $derived.by(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      Object.values(r as Record<string, unknown>).some(
        v => String(v ?? '').toLowerCase().includes(q)
      )
    );
  });

  const sorted = $derived.by(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] ?? '';
      const bv = (b as Record<string, unknown>)[sortKey] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });
  });

  const totalPages = $derived(Math.max(1, Math.ceil(sorted.length / pageSize)));
  const paginated = $derived(sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize));

  function toggleSort(key: string) {
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = true; }
    currentPage = 1;
  }

  function cellVal(row: T, col: Column<T>): string {
    const raw = (row as Record<string, unknown>)[col.key];
    if (col.format) return col.format(raw, row);
    if (raw === null || raw === undefined) return '—';
    return String(raw);
  }

  function cellHtml(row: T, col: Column<T>): string {
    const raw = (row as Record<string, unknown>)[col.key];
    return col.renderHtml!(raw, row);
  }

  $effect(() => {
    search;
    rows;
    currentPage = 1;
  });
</script>

<div class="dt-wrap">
  <div class="dt-toolbar">
    <input class="input dt-search" type="search" placeholder="Search…" bind:value={search} />
    <span class="dt-count">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
  </div>

  <div class="dt-scroll">
    <table class="dt-table" class:compact>
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th
              style:width={col.width}
              style:text-align={col.align ?? 'left'}
              class:sortable={col.sortable}
              tabindex={col.sortable ? 0 : undefined}
              role={col.sortable ? 'button' : undefined}
              aria-sort={col.sortable ? (sortKey === col.key ? (sortAsc ? 'ascending' : 'descending') : 'none') : undefined}
              onclick={() => col.sortable && toggleSort(col.key)}
              onkeydown={(e) => { if (col.sortable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSort(col.key); } }}
            >
              {col.label}
              {#if col.sortable}
                <span class="sort-icon">
                  {sortKey === col.key ? (sortAsc ? '▲' : '▼') : '↕'}
                </span>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each paginated as row, i (rowKey(row, i))}
          <tr
            class:clickable={!!onRowClick}
            onclick={() => onRowClick?.(row)}
          >
            {#each columns as col (col.key)}
              <td style:text-align={col.align ?? 'left'}>
                {#if col.renderHtml}
                  {@html cellHtml(row, col)}
                {:else}
                  {cellVal(row, col)}
                {/if}
              </td>
            {/each}
          </tr>
        {:else}
          <tr>
            <td colspan={columns.length} class="empty">{emptyText}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if totalPages > 1}
    <div class="dt-pagination">
      <button class="btn btn-ghost btn-sm" disabled={currentPage === 1} onclick={() => currentPage--}>‹ Prev</button>
      <span class="pg-info">Page {currentPage} / {totalPages}</span>
      <button class="btn btn-ghost btn-sm" disabled={currentPage === totalPages} onclick={() => currentPage++}>Next ›</button>
    </div>
  {/if}
</div>

<style>
  .dt-wrap { display: flex; flex-direction: column; gap: 0; }

  .dt-toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
  .dt-search { max-width: 260px; }
  .dt-count { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; }

  .dt-scroll { overflow-x: auto; }

  .dt-table {
    width: 100%; border-collapse: collapse; font-size: 13px;
  }
  .dt-table.compact { font-size: 12px; }

  thead tr { background-color: var(--color-primary); }

  th {
    color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; padding: 10px; white-space: nowrap;
    border-right: 1px solid rgba(255,255,255,0.12); user-select: none;
  }
  th:last-child { border-right: none; }
  th.sortable { cursor: pointer; }
  th.sortable:hover { background-color: var(--color-primary-hover); }

  .sort-icon { margin-left: 4px; opacity: 0.7; font-size: 10px; }

  tbody tr:nth-child(odd)  { background-color: var(--color-surface); }
  tbody tr:nth-child(even) { background-color: var(--color-surface-alt); }
  tbody tr:hover { background-color: #D1DDE6; }
  tbody tr.clickable { cursor: pointer; }

  td {
    padding: 8px 10px; border-bottom: 1px solid var(--color-border);
    color: var(--color-text-dark); vertical-align: middle; white-space: nowrap;
  }
  .compact td { padding: 5px 8px; }

  td.empty { text-align: center; color: var(--color-text-muted); padding: 32px; font-style: italic; }

  .dt-pagination { display: flex; align-items: center; gap: 12px; padding: 8px 0; justify-content: flex-end; }
  .pg-info { font-size: 12px; color: var(--color-text-muted); }
</style>
