<script lang="ts">
  import { base } from '$app/paths'
</script>

<svelte:head><title>403 — ไม่มีสิทธิ์เข้าถึง</title></svelte:head>

<div class="err-shell">
  <div class="err-card">
    <div class="err-code">403</div>
    <h1 class="err-title">ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
    <p class="err-desc">บัญชีของคุณไม่มีสิทธิ์เข้าถึงหน้าที่ร้องขอ<br>กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์เพิ่มเติม</p>
    <a href="{base}/" class="btn btn-solid">กลับหน้าหลัก</a>
  </div>
</div>

<style>
  .err-shell {
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
  }

  .err-card {
    text-align: center;
    max-width: 400px;
  }

  .err-code {
    font-size: 80px;
    font-weight: 800;
    color: var(--color-brand-red);
    line-height: 1;
    margin-bottom: 16px;
    opacity: 0.85;
  }

  .err-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 12px;
  }

  .err-desc {
    font-size: 14px;
    color: var(--color-text-muted);
    line-height: 1.6;
    margin-bottom: 28px;
  }
</style>
