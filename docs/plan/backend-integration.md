# Backend Integration Plan

## Architecture

```
Browser → api.ts → SvelteKit server routes → Middleware API (localhost:8000) → SQL Server
```

- **SvelteKit server routes** act as a proxy — `API_KEY` stays server-side, never in browser bundle
- **No CORS** issues — middleware calls happen server-to-server
- `api.ts` (client) keeps the same typed interface; server routes handle auth + data mapping

---

## Environment

**`.env`** (add):
```
API_BASE_URL=http://localhost:8000
API_KEY=mch_dev_12345
API_TIMEOUT=10000
```

---

## New Files

### 1. `src/lib/server/middleware.ts`
Server-only fetch wrapper. Adds `X-API-Key` header, handles errors, returns typed JSON.

### 2. SvelteKit server routes under `src/routes/api/`

| SvelteKit route | Middleware endpoint | Notes |
|---|---|---|
| `GET /api/overview` | `GET /api/v1/overview` | Returns `{kpi, matrix, donut}` bundled |
| `GET /api/overview/open-jobs` | `GET /api/v1/overview/open-jobs` | |
| `GET /api/live/machines` | `/api/v1/machines` + `/api/v1/overview/open-jobs` | Merge to derive `LiveMachine[]` |
| `GET /api/utilization/detail` | `GET /api/v1/utilization/detail` | One call, all charts |
| `GET /api/downtime/detail` | `GET /api/v1/downtime/detail` | One call, all charts |
| `GET /api/machines` | `GET /api/v1/machines` | Machine list + filter |
| `GET /api/machines/detail` | `GET /api/v1/machines/detail` | `?id=XXX` |
| `GET /api/techs/scores` | `GET /api/v1/tech/metrics` | Scoring calc in server route |
| `GET /api/inventory` | `/api/v1/inventory/machines` + `/api/v1/inventory/downtime` | |

---

## Modified Files

| File | Change |
|---|---|
| `src/lib/utils/api.ts` | Update paths to match new server routes; consolidate per-page calls |
| `src/lib/types/index.ts` | Add any missing types from real API shapes |
| `src/routes/+page.svelte` (Overview) | Replace mock → real API call, add loading/error states |
| `src/routes/live/+page.svelte` | Same |
| `src/routes/utilization/+page.svelte` | Same |
| `src/routes/downtime/+page.svelte` | Same |
| `src/routes/machine-detail/+page.svelte` | Same |
| `src/routes/timeline/+page.svelte` | Same (tech scores) |
| `src/routes/inventory/+page.svelte` | Same |

**Out of scope this session:** `/store-items`, `/admin`, `/wb-report` (no middleware endpoints for those).

---

## Data Mapping (middleware → TypeScript)

### `/api/v1/overview` → `OverviewKpi`
| Middleware field | TS field |
|---|---|
| `kpi.total_machines` | `key_machines` |
| `kpi.waiting` | `waiting_for_tech` |
| `kpi.down` | `mc_down` |
| `kpi.updated_at` | `last_updated` |
| `kpi.running` | `running` |
| `kpi.on_process` | `on_process` |
| `kpi.closed_this_shift` | `closed_this_shift` |

### `StatusMatrixRow` — no changes needed
Middleware already returns `{job_type, waiting, on_process, closed}`.

### `LiveMachine` derivation
- Machine list from `/api/v1/machines` = base data
- Open jobs from `/api/v1/overview/open-jobs` = current status, tech, symptom, elapsed

---

## Implementation Order

1. `.env` config
2. `src/lib/server/middleware.ts`
3. Server routes (one at a time, easiest first)
4. Update `api.ts`
5. Wire pages (Overview first, then others)

Each step is independently verifiable.
