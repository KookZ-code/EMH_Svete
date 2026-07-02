<script lang="ts">
  import type { ActionData } from './$types'

  let { form }: { form: ActionData } = $props()
</script>

<svelte:head><title>Login — EMH Dashboard</title></svelte:head>

<div class="login-shell">
  <div class="login-card">
    <div class="login-brand">
      <span class="login-icon">⚡</span>
      <h1>EMH Dashboard</h1>
      <p>Equipment Maintenance & Health</p>
    </div>

    <form method="POST" class="login-form">

      {#if form?.error}
        <div class="login-error">{form.error}</div>
      {/if}

      <div class="form-group">
        <label class="label" for="username">Username</label>
        <input
          id="username" name="username" type="text" class="input"
          placeholder="Enter your username"
          autocomplete="username"
          value="guest"
          required
        />
      </div>

      <div class="form-group">
        <label class="label" for="password">Password</label>
        <input
          id="password" name="password" type="password" class="input"
          placeholder="••••••••"
          autocomplete="current-password"
          value="123456"
          required
        />
      </div>

      <button type="submit" class="btn btn-solid login-btn">
        Login
      </button>
    </form>

    <p class="login-footer">EMH v2.0 · Microchip Technology</p>
  </div>
</div>

<style>
  .login-shell {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-primary);
    background-image: linear-gradient(
      135deg,
      var(--color-primary) 0%,
      rgba(21,126,172,0.6) 100%
    );
    padding: 24px;
  }

  .login-card {
    background: var(--color-surface);
    border-radius: var(--r-md);
    padding: 40px 36px;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.24);
  }

  .login-brand {
    text-align: center;
    margin-bottom: 32px;
  }

  .login-icon {
    font-size: 36px;
    display: block;
    margin-bottom: 12px;
  }

  .login-brand h1 {
    font-size: 22px;
    font-weight: 700;
    color: var(--color-primary);
    margin-bottom: 4px;
  }

  .login-brand p {
    font-size: 13px;
    color: var(--color-text-muted);
    margin: 0;
  }

  .login-form { display: flex; flex-direction: column; gap: 16px; }

  .form-group { display: flex; flex-direction: column; gap: 6px; }

  .login-error {
    background: #FEE2E2;
    border: 1px solid var(--color-brand-red);
    color: var(--color-brand-red);
    font-size: 13px;
    padding: 10px 12px;
    border-radius: var(--r-sm);
  }

  .login-btn {
    width: 100%;
    justify-content: center;
    padding: 12px;
    font-size: 15px;
    margin-top: 4px;
  }

  .login-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .login-footer {
    text-align: center;
    font-size: 11px;
    color: var(--color-text-disabled);
    margin-top: 20px;
  }
</style>
