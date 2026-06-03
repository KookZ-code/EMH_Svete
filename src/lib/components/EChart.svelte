<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    option: object;
    height?: string;
    loading?: boolean;
  }

  let { option, height = '300px', loading = false }: Props = $props();

  type ChartInstance = { setOption: (o: object, r?: boolean) => void; resize: () => void; dispose: () => void };

  let el: HTMLDivElement;
  let chartInstance = $state<ChartInstance | null>(null);

  onMount(() => {
    let ro: ResizeObserver;
    import('echarts').then(({ init }) => {
      chartInstance = init(el) as ChartInstance;   // setting $state triggers $effect
      ro = new ResizeObserver(() => chartInstance?.resize());
      ro.observe(el);
    });
    return () => {
      ro?.disconnect();
      chartInstance?.dispose();
    };
  });

  // Read option BEFORE the guard so Svelte always tracks it as a dependency,
  // even on the first run when chartInstance is still null.
  $effect(() => {
    const opt = option;
    if (!chartInstance) return;
    chartInstance.setOption(opt, true);
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
