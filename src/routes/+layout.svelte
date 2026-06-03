<script lang="ts">
  import { page } from '$app/state';
  import '../app.css';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import { sidebar, themeStore } from '$lib/stores/ui.svelte';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => themeStore.apply());

  // Login page gets no sidebar
  const isLogin = $derived(page.url.pathname === '/login');
</script>

{#if isLogin}
  {@render children()}
{:else}
  <div class="app-shell" class:collapsed={sidebar.collapsed}>
    <Sidebar />
    <div class="main-wrap">
      <header class="topbar">
        <div class="tb-left">
          <!-- breadcrumb could go here -->
        </div>
        <div class="tb-right">
          <button class="tb-btn" onclick={() => themeStore.toggle()} title="Toggle dark mode">
            {themeStore.current === 'light' ? '🌙' : '☀️'}
          </button>
          <a href="/admin" class="tb-btn" title="Admin">⚙️</a>
        </div>
      </header>
      <main class="main-content">
        {@render children()}
      </main>
    </div>
  </div>
{/if}

<style>
  .app-shell {
    display: flex;
    min-height: 100vh;
  }

  .main-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .topbar {
    height: var(--topbar-h);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border-strong);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--gutter);
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .tb-right { display: flex; align-items: center; gap: 4px; }

  .tb-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    transition: background 0.12s;
    text-decoration: none;
  }

  .tb-btn:hover { background: var(--color-surface-gray); }

  .main-content {
    flex: 1;
    padding: var(--gutter);
    overflow-y: auto;
  }
</style>
