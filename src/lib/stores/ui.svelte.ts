// src/lib/stores/ui.svelte.ts — Global UI state using Svelte 5 runes

// Sidebar collapsed state (persisted in sessionStorage)
function createSidebar() {
  let collapsed = $state(false);

  if (typeof window !== 'undefined') {
    const saved = sessionStorage.getItem('sidebar-collapsed');
    if (saved !== null) collapsed = saved === 'true';
  }

  return {
    get collapsed() { return collapsed; },
    toggle() {
      collapsed = !collapsed;
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('sidebar-collapsed', String(collapsed));
      }
    },
  };
}

// Theme (light | dark)
function createTheme() {
  let theme: 'light' | 'dark' = $state('light');

  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('emh-theme') as 'light' | 'dark' | null;
    if (saved) theme = saved;
  }

  return {
    get current() { return theme; },
    toggle() {
      theme = theme === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        localStorage.setItem('emh-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
      }
    },
    apply() {
      if (typeof window !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
      }
    },
  };
}

export const sidebar = createSidebar();
export const themeStore = createTheme();
