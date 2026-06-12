<script lang="ts">
  import { onMount } from 'svelte';

  export interface EChartClickParams {
    seriesName: string;
    name: string;
    value: unknown;
    data: unknown;
    dataIndex: number;
    seriesIndex: number;
  }

  interface Props {
    option: object;
    height?: string;
    loading?: boolean;
    onclick?: (params: EChartClickParams) => void;
  }

  let { option, height = '300px', loading = false, onclick }: Props = $props();

  type ChartInstance = {
    setOption: (o: object, r?: boolean) => void;
    resize: () => void;
    dispose: () => void;
    on:  (event: string, handler: (p: unknown) => void) => void;
    off: (event: string, handler: (p: unknown) => void) => void;
  };

  let el: HTMLDivElement;
  let chartInstance = $state<ChartInstance | null>(null);

  onMount(() => {
    let ro: ResizeObserver;
    import('echarts').then(({ init }) => {
      chartInstance = init(el) as ChartInstance;
      ro = new ResizeObserver(() => chartInstance?.resize());
      ro.observe(el);
    });
    return () => {
      ro?.disconnect();
      chartInstance?.dispose();
    };
  });

  $effect(() => {
    const opt = option;
    if (!chartInstance) return;
    chartInstance.setOption(opt, true);
  });

  // Register/deregister click handler whenever chartInstance or onclick changes.
  $effect(() => {
    if (!chartInstance || !onclick) return;
    const handler = onclick as (p: unknown) => void;
    chartInstance.on('click', handler);
    return () => chartInstance?.off('click', handler);
  });
</script>

<div class="echart-wrap" style:height>
  {#if loading}
    <div class="loading">Loading…</div>
  {/if}
  <div bind:this={el} class="echart-inner" style:opacity={loading || !chartInstance ? '0' : '1'}></div>
</div>

<style>
  .echart-wrap {
    position: relative;
    width: 100%;
  }
  .echart-inner {
    width: 100%;
    height: 100%;
    transition: opacity 0.2s;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    font-size: 13px;
  }
</style>
