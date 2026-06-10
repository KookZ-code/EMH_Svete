<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { sidebar } from '$lib/stores/ui.svelte';

  const navItems = [
    { icon: '🏭', label: 'Overview',         path: '/' },
    { icon: '📺', label: 'Live Board',       path: '/live' },
    { icon: '📊', label: 'Utilization',      path: '/utilization' },
    { icon: '📉', label: 'Downtime',         path: '/downtime' },
    { icon: '🖥️', label: 'Machine Detail',   path: '/machine-detail' },
    { icon: '👷', label: 'Tech Performance', path: '/timeline' },
    { icon: '📦', label: 'Inventory',        path: '/inventory' },
    { icon: '📋', label: 'WB Report',        path: '/wb-report' },
    { icon: '🔬', label: 'DA Report',        path: '/da-report' },
    { icon: '🏪', label: 'Store Items',      path: '/store-items' },
    { icon: '⚙️', label: 'Admin',            path: '/admin' },
  ];

  function isActive(path: string): boolean {
    const full = base + path;
    if (path === '/') return page.url.pathname === full || page.url.pathname === base + '/';
    return page.url.pathname.startsWith(full);
  }
</script>

<aside class="sidebar" class:collapsed={sidebar.collapsed}>
  <!-- Logo / brand -->
  <div class="sb-logo">
    {#if !sidebar.collapsed}
      <span class="sb-brand">EMH Dashboard</span>
    {:else}
      <span class="sb-brand-icon">⚡</span>
    {/if}
  </div>

  <!-- Nav links -->
  <nav class="sb-nav">
    {#each navItems as item (item.path)}
      <a
        href="{base}{item.path}"
        class="sb-item"
        class:active={isActive(item.path)}
        title={sidebar.collapsed ? item.label : ''}
      >
        <span class="sb-icon">{item.icon}</span>
        {#if !sidebar.collapsed}
          <span class="sb-label">{item.label}</span>
        {/if}
      </a>
    {/each}
  </nav>

  <!-- Collapse toggle -->
  <button class="sb-toggle" onclick={() => sidebar.toggle()} title="Toggle sidebar">
    {sidebar.collapsed ? '»' : '«'}
  </button>
</aside>

<style>
  .sidebar {
    width: var(--sidebar-w);
    min-height: 100vh;
    background-color: var(--color-primary);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    transition: width 0.2s ease;
    overflow: hidden;
    position: sticky;
    top: 0;
    height: 100vh;
  }

  .sidebar.collapsed { width: var(--sidebar-w-col); }

  /* Logo area */
  .sb-logo {
    height: 52px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    flex-shrink: 0;
  }

  .sb-brand {
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .sb-brand-icon {
    color: #FFD53A;
    font-size: 20px;
  }

  /* Nav */
  .sb-nav {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px 0;
  }

  .sb-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    color: rgba(255,255,255,0.75);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    border-left: 3px solid transparent;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .sb-item:hover {
    background-color: rgba(255,255,255,0.08);
    color: #fff;
  }

  .sb-item.active {
    background-color: rgba(255,255,255,0.12);
    color: #fff;
    border-left-color: #FFD53A;
  }

  .sb-icon {
    font-size: 16px;
    flex-shrink: 0;
    width: 22px;
    text-align: center;
  }

  .sb-label { overflow: hidden; }

  /* Collapse toggle */
  .sb-toggle {
    height: 40px;
    border: none;
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.6);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .sb-toggle:hover {
    background: rgba(255,255,255,0.12);
    color: #fff;
  }
</style>
