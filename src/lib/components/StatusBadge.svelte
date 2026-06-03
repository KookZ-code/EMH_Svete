<script lang="ts">
  import type { JobType, MachineStatus } from '$types';

  interface Props {
    type: JobType | MachineStatus | string;
    size?: 'sm' | 'md';
  }

  let { type, size = 'md' }: Props = $props();

  const colorMap: Record<string, string> = {
    'Running':            'var(--status-running)',
    'M/C Down':           'var(--status-down)',
    'M/C DOWN':           'var(--status-down)',
    'ENGINEERING DOWN':   'var(--status-eng-down)',
    'FACILITY DOWN':      'var(--status-facility)',
    'PM':                 'var(--status-pm)',
    'SETUP':              'var(--status-setup)',
    'SETUP BY OPERATOR':  'var(--status-setup)',
    'CONVERT':            'var(--status-convert)',
    'CLEAN MOLD':         'var(--status-running)',
    'CHANGE CAP':         'var(--status-other)',
    'Waiting':            'var(--status-waiting)',
    'Lost Time':          'var(--status-lost)',
    'Other':              'var(--status-other)',
    'On Process':         'var(--color-accent-blue)',
    'Closed':             'var(--color-text-muted)',
  };

  const color = $derived(colorMap[type] ?? 'var(--status-other)');

  function textColor(bg: string): string {
    // CONVERT is yellow — use dark text
    if (type === 'CONVERT') return '#333';
    return '#fff';
  }
</script>

<span class="badge size-{size}" style:background-color={color} style:color={textColor(color)}>
  {type}
</span>

<style>
  .badge {
    display: inline-block;
    font-weight: 700;
    border-radius: var(--r-sm);
    white-space: nowrap;
    line-height: 1;
  }

  .size-md { font-size: 11px; padding: 3px 8px; }
  .size-sm { font-size: 10px; padding: 2px 6px; }
</style>
